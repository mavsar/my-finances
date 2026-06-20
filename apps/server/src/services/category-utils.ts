import { sqlite } from "../db/client.js";

export type CategoryType = "income" | "expense" | "both";
export type TransactionType = "income" | "expense";

/**
 * Whether a category of the given type can hold a transaction of `txnType`.
 * "both" categories (e.g. Interactive Brokers) accept income and expense alike;
 * strict categories only accept their own type.
 */
export function categoryAccepts(
  categoryType: string | undefined,
  txnType: TransactionType
): boolean {
  return categoryType === "both" || categoryType === txnType;
}

const defaultStmt = sqlite.prepare(
  "SELECT id FROM categories WHERE is_default = 1 AND type = ? LIMIT 1"
);

/**
 * The fallback category id for a transaction type — "Ostali prihodki" for income,
 * "Ostali odhodki" for expense. Every transaction must have a category, so this is
 * used whenever no rule/AI/manual choice yields a compatible one.
 */
export function getDefaultCategoryId(txnType: TransactionType): number {
  const row = defaultStmt.get(txnType) as { id: number } | undefined;
  if (!row) {
    throw new Error(`Privzeta kategorija za tip "${txnType}" ne obstaja`);
  }
  return row.id;
}
