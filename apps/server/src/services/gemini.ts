import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { extractStatementFromPdf } from "./pdf-extract.js";

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category_id: number | null;
}

export interface BatchCategorizeResult {
  id: number;
  category_id: number | null;
}

/** Raw transaction extracted from PDF — no category, keeps prejemnik separate */
export interface RawTransaction {
  date: string;
  prejemnik: string;
  opis: string;
  amount: number;
  type: "income" | "expense";
  /** Account balance after this transaction (from "Stanje" / "Balance" column) — the source of truth */
  stanje?: number;
}

/** A full statement parse: the opening balance plus all transactions, in document order. */
export interface ParsedStatement {
  openingBalance: number | null;
  transactions: RawTransaction[];
}

/**
 * Result of reconciling a parsed statement against its running-balance column.
 * The balance chain is treated as ground truth: each transaction's amount and type
 * are derived from `stanje[n] - stanje[n-1]`.
 */
export interface StatementAnalysis {
  transactions: RawTransaction[];
  rowCount: number;
  /** rows whose amount/type could be derived from the balance chain */
  derivableCount: number;
  /** derivable rows where the balance-derived amount matched the separately-read amount column */
  agreeCount: number;
  /** opening balance known (or inferable), every row derivable, and every derivation agrees with the amount column */
  fullyConsistent: boolean;
}

const AMOUNT_TOLERANCE = 0.02;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function signedOf(t: { amount: number; type: "income" | "expense" }): number {
  return t.type === "income" ? t.amount : -t.amount;
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
  }
  return client;
}

/** Human label for a category's accepted transaction type(s), used in AI prompts. */
function categoryTypeLabel(type: string): string {
  if (type === "income") return "prihodek";
  if (type === "expense") return "odhodek";
  return "prihodek ali odhodek";
}

function checkApiKey() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here") {
    throw new Error("GEMINI_API_KEY ni nastavljen v .env datoteki");
  }
}

const PARSE_PROMPT = `Si natančen finančni asistent, ki razčlenjuje bančne izpiske. Iz priloženega PDF izvleci ZAČETNO STANJE računa in VSE transakcije.

══════════════════════════════════════════════
NAJPOMEMBNEJE — stolpec STANJE (saldo računa):
══════════════════════════════════════════════
- Skoraj vsak izpisek ima stolpec s stanjem računa PO vsaki transakciji (naslovi: "Stanje", "Saldo", "Novo stanje", "Balance").
- Ta vrednost je KLJUČNA za pravilnost. Za VSAKO transakcijo natančno prepiši to vrednost v polje "stanje" (decimalno, lahko negativno, npr. -1749.05).
- Izvleci tudi ZAČETNO STANJE (saldo PRED prvo transakcijo; naslovi: "Začetno stanje", "Prejšnje stanje", "Stanje na dan", "Preneseno stanje") v polje "zacetno_stanje". Če ga ni, vrni null.
- KRITIČNO: ohrani transakcije v NATANČNO istem vrstnem redu kot v izpisku (od zgoraj navzdol). Vrstni red določa pravilnost stanja.

Pravila za posamezno transakcijo:
- date: datum v obliki YYYY-MM-DD (npr. 2024-01-15)
- amount: znesek kot pozitivno decimalno število brez valute (npr. 766.61) — natančno prepiši iz stolpca "V breme" ali "V dobro"
- type: določi po stolpcu, v katerem je znesek:
  * znesek v stolpcu "V breme" (Breme / Debit / Obremenitev) → "expense"
  * znesek v stolpcu "V dobro" (Dobro / Credit / Dobropis) → "income"
- stanje: saldo računa PO tej transakciji (iz stolpca stanja)
- prejemnik: ime prejemnika ali plačnika — prazno, če ni navedeno ali je samo referenčna številka
- opis: namen plačila oz. opis transakcije
- Ignoriraj vrstice s skupnimi vsotami (Skupaj / Total / Promet).

Vrni SAMO veljaven JSON v TOČNO tej obliki, brez dodatnega besedila:
{
  "zacetno_stanje": 1234.56,
  "transakcije": [
    { "date": "2024-01-15", "prejemnik": "Mercator d.o.o.", "opis": "Nakup živil", "amount": 23.50, "type": "expense", "stanje": 1211.06 }
  ]
}`;

