import fs from "node:fs";
import path from "node:path";
import { Router, type Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { sqlite } from "../db/client.js";
import { parseTransactionsRaw, categorizePatternsWithGemini, type RawTransaction } from "../services/gemini.js";
import { matchRules, normalize, type MatchableRule } from "../services/rule-match.js";

const uploadsDir = process.env.UPLOADS_PATH?.trim()
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.resolve(process.cwd(), "storage", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Dovoljeni so samo PDF dokumenti"));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

interface JobEvent {
  type: string;
  [key: string]: unknown;
}

interface Job {
  status: "queued" | "running" | "done" | "error";
  events: JobEvent[];
  clients: Response[];
}

const jobs = new Map<string, Job>();

function emit(jobId: string, event: JobEvent) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.events.push(event);
  for (const client of job.clients) {
    try {
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // client disconnected
    }
  }
}

export const filesRouter = Router();

filesRouter.get("/jobs/:jobId/events", (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) { res.status(404).json({ error: "Opravilo ne obstaja" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.status === "done" || job.status === "error") {
    res.end();
    return;
  }

  job.clients.push(res);

  const keepAlive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(keepAlive); }
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
    const j = jobs.get(jobId);
    if (j) j.clients = j.clients.filter((c) => c !== res);
  });
});

filesRouter.post("/upload", upload.array("files", 200), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "Ni izbranih datotek" });
    return;
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: "queued", events: [], clients: [] });

  void processFiles(jobId, files);

  res.json({ jobId, fileCount: files.length });
});

/**
 * Extracts the statement period (end-of-month) from a `IZP_NNN_YYYYMMDD_...` filename
 * and returns it as an ISO date. Used to order transactions across files in true
 * booking order. Returns null for filenames that don't match the expected pattern.
 */
