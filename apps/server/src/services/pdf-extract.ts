import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParsedStatement, RawTransaction } from "./gemini.js";

/**
 * Deterministic, AI-free extraction of bank-statement transactions from a text PDF.
 *
 * The numbers in a bank statement are exact text inside the PDF — reading them with
 * an LLM only introduces errors. This module reads the text with its X/Y coordinates,
 * reconstructs the table rows, and pulls each value straight from its column:
 *   - amount  = the value in the "V breme" (debit) or "V dobro" (credit) column
 *   - type    = which of those two columns the value sits in
 *   - stanje  = the rightmost value (running balance)
 *
 * Returns null when the layout can't be recognized, so the caller can fall back to AI.
 */

export interface Item {
  str: string;
  x: number; // left edge
  y: number; // baseline (PDF space: larger = higher on page)
  w: number;
}

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
// Slovenian currency: thousands "." and decimal ",". Optional leading/trailing minus.
const CURRENCY_RE = /^-?\d{1,3}(?:\.\d{3})*,\d{2}-?$|^-?\d+,\d{2}-?$/;
const ROW_Y_TOLERANCE = 4;

function toIsoDate(d: string): string | null {
  const m = d.trim().match(DATE_RE);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseSlovenianNumber(s: string): number | null {
  const t = s.trim();
  if (!CURRENCY_RE.test(t)) return null;
  let neg = false;
  let str = t;
  if (str.startsWith("-")) { neg = true; str = str.slice(1); }
  if (str.endsWith("-")) { neg = true; str = str.slice(0, -1); }
  str = str.replace(/\./g, "").replace(",", ".");
  const n = Number(str);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

async function loadItemsPerPage(pdfPath: string): Promise<Item[][]> {
  const data = new Uint8Array(readFileSync(pdfPath));
  const loadingTask = getDocument({ data });
  const doc = await loadingTask.promise;
  const pages: Item[][] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
        if (typeof raw.str !== "string" || raw.str.trim() === "") continue;
        const tr = raw.transform ?? [1, 0, 0, 1, 0, 0];
        items.push({ str: raw.str, x: tr[4], y: tr[5], w: raw.width ?? 0 });
      }
      pages.push(items);
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

/** Groups items on a page into rows by Y position, each row sorted left → right. */
function groupRows(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  let current: Item[] = [];
  let rowY: number | null = null;
  for (const it of sorted) {
    if (rowY === null || Math.abs(it.y - rowY) < ROW_Y_TOLERANCE) {
      current.push(it);
      if (rowY === null) rowY = it.y;
    } else {
      rows.push(current.sort((a, b) => a.x - b.x));
      current = [it];
      rowY = it.y;
    }
  }
  if (current.length) rows.push(current.sort((a, b) => a.x - b.x));
  return rows;
}

const lc = (s: string) => s.toLowerCase();
const centerX = (i: Item) => i.x + i.w / 2;

interface Layout {
  prejemnikLeft: number;
  opisLeft: number;
  numericLeft: number;
  bremeCenter: number;
  dobroCenter: number;
}

/** Locates the table columns from the header row. Returns null if not a recognized layout. */
function detectLayout(allItems: Item[]): Layout | null {
  const bremeItem = allItems.find((i) => lc(i.str).includes("breme"));
  const dobroItem = allItems.find((i) => lc(i.str).includes("dobro"));
  if (!bremeItem || !dobroItem) return null;

  const headerY = bremeItem.y;
  const onHeaderRow = (i: Item) => Math.abs(i.y - headerY) < ROW_Y_TOLERANCE * 2;
  const stanjeItem = allItems.find((i) => onHeaderRow(i) && lc(i.str).includes("stanje"));
  const opisItem = allItems.find((i) => lc(i.str).includes("opis"));
  const prejemnikItem = allItems.find((i) => lc(i.str).includes("plačnik") || lc(i.str).includes("prejemnik"));
  if (!stanjeItem || !opisItem || !prejemnikItem) return null;

  const bremeCenter = centerX(bremeItem);
  const dobroCenter = centerX(dobroItem);
  const gap = Math.max(dobroCenter - bremeCenter, 20);

  return {
    prejemnikLeft: prejemnikItem.x,
    opisLeft: opisItem.x,
    // Numeric region begins one column-gap to the left of the debit column center,
    // which sits safely to the right of the description text.
    numericLeft: bremeCenter - gap,
    bremeCenter,
    dobroCenter,
  };
}

const OPENING_RE = /(začetno|preneseno|prejšnje|otvoritveno|preteklo)\s*stanje|stanje\s*(prejšnj|prenes)/;
// A statement can contain several currency sub-accounts (e.g. "Valuta: EUR" then a
// "Valuta: USD" section for foreign payments). Only the EUR section belongs to this
// account's balance — foreign sections must be skipped, or their rows get mixed into
// the EUR balance chain and fabricate phantom transactions.
const VALUTA_RE = /valuta:\s*([a-z]{3})/i;

export async function extractStatementFromPdf(pdfPath: string): Promise<ParsedStatement | null> {
  let pages: Item[][];
  try {
    pages = await loadItemsPerPage(pdfPath);
  } catch {
    return null;
  }
  return parseStatementFromItems(pages);
}

/**
 * Pure table-parsing core (no IO) — exported for testing.
 * Takes positioned text items per page and reconstructs the statement.
 */
export function parseStatementFromItems(pages: Item[][]): ParsedStatement | null {
  const allItems = pages.flat();
  if (allItems.length === 0) return null;

  const layout = detectLayout(allItems);
  if (!layout) return null;

  const { prejemnikLeft, opisLeft, numericLeft, bremeCenter, dobroCenter } = layout;

  const transactions: RawTransaction[] = [];
  let openingBalance: number | null = null;
  let current: RawTransaction | null = null;
  // Assume EUR until a "Valuta:" marker says otherwise (statements always lead with EUR).
  let inEurSection = true;

  for (const items of pages) {
    for (const row of groupRows(items)) {
      // Track currency sub-account boundaries: only EUR rows count toward this balance.
      const valutaMatch = row.map((i) => i.str).join(" ").match(VALUTA_RE);
      if (valutaMatch) {
        inEurSection = valutaMatch[1].toUpperCase() === "EUR";
        current = null;
        continue;
      }
      if (!inEurSection) { current = null; continue; }

      // Skip the header row itself
      if (row.some((i) => lc(i.str).includes("breme") || lc(i.str).includes("dobro"))) continue;

      const dateItem = row.find((i) => DATE_RE.test(i.str.trim()));
      const rowTextLc = lc(row.map((i) => i.str).join(" "));

      const numbers = row
        .filter((i) => centerX(i) > numericLeft && parseSlovenianNumber(i.str) !== null)
        .map((i) => ({ value: parseSlovenianNumber(i.str) as number, cx: centerX(i) }))
        .sort((a, b) => a.cx - b.cx);

      // Opening / carried-over balance line
      if (!dateItem && openingBalance === null && OPENING_RE.test(rowTextLc) && numbers.length >= 1) {
        openingBalance = numbers[numbers.length - 1].value;
        continue;
      }

      if (dateItem) {
        const iso = toIsoDate(dateItem.str);
        if (!iso) { current = null; continue; }

        const prejemnik = row
          .filter((i) => i.x >= prejemnikLeft - 2 && i.x < opisLeft - 2 && !DATE_RE.test(i.str.trim()) && parseSlovenianNumber(i.str) === null)
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const opis = row
          .filter((i) => i.x >= opisLeft - 2 && centerX(i) <= numericLeft && parseSlovenianNumber(i.str) === null)
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (numbers.length >= 2) {
          const stanje = numbers[numbers.length - 1].value;
          const amt = numbers[numbers.length - 2];
          // Column position decides the sign: nearer the credit column → income.
          const type: "income" | "expense" =
            Math.abs(amt.cx - dobroCenter) < Math.abs(amt.cx - bremeCenter) ? "income" : "expense";
          current = {
            date: iso,
            prejemnik,
            opis,
            amount: Math.abs(amt.value),
            type,
            stanje,
          };
          transactions.push(current);
        } else {
          // Dated row without an amount+balance pair — not a real transaction line.
          current = null;
        }
      } else if (current) {
        // Continuation line — append wrapped recipient / description text.
        const moreP = row
          .filter((i) => i.x >= prejemnikLeft - 2 && i.x < opisLeft - 2 && parseSlovenianNumber(i.str) === null)
          .map((i) => i.str)
          .join(" ")
          .trim();
        const moreO = row
          .filter((i) => i.x >= opisLeft - 2 && centerX(i) <= numericLeft && parseSlovenianNumber(i.str) === null)
          .map((i) => i.str)
          .join(" ")
          .trim();
        if (moreP) current.prejemnik = `${current.prejemnik} ${moreP}`.replace(/\s+/g, " ").trim();
        if (moreO) current.opis = `${current.opis} ${moreO}`.replace(/\s+/g, " ").trim();
      }
    }
  }

  if (transactions.length === 0) return null;
  return { openingBalance, transactions };
}
