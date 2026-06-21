import { GoogleGenAI } from "@google/genai";
import { categoryAccepts, type TransactionType } from "./category-utils.js";
import { normalize } from "./rule-match.js";

/**
 * Smarter, web-grounded categorization.
 *
 * For each transaction description (payee + opis) the model is asked to:
 *  1. Detect the language of the text.
 *  2. Extract the company / merchant / service name if one is present.
 *  3. Use Google Search to learn what that company actually does when it isn't
 *     obvious from the text.
 *  4. Pick the most specific EXISTING category that can hold the transaction's
 *     type, or — if nothing fits — propose a brand new category.
 *
 * The goal is to almost never fall back to "Ostali prihodki/odhodki" for things
 * that are genuinely identifiable.
 */

export interface SmartCatInput {
  description: string;
  type: TransactionType;
}

export interface NewCategoryProposal {
  name: string;
  type: "income" | "expense" | "both";
  reason: string;
}

export interface SmartCatResult {
  description: string;
  type: TransactionType;
  /** An existing category that can hold this transaction, chosen by the model. */
  category_id: number | null;
  /** A suggested new category when no existing one fits. */
  proposal: NewCategoryProposal | null;
  company: string | null;
  language: string | null;
}

interface CategoryLike {
  id: number;
  name: string;
  type: string;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
  }
  return client;
}

function checkApiKey() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "your_gemini_api_key_here") {
    throw new Error("GEMINI_API_KEY ni nastavljen v .env datoteki");
  }
}

function typeLabel(type: string): string {
  if (type === "income") return "prihodek";
  if (type === "expense") return "odhodek";
  return "prihodek ali odhodek";
}

// Global rule: the account holder's own name carries no signal about what a
// transaction is, and actively pollutes web searches ("Primož Mavsar BANKOMAT"
// finds nothing useful). Strip it from any text before it reaches the model or a
// grounding search. Configurable via ACCOUNT_HOLDER_NAME; defaults to the owner.
const SELF_NAME_TOKENS = new Set(
  (process.env.ACCOUNT_HOLDER_NAME?.trim() || "Primož Mavsar")
    .split(/\s+/)
    .map((t) => normalize(t).replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 1)
);

/** Remove the account holder's name (any token order, accent-insensitive) from a description. */
export function stripSelfName(text: string): string {
  const kept = text.split(/\s+/).filter((tok) => {
    const n = normalize(tok).replace(/[^a-z0-9]/g, "");
    return n.length === 0 || !SELF_NAME_TOKENS.has(n);
  });
  const result = kept
    .join(" ")
    .replace(/\s*[—–-]\s*[—–-]\s*/g, " — ") // collapse separators left dangling together
    .replace(/^\s*[—–-]\s*/, "") // drop a leading separator
    .replace(/\s*[—–-]\s*$/, "") // drop a trailing separator
    .replace(/\s+/g, " ")
    .trim();
  return result || text; // never hand the model an empty string
}

