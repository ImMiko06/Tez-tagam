# Tez Tagam

Учебный сайт доставки еды по Алматы: витрина, кабинет ресторана и кабинет курьера. Сервер Node.js сохраняет каталог и заказы в PostgreSQL.

## Запуск на этом компьютере

Нужны Node.js 18+ и установленный PostgreSQL 17. Проект использует отдельную локальную базу PostgreSQL на порту `5433`, чтобы не менять системный сервер. Данные экземпляра базы хранятся в игнорируемой папке `.postgres-data/`, пароль приложения — в локальном `.env`.

```powershell
npm install
npm run db:start
npm start
```

Откройте [http://127.0.0.1:4173](http://127.0.0.1:4173). Чтобы остановить сайт, нажмите `Ctrl+C`; остановить локальную базу можно командой `npm run db:stop`.

## База данных

Имя базы: `teztagam`. Подключение приложения задаётся переменными в `.env` (пример — `.env.example`). Не отправляйте файл `.env` другим людям: он содержит пароль.

Таблицы описаны в [`db/schema.sql`](db/schema.sql):

- `restaurants` — рестораны Алматы;
- `dishes` — блюда, категории, цены и фотографии;
- `couriers` — аккаунты курьеров и хеши паролей;
- `customers` — зарегистрированные покупатели (имя, электронная почта, телефон и хеш пароля);
- `orders` — покупатель, адрес, сумма и текущий статус; `customer_id` связывает заказ с аккаунтом;
- `order_items` — состав заказа и цены на момент покупки;
- `order_status_history` — история движения заказа.

Архив базы с текущими таблицами и данными: [`db/teztagam_dump.sql`](db/teztagam_dump.sql). Для восстановления в уже созданную пустую БД `teztagam` выполните `psql -h 127.0.0.1 -p 5433 -U tez_tagam_app -d teztagam -f db/teztagam_dump.sql`. Для подключения на другом компьютере настройте `.env` под параметры его PostgreSQL.

При первом запуске сервер загружает рестораны и блюда из `data/*.json`, импортирует старые заказы и аккаунт курьера. Дальше новые заказы и изменения статусов записываются в PostgreSQL.

Подключиться к базе через pgAdmin можно с параметрами из `.env` (`Host`, `Port`, `Maintenance database`, `Username`, `Password`). Например, посмотреть каталог и заказы можно таким SQL:

```sql
SELECT id, name, cuisine FROM restaurants ORDER BY name;
SELECT id, name, restaurant_id, price FROM dishes ORDER BY restaurant_id, name;
SELECT id, name, email, phone, created_at FROM customers ORDER BY created_at DESC;
SELECT id, name, email FROM couriers ORDER BY id;
SELECT id, customer_id, courier_id, customer_name, total, status, created_at FROM orders ORDER BY created_at DESC;
SELECT o.id AS order_id, c.id AS customer_id, c.name AS customer, cr.id AS courier_id, cr.name AS courier, o.total, o.status
FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN couriers cr ON cr.id = o.courier_id
ORDER BY o.created_at DESC;
SELECT id AS item_id, order_id, dish_id, restaurant_id, dish_name, restaurant_name, quantity, price FROM order_items ORDER BY order_id, id;
SELECT id AS history_id, order_id, status, changed_at FROM order_status_history ORDER BY order_id, changed_at;
```

## Регистрация покупателя и роли

На главной странице нажмите **«Войти / Регистрация»** и создайте аккаунт. Сервер автоматически присваивает ID вида `CUS-...`; он появляется в профиле после регистрации. Пользователь не вводит свой первичный ключ вручную. Данные профиля сохраняются в PostgreSQL в таблице `customers`; пароли хранятся только в виде хеша. После входа новые заказы автоматически связываются с аккаунтом по `orders.customer_id`. В pgAdmin откройте `teztagam → Schemas → public → Tables → customers`, затем правой кнопкой по `customers` → **View/Edit Data → All Rows**. ID записей уже предусмотрены во всех таблицах: у ресторанов/блюд/покупателей/курьеров/заказов это `id`, в `order_items` и `order_status_history` — числовые `id`, а поля `customer_id`, `courier_id`, `restaurant_id`, `dish_id` и `order_id` связывают записи между таблицами.

## Демо-роли

- **Покупатель:** регистрация и вход, выбор блюд, корзина, оформление заказа и история заказов в профиле.
- **Ресторан:** `/kitchen.html`, меняет статус заказа на «Готовится» и «Ожидает курьера».
- **Курьер:** `/courier.html`, логин `courier@teztagam.kz`, пароль `tez2026`. Может принять готовый заказ и отметить доставку.

Каталог включает 12 ресторанов и 58 примеров блюд. Цены показаны для демонстрации и не обновляются в реальном времени.

## Публикация на Vercel

Приложение экспортирует Express-сервер из `server.js`; страницы и браузерные файлы находятся в `public/`, как требует Vercel. При локальном запуске тот же сервер обслуживает сайт и API. Сессии подписываются секретным ключом, поэтому вход не зависит от памяти отдельного процесса.

Для облачного запуска:

1. Создайте PostgreSQL-проект в Neon и скопируйте **pooled connection string**.
2. Загрузите проект в GitHub и импортируйте репозиторий в Vercel.
3. В настройках Vercel → **Environment Variables** добавьте `DATABASE_URL` (строка подключения Neon) и `SESSION_SECRET` (длинная случайная строка). Не публикуйте эти значения и не загружайте `.env` в GitHub.
4. Нажмите Deploy. При первом запросе сервер создаст таблицы по `db/schema.sql` и заполнит каталог из `data/*.json`.

Бесплатный тариф Vercel Hobby подходит для личных и учебных проектов; его лимиты указаны в [документации Vercel](https://vercel.com/docs/plans/hobby).

## Основные файлы

- `public/index.html`, `public/styles.css`, `public/app.js` — сайт покупателя;
- `public/kitchen.html`, `public/kitchen.js` — кабинет ресторана;
- `public/courier.html`, `public/courier.js` — кабинет курьера;
- `server.js` — Express-сервер и API, совместимый с Vercel;
- `database.js` — подключение к PostgreSQL, первичная загрузка каталога и работа с заказами;
- `db/schema.sql` — SQL-структура базы;
- `data/menu.json`, `data/restaurants.json` — исходные данные каталога;
- `data/orders.json`, `data/couriers.json` — данные для однократного переноса в базу.

Это учебный проект: аккаунт курьера демонстрационный, кабинет ресторана пока без авторизации, оплата и реальная диспетчеризация не подключены.

## Защита аккаунтов

Пароль покупателя: от 8 до 128 символов, латинские заглавная и строчная буквы и цифра. Пароли хранятся как хеши scrypt с отдельной случайной солью. Email уникален без учёта регистра, номер телефона уникален после удаления форматирующих символов. Авторизованный пользователь может сменить пароль в профиле, подтвердив текущий пароль; новый пароль проверяется по тем же требованиям и хешируется с новой солью. После 5 ошибочных входов адрес блокируется на 15 минут; сессия действует 1 час. Защита применяется к покупателям и курьерам. В проекте предусмотрены три типа профиля: покупатель (регистрация и личный кабинет), курьер (кабинет курьера), ресторан (доска заказов). Профиль покупателя показывается автоматически после регистрации и доступен через кнопку аккаунта.
