import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

type ProductRow = {
  id: number;
  title: string;
  category: string;
  price: string | number;
  stock: number;
  image: string;
};

// One shared connection pool per function instance, reused across requests.
let database: ReturnType<typeof getDatabase> | undefined;
const getDb = () => (database ??= getDatabase());

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const error = (message: string, status: number) => json({ error: message }, status);

// Postgres returns NUMERIC as a string and SERIAL as a number; the frontend expects
// numeric prices and string ids.
const toProduct = (row: ProductRow) => ({
  id: String(row.id),
  title: row.title,
  category: row.category,
  price: Number(row.price),
  stock: Number(row.stock),
  image: row.image,
});

function parseProduct(body: any) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const image = typeof body?.image === "string" ? body.image.trim() : "";
  const price = Number(body?.price);
  const stock = Number(body?.stock);

  if (!title) return { error: "Product title is required." };
  if (!category) return { error: "Product category is required." };
  if (!Number.isFinite(price) || price < 0) return { error: "Price must be a non-negative number." };
  if (!Number.isInteger(stock) || stock < 0) return { error: "Stock must be a non-negative whole number." };

  return { value: { title, category, price, stock, image } };
}

function parseId(raw: string | undefined) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function listProducts() {
  const rows = (await getDb().sql`SELECT * FROM products ORDER BY id`) as ProductRow[];
  return json(rows.map(toProduct));
}

async function createProduct(req: Request) {
  const parsed = parseProduct(await req.json().catch(() => null));
  if (parsed.error) return error(parsed.error, 400);
  const { title, category, price, stock, image } = parsed.value!;

  const [row] = (await getDb().sql`
    INSERT INTO products (title, category, price, stock, image)
    VALUES (${title}, ${category}, ${price}, ${stock}, ${image})
    RETURNING *
  `) as ProductRow[];
  return json(toProduct(row), 201);
}

async function updateProduct(req: Request, id: number) {
  const parsed = parseProduct(await req.json().catch(() => null));
  if (parsed.error) return error(parsed.error, 400);
  const { title, category, price, stock, image } = parsed.value!;

  const [row] = (await getDb().sql`
    UPDATE products
    SET title = ${title}, category = ${category}, price = ${price}, stock = ${stock}, image = ${image}
    WHERE id = ${id}
    RETURNING *
  `) as ProductRow[];
  if (!row) return error("Product not found.", 404);
  return json(toProduct(row));
}

async function deleteProduct(id: number) {
  const rows = (await getDb().sql`DELETE FROM products WHERE id = ${id} RETURNING id`) as { id: number }[];
  if (rows.length === 0) return error("Product not found.", 404);
  return json({ deleted: String(id) });
}

async function checkout(req: Request) {
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0) return error("Your cart is empty.", 400);

  // Merge duplicate lines and validate quantities.
  const quantities = new Map<number, number>();
  for (const item of items) {
    const id = parseId(String(item?.id));
    const qty = Number(item?.qty);
    if (!id || !Number.isInteger(qty) || qty <= 0) return error("Invalid cart item.", 400);
    quantities.set(id, (quantities.get(id) ?? 0) + qty);
  }
  const ids = [...quantities.keys()];

  const client = await getDb().pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the rows so concurrent checkouts can't oversell.
    const { rows } = await client.query<ProductRow>(
      "SELECT * FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const product = byId.get(id);
      if (!product) {
        await client.query("ROLLBACK");
        return error("One of the products in your cart is no longer available.", 409);
      }
      if (product.stock < quantities.get(id)!) {
        await client.query("ROLLBACK");
        return error(`Only ${product.stock} unit(s) of "${product.title}" left in stock.`, 409);
      }
    }

    for (const id of ids) {
      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [quantities.get(id), id]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return listProducts();
}

export default async (req: Request, context: Context) => {
  const { pathname } = new URL(req.url);

  try {
    if (pathname === "/api/checkout") {
      if (req.method === "POST") return await checkout(req);
      return error("Method not allowed", 405);
    }

    if (context.params.id !== undefined) {
      const id = parseId(context.params.id);
      if (!id) return error("Product not found.", 404);
      if (req.method === "PUT") return await updateProduct(req, id);
      if (req.method === "DELETE") return await deleteProduct(id);
      return error("Method not allowed", 405);
    }

    if (req.method === "GET") return await listProducts();
    if (req.method === "POST") return await createProduct(req);
    return error("Method not allowed", 405);
  } catch (err) {
    console.error("API error:", err);
    return error("A database error occurred. Please try again.", 500);
  }
};

export const config: Config = {
  path: ["/api/products", "/api/products/:id", "/api/checkout"],
};