/** A single Gemini parse of the PDF into an opening balance + ordered transactions. */
async function parseStatementOnce(pdfBase64: string): Promise<ParsedStatement> {
  const response = await getClient().models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        parts: [
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
          { text: PARSE_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text ?? "{}";
  const parsed: unknown = JSON.parse(text);

  // Accept either the documented object form or a bare array (defensive).
  const obj = (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>)
    : {};
  const rawArr: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(obj.transakcije)
      ? (obj.transakcije as unknown[])
      : [];
  const openingBalance = typeof obj.zacetno_stanje === "number" ? obj.zacetno_stanje : null;

  const transactions: RawTransaction[] = rawArr
    .filter(
      (t): t is Record<string, unknown> =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as Record<string, unknown>).date === "string" &&
        typeof (t as Record<string, unknown>).amount === "number" &&
        ((t as Record<string, unknown>).type === "income" || (t as Record<string, unknown>).type === "expense")
    )
    .map((t) => ({
      date: t.date as string,
      prejemnik: (((t.prejemnik as string) ?? "") as string).trim(),
      opis: (((t.opis as string) ?? (t.description as string) ?? "") as string).trim(),
      amount: Math.abs(t.amount as number),
      type: t.type as "income" | "expense",
      stanje: typeof t.stanje === "number" ? (t.stanje as number) : undefined,
    }));

  return { openingBalance, transactions };
}

/**
 * Reconciles a parsed statement against its running-balance column.
 *
 * The balance column is authoritative: for each row we compute
 *   signed = stanje[n] - stanje[n-1]   (the first row uses the opening balance)
 * and overwrite amount = |signed| and type = sign(signed). The independently-read
 * amount column is used only to MEASURE confidence (does it agree with the balance
 * math?), never to decide the stored value.
 */
export function analyzeStatement(stmt: ParsedStatement): StatementAnalysis {
  const transactions = stmt.transactions.map((t) => ({ ...t }));

  // Starting balance: prefer the explicit opening balance, otherwise infer it from
  // the first row (its stanje minus its read signed amount) so the chain can start.
  let prev: number | null = stmt.openingBalance;
  if (prev == null && transactions.length > 0 && transactions[0].stanje != null) {
    prev = round2(transactions[0].stanje - signedOf(transactions[0]));
  }

  let derivableCount = 0;
  let agreeCount = 0;

  for (const t of transactions) {
    if (t.stanje != null && prev != null) {
      const signed = round2(t.stanje - prev);
      const derivedAmount = Math.abs(signed);
      const derivedType: "income" | "expense" = signed >= 0 ? "income" : "expense";

      derivableCount++;
      if (Math.abs(derivedAmount - t.amount) <= AMOUNT_TOLERANCE) agreeCount++;

      // Balance is ground truth — override the (possibly misread) amount/type.
      // Skip zero-diff rows (informational lines) so we don't blank a real amount.
      if (derivedAmount > 0.001) {
        if (Math.abs(derivedAmount - t.amount) > AMOUNT_TOLERANCE || t.type !== derivedType) {
          console.log(
            `[parse] ${t.date} "${t.prejemnik || t.opis}": prebrano ${t.type} ${t.amount.toFixed(2)} → po stanju ${derivedType} ${derivedAmount.toFixed(2)} (stanje ${prev} → ${t.stanje})`
          );
        }
        t.amount = derivedAmount;
        t.type = derivedType;
      }
      prev = t.stanje;
    } else if (t.stanje != null) {
      prev = t.stanje;
    } else if (prev != null) {
      // No balance on this row — keep the read value, advance running balance with it.
      prev = round2(prev + signedOf(t));
    }
  }

  const fullyConsistent =
    transactions.length > 0 &&
    derivableCount === transactions.length &&
    agreeCount === derivableCount;

  return {
    transactions,
    rowCount: transactions.length,
    derivableCount,
    agreeCount,
    fullyConsistent,
  };
}

/** Higher is better: maximize balance-verified rows, then derivable rows, then coverage. */
function scoreAnalysis(a: StatementAnalysis): number {
  return a.agreeCount * 1000 + a.derivableCount * 10 + a.rowCount;
}

/**
 * Extracts transactions from a PDF with built-in correctness checks.
 *
 * Strategy:
 *  1. DETERMINISTIC — read the numbers straight from the PDF text (exact, no AI).
 *     The result is validated against the running-balance chain; if it reconciles,
 *     it is used as-is. This is the reliable path for text-based bank statements.
 *  2. AI FALLBACK — only when the layout isn't recognized or the deterministic
 *     numbers don't reconcile. Gemini reads the PDF up to 3 times and the most
 *     balance-consistent attempt wins. Balance math still overrides amount/type.
 */
export async function parseTransactionsRaw(filePath: string): Promise<RawTransaction[]> {
  // ── 1. Deterministic text extraction (preferred) ────────────────────────────
  try {
    const stmt = await extractStatementFromPdf(filePath);
    if (stmt && stmt.transactions.length > 0) {
      const analysis = analyzeStatement(stmt);
      const threshold = Math.ceil(analysis.rowCount * 0.95);
      if (analysis.derivableCount >= analysis.rowCount - 1 && analysis.agreeCount >= threshold) {
        console.log(
          `[parse] Deterministična razčlenitev: ${analysis.agreeCount}/${analysis.rowCount} vrstic skladnih z bilanco — uporabljeno.`
        );
        return analysis.transactions;
      }
      console.log(
        `[parse] Deterministična razčlenitev nezanesljiva (${analysis.agreeCount}/${analysis.rowCount} skladnih). Prehod na AI...`
      );
    } else {
      console.log("[parse] Deterministična razčlenitev ni prepoznala oblike izpiska. Prehod na AI...");
    }
  } catch (e) {
    console.log(`[parse] Napaka pri deterministični razčlenitvi: ${e instanceof Error ? e.message : e}. Prehod na AI...`);
  }

  // ── 2. AI fallback (Gemini, multi-pass) ─────────────────────────────────────
  checkApiKey();

  const pdfBase64 = fs.readFileSync(filePath).toString("base64");
  const MAX_ATTEMPTS = 3;
  let best: StatementAnalysis | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let stmt: ParsedStatement;
    try {
      stmt = await parseStatementOnce(pdfBase64);
    } catch {
      continue;
    }
    if (stmt.transactions.length === 0) continue;

    const analysis = analyzeStatement(stmt);

    if (analysis.fullyConsistent) {
      console.log(`[parse] Poskus ${attempt}: popolnoma skladno (${analysis.rowCount} transakcij, vse preverjene z bilanco).`);
      return analysis.transactions;
    }

    console.log(
      `[parse] Poskus ${attempt}: ${analysis.agreeCount}/${analysis.rowCount} vrstic preverjenih z bilanco, ` +
      `${analysis.derivableCount} izračunljivih. Ponovni poskus za večjo zanesljivost...`
    );

    if (!best || scoreAnalysis(analysis) > scoreAnalysis(best)) {
      best = analysis;
    }
  }

  if (!best) return [];
  console.log(`[parse] Uporabljen najboljši poskus: ${best.agreeCount}/${best.rowCount} vrstic preverjenih z bilanco.`);
  return best.transactions;
}

