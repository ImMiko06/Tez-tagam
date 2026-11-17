'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
} : {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'teztagam',
  user: process.env.PGUSER || 'tez_tagam_app',
  password: process.env.PGPASSWORD,
  max: 10,
});
const root = __dirname;
const seed = (file) => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function saveOrder(client, order) {
  const inserted = await client.query(
    `INSERT INTO orders (id, customer_name, customer_phone, customer_address, subtotal, delivery_fee, total, status, customer_id, courier_id, courier_name, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [order.id, order.customer.name, order.customer.phone, order.customer.address, order.subtotal,
      order.deliveryFee, order.total, order.status, order.customerId || null, order.courierId || null, order.courierName || null, order.createdAt]
  );
  if (!inserted.rowCount) return;
  for (const item of order.items) {
    await client.query(
      `INSERT INTO order_items (order_id,dish_id,dish_name,restaurant_id,restaurant_name,price,quantity)
       VALUES ($1,(SELECT id FROM dishes WHERE id=$2),$3,(SELECT id FROM restaurants WHERE id=$4),$5,$6,$7)`,
      [order.id, item.id || null, item.name, item.restaurantId || null, item.restaurant || 'Ресторан', item.price, item.quantity]
    );
  }
  for (const event of order.statusHistory || [{ status: order.status, at: order.createdAt }]) {
    await client.query(
      'INSERT INTO order_status_history (order_id,status,changed_at) VALUES ($1,$2,$3)',
      [order.id, event.status, event.at]
    );
  }
}

async function initialize() {
  await pool.query(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));

  const restaurants = seed('restaurants.json');
  for (const r of restaurants) {
    await pool.query(
      `INSERT INTO restaurants (id,name,cuisine,area,delivery,emoji,bg,tag,url,logo,cover)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,cuisine=EXCLUDED.cuisine,area=EXCLUDED.area,
       delivery=EXCLUDED.delivery,emoji=EXCLUDED.emoji,bg=EXCLUDED.bg,tag=EXCLUDED.tag,url=EXCLUDED.url,logo=EXCLUDED.logo,cover=EXCLUDED.cover`,
      [r.id,r.name,r.cuisine,r.area,r.delivery,r.emoji,r.bg,r.tag,r.url,r.logo || null,r.cover || null]
    );
  }
  const dishes = seed('menu.json');
  for (const d of dishes) {
    await pool.query(
      `INSERT INTO dishes (id,restaurant_id,name,category,price,rating,emoji,bg,tag,description,photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET restaurant_id=EXCLUDED.restaurant_id,name=EXCLUDED.name,category=EXCLUDED.category,
       price=EXCLUDED.price,rating=EXCLUDED.rating,emoji=EXCLUDED.emoji,bg=EXCLUDED.bg,tag=EXCLUDED.tag,
       description=EXCLUDED.description,photo=EXCLUDED.photo`,
      [d.id,d.restaurantId,d.name,d.category,Number(d.price),Number(d.rating || 4.8),d.emoji,d.bg,d.tag,d.desc,d.photo || null]
    );
  }

  const couriers = seed('couriers.json');
  for (const c of couriers) {
    await pool.query(
      `INSERT INTO couriers (id,name,email,salt,password_hash) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,salt=EXCLUDED.salt,password_hash=EXCLUDED.password_hash`,
      [c.id,c.name,c.email,c.salt,c.passwordHash]
    );
  }
  const existing = await pool.query('SELECT COUNT(*)::int AS count FROM orders');
  if (existing.rows[0].count === 0) {
    const oldOrders = seed('orders.json');
    await withTransaction(async (client) => {
      for (const order of oldOrders) await saveOrder(client, order);
    });
    console.log(`Imported ${oldOrders.length} existing orders into PostgreSQL.`);
  }
  return { restaurants, dishes };
}

async function loadOrder(id, executor = pool) {
  const result = await executor.query('SELECT * FROM orders WHERE id=$1', [id]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  const [items, history] = await Promise.all([
    executor.query('SELECT dish_id,dish_name,restaurant_id,restaurant_name,price,quantity FROM order_items WHERE order_id=$1 ORDER BY id', [id]),
    executor.query('SELECT status,changed_at FROM order_status_history WHERE order_id=$1 ORDER BY changed_at,id', [id]),
  ]);
  return {
    id: row.id,
    customerId: row.customer_id || undefined,
    customer: { name: row.customer_name, phone: row.customer_phone, address: row.customer_address },
    items: items.rows.map((x) => ({ id: x.dish_id, name: x.dish_name, restaurantId: x.restaurant_id, restaurant: x.restaurant_name, price: x.price, quantity: x.quantity })),
    subtotal: row.subtotal, deliveryFee: row.delivery_fee, total: row.total, status: row.status,
    statusHistory: history.rows.map((x) => ({ status: x.status, at: x.changed_at.toISOString() })),
    createdAt: row.created_at.toISOString(), courierId: row.courier_id || undefined, courierName: row.courier_name || undefined,
  };
}

async function getOrders() {
  const rows = await pool.query('SELECT id FROM orders ORDER BY created_at DESC');
  return Promise.all(rows.rows.map((x) => loadOrder(x.id)));
}
async function getOrder(id) { return loadOrder(id); }
async function createOrder(order) {
  await withTransaction((client) => saveOrder(client, order));
  return getOrder(order.id);
}
async function updateStatus(id, status) {
  return withTransaction(async (client) => {
    const updated = await client.query('UPDATE orders SET status=$2 WHERE id=$1 RETURNING id', [id, status]);
    if (!updated.rowCount) return null;
    await client.query('INSERT INTO order_status_history (order_id,status) VALUES ($1,$2)', [id, status]);
    return loadOrder(id, client);
  });
}
async function claimOrder(id, courier) {
  return withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE orders SET courier_id=$2,courier_name=$3 WHERE id=$1 AND status='Ready for pickup' AND courier_id IS NULL RETURNING id`,
      [id,courier.id,courier.name]
    );
    if (!updated.rowCount) return null;
    return loadOrder(id, client);
  });
}
async function listCouriers() {
  const result = await pool.query('SELECT id,name,email,salt,password_hash AS "passwordHash" FROM couriers ORDER BY id');
  return result.rows;
}
async function createCustomer(customer) {
  const result = await pool.query(
    `INSERT INTO customers (id,full_name,email,phone,password_salt,password_hash)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id,full_name AS name,email,phone,created_at AS "createdAt"`,
    [customer.id,customer.name,customer.email,customer.phone,customer.salt,customer.passwordHash]
  );
  return result.rows[0];
}
async function findCustomerByEmail(email) {
  const result = await pool.query(
    `SELECT id,full_name AS name,email,phone,password_salt AS salt,password_hash AS "passwordHash",created_at AS "createdAt"
     FROM customers WHERE email=$1`, [email]
  );
  return result.rows[0] || null;
}
async function getCustomer(id) {
  const result = await pool.query('SELECT id,full_name AS name,email,phone,created_at AS "createdAt" FROM customers WHERE id=$1',[id]);
  return result.rows[0] || null;
}
async function getCustomerOrders(id) {
  const result = await pool.query('SELECT id FROM orders WHERE customer_id=$1 ORDER BY created_at DESC',[id]);
  return Promise.all(result.rows.map((x) => loadOrder(x.id)));
}
async function getCatalog() {
  const [restaurants,dishes] = await Promise.all([
    pool.query('SELECT * FROM restaurants ORDER BY name'),
    pool.query('SELECT d.id,d.name,d.restaurant_id AS "restaurantId",r.name AS restaurant,d.category,d.price,d.rating::text,d.emoji,d.bg,d.tag,d.description AS "desc",d.photo FROM dishes d JOIN restaurants r ON r.id=d.restaurant_id ORDER BY d.id'),
  ]);
  return { restaurants: restaurants.rows, dishes: dishes.rows };
}

module.exports = { pool, initialize, getCatalog, listCouriers, createCustomer, findCustomerByEmail, getCustomer, getCustomerOrders, getOrders, getOrder, createOrder, updateStatus, claimOrder };
