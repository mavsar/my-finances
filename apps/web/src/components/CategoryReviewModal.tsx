import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Input } from "./Input";
import { Combobox } from "./Combobox";

export type CatType = "income" | "expense" | "both";

export interface ReviewGroup {
  key: string;
  name: string;
  type: CatType;
  color: string;
  reason: string;
  count: number;
  samples: string[];
}

export interface ReviewCategory {
  id: number;
  name: string;
  type: string;
  color: string;
}

export interface ReviewDecision {
  key: string;
  action: "create" | "merge" | "skip";
  name?: string;
  type?: CatType;
  color?: string;
  mergeCategoryId?: number;
}

interface GroupState {
  action: "create" | "merge" | "skip";
  name: string;
  type: CatType;
  color: string;
  mergeCategoryId: number | null;
}

const PRESET_COLORS = [
  "#ff4757", "#ff9f43", "#ffd32a", "#a3e635", "#26de81",
  "#10b981", "#22d3ee", "#45aaf2", "#5352ed", "#a55eea",
  "#ec4899", "#94a3b8",
];

const TYPE_OPTIONS = [
  { value: "expense", label: "Odhodek" },
  { value: "income", label: "Prihodek" },
  { value: "both", label: "Oboje" },
];

function typeLabel(t: CatType): string {
  return t === "income" ? "prihodek" : t === "expense" ? "odhodek" : "oboje";
}

export function CategoryReviewModal({
  open,
  groups,
  categories,
  onSubmit,
  submitting,
}: {
  open: boolean;
  groups: ReviewGroup[];
  categories: ReviewCategory[];
  onSubmit: (decisions: ReviewDecision[]) => void;
  submitting: boolean;
}) {
  const [state, setState] = useState<Record<string, GroupState>>({});

  // Initialize per-group state whenever a new set of groups arrives.
  const initialState = useMemo(() => {
    const s: Record<string, GroupState> = {};
    for (const g of groups) {
      s[g.key] = { action: "create", name: g.name, type: g.type, color: g.color, mergeCategoryId: null };
    }
    return s;
  }, [groups]);

  const merged: Record<string, GroupState> = { ...initialState, ...state };

  function update(key: string, patch: Partial<GroupState>) {
    setState((prev) => ({ ...prev, [key]: { ...initialState[key], ...prev[key], ...patch } }));
  }

  function setAll(action: "create" | "skip") {
    const s: Record<string, GroupState> = {};
    for (const g of groups) s[g.key] = { ...initialState[g.key], ...merged[g.key], action };
    setState(s);
  }

  function handleSubmit() {
    const decisions: ReviewDecision[] = groups.map((g) => {
      const gs = merged[g.key];
      if (gs.action === "merge") {
        return { key: g.key, action: "merge", mergeCategoryId: gs.mergeCategoryId ?? undefined };
      }
      if (gs.action === "skip") {
        return { key: g.key, action: "skip" };
      }
      return { key: g.key, action: "create", name: gs.name, type: gs.type, color: gs.color };
    });
    onSubmit(decisions);
  }

  const createCount = groups.filter((g) => merged[g.key].action === "create").length;

  return (
    <Modal
      open={open}
      onClose={() => { /* review must be answered; dismissal is disabled */ }}
      title="Pregled predlaganih kategorij"
      size="lg"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="full" color="green" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Shranjujem..." : "Potrdi in nadaljuj"}
          </Button>
          <Button variant="outline" color="default" onClick={() => setAll("create")} disabled={submitting}>
            Ustvari vse
          </Button>
          <Button variant="transparent" color="default" onClick={() => setAll("skip")} disabled={submitting}>
            Preskoči vse
          </Button>
          <span className="ml-auto text-xs text-slate-500">{createCount} za ustvariti</span>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-slate-400">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <span>
            AI ni našel primerne obstoječe kategorije za spodnje transakcije in predlaga nove.
            Za vsako lahko ustvariš novo kategorijo, jo združiš z obstoječo ali jo preskočiš
            (ostane v “Ostali …”).
          </span>
        </p>

        {groups.map((g) => {
          const gs = merged[g.key];
          return (
            <div key={g.key} className="rounded-xl border border-white/8 bg-white/2 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: gs.color }} />
                    <span className="text-sm font-medium text-slate-200 truncate">{g.name}</span>
                    <span className="text-xs text-slate-500">· {g.count} {g.count === 1 ? "transakcija" : "transakcij"}</span>
                  </div>
                  {g.reason && <p className="text-xs text-slate-500 mt-1">{g.reason}</p>}
                </div>
                <div className="flex gap-1 rounded-lg bg-white/5 p-0.5 shrink-0">
                  {(["create", "merge", "skip"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => update(g.key, { action: a })}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        gs.action === a ? "bg-white/10 text-slate-100" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {a === "create" ? "Nova" : a === "merge" ? "Združi" : "Preskoči"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sample transactions */}
              <div className="flex flex-wrap gap-1.5">
                {g.samples.map((s, i) => (
                  <span key={i} className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400 max-w-full truncate">
                    {s}
                  </span>
                ))}
              </div>

              {gs.action === "create" && (
                <div className="space-y-2.5 border-t border-white/5 pt-3">
                  <div className="flex gap-2">
                    <Input
                      value={gs.name}
                      onChange={(e) => update(g.key, { name: e.target.value })}
                      placeholder="Ime kategorije"
                      className="flex-1"
                    />
                    <Combobox
                      value={gs.type}
                      onChange={(val) => update(g.key, { type: val as CatType })}
                      options={TYPE_OPTIONS}
                      searchable={false}
                      className="w-32 shrink-0"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => update(g.key, { color: c })}
                        className={`h-5 w-5 rounded-full transition-transform ${gs.color === c ? "scale-125 ring-2 ring-white/40" : "hover:scale-110"}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {gs.action === "merge" && (
                <div className="border-t border-white/5 pt-3">
                  <Combobox
                    value={gs.mergeCategoryId}
                    onChange={(val) => update(g.key, { mergeCategoryId: val as number | null })}
                    options={categories
                      .filter((c) => c.type === "both" || g.type === "both" || c.type === g.type)
                      .map((c) => ({ value: c.id, label: `${c.name} (${typeLabel(c.type as CatType)})`, color: c.color }))}
                    nullable
                    nullLabel="— izberi obstoječo —"
                    className="w-full"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