/**
 * Categorize unknown transaction descriptions.
 *
 * `patterns` = unique full transaction descriptions (company name + opis) that
 * currently match no rule. Gemini chooses the best category for each from the
 * company name and description. The returned `pattern` is the SAME description,
 * unchanged — the caller stores it verbatim as an exact-match auto rule, so only
 * future transactions with the identical description reuse it (no broadening).
 */
export async function categorizePatternsWithGemini(
  patterns: string[],
  categories: Array<{ id: number; name: string; type: string }>
): Promise<Array<{ pattern: string; category_id: number }>> {
  checkApiKey();
  if (patterns.length === 0) return [];

  const categoryList = categories
    .map((c) => `ID ${c.id}: ${c.name} (${categoryTypeLabel(c.type)})`)
    .join("\n");

  const patternList = patterns.map((p, i) => `${i + 1}. "${p}"`).join("\n");

  const prompt = `Kategoriziraj naslednje opise bančnih transakcij.

Razpoložljive kategorije:
${categoryList}

Opisi transakcij (vsak vsebuje ime podjetja/prejemnika in opis prometa):
${patternList}

Navodila:
- Za vsak opis na podlagi imena podjetja IN opisa transakcije izberi NAJPRIMERNEJŠO in NAJNATANČNEJŠO kategorijo
- Izogibaj se splošnim kategorijam ("Ostali odhodki", "Ostali prihodki") razen ko res ni boljše
- Prednost daj specifičnim: npr. "Gorivo" pred "Prevoz", "Restavracije & kavarne" pred "Zabava & prosti čas"
- Vrni TOČNO toliko elementov, kolikor je opisov — eno za vsak "index"
- "index" je zaporedna številka opisa (1-osnovana), kot je navedena zgoraj
- Vrni SAMO veljavni JSON array brez kakršnega koli dodatnega besedila

Format:
[{"index": <number>, "category_id": <number>}]`;

  const response = await getClient().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text ?? "[]";
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const out: Array<{ pattern: string; category_id: number }> = [];
    for (const r of parsed) {
      if (r === null || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const idx = rec.index;
      const catId = rec.category_id;
      if (typeof idx !== "number" || typeof catId !== "number") continue;
      const pattern = patterns[idx - 1];
      if (pattern === undefined) continue;
      out.push({ pattern, category_id: catId });
    }
    return out;
  } catch {
    return [];
  }
}

