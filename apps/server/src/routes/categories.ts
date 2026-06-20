import { Router } from "express";
import { z } from "zod";
import { sqlite } from "../db/client.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", (_req, res) => {
  const categories = sqlite
    .prepare(
      `SELECT c.*,
        COUNT(t.id) as transaction_count,
        COALESCE(SUM(t.amount), 0) as total_amount
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id
       GROUP BY c.id
       ORDER BY c.name`
    )
    .all();
  res.json(categories);
});

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  type: z.enum(["income", "expense", "both"]),
});

categoriesRouter.post("/", (req, res) => {
  const result = categorySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues });
    return;
  }
  const { name, color, type } = result.data;
  try {
    const { lastInsertRowid } = sqlite
      .prepare("INSERT INTO categories (name, color, type) VALUES (?, ?, ?)")
      .run(name, color, type);
    res.status(201).json(sqlite.prepare("SELECT * FROM categories WHERE id = ?").get(lastInsertRowid));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Kategorija s tem imenom že obstaja" });
    } else {
      throw e;
    }
  }
});

categoriesRouter.put("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const result = categorySchema.partial().safeParse(req.body);
  if (!result.success) { res.status(400).json({ error: result.error.issues }); return; }

  const existing = sqlite.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!existing) { res.status(404).json({ error: "Kategorija ne obstaja" }); return; }

  const { name, color, type } = result.data;
  const updates: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) { updates.push("name = ?"); values.push(name); }
  if (color !== undefined) { updates.push("color = ?"); values.push(color); }
  if (type !== undefined) { updates.push("type = ?"); values.push(type); }
  if (updates.length === 0) { res.json(existing); return; }
  values.push(id);

  try {
    sqlite.transaction(() => {
      sqlite.prepare(`UPDATE categories SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      // Narrowing a category's type (e.g. "both" → "income") evicts the
      // transactions it can no longer hold, moving them to the fallback category
      // for their own type so nothing is left in an incompatible category.
      if (type !== undefined && type !== "both") {
        sqlite
          .prepare(
            `UPDATE transactions
             SET category_id = (SELECT id FROM categories WHERE is_default = 1 AND type = transactions.type),
                 is_manual = 0
             WHERE category_id = ? AND type != ?`
          )
          .run(id, type);
      }
    })();
    res.json(sqlite.prepare("SELECT * FROM categories WHERE id = ?").get(id));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Kategorija s tem imenom že obstaja" });
    } else {
      throw e;
    }
  }
});

categoriesRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const existing = sqlite
    .prepare("SELECT is_default FROM categories WHERE id = ?")
    .get(id) as { is_default: number } | undefined;
  if (!existing) { res.status(404).json({ error: "Kategorija ne obstaja" }); return; }
  if (existing.is_default) {
    res.status(400).json({ error: "Privzete kategorije ni mogoče izbrisati" });
    return;
  }

  // Every transaction must keep a category, so reassign affected rows to the
  // fallback for their type before deleting (the FK is RESTRICT, not SET NULL).
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE transactions
         SET category_id = (SELECT id FROM categories WHERE is_default = 1 AND type = transactions.type)
         WHERE category_id = ?`
      )
      .run(id);
    sqlite.prepare("DELETE FROM categories WHERE id = ?").run(id);
  })();
  res.status(204).end();
});
