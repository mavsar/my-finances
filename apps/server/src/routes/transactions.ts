import { Router, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { sqlite } from "../db/client.js";
import { recategorizeAll } from "../services/recategorize.js";
import { categoryAccepts } from "../services/category-utils.js";

export const transactionsRouter = Router();

// ── List ─────────────────────────────────────────────────────────────────────

transactionsRouter.get("/", (req, res) => {
  const { from, to, category_id, type, search, word, limit = "50", offset = "0" } = req.query as Record<string, string>;

  const where: string[] = [];
  const params: unknown[] = [];

  if (from) { where.push("t.date >= ?"); params.push(from); }
  if (to) { where.push("t.date <= ?"); params.push(to); }
  if (category_id) { where.push("t.category_id = ?"); params.push(Number(category_id)); }
  if (type) { where.push("t.type = ?"); params.push(type); }
  if (search?.trim()) {
    if (word === "1") {
      where.push("word_match(t.description, ?)");
    } else {
      where.push("normalize(t.description) LIKE '%' || normalize(?) || '%'");
    }
    params.push(search.trim());
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const lim = Math.min(Number(limit) || 50, 100_000);
  const off = Number(offset) || 0;

  const rows = sqlite
    .prepare(
      `SELECT t.id, t.date, t.description, t.prejemnik, t.amount, t.type, t.is_manual,
              t.stanje, t.category_id, c.name as category_name, c.color as category_color
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN uploaded_files uf ON uf.id = t.file_id
       ${whereClause}
       ORDER BY COALESCE(uf.statement_date, t.date) DESC, t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);

  const total = (
    sqlite
      .prepare(`SELECT COUNT(*) as cnt FROM transactions t ${whereClause}`)
      .get(...params) as { cnt: number }
  ).cnt;

  res.json({ transactions: rows, total, hasMore: off + lim < total });
});

// ── Patch category ────────────────────────────────────────────────────────────

const patchSchema = z.object({
  category_id: z.number().int().positive(),
  create_rule: z.boolean().optional().default(true),
});

transactionsRouter.patch("/:id/category", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const { category_id, create_rule } = parsed.data;

  const txn = sqlite
    .prepare("SELECT id, description, type FROM transactions WHERE id = ?")
    .get(id) as { id: number; description: string; type: "income" | "expense" } | undefined;

  if (!txn) { res.status(404).json({ error: "Transakcija ne obstaja" }); return; }

  const category = sqlite
    .prepare("SELECT type FROM categories WHERE id = ?")
    .get(category_id) as { type: string } | undefined;
  if (!category) { res.status(404).json({ error: "Kategorija ne obstaja" }); return; }
  if (!categoryAccepts(category.type, txn.type)) {
    res.status(400).json({ error: "Kategorija ne sprejema tega tipa transakcije" });
    return;
  }

  sqlite
    .prepare("UPDATE transactions SET category_id = ?, is_manual = 1 WHERE id = ?")
    .run(category_id, id);

  let ruleCreated = false;
  const pattern = txn.description;
  if (create_rule) {
    // Create an exact-match auto rule keyed by the full description, so every
    // future transaction with the identical description gets the same category
    // automatically (no Gemini, no broadening). Locked (manual) rules are
    // user-defined and protected from being overwritten here.
    sqlite
      .prepare(
        "INSERT INTO category_rules (pattern, category_id, is_locked) VALUES (?, ?, 0) ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id WHERE is_locked = 0"
      )
      .run(pattern, category_id);
    ruleCreated = true;
  }

  res.json({ ok: true, ruleCreated, pattern });
});

// ── Recategorize (SSE) ────────────────────────────────────────────────────────

interface ReJob {
  status: "running" | "done" | "error";
  events: object[];
  clients: Response[];
}

const reJobs = new Map<string, ReJob>();

function emitReJob(jobId: string, event: Record<string, unknown>) {
  const job = reJobs.get(jobId);
  if (!job) return;
  job.events.push(event);
  for (const c of job.clients) {
    try { c.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* disconnected */ }
  }
}

transactionsRouter.post("/recategorize", (req, res) => {
  const body = (req.body ?? {}) as { scope?: string; categoryIds?: unknown };
  const scope = body.scope === "category" ? "category" : "all";
  const categoryIds =
    scope === "category" && Array.isArray(body.categoryIds)
      ? (body.categoryIds as unknown[]).filter((id): id is number => Number.isInteger(id)).map(Number)
      : undefined;

  if (scope === "category" && (!categoryIds || categoryIds.length === 0)) {
    res.status(400).json({ error: "Manjka veljaven categoryIds" });
    return;
  }

  const jobId = uuidv4();
  reJobs.set(jobId, { status: "running", events: [], clients: [] });

  void runRecategorize(jobId, scope, categoryIds);

  res.json({ jobId });
});

transactionsRouter.get("/recategorize/:jobId/events", (req, res) => {
  const { jobId } = req.params;
  const job = reJobs.get(jobId);
  if (!job) { res.status(404).json({ error: "Opravilo ne obstaja" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const evt of job.events) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  if (job.status === "done" || job.status === "error") { res.end(); return; }

  job.clients.push(res);

  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 20000);
  req.on("close", () => {
    clearInterval(ping);
    const j = reJobs.get(jobId);
    if (j) j.clients = j.clients.filter((c) => c !== res);
  });
});

async function runRecategorize(jobId: string, scope: "all" | "uncategorized" | "category", categoryIds?: number[]) {
  try {
    await recategorizeAll(scope, jobId, (evt) => emitReJob(jobId, evt), categoryIds);
  } catch (err) {
    emitReJob(jobId, { type: "error", message: err instanceof Error ? err.message : "Napaka" });
  }

  const job = reJobs.get(jobId);
  if (job) {
    job.status = "done";
    for (const c of job.clients) { try { c.end(); } catch { /* ignore */ } }
    job.clients = [];
  }
  setTimeout(() => reJobs.delete(jobId), 5 * 60 * 1000);
}
