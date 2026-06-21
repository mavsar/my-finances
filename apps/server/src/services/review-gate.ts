import { sqlite } from "../db/client.js";
import { normalize } from "./rule-match.js";
import type { SmartCatResult } from "./smart-categorize.js";

type EmitFn = (event: Record<string, unknown>) => void;

export interface ReviewProposalGroup {
  key: string;
  name: string;
  type: "income" | "expense" | "both";
  color: string;
  reason: string;
  count: number;
  /** A few example descriptions shown in the modal. */
  samples: string[];
  /** All descriptions in this group — used server-side to reassign transactions. */
  descriptions: string[];
}

export interface ReviewDecision {
  key: string;
  action: "create" | "merge" | "skip";
  name?: string;
  type?: "income" | "expense" | "both";
  color?: string;
  mergeCategoryId?: number;
}

// Distinct-ish palette for freshly suggested categories (user can change it).
const SUGGESTION_COLORS = [
  "#f43f5e", "#fb923c", "#facc15", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#818cf8", "#c084fc", "#f472b6",
];

/**
 * How many non-manual transactions a proposed group would actually capture. This
 * mirrors the reassign query, so the modal count and the drop threshold reflect
 * real rows (one description can cover many transactions).
 */
function countGroupTransactions(descriptions: string[], type: "income" | "expense" | "both"): number {
  if (descriptions.length === 0) return 0;
  const unique = [...new Set(descriptions)];
  const placeholders = unique.map(() => "normalize(?)").join(", ");
  const typeClause = type === "both" ? "" : " AND type = ?";
  const sql = `SELECT COUNT(*) AS c FROM transactions WHERE is_manual = 0 AND normalize(description) IN (${placeholders})${typeClause}`;
  const params: unknown[] = [...unique];
  if (type !== "both") params.push(type);
  return (sqlite.prepare(sql).get(...params) as { c: number }).c;
}

/**
 * Group per-description proposals into distinct suggested categories.
 *
 * `count` is the real number of transactions each group would capture. Groups that
 * would hold only one or two transactions are dropped entirely — those rows stay
 * in the "Ostali …" fallback instead of spawning a barely-used category. This runs
 * once at the end of the job, so the counts are final (a description that looked
 * lonely early on may have many siblings by the time we get here).
 */
export function buildProposalGroups(results: SmartCatResult[]): ReviewProposalGroup[] {
  const MIN_TRANSACTIONS = 3; // drop groups with 1–2 transactions
  const groups = new Map<string, ReviewProposalGroup>();
  let colorIdx = 0;

  for (const r of results) {
    if (!r.proposal) continue;
    const key = `${normalize(r.proposal.name)}|${r.proposal.type}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: r.proposal.name,
        type: r.proposal.type,
        color: SUGGESTION_COLORS[colorIdx++ % SUGGESTION_COLORS.length],
        reason: r.proposal.reason,
        count: 0,
        samples: [],
        descriptions: [],
      };
      groups.set(key, g);
    }
    g.descriptions.push(r.description);
    if (g.samples.length < 5) g.samples.push(r.description);
  }

  const out: ReviewProposalGroup[] = [];
  for (const g of groups.values()) {
    g.count = countGroupTransactions(g.descriptions, g.type);
    if (g.count < MIN_TRANSACTIONS) continue; // too small → leave in "Ostali …"
    out.push(g);
  }
  return out;
}

// ── Pause / resume gate ─────────────────────────────────────────────────────

interface Pending {
  resolve: (decisions: ReviewDecision[]) => void;
  timeout: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();

/**
 * Emit a `needs_review` event and block until the client submits decisions via
 * {@link submitReview}. If no answer arrives within `timeoutMs`, every group is
 * treated as "skip" so the job can never hang forever.
 */
export function requestReview(
  jobId: string,
  groups: ReviewProposalGroup[],
  emit: EmitFn,
  timeoutMs = 10 * 60 * 1000
): Promise<ReviewDecision[]> {
  // Don't leak the full description lists to the client — samples are enough.
  emit({
    type: "needs_review",
    groups: groups.map((g) => ({
      key: g.key,
      name: g.name,
      type: g.type,
      color: g.color,
      reason: g.reason,
      count: g.count,
      samples: g.samples,
    })),
  });

  return new Promise<ReviewDecision[]>((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(jobId);
      resolve([]);
    }, timeoutMs);
    pending.set(jobId, { resolve, timeout });
  });
}

/** Resolve a pending review with the user's decisions. Returns false if none pending. */
export function submitReview(jobId: string, decisions: ReviewDecision[]): boolean {
  const p = pending.get(jobId);
  if (!p) return false;
  clearTimeout(p.timeout);
  pending.delete(jobId);
  p.resolve(decisions);
  return true;
}

export function hasPendingReview(jobId: string): boolean {
  return pending.has(jobId);
}

// ── Apply decisions ─────────────────────────────────────────────────────────

/**
 * Apply the user's review decisions: create/merge categories, persist exact-match
 * auto rules, and reassign the matching transactions away from the fallback.
 */
export function applyReviewDecisions(
  groups: ReviewProposalGroup[],
  decisions: ReviewDecision[],
  emit?: EmitFn
): { categoriesCreated: number; transactionsAssigned: number } {
  const groupByKey = new Map(groups.map((g) => [g.key, g]));
  const decisionByKey = new Map(decisions.map((d) => [d.key, d]));

  const insertCategory = sqlite.prepare("INSERT INTO categories (name, color, type) VALUES (?, ?, ?)");
  const findCategoryByName = sqlite.prepare("SELECT id, type FROM categories WHERE name = ?");
  const findCategoryById = sqlite.prepare("SELECT id, type FROM categories WHERE id = ?");
  const insertRule = sqlite.prepare(
    "INSERT INTO category_rules (pattern, category_id, is_locked) VALUES (?, ?, 0) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id WHERE is_locked = 0"
  );
  const reassign = sqlite.prepare(
    `UPDATE transactions SET category_id = ?
     WHERE is_manual = 0 AND normalize(description) = normalize(?) AND (? = 'both' OR type = ?)`
  );

  let categoriesCreated = 0;
  let transactionsAssigned = 0;

  const run = sqlite.transaction(() => {
    for (const group of groups) {
      const decision = decisionByKey.get(group.key);
      if (!decision || decision.action === "skip") continue;

      let categoryId: number;
      let categoryType: string;

      if (decision.action === "create") {
        const name = (decision.name ?? group.name).trim();
        const type = decision.type ?? group.type;
        const color = decision.color ?? group.color;
        const existing = findCategoryByName.get(name) as { id: number; type: string } | undefined;
        if (existing) {
          categoryId = existing.id;
          categoryType = existing.type;
        } else {
          const { lastInsertRowid } = insertCategory.run(name, color, type);
          categoryId = Number(lastInsertRowid);
          categoryType = type;
          categoriesCreated++;
        }
      } else {
        // merge
        const target = decision.mergeCategoryId
          ? (findCategoryById.get(decision.mergeCategoryId) as { id: number; type: string } | undefined)
          : undefined;
        if (!target) continue;
        categoryId = target.id;
        categoryType = target.type;
      }

      // The reassign is type-guarded (only updates rows the category can hold),
      // so an income category merged onto an expense row simply won't match.
      for (const desc of group.descriptions) {
        insertRule.run(desc, categoryId);
        const info = reassign.run(categoryId, desc, categoryType, categoryType);
        transactionsAssigned += info.changes ?? 0;
      }
    }
  });
  run();

  emit?.({ type: "review_applied", categoriesCreated, transactionsAssigned });
  return { categoriesCreated, transactionsAssigned };
}
