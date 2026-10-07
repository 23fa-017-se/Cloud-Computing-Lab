CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the default CommerceHub catalog once, only while the table is empty.
INSERT INTO products (title, category, price, stock, image)
SELECT title, category, price, stock, image
FROM (VALUES
  ('Minimalist Watch', 'Accessories', 129.99, 12, 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80'),
  ('Wireless Earbuds Pro', 'Electronics', 89.50, 25, 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&q=80'),
  ('Classic Leather Jacket', 'Apparel', 199.00, 8, 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500&q=80'),
  ('Smart Fitness Tracker', 'Electronics', 49.99, 30, 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=500&q=80')
) AS seed(title, category, price, stock, image)
WHERE NOT EXISTS (SELECT 1 FROM products);
