CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cuisine TEXT NOT NULL,
  area TEXT NOT NULL,
  delivery TEXT NOT NULL,
  emoji TEXT NOT NULL,
  bg TEXT NOT NULL,
  tag TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT,
  cover TEXT
);

CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  rating NUMERIC(2,1) NOT NULL DEFAULT 4.8,
  emoji TEXT NOT NULL,
  bg TEXT NOT NULL,
  tag TEXT NOT NULL,
  description TEXT NOT NULL,
  photo TEXT
);

CREATE TABLE IF NOT EXISTS couriers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_lower_unique_idx ON customers (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_digits_unique_idx ON customers (REGEXP_REPLACE(phone, '[^0-9]', '', 'g'));

CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  delivery_lat DOUBLE PRECISION,
  delivery_lng DOUBLE PRECISION,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  delivery_fee INTEGER NOT NULL CHECK (delivery_fee >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('Received','Preparing','Ready for pickup','On the way','Delivered','Cancelled')),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  courier_id TEXT REFERENCES couriers(id) ON DELETE SET NULL,
  courier_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id TEXT REFERENCES dishes(id) ON DELETE SET NULL,
  dish_name TEXT NOT NULL,
  restaurant_id TEXT REFERENCES restaurants(id) ON DELETE SET NULL,
  restaurant_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_courier_idx ON orders(courier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_history_order_idx ON order_status_history(order_id, changed_at);
