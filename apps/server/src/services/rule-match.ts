/**
 * Shared helpers for evaluating category rules.
 *
 * There are two kinds of rules, distinguished by `is_locked`:
 *
 *  • Manual rules (is_locked = 1) — created/edited by the user. Their `conditions`
 *    column stores a JSON array of RuleCondition objects with AND/OR (IN/ALI)
 *    logic, evaluated strictly left-to-right on a word-boundary basis. The first
 *    element has no `op`; subsequent elements declare how they combine with the
 *    running result. These are flexible substring/word matchers.
 *
 *  • Auto rules (is_locked = 0) — created automatically when Gemini categorizes a
 *    transaction. Their `pattern` is the FULL transaction description and they
 *    match a transaction ONLY when its description is exactly the same
 *    (accent-insensitive). No broadening, no prefix merging — so two different
 *    merchants never end up sharing one auto rule.
 *
 * In both cases, manual (locked) rules are evaluated before auto rules, and any
 * matching rule overrides Gemini.
 */

export interface RuleCondition {
  /** The substring to look for (case-insensitive). */
  pattern: string;
  /** How this condition combines with the previous result. Undefined = first condition. */
  op?: "AND" | "OR";
}

export interface MatchableRule {
  pattern: string;
  conditions: string | null; // serialized JSON of RuleCondition[]
  category_id: number;
  /** 1 = manual rule (word/condition match); 0 or undefined = auto rule (exact description match). */
  is_locked?: number;
}

/** Parse the conditions JSON, falling back to a single-condition array on failure. */
export function parseConditions(
  json: string | null,
  fallbackPattern: string
): RuleCondition[] {
  if (!json) return [{ pattern: fallbackPattern }];
  try {
    const parsed = JSON.parse(json) as RuleCondition[];
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : [{ pattern: fallbackPattern }];
  } catch {
    return [{ pattern: fallbackPattern }];
  }
}

/**
 * Normalize text for accent-insensitive matching.
 * Lowercases, strips combining diacritical marks (č=c, š=s, ž=z, …),
 * and maps Greek lookalike letters to their Latin equivalents
 * (e.g. Greek Α→a that can appear in OCR/copy-paste from bank PDFs).
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // strip combining diacriticals
    .replace(/\u03b1/g, "a")           // Greek small alpha → a
    .replace(/\u03b2/g, "b")           // Greek small beta  → b
    .replace(/\u03b5/g, "e")           // Greek small epsilon → e
    .replace(/\u03b7/g, "h")           // Greek small eta → h
    .replace(/\u03b9/g, "i")           // Greek small iota → i
    .replace(/\u03ba/g, "k")           // Greek small kappa → k
    .replace(/\u03bc/g, "m")           // Greek small mu → m
    .replace(/\u03bd/g, "n")           // Greek small nu → n
    .replace(/\u03bf/g, "o")           // Greek small omicron → o
    .replace(/\u03c1/g, "r")           // Greek small rho → r (looks like p but reads as r)
    .replace(/\u03c4/g, "t")           // Greek small tau → t
    .replace(/\u03c5/g, "y")           // Greek small upsilon → y
    .replace(/\u03c7/g, "x");          // Greek small chi → x
}

/**
 * Check whether `pattern` appears in `text` as whole word(s).
 * Both sides are normalized before comparison.
 * "ROK" matches "Rok Klec" but not "Brokers".
 */
export function matchesWord(text: string, pattern: string): boolean {
  const normText = normalize(text);
  const normPattern = normalize(pattern).trim();
  if (!normPattern) return false;
  const escaped = normPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(normText);
}

/** Evaluate all conditions against a text, left-to-right. */
export function evaluateConditions(
  text: string,
  conditions: RuleCondition[]
): boolean {
  let result = matchesWord(text, conditions[0].pattern);
  for (let i = 1; i < conditions.length; i++) {
    const matches = matchesWord(text, conditions[i].pattern);
    if (conditions[i].op === "AND") {
      result = result && matches;
    } else {
      result = result || matches;
    }
  }
  return result;
}

/**
 * Whether a single rule matches `text`.
 *
 *  • Manual rule (is_locked = 1): flexible word/condition (AND/OR) match.
 *  • Auto rule  (is_locked = 0): exact, accent-insensitive description match.
 */
export function ruleMatches(rule: MatchableRule, text: string): boolean {
  if (rule.is_locked) {
    return evaluateConditions(text, parseConditions(rule.conditions, rule.pattern));
  }
  return normalize(rule.pattern).trim() === normalize(text).trim();
}

/**
 * Find the first rule that matches `text`.
 * Rules should be pre-sorted by priority (locked first, then longest pattern).
 */
export function matchRules(
  text: string,
  rules: MatchableRule[]
): number | null {
  for (const rule of rules) {
    if (ruleMatches(rule, text)) {
      return rule.category_id;
    }
  }
  return null;
}

/** Format conditions for display: "CARGOX AND PLAČA" */
export function formatConditionsLabel(conditions: RuleCondition[]): string {
  return conditions
    .map((c, i) => (i === 0 ? c.pattern : `${c.op ?? "AND"} ${c.pattern}`))
    .join(" ");
}
