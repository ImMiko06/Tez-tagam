'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = require('./database');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const statusLabels = ['Received','Preparing','Ready for pickup','On the way','Delivered','Cancelled'];
let restaurants = [];
let menu = [];
let couriers = [];
let initialization;
function send(res, code, data) {
  res.status(code).set({'Cache-Control':'no-store'}).json(data);
}
function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 65536) { reject(new Error('Слишком большой запрос.')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Некорректные данные запроса.')); } });
    req.on('error', reject);
  });
}
function clean(value, max = 200) { return String(value || '').trim().replace(/[<>]/g, '').slice(0, max); }
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.VERCEL) throw new Error('Добавьте SESSION_SECRET в переменные окружения Vercel.');
  return process.env.PGPASSWORD || 'tez-tagam-local-development-secret-change-before-deploy';
}
function createToken(subject, role) {
  const payload = Buffer.from(JSON.stringify({sub:subject,role,exp:Math.floor(Date.now()/1000)+60*60})).toString('base64url');
  const signature = crypto.createHmac('sha256',sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function tokenSubject(req, role) {
  const token=(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  const [payload,signature,...extra]=token.split('.');
  if (!payload || !signature || extra.length) return null;
  const expected=crypto.createHmac('sha256',sessionSecret()).update(payload).digest();
  let supplied;
  try { supplied=Buffer.from(signature,'base64url'); } catch { return null; }
  if (supplied.length!==expected.length || !crypto.timingSafeEqual(supplied,expected)) return null;
  try {
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return data.role===role && data.sub && data.exp>Date.now()/1000 ? data.sub : null;
  } catch { return null; }
}
function currentCourier(req) { return tokenSubject(req,'courier'); }
function currentCustomer(req) { return tokenSubject(req,'customer'); }
function requireCourier(req, res) {
  const courierId = currentCourier(req);
  if (!courierId) { send(res, 401, {error:'Войдите в аккаунт курьера.'}); return null; }
  const courier=couriers.find((x) => x.id === courierId) || null;
  if (!courier) send(res,401,{error:'Сессия курьера недействительна. Войдите снова.'});
  return courier;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'64kb'}));
app.use(express.static(path.join(ROOT,'public'),{index:'index.html',fallthrough:true,etag:false,maxAge:0}));
app.use(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    await ensureInitialized();
    if (req.method === 'GET' && pathname === '/api/menu') return send(res, 200, {items:menu, categories:['Все', ...new Set(menu.map((x) => x.category))]});
    if (req.method === 'GET' && pathname === '/api/restaurants') return send(res, 200, {restaurants});

    if (req.method === 'POST' && pathname === '/api/users/register') {
      const body = await readBody(req);
      const name = clean(body.name,100);
      const email = clean(body.email,160).toLowerCase();
      const phone = clean(body.phone,32);
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || typeof body.password !== 'string' || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/.test(body.password)) {
        return send(res,400,{error:'Укажите имя, корректную почту, телефон и пароль от 8 символов: нужны строчная и заглавная латинские буквы и цифра.'});
      }
      const salt = crypto.randomBytes(16).toString('hex');
      // The server assigns customer IDs; the browser never chooses primary keys.
      const customer = {id:`CUS-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,name,email,phone,salt,passwordHash:crypto.scryptSync(body.password,salt,64).toString('hex')};
      try {
        const saved = await db.createCustomer(customer);
        const token = createToken(saved.id,'customer');
        return send(res,201,{token,customer:saved});
      } catch (error) {
        if (error.code === '23505') return send(res,409,{error:'Пользователь с такой электронной почтой уже зарегистрирован.'});
        throw error;
      }
    }

    if (req.method === 'POST' && pathname === '/api/users/login') {
      const body = await readBody(req);
      const email = clean(body.email,160).toLowerCase();
      const lock = await db.getLoginLock(email);
      if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) return send(res,429,{error:'Слишком много попыток. Попробуйте снова через 15 минут.'});
      const customer = await db.findCustomerByEmail(email);
      if (!customer || typeof body.password !== 'string') {
        const failed = await db.recordLoginFailure(email);
        return send(res,failed.locked_until?429:401,{error:failed.locked_until?'Слишком много попыток. Попробуйте снова через 15 минут.':'Неверная почта или пароль.'});
      }
      const candidate = crypto.scryptSync(body.password,customer.salt,64);
      const expected = Buffer.from(customer.passwordHash,'hex');
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate,expected)) {
        const failed = await db.recordLoginFailure(email);
        return send(res,failed.locked_until?429:401,{error:failed.locked_until?'Слишком много попыток. Попробуйте снова через 15 минут.':'Неверная почта или пароль.'});
      }
      await db.clearLoginFailures(email);
      const token = createToken(customer.id,'customer');
      return send(res,200,{token,customer:{id:customer.id,name:customer.name,email:customer.email,phone:customer.phone,createdAt:customer.createdAt}});
    }

    if (pathname.startsWith('/api/users/')) {
      const customerId = currentCustomer(req);
      if (!customerId) return send(res,401,{error:'Войдите в аккаунт покупателя.'});
      if (req.method === 'GET' && pathname === '/api/users/me') {
        const customer = await db.getCustomer(customerId);
        return customer ? send(res,200,{customer}) : send(res,404,{error:'Аккаунт не найден.'});
      }
      if (req.method === 'GET' && pathname === '/api/users/orders') return send(res,200,{orders:await db.getCustomerOrders(customerId)});
      return send(res,404,{error:'Маршрут аккаунта не найден.'});
    }

    if (req.method === 'POST' && pathname === '/api/orders') {
      const body = await readBody(req);
      const customer = {name:clean(body.customer?.name,80), phone:clean(body.customer?.phone,32), address:clean(body.customer?.address,240)};
      const customerId = currentCustomer(req);
      if (!customer.name || !customer.phone || !customer.address) return send(res, 400, {error:'Укажите имя, телефон и адрес доставки.'});
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return send(res, 400, {error:'Корзина пуста или содержит ошибку.'});
      const lines = [];
      for (const raw of body.items) {
        const dish = menu.find((x) => x.id === raw.id);
        const quantity = Number(raw.quantity);
        if (!dish || !Number.isInteger(quantity) || quantity < 1 || quantity > 30) return send(res, 400, {error:'Некорректная позиция в заказе. Проверьте корзину.'});
        lines.push({id:dish.id, name:dish.name, restaurant:dish.restaurant, restaurantId:dish.restaurantId, price:Number(dish.price), quantity});
      }
      const subtotal = lines.reduce((sum, x) => sum + x.price * x.quantity, 0);
      const now = new Date().toISOString();
      const order = {id:`TT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`, customer, customerId, items:lines, subtotal, deliveryFee:700,
        total:subtotal + 700, status:'Received', statusHistory:[{status:'Received',at:now}], createdAt:now};
      return send(res, 201, {order:await db.createOrder(order)});
    }

    if (req.method === 'POST' && pathname === '/api/courier/login') {
      const body = await readBody(req);
      const email = clean(body.email,160).toLowerCase();
      const lock = await db.getLoginLock(email);
      if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) return send(res,429,{error:'Слишком много попыток. Попробуйте снова через 15 минут.'});
      const courier = couriers.find((x) => x.email.toLowerCase() === email);
      if (!courier || typeof body.password !== 'string') {
        const failed = await db.recordLoginFailure(email);
        return send(res,failed.locked_until?429:401,{error:failed.locked_until?'Слишком много попыток. Попробуйте снова через 15 минут.':'Неверная почта или пароль.'});
      }
      const candidate = crypto.scryptSync(body.password,courier.salt,64);
      const expected = Buffer.from(courier.passwordHash,'hex');
      if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate,expected)) {
        const failed = await db.recordLoginFailure(email);
        return send(res,failed.locked_until?429:401,{error:failed.locked_until?'Слишком много попыток. Попробуйте снова через 15 минут.':'Неверная почта или пароль.'});
      }
      await db.clearLoginFailures(email);
      const token = createToken(courier.id,'courier');
      return send(res,200,{token,courier:{id:courier.id,name:courier.name,email:courier.email}});
    }

    if (pathname.startsWith('/api/courier/')) {
      const courier = requireCourier(req,res);
      if (!courier) return;
      if (req.method === 'GET' && pathname === '/api/courier/me') return send(res,200,{courier:{id:courier.id,name:courier.name,email:courier.email}});
      if (req.method === 'GET' && pathname === '/api/courier/orders') {
        const orders = await db.getOrders();
        return send(res,200,{available:orders.filter((o) => o.status === 'Ready for pickup' && !o.courierId),mine:orders.filter((o) => o.courierId === courier.id)});
      }
      const claim = pathname.match(/^\/api\/courier\/orders\/([A-Z0-9-]+)\/claim$/i);
      if (claim && req.method === 'POST') {
        const existing = await db.getOrder(claim[1]);
        if (!existing) return send(res,404,{error:'Заказ не найден.'});
        const order = await db.claimOrder(existing.id,courier);
        if (!order) return send(res,409,{error:'Заказ уже принят другим курьером или ещё не готов.'});
        return send(res,200,{order});
      }
      const courierUpdate = pathname.match(/^\/api\/courier\/orders\/([A-Z0-9-]+)\/status$/i);
      if (courierUpdate && req.method === 'PATCH') {
        const order = await db.getOrder(courierUpdate[1]);
        if (!order) return send(res,404,{error:'Заказ не найден.'});
        if (order.courierId !== courier.id) return send(res,403,{error:'Этот заказ не назначен вашему аккаунту.'});
        const body = await readBody(req);
        const allowed = order.status === 'Ready for pickup' ? ['On the way','Cancelled'] : order.status === 'On the way' ? ['Delivered','Cancelled'] : [];
        if (!allowed.includes(body.status)) return send(res,409,{error:'Этот статус сейчас нельзя установить.'});
        return send(res,200,{order:await db.updateStatus(order.id,body.status)});
      }
      return send(res,404,{error:'Маршрут курьера не найден.'});
    }

    if (req.method === 'GET' && pathname === '/api/orders') return send(res,200,{orders:await db.getOrders()});
    const orderMatch = pathname.match(/^\/api\/orders\/([A-Z0-9-]+)$/i);
    if (orderMatch && req.method === 'GET') {
      const order = await db.getOrder(orderMatch[1]);
      return order ? send(res,200,{order}) : send(res,404,{error:'Заказ не найден. Проверьте его номер.'});
    }
    if (orderMatch && req.method === 'PATCH') {
      const order = await db.getOrder(orderMatch[1]);
      if (!order) return send(res,404,{error:'Заказ не найден.'});
      const body = await readBody(req);
      const allowed = order.status === 'Received' ? ['Preparing','Cancelled'] : order.status === 'Preparing' ? ['Ready for pickup','Cancelled'] : [];
      if (!allowed.includes(body.status) || !statusLabels.includes(body.status)) return send(res,409,{error:'Этот статус сейчас нельзя установить в кабинете ресторана.'});
      return send(res,200,{order:await db.updateStatus(order.id,body.status)});
    }
    if (pathname.startsWith('/api/')) return send(res,404,{error:'Маршрут API не найден.'});
    return send(res,404,{error:'Маршрут API не найден.'});
  } catch (error) {
    if (!res.headersSent) send(res,500,{error:'Сервер не смог выполнить запрос.'});
    console.error(error);
  }
});

async function ensureInitialized() {
  if (!initialization) {
    initialization=(async()=>{
      if (process.env.VERCEL && !process.env.DATABASE_URL) throw new Error('Добавьте DATABASE_URL с подключением к PostgreSQL в Vercel.');
      if (process.env.VERCEL && !process.env.SESSION_SECRET) throw new Error('Добавьте SESSION_SECRET в переменные окружения Vercel.');
      const catalog=await db.initialize();
      restaurants=catalog.restaurants;
      menu=catalog.dishes;
      couriers=await db.listCouriers();
    })();
  }
  return initialization;
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const badJson=error?.type==='entity.parse.failed';
  send(res,badJson?400:500,{error:badJson?'Некорректный JSON в запросе.':'Сервер не смог выполнить запрос.'});
  if (!badJson) console.error(error);
});

async function start() {
  try {
    await ensureInitialized();
    app.listen(PORT,'127.0.0.1',() => console.log(`Tez Tagam is running at http://127.0.0.1:${PORT} (PostgreSQL)`));
  } catch (error) {
    console.error('Не удалось подключиться к PostgreSQL. Проверьте .env и запущенную службу PostgreSQL.',error.message);
    process.exitCode = 1;
  }
}
if (require.main === module) start();
module.exports = app;