/** Pull the first JSON array out of a model response that may be wrapped in prose or ``` fences. */
function extractJsonArray(text: string): unknown[] {
  let t = text.trim();
  // Strip ```json / ``` fences if present.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Google Search grounding is slower than a plain call, so keep batches small.
const BATCH_SIZE = 20;

function buildPrompt(
  items: SmartCatInput[],
  categories: CategoryLike[],
  priorProposals: NewCategoryProposal[] = []
): string {
  const categoryList = categories
    .map((c) => `ID ${c.id}: ${c.name} (${typeLabel(c.type)})`)
    .join("\n");

  // Categories already proposed earlier in this same run. Surfacing them lets the
  // model REUSE an identical name instead of inventing near-duplicates like
  // "Davki in dajatve" vs "Davki & plačila".
  const priorList = priorProposals.length
    ? `\n\nŽe predlagane NOVE kategorije v tej seji — če katera ustreza, uporabi POVSEM ENAKO ime (ne ustvarjaj podobnih variant):\n${priorProposals
        .map((p) => `- ${p.name} (${typeLabel(p.type)})`)
        .join("\n")}`
    : "";

  const txnList = items
    .map((t, i) => `${i + 1}. [${t.type === "income" ? "prihodek" : "odhodek"}] "${stripSelfName(t.description)}"`)
    .join("\n");

  return `Si natančen finančni analitik. Kategoriziraj spodnje bančne transakcije čim bolj NATANČNO.

Obstoječe kategorije (uporabi ID):
${categoryList}${priorList}

Transakcije (zaporedna št., tip transakcije, opis = prejemnik + namen):
${txnList}

Za VSAKO transakcijo naredi naslednje:
1. Ugotovi jezik opisa (npr. "sl", "en", "de" ...).
2. Iz opisa razberi ime podjetja / trgovca / storitve, če obstaja.
3. Če ne veš, kaj podjetje počne, ga POIŠČI z Google iskanjem in ugotovi dejavnost. Prepoznaj znane trgovce in storitve (npr. Müller, Hofer, Lidl, Spar, DM, IKEA, Amazon, Netflix, Spotify, Bolt, Booking ...) tudi brez iskanja.
4. NAJPREJ transakcijo umesti v eno od OBSTOJEČIH kategorij — izberi najbližjo smiselno, tudi če ujemanje ni popolno. Obstoječe kategorije imajo MOČNO prednost pred ustvarjanjem nove.
5. NOVO kategorijo predlagaj LE, če nobena obstoječa ni niti približno smiselna.

Pravila za NOVE kategorije (ZELO POMEMBNO — izogibaj se novim kategorijam):
- Nova kategorija mora biti ŠIROKA, splošna skupina porabe — taka, ki bo sčasoma vsebovala DESETINE različnih trgovcev (npr. "Hrana in pijača", "Prevoz", "Zabava in prosti čas", "Zdravje", "Oblačila in obutev", "Dom in gospodinjstvo", "Elektronika", "Šport in rekreacija").
- NIKOLI ne predlagaj ozke ali znamki specifične kategorije. SLABO: "Steam", "Spletne igre", "Najem skuterja", "Kava pri Štruklju". DOBRO: "Zabava in prosti čas", "Prevoz", "Gostinstvo".
- Če bi nova kategorija vsebovala le enega trgovca ali en sam primer, je NE predlagaj — izberi najbližjo obstoječo kategorijo.
- Predlagaj čim MANJ različnih novih kategorij. Pri dvomu vedno raje uporabi obstoječo.
- Če je v seznamu "Že predlagane NOVE kategorije" že kaj primernega, OBVEZNO uporabi povsem enako ime (npr. ne "Davki & plačila", če že obstaja "Davki in dajatve").

Ostala pravila:
- NE uporabljaj "Ostali odhodki" / "Ostali prihodki", razen če transakcije res NI mogoče prepoznati (npr. anonimni prenos brez prejemnika).
- Več transakcij istega TIPA dogodka združi pod ENO dosledno poimenovano kategorijo (npr. "BANKOMAT", "DVIG GOTOVINE" → "Dvigi gotovine"; "STROŠEK", "NADOMESTILO", "PROVIZIJA" → "Bančni stroški"). Za isti vzorec VEDNO uporabi povsem enako ime, da se predlogi združijo.
- Če izbereš obstoječo kategorijo, nastavi "category_id" in pusti "new_category" na null.
- Če predlagaš novo, nastavi "category_id" na null in izpolni "new_category".
- "company" naj NE vsebuje imena imetnika računa, le dejansko podjetje/trgovca.
- Vrni TOČNO toliko elementov, kolikor je transakcij, vsak z "index" (1-osnovan).

Vrni SAMO JSON array v tej obliki:
[{"index": 1, "category_id": 12, "new_category": null, "company": "Mercator", "language": "sl"},
 {"index": 2, "category_id": null, "new_category": {"name": "Zabava in prosti čas", "type": "expense", "reason": "Široka skupina za zabavo (npr. Steam, kino, igre)"}, "company": "Steam", "language": "en"},
 {"index": 3, "category_id": null, "new_category": {"name": "Dvigi gotovine", "type": "expense", "reason": "Dvig gotovine na bankomatu"}, "company": null, "language": "sl"}]`;
}

async function categorizeBatch(
  items: SmartCatInput[],
  categories: CategoryLike[],
  priorProposals: NewCategoryProposal[] = []
): Promise<SmartCatResult[]> {
  const prompt = buildPrompt(items, categories, priorProposals);

  const response = await getClient().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    // Google Search grounding cannot be combined with JSON response mode, so we
    // ask for JSON in the prompt and parse it out of the text ourselves.
    config: { tools: [{ googleSearch: {} }] },
  });

  const arr = extractJsonArray(response.text ?? "");
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const r of arr) {
    if (r && typeof r === "object") {
      const rec = r as Record<string, unknown>;
      if (typeof rec.index === "number") byIndex.set(rec.index, rec);
    }
  }

  const catById = new Map(categories.map((c) => [c.id, c.type]));

  return items.map((item, i) => {
    const rec = byIndex.get(i + 1);
    let categoryId: number | null = null;
    let proposal: NewCategoryProposal | null = null;

    const rawCat = rec?.category_id;
    if (typeof rawCat === "number" && categoryAccepts(catById.get(rawCat), item.type)) {
      categoryId = rawCat;
    }

    const nc = rec?.new_category;
    if (categoryId === null && nc && typeof nc === "object") {
      const ncr = nc as Record<string, unknown>;
      const name = typeof ncr.name === "string" ? ncr.name.trim() : "";
      const rawType = ncr.type;
      const type: NewCategoryProposal["type"] =
        rawType === "income" || rawType === "both" ? rawType : "expense";
      if (name) {
        proposal = {
          name,
          // A proposed category must be able to hold this transaction's type.
          type: categoryAccepts(type, item.type) ? type : item.type,
          reason: typeof ncr.reason === "string" ? ncr.reason.trim() : "",
        };
      }
    }

    return {
      description: item.description,
      type: item.type,
      category_id: categoryId,
      proposal,
      company: typeof rec?.company === "string" ? (rec.company as string) : null,
      language: typeof rec?.language === "string" ? (rec.language as string) : null,
    };
  });
}

