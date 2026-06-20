import { Router } from "express";
import { z } from "zod";
import { sqlite } from "../db/client.js";
import { parseConditions, evaluateConditions, matchRules, ruleMatches, type RuleCondition, type MatchableRule } from "../services/rule-match.js";
import { categoryAccepts } from "../services/category-utils.js";

export const rulesRouter = Router();

rulesRouter.get("/", (_req, res) => {
  type RuleRow = {
    id: number; pattern: string; conditions: string | null; is_locked: number; created_at: string;
    category_id: number; category_name: string; category_color: string; category_type: string;
  };

  const rules = sqlite
    .prepare(
      `SELECT r.id, r.pattern, r.conditions, r.is_locked, r.created_at,
              c.id as category_id, c.name as category_name, c.color as category_color, c.type as category_type
       FROM category_rules r
       JOIN categories c ON r.category_id = c.id
       ORDER BY r.is_locked DESC, r.created_at DESC`
    )
    .all() as RuleRow[];

  // Load descriptions + category once; count only transactions actually assigned to this rule's category
  const txns = sqlite
    .prepare("SELECT description, category_id FROM transactions")
    .all() as { description: string; category_id: number | null }[];

  const result = rules.map((rule) => {
    const match_count = txns.filter(
      (t) => t.category_id === rule.category_id && ruleMatches(rule, t.description)
    ).length;
    return { ...rule, match_count };
  });

  res.json(result);
});

const conditionSchema = z.object({
  pattern: z.string().min(1),
  op: z.enum(["AND", "OR"]).optional(),
});

const createSchema = z.object({
  conditions: z.array(conditionSchema).min(1),
  category_id: z.number().int().positive(),
});

// POST / — create a rule manually (always is_locked = 1)
rulesRouter.post("/", (req, res) => {
  // Route must be defined before /bulk-category to avoid shadowing — see express registration order in app.
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const { conditions, category_id } = parsed.data;
  const pattern = conditions[0].pattern;
  const conditionsJson = JSON.stringify(conditions);

  try {
    const result = sqlite
      .prepare("INSERT INTO category_rules (pattern, conditions, category_id, is_locked) VALUES (?, ?, ?, 1)")
      .run(pattern, conditionsJson, category_id);

    const id = result.lastInsertRowid;

    // Apply to all non-manual transactions matching the conditions
    applyConditionsToTransactions(category_id, conditions);

    const created = sqlite.prepare(`
      SELECT r.id, r.pattern, r.conditions, r.is_locked, r.created_at,
             c.id as category_id, c.name as category_name, c.color as category_color,
             (SELECT COUNT(*) FROM transactions t WHERE normalize(t.description) LIKE '%' || normalize(r.pattern) || '%') as match_count
      FROM category_rules r JOIN categories c ON r.category_id = c.id WHERE r.id = ?
    `).get(id);
    res.status(201).json(created);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Pravilo s tem primarnim vzorcem že obstaja" });
    } else throw e;
  }
});

const updateSchema = z.object({
  conditions: z.array(conditionSchema).min(1).optional(),
  category_id: z.number().int().positive().optional(),
});

