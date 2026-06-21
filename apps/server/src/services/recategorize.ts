import { sqlite } from "../db/client.js";
import { matchRules, findMatchingRule, type MatchableRule } from "./rule-match.js";
import { categoryAccepts, getDefaultCategoryId } from "./category-utils.js";
import { smartCategorize, type SmartCatInput, type SmartCatResult, type NewCategoryProposal } from "./smart-categorize.js";
import { buildProposalGroups, requestReview, applyReviewDecisions } from "./review-gate.js";

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
  scope: "all" | "uncategorized" | "category",
  jobId: string,
  emit?: EmitFn,
  categoryIds?: number[]
): Promise<{ totalProcessed: number; rulesApplied: number; geminiApplied: number }> {
  const categories = sqlite
    .prepare("SELECT id, name, type FROM categories")
    .all() as Array<{ id: number; name: string; type: string }>;

  const catById = new Map(categories.map((c) => [c.id, c.type]));

  const rules = sqlite
    .prepare("SELECT pattern, conditions, category_id, is_locked FROM category_rules ORDER BY is_locked DESC, length(pattern) DESC")
    .all() as MatchableRule[];

  // Transactions always carry a category now, so "uncategorized" means the rows
  // still parked in the fallback ("Ostali …") categories.
  const defaultIds = [getDefaultCategoryId("income"), getDefaultCategoryId("expense")];

  // Categories whose existing auto-rule assignment should NOT be trusted as sticky
  // (those rows get re-evaluated by the AI). Defaults are always re-evaluated; for a
  // category-scoped run we also re-evaluate the targeted categories, otherwise their
  // own auto rules would just keep every row exactly where it is.
  const reEvalIds = new Set(defaultIds);

  let where: string;
  if (scope === "category" && categoryIds && categoryIds.length > 0) {
    const ids = categoryIds.map(String).join(", ");
    where = `WHERE is_manual = 0 AND category_id IN (${ids})`;
    for (const id of categoryIds) reEvalIds.add(id);
  } else if (scope === "uncategorized") {
    where = `WHERE is_manual = 0 AND category_id IN (${defaultIds.join(", ")})`;
  } else {
    where = "WHERE is_manual = 0";
  }

  const transactions = sqlite
    .prepare(`SELECT id, description, type FROM transactions ${where}`)
    .all() as TxnRow[];

  emit?.({ type: "start", total: transactions.length });

  // --- Phase 1: apply rules ---
  const needsGemini: TxnRow[] = [];
  let rulesApplied = 0;

  const updateCat = sqlite.prepare("UPDATE transactions SET category_id = ? WHERE id = ?");

  const total = transactions.length;
  let scanned = 0;
  for (const txn of transactions) {
    const matched = findMatchingRule(txn.description, rules);
    // Trust a rule only if it's a locked (user) rule, or an auto rule that points
    // to a REAL category. An auto rule pointing at a fallback ("Ostali …") is a
    // stale placeholder from an earlier run — re-attempt it with the AI instead of
    // letting it short-circuit categorization.
    const strong =
      matched !== null &&
      categoryAccepts(catById.get(matched.category_id), txn.type as "income" | "expense") &&
      (matched.is_locked === 1 || !reEvalIds.has(matched.category_id));
    if (strong) {
      updateCat.run(matched!.category_id, txn.id);
      rulesApplied++;
    } else {
      needsGemini.push(txn);
    }
    scanned++;
    // Keep the bar alive while scanning large sets against the rules.
    if (scanned % 1000 === 0) {
      emit?.({ type: "rules_progress", scanned, total, rulesApplied });
    }
  }

  emit?.({ type: "rules_applied", count: rulesApplied, remaining: needsGemini.length });

  // --- Phase 2: web-grounded AI for unmatched ---
  let geminiApplied = 0;

  // Upsert (not INSERT OR IGNORE) so a fresh AI decision overwrites a stale
  // auto rule that previously pointed the same description at a fallback.
  const insertRule = sqlite.prepare(
    "INSERT INTO category_rules (pattern, category_id, is_locked) VALUES (?, ?, 0) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id WHERE is_locked = 0"
  );

  // Unique descriptions (carrying their transaction type) to research.
  const unknownItems: SmartCatInput[] = [];
  const seenUnknown = new Set<string>();
  for (const t of needsGemini) {
    const key = `${t.type}|${t.description}`;
    if (seenUnknown.has(key)) continue;
    seenUnknown.add(key);
    unknownItems.push({ description: t.description, type: t.type as "income" | "expense" });
  }

  const proposalResults: SmartCatResult[] = [];

  // Group the unmatched transactions by description so a resolved description can
  // be applied to every matching row immediately (giving a live, per-batch count).
  const txnsByKey = new Map<string, TxnRow[]>();
  for (const t of needsGemini) {
    const key = `${t.type}|${t.description}`;
    const list = txnsByKey.get(key);
    if (list) list.push(t);
    else txnsByKey.set(key, [t]);
  }

  if (unknownItems.length > 0) {
    const BATCH = 20;
    const totalUnique = unknownItems.length;
    const totalBatches = Math.ceil(totalUnique / BATCH);
    emit?.({ type: "gemini_start", totalBatches, totalUnique });

    // Proposed categories accumulate across batches so the model reuses earlier
    // names instead of inventing near-duplicates ("Davki in dajatve" vs "Davki & plačila").
    const carriedProposals: NewCategoryProposal[] = [];

    let processed = 0;
    for (let i = 0; i < totalBatches; i++) {
      const batch = unknownItems.slice(i * BATCH, (i + 1) * BATCH);

      // Announce the batch BEFORE the (slow, grounded) call so the UI reacts at once.
      emit?.({
        type: "gemini_batch_start",
        batchIndex: i + 1,
        totalBatches,
        processed,
        totalUnique,
      });

      const results = await smartCategorize(batch, categories, carriedProposals);

      sqlite.transaction(() => {
        for (const r of results) {
          if (r.category_id !== null && categoryAccepts(catById.get(r.category_id), r.type)) {
            // Persist the decision and apply it to every matching row right away.
            insertRule.run(r.description, r.category_id);
            for (const t of txnsByKey.get(`${r.type}|${r.description}`) ?? []) {
              updateCat.run(r.category_id, t.id);
              geminiApplied++;
            }
          } else if (r.proposal) {
            proposalResults.push(r);
            const key = `${r.proposal.name.toLowerCase()}|${r.proposal.type}`;
            if (!carriedProposals.some((p) => `${p.name.toLowerCase()}|${p.type}` === key)) {
              carriedProposals.push(r.proposal);
            }
          }
        }
      })();

      processed += batch.length;
      emit?.({
        type: "gemini_batch",
        batchIndex: i + 1,
        totalBatches,
        processed,
        totalUnique,
        geminiApplied,
        proposals: proposalResults.length,
      });
    }
  }

  // --- Phase 3: review suggested new categories, then apply ---
  const groups = buildProposalGroups(proposalResults);
  if (groups.length > 0) {
    emit?.({
      type: "step",
      step: "review",
      message: `AI predlaga ${groups.length} ${groups.length === 1 ? "novo kategorijo" : "novih kategorij"} — potreben pregled.`,
    });
    const decisions = await requestReview(jobId, groups, (e) => emit?.(e));
    applyReviewDecisions(groups, decisions, (e) => emit?.(e));
  }

  // --- Phase 4: fallback — anything still unplaced goes to the default ---
  // Existing-category matches and accepted review groups both created exact-match
  // auto rules, so re-running rule matching tells us exactly what is now placed;
  // everything else falls back to "Ostali …".
  const finalRules = sqlite
    .prepare("SELECT pattern, conditions, category_id, is_locked FROM category_rules ORDER BY is_locked DESC, length(pattern) DESC")
    .all() as MatchableRule[];
  // Reload category types: the review may have created brand-new categories that
  // aren't in the snapshot above. Without this, a row just assigned to a new
  // category would look "unknown" here and get wrongly reset to the fallback.
  const catTypeById = new Map(
    (sqlite.prepare("SELECT id, type FROM categories").all() as Array<{ id: number; type: string }>)
      .map((c) => [c.id, c.type])
  );
  sqlite.transaction(() => {
    for (const t of needsGemini) {
      const m = matchRules(t.description, finalRules);
      if (m !== null && categoryAccepts(catTypeById.get(m), t.type as "income" | "expense")) continue;
      updateCat.run(getDefaultCategoryId(t.type as "income" | "expense"), t.id);
    }
  })();

  emit?.({
    type: "done",
    totalProcessed: transactions.length,
    rulesApplied,
    geminiApplied,
  });

  return { totalProcessed: transactions.length, rulesApplied, geminiApplied };
}