function deriveStatementDate(originalName: string): string | null {
  const m = originalName.match(/IZP_\d+_(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Builds the stored transaction description from prejemnik + opis (single source of truth). */
function buildDescription(prejemnik: string, opis: string): string {
  const p = (prejemnik ?? "").trim();
  const o = (opis ?? "").trim();
  return p ? `${p}${o ? ` — ${o}` : ""}` : o;
}

interface DbTransaction {
  id: number;
  date: string;
  description: string;
  prejemnik: string;
  amount: number;
  type: "income" | "expense";
  stanje: number | null;
  category_id?: number | null;
  is_manual?: number;
}

/**
 * Shared pipeline used by both fresh imports and rechecks: categorize a set of
 * balance-verified raw transactions and write them to a (already-empty) file.
 *
 *  1. Match each transaction against existing rules (locked rules first, then
 *     exact-description auto rules).
 *  2. Ask Gemini to categorize any descriptions that match no rule, then persist
 *     each result as an exact-match auto rule (is_locked = 0) keyed by the full
 *     description — so identical future descriptions skip Gemini entirely.
 *  3. Insert every transaction, preserving caller-provided manual categories.
 *  4. Drop true cross-statement boundary duplicates (same row incl. balance).
 *
 * `manualByKey` maps `${date}|${normalize(description)}` → categoryId for rows the
 * user had manually categorized, so a recheck never throws away those choices.
 */
async function categorizeAndStore(
  jobId: string,
  fileId: number,
  rawTxns: RawTransaction[],
  categories: Array<{ id: number; name: string; type: string }>,
  fileIndex: number,
  manualByKey?: Map<string, number>
): Promise<{ savedCount: number; duplicatesRemoved: number }> {
  type RuleRow = MatchableRule;
  const rules: RuleRow[] = sqlite
    .prepare("SELECT pattern, conditions, category_id, is_locked FROM category_rules ORDER BY is_locked DESC, length(pattern) DESC")
    .all() as RuleRow[];
  const matchRule = (text: string): number | null => matchRules(text, rules);

  const txnsWithDesc = rawTxns.map((t) => ({ ...t, description: buildDescription(t.prejemnik, t.opis) }));
  const unknownDescriptions = [
    ...new Set(txnsWithDesc.filter((t) => matchRule(t.description) === null).map((t) => t.description)),
  ];

  if (unknownDescriptions.length > 0) {
    emit(jobId, {
      type: "step",
      step: "categorizing",
      message: `Kategoriziranje ${unknownDescriptions.length} novih transakcij z AI...`,
      progress: 65,
      fileIndex: fileIndex + 1,
    });

    const newRules = await categorizePatternsWithGemini(unknownDescriptions, categories);

    // Persist each Gemini result as an exact-match auto rule keyed by the full
    // description, so the same description never hits Gemini again.
    const insertRule = sqlite.prepare(
      "INSERT OR IGNORE INTO category_rules (pattern, category_id, is_locked) VALUES (?, ?, 0)"
    );
    sqlite.transaction(() => {
      for (const r of newRules) {
        insertRule.run(r.pattern, r.category_id);
        rules.push({ pattern: r.pattern, category_id: r.category_id, conditions: null, is_locked: 0 });
      }
    })();
  }

  emit(jobId, { type: "step", step: "saving", message: `Shranjevanje ${rawTxns.length} transakcij...`, progress: 82, fileIndex: fileIndex + 1 });

  const insertTxn = sqlite.prepare(
    "INSERT INTO transactions (file_id, date, description, prejemnik, amount, type, category_id, stanje, is_manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  sqlite.transaction(() => {
    for (const txn of txnsWithDesc) {
      const description = txn.description;
      const manualCat = manualByKey?.get(`${txn.date}|${normalize(description)}`);
      const categoryId = manualCat ?? matchRule(description);
      insertTxn.run(
        fileId,
        txn.date,
        description,
        txn.prejemnik,
        txn.amount,
        txn.type,
        categoryId,
        txn.stanje ?? null,
        manualCat != null ? 1 : 0
      );
    }
  })();

  // Remove true cross-statement boundary overlaps (the same transaction appearing
  // in two consecutive monthly files). A real duplicate is identical *including* the
  // running balance, so legitimately-repeated same-day charges are preserved.
  const dupeInfo = sqlite
    .prepare(
      `DELETE FROM transactions
       WHERE file_id = ? AND id NOT IN (
         SELECT MIN(id) FROM transactions
         GROUP BY date, description, amount, type, prejemnik, stanje
       )`
    )
    .run(fileId);

  return { savedCount: rawTxns.length - (dupeInfo.changes ?? 0), duplicatesRemoved: dupeInfo.changes ?? 0 };
}

interface RecheckCorrection {
  transactionId: number;
  date: string;
  description: string;
  prevType: "income" | "expense";
  newType: "income" | "expense";
  prevAmount: number;
  newAmount: number;
  newStanje: number | null;
}

/**
 * Re-parses an already-processed file and corrects stored transactions.
 *
 * The fresh parse (`parseTransactionsRaw`) is already balance-verified: each
 * transaction's amount and type were derived from the running-balance column and
 * cross-checked across multiple parse passes. So the fresh values are authoritative.
 *
 * Matching fresh → stored is done on the STABLE fields (date + description), never
 * on amount — because the amount is exactly what may be wrong in the stored record.
 * Whenever a matched stored row disagrees with the verified fresh values, it is
 * corrected (amount, type, and backfilled stanje).
 *
 * The re-uploaded file is deleted from disk after the check.
 */
async function recheckExistingFile(
  jobId: string,
  file: Express.Multer.File,
  existingFileId: number,
  fileIndex: number,
  categories: Array<{ id: number; name: string; type: string }>
) {
  emit(jobId, {
    type: "file_start",
    fileName: file.originalname,
    fileIndex: fileIndex + 1,
    isRecheck: true,
  });

  try {
    emit(jobId, {
      type: "step",
      step: "recheck",
      message: "Ponovni pregled obstoječih podatkov...",
      progress: 30,
      fileIndex: fileIndex + 1,
    });

    const freshTxns = await parseTransactionsRaw(file.path);
    if (freshTxns.length === 0) {
      throw new Error("Ni bilo najdenih transakcij pri ponovnem pregledu");
    }

    emit(jobId, {
      type: "step",
      step: "recheck_compare",
      message: "Preverjanje vrednosti z bilanco stanja...",
      progress: 55,
      fileIndex: fileIndex + 1,
    });

    // Snapshot the existing rows BEFORE we touch anything — used both to preserve
    // manual category choices and to report exactly what changed.
    const existingTxns = sqlite
      .prepare(
        "SELECT id, date, description, prejemnik, amount, type, stanje, category_id, is_manual FROM transactions WHERE file_id = ? ORDER BY id"
      )
      .all(existingFileId) as DbTransaction[];

    // Preserve user's manual categorizations, keyed by date + normalized description.
    const manualByKey = new Map<string, number>();
    for (const e of existingTxns) {
      if (e.is_manual === 1 && e.category_id != null) {
        manualByKey.set(`${e.date}|${normalize(e.description)}`, e.category_id);
      }
    }

    // The deterministic, balance-verified parse is authoritative, so we fully
    // re-sync the file: wipe its rows and rebuild from the fresh parse. This heals
    // every kind of corruption at once — wrong amounts, wrong +/- signs, missing
    // rows that an earlier dedup wrongly removed, and missing balances.
    emit(jobId, {
      type: "step",
      step: "recheck_fix",
      message: "Ponovno usklajevanje transakcij...",
      progress: 80,
      fileIndex: fileIndex + 1,
    });

    sqlite.prepare("DELETE FROM transactions WHERE file_id = ?").run(existingFileId);
    const { savedCount } = await categorizeAndStore(jobId, existingFileId, freshTxns, categories, fileIndex, manualByKey);

    sqlite
      .prepare("UPDATE uploaded_files SET transactions_count = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(savedCount, existingFileId);

    // ── Diff old vs new for the report ──────────────────────────────────────────
    const oldRows = existingTxns.map((r) => ({ ...r, used: false }));
    const corrections: RecheckCorrection[] = [];
    let restored = 0;

    for (const fresh of freshTxns) {
      const desc = buildDescription(fresh.prejemnik, fresh.opis);
      const nDesc = normalize(desc);
      const candidates = oldRows.filter((o) => !o.used && o.date === fresh.date && normalize(o.description) === nDesc);

      let match = candidates[0];
      if (candidates.length > 1 && fresh.stanje != null) {
        match = candidates.reduce((best, c) => {
          const cd = c.stanje == null ? Infinity : Math.abs(c.stanje - fresh.stanje!);
          const bd = best.stanje == null ? Infinity : Math.abs(best.stanje - fresh.stanje!);
          return cd < bd ? c : best;
        }, candidates[0]);
      }

      if (!match) {
        restored++;
        continue;
      }
      match.used = true;

      if (Math.abs(match.amount - fresh.amount) > 0.02 || match.type !== fresh.type) {
        corrections.push({
          transactionId: match.id,
          date: match.date,
          description: match.description,
          prevType: match.type,
          newType: fresh.type,
          prevAmount: match.amount,
          newAmount: fresh.amount,
          newStanje: fresh.stanje ?? null,
        });
      }
    }

    const removed = oldRows.filter((o) => !o.used).length;

    emit(jobId, {
      type: "recheck_done",
      fileName: file.originalname,
      fileIndex: fileIndex + 1,
      correctionsCount: corrections.length,
      restored,
      removed,
      corrections,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Neznana napaka pri preverjanju";
    emit(jobId, {
      type: "file_error",
      fileName: file.originalname,
      error: message,
      fileIndex: fileIndex + 1,
    });
  } finally {
    if (fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
  }
}

async function processFiles(jobId: string, files: Express.Multer.File[]) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  emit(jobId, { type: "start", totalFiles: files.length });

  const categories = sqlite
    .prepare("SELECT id, name, type FROM categories")
    .all() as Array<{ id: number; name: string; type: string }>;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Guard: detect files that were already uploaded by original filename
    const existing = sqlite
      .prepare("SELECT id, status FROM uploaded_files WHERE original_name = ?")
      .get(file.originalname) as { id: number; status: string } | undefined;
    if (existing) {
      if (existing.status === "done") {
        // Re-upload of an already-processed file → run recheck instead of erroring
        await recheckExistingFile(jobId, file, existing.id, i, categories);
      } else {
        emit(jobId, {
          type: "file_error",
          fileName: file.originalname,
          error: `Datoteka je bila že naložena (status: ${existing.status}).`,
          fileIndex: i + 1,
        });
        if (fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
      }
      continue;
    }

    const { lastInsertRowid: fileId } = sqlite
      .prepare("INSERT INTO uploaded_files (original_name, file_path, status, statement_date) VALUES (?, ?, 'processing', ?)")
      .run(file.originalname, file.path, deriveStatementDate(file.originalname));

    emit(jobId, {
      type: "file_start",
      fileName: file.originalname,
      fileIndex: i + 1,
      totalFiles: files.length,
      fileId: Number(fileId),
    });

    try {
      // ── Step 1: Gemini reads PDF natively and extracts raw transactions ─────
      emit(jobId, { type: "step", step: "extracting", message: "Razčlenjevanje transakcij z AI...", progress: 30, fileIndex: i + 1 });

      const rawTxns = await parseTransactionsRaw(file.path);
      if (rawTxns.length === 0) {
        throw new Error("Ni bilo najdenih transakcij v datoteki");
      }

      // ── Steps 3-6: categorize, save, and drop boundary duplicates ─────────
      emit(jobId, { type: "step", step: "rules", message: "Preverjanje obstoječih pravil...", progress: 50, fileIndex: i + 1 });

      const { savedCount, duplicatesRemoved } = await categorizeAndStore(
        jobId,
        Number(fileId),
        rawTxns,
        categories,
        i
      );

      sqlite
        .prepare("UPDATE uploaded_files SET status = 'done', transactions_count = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(savedCount, Number(fileId));

      emit(jobId, {
        type: "file_done",
        fileName: file.originalname,
        fileId: Number(fileId),
        transactionsCount: savedCount,
        duplicatesRemoved,
        fileIndex: i + 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neznana napaka";

      sqlite.prepare("DELETE FROM uploaded_files WHERE id = ?").run(Number(fileId));
      if (fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      }

      emit(jobId, { type: "file_error", fileName: file.originalname, error: message, fileIndex: i + 1 });
    }
  }

  job.status = "done";
  emit(jobId, { type: "done", message: "Vse datoteke so bile obdelane." });

  for (const client of job.clients) {
    try { client.end(); } catch { /* ignore */ }
  }
  job.clients = [];

  setTimeout(() => jobs.delete(jobId), 5 * 60 * 1000);
}

filesRouter.get("/", (_req, res) => {
  res.json(sqlite.prepare("SELECT * FROM uploaded_files ORDER BY uploaded_at DESC").all());
});

filesRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const file = sqlite
    .prepare("SELECT * FROM uploaded_files WHERE id = ?")
    .get(id) as { file_path?: string } | undefined;

  if (!file) { res.status(404).json({ error: "Datoteka ne obstaja" }); return; }

  sqlite.prepare("DELETE FROM uploaded_files WHERE id = ?").run(id);

  if (file.file_path && fs.existsSync(file.file_path)) {
    try { fs.unlinkSync(file.file_path); } catch { /* ignore */ }
  }

  res.status(204).end();
});