rulesRouter.put("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const { conditions, category_id } = parsed.data;
  if (conditions === undefined && category_id === undefined) {
    res.status(400).json({ error: "Ni sprememb" }); return;
  }

  const updates: string[] = [];
  const vals: unknown[] = [];

  if (conditions !== undefined) {
    updates.push("pattern = ?");       vals.push(conditions[0].pattern);
    updates.push("conditions = ?");    vals.push(JSON.stringify(conditions));
    updates.push("is_locked = 1");
  }
  if (category_id !== undefined) {
    updates.push("category_id = ?");  vals.push(category_id);
  }

  vals.push(id);

  try {
    sqlite.transaction(() => {
      sqlite.prepare(`UPDATE category_rules SET ${updates.join(", ")} WHERE id = ?`).run(...vals);

      // Re-apply to all non-manually-assigned transactions when category changes
      if (category_id !== undefined) {
        const rule = sqlite
          .prepare("SELECT pattern, conditions FROM category_rules WHERE id = ?")
          .get(id) as { pattern: string; conditions: string | null } | undefined;
        if (rule) {
          const conds = parseConditions(rule.conditions, rule.pattern);
          applyConditionsToTransactions(category_id, conds);
        }
      }
    })();

    const updated = sqlite.prepare(`
      SELECT r.id, r.pattern, r.conditions, r.is_locked, r.created_at,
             c.id as category_id, c.name as category_name, c.color as category_color,
             (SELECT COUNT(*) FROM transactions t WHERE normalize(t.description) LIKE '%' || normalize(r.pattern) || '%') as match_count
      FROM category_rules r JOIN categories c ON r.category_id = c.id WHERE r.id = ?
    `).get(id);
    res.json(updated);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Pravilo s tem vzorcem že obstaja" });
    } else throw e;
  }
});

rulesRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  sqlite.prepare("DELETE FROM category_rules WHERE id = ?").run(id);
  res.status(204).end();
});

const bulkSchema = z.object({
  rule_ids: z.array(z.number().int().positive()).min(1),
  category_id: z.number().int().positive(),
});

rulesRouter.post("/bulk-category", (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const { rule_ids, category_id } = parsed.data;

  type CondRow = { id: number; pattern: string; conditions: string | null };
  const placeholders = rule_ids.map(() => "?").join(", ");

  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE category_rules SET category_id = ? WHERE id IN (${placeholders})`).run(category_id, ...rule_ids);

    const rules = sqlite
      .prepare(`SELECT id, pattern, conditions FROM category_rules WHERE id IN (${placeholders})`)
      .all(...rule_ids) as CondRow[];

    for (const rule of rules) {
      const conds = parseConditions(rule.conditions, rule.pattern);
      applyConditionsToTransactions(category_id, conds);
    }
  })();

  res.json({ updated: rule_ids.length });
});

/**
 * Apply a category to non-manual transactions that match the given conditions,
 * respecting rule priority (locked first, then longer patterns first).
 * After matching, each candidate is re-evaluated against ALL rules in priority
 * order so that a more-specific rule always wins over a less-specific one.
 */
function applyConditionsToTransactions(
  categoryId: number,
  conditions: RuleCondition[]
): void {
  const catType = (
    sqlite.prepare("SELECT type FROM categories WHERE id = ?").get(categoryId) as
      | { type: string }
      | undefined
  )?.type;
  if (!catType) return;

  const txns = sqlite
    .prepare("SELECT id, description, type FROM transactions WHERE is_manual = 0")
    .all() as { id: number; description: string; type: "income" | "expense" }[];

  // Only transactions whose type this category can hold are candidates — a rule
  // pointing at an income category never touches an expense transaction.
  const candidates = txns.filter(
    (t) => categoryAccepts(catType, t.type) && evaluateConditions(t.description, conditions)
  );
  if (candidates.length === 0) return;

  // Load ALL rules in priority order so the most-specific rule wins, plus a
  // category-type lookup to keep the winning rule type-compatible.
  const allRules = sqlite
    .prepare("SELECT pattern, conditions, category_id, is_locked FROM category_rules ORDER BY is_locked DESC, length(pattern) DESC")
    .all() as MatchableRule[];
  const catTypeById = new Map(
    (sqlite.prepare("SELECT id, type FROM categories").all() as { id: number; type: string }[]).map(
      (c) => [c.id, c.type]
    )
  );

  const update = sqlite.prepare("UPDATE transactions SET category_id = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const t of candidates) {
      const matched = matchRules(t.description, allRules);
      const correctCatId =
        matched !== null && categoryAccepts(catTypeById.get(matched), t.type) ? matched : categoryId;
      update.run(correctCatId, t.id);
    }
  })();
}