/** Add a proposal to the running list unless an equivalent (same name+type) exists. */
function addProposal(running: NewCategoryProposal[], p: NewCategoryProposal) {
  const key = `${normalize(p.name)}|${p.type}`;
  if (!running.some((q) => `${normalize(q.name)}|${q.type}` === key)) running.push(p);
}

/**
 * Categorize a set of unique transaction descriptions. Batches internally and
 * tolerates per-batch failures (a failed batch yields empty results for its
 * items, which the caller treats as "fall back to default").
 *
 * `priorProposals` seeds the "already suggested" list so the model reuses earlier
 * names instead of minting near-duplicates; newly proposed categories are fed
 * forward into later batches within this call too.
 */
export async function smartCategorize(
  items: SmartCatInput[],
  categories: CategoryLike[],
  priorProposals: NewCategoryProposal[] = []
): Promise<SmartCatResult[]> {
  checkApiKey();
  if (items.length === 0) return [];

  const running: NewCategoryProposal[] = [];
  for (const p of priorProposals) addProposal(running, p);

  const out: SmartCatResult[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const res = await categorizeBatch(batch, categories, running);
      for (const r of res) if (r.proposal) addProposal(running, r.proposal);
      out.push(...res);
    } catch (err) {
      console.error("[smart-categorize] batch failed:", err);
      out.push(
        ...batch.map((item) => ({
          description: item.description,
          type: item.type,
          category_id: null,
          proposal: null,
          company: null,
          language: null,
        }))
      );
    }
  }
  return out;
}
