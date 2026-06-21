import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Input } from "./Input";
import { Combobox } from "./Combobox";

// ── Shared rule building blocks ───────────────────────────────────────────────
//
// These power the rule editor in both Settings (Pravila kategorij) and the
// dashboard transaction list, so "define a rule" looks and behaves identically
// in both places.

export interface RuleCondition {
  pattern: string;
  op?: "AND" | "OR";
}

export interface RuleEditorCategory {
  id: number;
  name: string;
  color: string;
}

interface RuleTxn {
  id: number;
  date: string;
  description: string;
  prejemnik: string;
  amount: number;
  type: "income" | "expense";
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
function fmtAmt(v: number) {
  return new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(v);
}

export function parseRuleConditions(rule: { pattern: string; conditions: string | null }): RuleCondition[] {
  if (!rule.conditions) return [{ pattern: rule.pattern }];
  try {
    const parsed = JSON.parse(rule.conditions) as RuleCondition[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [{ pattern: rule.pattern }];
  } catch {
    return [{ pattern: rule.pattern }];
  }
}

export function formatConditionsLabel(conditions: RuleCondition[]): string {
  return conditions
    .map((c, i) => (i === 0 ? c.pattern : `${c.op ?? "AND"} ${c.pattern}`))
    .join("  ");
}

// ── Conditions builder (pattern rows joined by AND/OR) ────────────────────────

export function ConditionsBuilder({
  conditions,
  onChange,
}: {
  conditions: RuleCondition[];
  onChange: (c: RuleCondition[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <Combobox
              value={c.op ?? "AND"}
              onChange={(val) => {
                const updated = [...conditions];
                updated[i] = { ...c, op: val as "AND" | "OR" };
                onChange(updated);
              }}
              options={[
                { value: "AND", label: "IN" },
                { value: "OR", label: "ALI" },
              ]}
              searchable={false}
              size="sm"
              className="w-20 shrink-0"
            />
          )}
          <Input
            value={c.pattern}
            onChange={(e) => {
              const updated = [...conditions];
              updated[i] = { ...c, pattern: e.target.value };
              onChange(updated);
            }}
            placeholder="Besedilo / vzorec…"
            mono
            className="flex-1"
          />
          {conditions.length > 1 && (
            <Button
              iconOnly
              variant="transparent"
              color="red"
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}
            >
              <X size={12} />
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="full"
        color="default"
        size="sm"
        onClick={() => onChange([...conditions, { pattern: "", op: "AND" }])}
        iconLeft={<Plus size={11} />}
      >
        Dodaj pogoj
      </Button>
    </div>
  );
}

// ── Live preview of transactions matched by the conditions ────────────────────

export function RuleMatchPreview({ conditions }: { conditions: RuleCondition[] }) {
  const [txns, setTxns] = useState<RuleTxn[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Include ops so AND↔OR changes trigger a refresh
  const patternsKey = conditions
    .map((c) => `${c.op ?? "FIRST"}:${c.pattern.trim()}`)
    .filter((s) => s.split(":")[1])
    .join("|");

  useEffect(() => {
    const filled = conditions.filter((c) => c.pattern.trim());
    if (filled.length === 0) { setTxns(null); return; }

    setLoading(true);
    const timer = setTimeout(() => {
      const uniquePatterns = [...new Set(filled.map((c) => c.pattern.trim()))];

      void Promise.all(
        uniquePatterns.map((p) =>
          apiFetch(`/api/transactions?search=${encodeURIComponent(p)}&limit=500&word=1`)
            .then((r) => r.json())
            .then((d: { transactions: RuleTxn[] }) => ({ pattern: p, txns: d.transactions }))
            .catch(() => ({ pattern: p, txns: [] as RuleTxn[] }))
        )
      ).then((results) => {
        const byPattern = new Map<string, Set<number>>(
          results.map(({ pattern, txns }) => [pattern, new Set(txns.map((t) => t.id))])
        );
        const allById = new Map<number, RuleTxn>(
          results.flatMap(({ txns }) => txns).map((t) => [t.id, t])
        );

        // Walk conditions applying AND (intersect) / OR (union)
        let resultIds = byPattern.get(filled[0].pattern.trim()) ?? new Set<number>();
        for (let i = 1; i < filled.length; i++) {
          const cond = filled[i];
          const condIds = byPattern.get(cond.pattern.trim()) ?? new Set<number>();
          if (cond.op === "OR") {
            condIds.forEach((id) => resultIds.add(id));
          } else {
            resultIds = new Set([...resultIds].filter((id) => condIds.has(id)));
          }
        }

        const merged = [...resultIds]
          .map((id) => allById.get(id)!)
          .filter(Boolean)
          .sort((a, b) => b.date.localeCompare(a.date));

        setTxns(merged);
        setLoading(false);
      });
    }, 400);

    return () => { clearTimeout(timer); setLoading(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternsKey]);

  return (
    <div className="rounded-lg border border-white/5 bg-white/2 overflow-hidden">
      <p className="px-3 py-2 text-xs font-medium text-slate-500 border-b border-white/5">
        Ujemajoče transakcije
        {txns && txns.length > 0 && (
          <span className="ml-1 text-slate-600">({txns.length})</span>
        )}
      </p>
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
          <Loader2 size={11} className="animate-spin text-slate-400 shrink-0" />
          Nalaganje...
        </div>
      ) : !txns || txns.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">
          {!txns ? "Vpišite vzorec za iskanje transakcij." : "Ni ujemajočih transakcij."}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0b1e32]">
              <tr className="text-left border-b border-white/5">
                <th className="px-3 py-1.5 font-medium text-slate-600 whitespace-nowrap">Datum</th>
                <th className="px-3 py-1.5 font-medium text-slate-600 whitespace-nowrap">Prejemnik</th>
                <th className="px-3 py-1.5 font-medium text-slate-600 w-full">Opis</th>
                <th className="px-3 py-1.5 font-medium text-slate-600 text-right whitespace-nowrap">Znesek</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/3">
              {txns.map((t) => (
                <tr key={t.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-3 py-1.5 text-slate-500 tabular-nums whitespace-nowrap">{fmtDate(t.date)}</td>
                  <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap max-w-[120px]">
                    <span className="block truncate">{t.prejemnik || "—"}</span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-400 max-w-[200px]">
                    <span className="block truncate">{t.description}</span>
                  </td>
                  <td className={`px-3 py-1.5 tabular-nums text-right whitespace-nowrap font-medium ${t.type === "income" ? "text-emerald-400" : "text-rose-400"}`}>
                    {t.type === "expense" ? "−" : "+"}{fmtAmt(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Full create/edit rule modal ───────────────────────────────────────────────

export function RuleEditorModal({
  open,
  onClose,
  categories,
  ruleId = null,
  initialConditions,
  initialCategoryId,
  title,
  saveLabel,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  categories: RuleEditorCategory[];
  /** When set, the modal edits this rule (PUT); otherwise it creates one (POST). */
  ruleId?: number | null;
  initialConditions?: RuleCondition[];
  initialCategoryId?: number;
  title?: string;
  saveLabel?: string;
  onSaved?: () => void;
}) {
  const [conditions, setConditions] = useState<RuleCondition[]>([{ pattern: "" }]);
  const [categoryId, setCategoryId] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form each time the modal is opened.
  useEffect(() => {
    if (!open) return;
    setConditions(
      initialConditions && initialConditions.length > 0
        ? initialConditions.map((c) => ({ ...c }))
        : [{ pattern: "" }]
    );
    setCategoryId(initialCategoryId ?? categories[0]?.id ?? 0);
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const invalid = !categoryId || conditions.every((c) => !c.pattern.trim());

  async function save() {
    const filled = conditions
      .map((c) => ({ ...c, pattern: c.pattern.trim() }))
      .filter((c) => c.pattern);
    if (filled.length === 0 || !categoryId) return;

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(ruleId ? `/api/rules/${ruleId}` : "/api/rules", {
        method: ruleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conditions: filled, category_id: categoryId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          res.status === 409
            ? "Pravilo s tem primarnim vzorcem že obstaja."
            : typeof data?.error === "string"
              ? data.error
              : "Pravila ni bilo mogoče shraniti."
        );
        return;
      }
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? (ruleId ? "Uredi pravilo" : "Novo pravilo")}
      size="lg"
      footer={
        <div className="flex gap-2">
          <Button variant="full" color="green" onClick={() => void save()} disabled={saving || invalid}>
            {saving ? "Shranjujem..." : saveLabel ?? (ruleId ? "Shrani in posodobi transakcije" : "Ustvari pravilo")}
          </Button>
          <Button variant="outline" color="default" onClick={onClose}>
            Prekliči
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Pravilo razvrsti izbrane in vse druge ujemajoče transakcije. Vzorci se ujemajo po celih besedah; več pogojev združite z IN/ALI.
        </p>
        <ConditionsBuilder conditions={conditions} onChange={setConditions} />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 shrink-0">Kategorija:</label>
          <Combobox
            value={categoryId || null}
            onChange={(val) => setCategoryId((val as number) ?? 0)}
            options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
            placeholder="Izberi kategorijo..."
            className="flex-1"
          />
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <RuleMatchPreview conditions={conditions} />
      </div>
    </Modal>
  );
}