export async function parseTransactionsWithGemini(
  pdfText: string,
  categories: Array<{ id: number; name: string; type: string }>
): Promise<ParsedTransaction[]> {
  checkApiKey();

  const categoryList = categories
    .map((c) => `ID ${c.id}: ${c.name} (${categoryTypeLabel(c.type)})`)
    .join("\n");

  const truncatedText =
    pdfText.length > 60000
      ? pdfText.slice(0, 60000) + "\n... (besedilo skrajšano)"
      : pdfText;

  const prompt = `Si finančni asistent, ki razčlenjuje bančne izpiske. Iz spodnjega besedila, izvlečenega iz PDF bančnega izpiska, izvleci vse transakcije in jih kategoriziraj.

Razpoložljive kategorije:
${categoryList}

Navodila:
- Datum zapiši v obliki YYYY-MM-DD (npr. 2024-01-15)
- Znesek naj bo pozitivno decimalno število brez valute (npr. 123.45)
- Tip: "income" za dobropis oz. nakazilo NA račun, "expense" za breme oz. plačilo Z računa
- Za vsako transakcijo izberi ustrezno categorijo (category_id) iz zgornjega seznama
- Če kategorija ni jasna, uporabi "Ostali odhodki" ali "Ostali prihodki"
- Ignoriraj začetno stanje, končno stanje in skupne vsote — samo posamezne transakcije
- Vrni SAMO veljavni JSON array brez kakršnega koli dodatnega besedila

Zahtevani JSON format:
[
  {
    "date": "YYYY-MM-DD",
    "description": "opis transakcije",
    "amount": 123.45,
    "type": "income",
    "category_id": 2
  }
]

Besedilo bančnega izpiska:
${truncatedText}`;

  const response = await getClient().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text ?? "[]";

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (t): t is Record<string, unknown> =>
          t !== null &&
          typeof t === "object" &&
          typeof t.date === "string" &&
          typeof t.description === "string" &&
          typeof t.amount === "number" &&
          (t.type === "income" || t.type === "expense")
      )
      .map((t) => ({
        date: t.date as string,
        description: t.description as string,
        amount: Math.abs(t.amount as number),
        type: t.type as "income" | "expense",
        category_id: typeof t.category_id === "number" ? t.category_id : null,
      }));
  } catch {
    return [];
  }
}

export async function categorizeBatchWithGemini(
  transactions: Array<{ id: number; description: string; type: string }>,
  categories: Array<{ id: number; name: string; type: string }>
): Promise<BatchCategorizeResult[]> {
  checkApiKey();

  const categoryList = categories
    .map((c) => `ID ${c.id}: ${c.name} (${categoryTypeLabel(c.type)})`)
    .join("\n");

  const txnList = transactions
    .map((t) => `ID ${t.id}: ${t.description} (${t.type === "income" ? "prihodek" : "odhodek"})`)
    .join("\n");

  const prompt = `Kategoriziraj naslednje bančne transakcije v ustrezne kategorije.

Razpoložljive kategorije:
${categoryList}

Transakcije (format: ID: opis (tip)):
${txnList}

Pravila:
- Izberi NAJPRIMERNEJŠO in NAJNATANČNEJŠO kategorijo — izogibaj se splošnim ("Ostali odhodki", "Ostali prihodki") razen ko res ni boljše
- Prednost daj specifičnim kategorijam: npr. "Gorivo" pred "Prevoz", "Restavracije & kavarne" pred "Zabava & prosti čas"
- Vrni SAMO veljavni JSON array brez kakršnega koli dodatnega besedila:
[{"id": <number>, "category_id": <number>}]`;

  const response = await getClient().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text ?? "[]";

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is BatchCategorizeResult =>
        r !== null && typeof r === "object" && typeof r.id === "number"
    );
  } catch {
    return [];
  }
}
