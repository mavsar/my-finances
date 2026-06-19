import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

const databasePath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data", "my-finances.db");

const databaseDirectory = path.dirname(databasePath);
if (!fs.existsSync(databaseDirectory)) {
  fs.mkdirSync(databaseDirectory, { recursive: true });
}

export const sqlite = new Database(databasePath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Shared normalizer: lowercase, strip combining diacritics, map Greek lookalikes to Latin.
function normStr(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u03b1/g, "a").replace(/\u03b2/g, "b").replace(/\u03b5/g, "e")
    .replace(/\u03b7/g, "h").replace(/\u03b9/g, "i").replace(/\u03ba/g, "k")
    .replace(/\u03bc/g, "m").replace(/\u03bd/g, "n").replace(/\u03bf/g, "o")
    .replace(/\u03c1/g, "r").replace(/\u03c4/g, "t").replace(/\u03c5/g, "y")
    .replace(/\u03c7/g, "x");
}

// Accent-insensitive matching: č=c, š=s, ž=z, Greek lookalikes → Latin, etc.
sqlite.function("normalize", (text: unknown) => {
  if (typeof text !== "string") return "";
  return normStr(text);
});

// Whole-word accent-insensitive match used by rule evaluation in SQL.
// Returns 1 if pattern appears as whole word(s) in text, 0 otherwise.
sqlite.function("word_match", (text: unknown, pattern: unknown) => {
  if (typeof text !== "string" || typeof pattern !== "string") return 0;
  const normPattern = normStr(pattern).trim();
  if (!normPattern) return 0;
  const escaped = normPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(normStr(text)) ? 1 : 0;
});

runMigrations(sqlite);
