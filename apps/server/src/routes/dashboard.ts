import { Router } from "express";
import { sqlite } from "../db/client.js";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const where: string[] = [];
  const params: string[] = [];
  if (from) { where.push("date >= ?"); params.push(from); }
  if (to) { where.push("date <= ?"); params.push(to); }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const row = sqlite
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense,
        COUNT(*) as transaction_count
       FROM transactions ${whereClause}`
    )
    .get(...params) as { total_income: number; total_expense: number; transaction_count: number };

  // The real account balance is the running balance (stanje) of the most recent
  // transaction in the period, in true booking order — NOT income minus expense
  // (which double-counts cross-statement currency conversions and ignores the bank's
  // own balance chain). Falls back to null if no balance is recorded for the period.
  const tWhere = where.map((w) => `t.${w}`);
  const balWhere = [...tWhere, "t.stanje IS NOT NULL"].join(" AND ");
  const balRow = sqlite
    .prepare(
      `SELECT t.stanje as ending_balance
       FROM transactions t
       LEFT JOIN uploaded_files uf ON uf.id = t.file_id
       WHERE ${balWhere}
       ORDER BY COALESCE(uf.statement_date, t.date) DESC, t.id DESC
       LIMIT 1`
    )
    .get(...params) as { ending_balance: number } | undefined;

  res.json({
    ...row,
    balance: row.total_income - row.total_expense,
    ending_balance: balRow?.ending_balance ?? null,
  });
});

dashboardRouter.get("/monthly-trend", (req, res) => {
  const { year, from, to } = req.query as { year?: string; from?: string; to?: string };
  const where: string[] = [];
  const params: string[] = [];
  if (year) { where.push("strftime('%Y', date) = ?"); params.push(year); }
  else {
    if (from) { where.push("date >= ?"); params.push(from); }
    if (to) { where.push("date <= ?"); params.push(to); }
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = sqlite
    .prepare(
      `SELECT
        strftime('%Y-%m', date) as month,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
       FROM transactions ${whereClause}
       GROUP BY month ORDER BY month`
    )
    .all(...params);

  res.json(rows);
});

dashboardRouter.get("/by-category", (req, res) => {
  const { from, to, type } = req.query as { from?: string; to?: string; type?: string };
  const where: string[] = [];
  const params: string[] = [];
  if (from) { where.push("t.date >= ?"); params.push(from); }
  if (to) { where.push("t.date <= ?"); params.push(to); }
  if (type) { where.push("t.type = ?"); params.push(type); }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = sqlite
    .prepare(
      `SELECT
        COALESCE(c.id, 0) as id,
        COALESCE(c.name, 'Nekategorizirano') as name,
        COALESCE(c.color, '#94a3b8') as color,
        COALESCE(c.type, 'expense') as category_type,
        COUNT(t.id) as count,
        COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount ELSE 0 END), 0) as income_total,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as expense_total,
        COALESCE(SUM(t.amount), 0) as total
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       ${whereClause}
       GROUP BY c.id ORDER BY total DESC`
    )
    .all(...params) as Array<{ total: number; income_total: number; expense_total: number } & Record<string, unknown>>;

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  res.json(rows.map((r) => ({ ...r, percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0 })));
});

dashboardRouter.get("/years", (_req, res) => {
  const rows = sqlite
    .prepare("SELECT DISTINCT strftime('%Y', date) as year FROM transactions ORDER BY year DESC")
    .all() as Array<{ year: string }>;
  res.json(rows.map((r) => r.year));
});
