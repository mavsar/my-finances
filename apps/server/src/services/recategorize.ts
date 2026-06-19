import { sqlite } from "../db/client.js";
import { categorizeBatchWithGemini } from "./gemini.js";
import { matchRules, type MatchableRule } from "./rule-match.js";

type EmitFn = (event: Record<string, unknown>) => void;

interface TxnRow {
  id: number;
  description: string;
  type: string;
}

export function applyRuleToDescription(description: string): number | null {
  const rules = sqlite
    .prepare("SELECT pattern, conditions, category_id, is_locked FROM category_rules ORDER BY is_locked DESC, length(pattern) DESC")
    .all() as MatchableRule[];
  return matchRules(description, rules);
}

export async function recategorizeAll(
  scope: "all" | "uncategorized",
  emit?: EmitFn
): Promise<{ totalProcessed: number; rulesApplied: number; geminiApplied: number }> {
  const categories = sqlite
    .prepare("SELECT id, name, type FROM categories")
    .all() as Array<{ id: number; name: string; type: string }>;

  const catById = new Map(categories.map((c) => [c.id, c.type as "income" | "expense"]));

  const rules = sqlite
    .prepare("SELECT pattern, conditions, category_id, is_locked FROM category_rules ORDER BY is_locked DESC, length(pattern) DESC")
    .all() as MatchableRule[];

  const where =
    scope === "uncategorized"
      ? "WHERE is_manual = 0 AND category_id IS NULL"
      : "WHERE is_manual = 0";

  const transactions = sqlite
    .prepare(`SELECT id, description, type FROM transactions ${where}`)
    .all() as TxnRow[];

  emit?.({ type: "start", total: transactions.length });

  // --- Phase 1: apply rules ---
  const needsGemini: TxnRow[] = [];
  let rulesApplied = 0;

  const updateCat = sqlite.prepare("UPDATE transactions SET category_id = ? WHERE id = ?");

  for (const txn of transactions) {
    const catId = matchRules(txn.description, rules);
    if (catId !== null && catById.get(catId) === txn.type) {
      updateCat.run(catId, txn.id);
      rulesApplied++;
    } else {
      needsGemini.push(txn);
    }
  }

  emit?.({ type: "rules_applied", count: rulesApplied, remaining: needsGemini.length });

  // --- Phase 2: Gemini for unmatched ---
  let geminiApplied = 0;

  // Persist every Gemini decision as an exact-match auto rule keyed by the full
  // description, so the same description is matched automatically next time
  // (and overrides Gemini going forward).
  const insertRule = sqlite.prepare(
    "INSERT OR IGNORE INTO category_rules (pattern, category_id, is_locked) VALUES (?, ?, 0)"
  );
  const descById = new Map<number, string>(needsGemini.map((t) => [t.id, t.description]));

  if (needsGemini.length > 0) {
    const BATCH = 100;
    const batches: TxnRow[][] = [];
    for (let i = 0; i < needsGemini.length; i += BATCH) {
      batches.push(needsGemini.slice(i, i + BATCH));
    }

    emit?.({ type: "gemini_start", totalBatches: batches.length });

    for (let i = 0; i < batches.length; i++) {
      try {
        const results = await categorizeBatchWithGemini(batches[i], categories);

        sqlite.transaction(() => {
          for (const r of results) {
            if (r.category_id && catById.get(r.category_id) === needsGemini.find((t) => t.id === r.id)?.type) {
              updateCat.run(r.category_id, r.id);
              geminiApplied++;
              const desc = descById.get(r.id);
              if (desc) insertRule.run(desc, r.category_id);
            }
          }
        })();
      } catch (err) {
        console.error(`Gemini batch ${i + 1} failed:`, err);
      }

      emit?.({
        type: "gemini_batch",
        batchIndex: i + 1,
        totalBatches: batches.length,
        processed: Math.min((i + 1) * BATCH, needsGemini.length),
      });
    }
  }

  emit?.({
    type: "done",
    totalProcessed: transactions.length,
    rulesApplied,
    geminiApplied,
  });

  return { totalProcessed: transactions.length, rulesApplied, geminiApplied };
}
