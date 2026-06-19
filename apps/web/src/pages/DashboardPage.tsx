import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { Combobox } from "../components/Combobox";
import { Input } from "../components/Input";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend,
  Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SectorProps } from "recharts";
import {
  ArrowDownCircle, ArrowUpCircle, CheckCircle2, ChevronDown,
  ChevronUp, Loader2, Search, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = { type: "year"; year: string; month?: string } | { type: "all" };

interface Summary { total_income: number; total_expense: number; balance: number; ending_balance: number | null; transaction_count: number; }
interface MonthlyRow { month: string; income: number; expense: number; }
interface CategoryRow { id: number; name: string; color: string; total: number; income_total: number; expense_total: number; percentage: number; }
interface Category { id: number; name: string; color: string; type: string; }
interface Transaction {
  id: number; date: string; description: string; prejemnik: string; amount: number;
  type: "income" | "expense"; category_id: number | null;
  category_name: string | null; category_color: string | null; is_manual: number;
  stanje: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan","02": "Feb","03": "Mar","04": "Apr","05": "Maj","06": "Jun",
  "07": "Jul","08": "Avg","09": "Sep","10": "Okt","11": "Nov","12": "Dec",
};

function fmt(v: number) {
  return new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(v);
}
function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
function periodDateRange(p: Period): { from?: string; to?: string } {
  if (p.type === "all") return {};
  if (p.month) {
    const lastDay = new Date(Number(p.year), Number(p.month), 0).getDate();
    return {
      from: `${p.year}-${p.month}-01`,
      to: `${p.year}-${p.month}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
}
function toQS(params: Record<string, string | undefined>) {
  const q = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("&");
  return q ? `?${q}` : "";
}

// ── Dashboard Page ─────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [years, setYears] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [byCategory, setByCategory] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Derive all filter state from URL ──────────────────────────────────────
  const yearParam  = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const catParam   = searchParams.get("category");
  const periodParam = searchParams.get("period"); // "all" when user explicitly chose Vse

  const period: Period = useMemo(
    () => yearParam ? { type: "year", year: yearParam, month: monthParam ?? undefined } : { type: "all" },
    [yearParam, monthParam]
  );
  const selectedCategoryId = catParam ? Number(catParam) : null;

  // ── URL-update helpers (replace state setters) ────────────────────────────
  function setPeriod(p: Period) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      // Clear category filter when period changes
      next.delete("category");
      if (p.type === "all") {
        next.delete("year");
        next.delete("month");
        next.set("period", "all"); // explicit marker so refresh stays on Vse
      } else {
        next.delete("period");
        next.set("year", p.year);
        if (p.month) next.set("month", p.month); else next.delete("month");
      }
      return next;
    });
  }
  function setSelectedCategoryId(id: number | null) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === null) next.delete("category"); else next.set("category", String(id));
      return next;
    });
  }

  useEffect(() => {
    apiFetch("/api/dashboard/years")
      .then((r) => r.json())
      .then((d: string[]) => {
        setYears(d);
        // Only default to latest year when there is no explicit filter in the URL
        if (d.length > 0 && !searchParams.get("year") && !searchParams.get("period")) {
          setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("year", d[0]); return next; }, { replace: true });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDashboard = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const { from, to } = periodDateRange(p);
      const sp = toQS({ from, to });
      // Bar chart always shows the full year for context, even when a month is filtered
      const tp = p.type === "year" ? toQS({ year: p.year }) : "";
      const cp = toQS({ from, to });
      const [s, m, c] = await Promise.all([
        apiFetch(`/api/dashboard/summary${sp}`).then((r) => r.json()),
        apiFetch(`/api/dashboard/monthly-trend${tp}`).then((r) => r.json()),
        apiFetch(`/api/dashboard/by-category${cp}`).then((r) => r.json()),
      ]);
      setSummary(s as Summary);
      setMonthly(m as MonthlyRow[]);
      setByCategory((c as CategoryRow[]).filter((x) => x.total > 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchDashboard(period); }, [yearParam, monthParam, fetchDashboard]);

  const chartData = useMemo(
    () => monthly.map((r) => ({ ...r, label: MONTH_LABELS[r.month.slice(5)] ?? r.month })),
    [monthly]
  );
  const selectedMonth = period.type === "year" ? (period.month ?? null) : null;
  const isEmpty = !loading && monthly.length === 0;
  const { from, to } = periodDateRange(period);

  return (
    <div className="space-y-6">
      {/* Header + period selector */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Nadzorna plošča</h1>
          <p className="text-sm text-slate-400 mt-0.5">Pregled vaših financ</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          {/* Year / Vse row */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              onClick={() => setPeriod({ type: "all" })}
              variant={period.type === "all" ? "full" : "transparent"}
              color={period.type === "all" ? "green" : "default"}
              className={period.type === "all" ? "ring-1 ring-emerald-500/30" : undefined}
            >
              Vse
            </Button>
            {years.map((y) => (
              <Button key={y}
                onClick={() => setPeriod(
                  period.type === "year" && period.year === y && !period.month
                    ? { type: "all" }
                    : { type: "year", year: y }
                )}
                variant={period.type === "year" && period.year === y ? "full" : "transparent"}
                color={period.type === "year" && period.year === y ? "green" : "default"}
                className={period.type === "year" && period.year === y ? "ring-1 ring-emerald-500/30" : undefined}
              >
                {y}
              </Button>
            ))}
          </div>
          {/* Month row — directly below, only when a year is selected */}
          {period.type === "year" && (
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {(["01","02","03","04","05","06","07","08","09","10","11","12"] as const).map((num) => {
                const label = MONTH_LABELS[num];
                const active = period.month === num;
                return (
                  <Button key={num}
                    onClick={() => setPeriod({ type: "year", year: period.year, month: active ? undefined : num })}
                    size="sm"
                    variant={active ? "full" : "transparent"}
                    color="default"
                    className={active
                      ? "bg-indigo-500/25 text-indigo-300 hover:bg-indigo-500/35 ring-1 ring-indigo-500/40"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/5"}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {isEmpty && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/2 py-20 text-center">
          <Wallet size={40} className="text-slate-600 mb-4" />
          <p className="text-slate-400 text-sm">Ni podatkov za prikaz.</p>
          <p className="text-slate-500 text-xs mt-1">Naložite PDF izpiske v razdelku Nastavitve.</p>
        </div>
      )}

      {!isEmpty && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCard label="Skupni prihodki" value={summary?.total_income ?? 0} icon={<ArrowUpCircle size={18}/>} colorClass="text-emerald-400" bgClass="bg-emerald-500/10" loading={loading}/>
            <SummaryCard label="Skupni odhodki" value={summary?.total_expense ?? 0} icon={<ArrowDownCircle size={18}/>} colorClass="text-rose-400" bgClass="bg-rose-500/10" loading={loading}/>
            <SummaryCard label="Razlika" value={summary?.balance ?? 0}
              icon={(summary?.balance ?? 0) >= 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>}
              colorClass={(summary?.balance ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}
              bgClass={(summary?.balance ?? 0) >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10"}
              loading={loading}/>
            <div className="rounded-xl border border-white/5 bg-white/2 p-4">
              <p className="text-xs text-slate-400 mb-1">Transakcije</p>
              <p className="text-xl font-semibold text-slate-100">{loading ? "…" : (summary?.transaction_count ?? 0).toLocaleString("sl-SI")}</p>
            </div>
          </div>

          {/* Monthly trend */}
          <div className="rounded-xl border border-white/5 bg-white/2 p-5">
            <h2 className="text-sm font-medium text-slate-300 mb-4">Mesečni pregled</h2>
            {loading ? (
              <ChartSkeleton height={280} />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}/>
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", fontSize: 12 }}
                    labelStyle={{ color: "#cbd5e1" }}
                    itemStyle={{ color: "#f1f5f9" }}
                    formatter={(value: number) => [fmt(value)]}/>
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} formatter={(v) => v === "income" ? "Prihodki" : "Odhodki"}/>
                  <Bar dataKey="income" fill="#10b981" radius={[4,4,0,0]} maxBarSize={28} name="income">
                    {chartData.map((row, i) => {
                      const rowMonth = row.month.slice(5);
                      return <Cell key={i} fill="#10b981" opacity={selectedMonth && rowMonth !== selectedMonth ? 0.2 : 1} />;
                    })}
                  </Bar>
                  <Bar dataKey="expense" fill="#f43f5e" radius={[4,4,0,0]} maxBarSize={28} name="expense">
                    {chartData.map((row, i) => {
                      const rowMonth = row.month.slice(5);
                      return <Cell key={i} fill="#f43f5e" opacity={selectedMonth && rowMonth !== selectedMonth ? 0.2 : 1} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex items-center justify-center h-[280px] text-sm text-slate-500">Ni podatkov za prikaz.</p>
            )}
          </div>

          {/* Category breakdown */}
          <CategoryBreakdown byCategory={byCategory} loading={loading} selectedCategoryId={selectedCategoryId} onSelectCategory={setSelectedCategoryId} />

          {/* Transaction list */}
          <TransactionList from={from} to={to} categoryId={selectedCategoryId} onCategoryChange={() => void fetchDashboard(period)} />
        </>
      )}
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, colorClass, bgClass, loading }: {
  label: string; value: number; icon: React.ReactNode;
  colorClass: string; bgClass: string; loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/2 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-400">{label}</p>
        <span className={`${colorClass} ${bgClass} rounded-md p-1`}>{icon}</span>
      </div>
      <p className={`text-xl font-semibold tabular-nums ${colorClass}`}>{loading ? "…" : fmt(value)}</p>
    </div>
  );
}

// ── Transaction list ──────────────────────────────────────────────────────────

const PAGE = 50;

function TransactionList({ from, to, categoryId, onCategoryChange }: { from?: string; to?: string; categoryId?: number | null; onCategoryChange?: () => void }) {
  const [open, setOpen] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [changed, setChanged] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCatId, setBulkCatId] = useState<number | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKey = useRef("");

  const key = `${from ?? ""}|${to ?? ""}|${search}|${categoryId ?? ""}`;

  // Debounce search input → committed search
  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val.trim()), 350);
  }

  // Reset when period or search changes
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    setTransactions([]);
    setOffset(0);
    setTotal(0);
    setSelectedIds(new Set());
  }, [key]);

  // Fetch categories once
  useEffect(() => {
    apiFetch("/api/categories")
      .then((r) => r.json())
      .then((d) => setCategories(d as Category[]))
      .catch(() => {});
  }, []);

  const load = useCallback(async (off: number, append: boolean, lim = PAGE) => {
    setLoading(true);
    try {
      const qs = toQS({ from, to, search: search || undefined, category_id: categoryId ? String(categoryId) : undefined, limit: String(lim), offset: String(off) });
      const data = await apiFetch(`/api/transactions${qs}`).then((r) => r.json()) as { transactions: Transaction[]; total: number };
      setTransactions((prev) => append ? [...prev, ...data.transactions] : data.transactions);
      setTotal(data.total);
      setOffset(off + data.transactions.length);
    } finally {
      setLoading(false);
    }
  }, [from, to, search, categoryId]);

  // Load first page when period or search changes
  useEffect(() => {
    if (!open) return;
    void load(0, false);
  }, [key, open, load]);

  async function handleCategoryChange(txnId: number, newCatId: number) {
    await apiFetch(`/api/transactions/${txnId}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: newCatId }),
    });
    const cat = categories.find((c) => c.id === newCatId);
    setTransactions((prev) =>
      prev.map((t) => t.id === txnId
        ? { ...t, category_id: newCatId, category_name: cat?.name ?? null, category_color: cat?.color ?? null, is_manual: 1 }
        : t
      )
    );
    setChanged((prev) => ({ ...prev, [txnId]: true }));
    setTimeout(() => setChanged((prev) => { const n = { ...prev }; delete n[txnId]; return n; }), 2000);
    onCategoryChange?.();
  }

  async function handleBulkCategoryChange() {
    if (bulkCatId === null || selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) =>
        apiFetch(`/api/transactions/${id}/category`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_id: bulkCatId, create_rule: false }),
        })
      ));
      const cat = categories.find((c) => c.id === bulkCatId);
      setTransactions((prev) =>
        prev.map((t) => selectedIds.has(t.id)
          ? { ...t, category_id: bulkCatId, category_name: cat?.name ?? null, category_color: cat?.color ?? null, is_manual: 1 }
          : t
        )
      );
      setSelectedIds(new Set());
      setBulkCatId(null);
      onCategoryChange?.();
    } finally {
      setBulkLoading(false);
    }
  }

  const allSelected = transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.id)));
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-white/5 bg-white/2">
      <div className="flex items-center gap-3 px-5 py-4">
        <Button
          variant="transparent"
          color="default"
          onClick={() => { setOpen((v) => !v); if (!open && transactions.length === 0) void load(0, false); }}
          className="text-slate-200 gap-2 min-w-0"
        >
          {open ? <ChevronUp size={15} className="text-slate-400 shrink-0"/> : <ChevronDown size={15} className="text-slate-400 shrink-0"/>}
          <span className="whitespace-nowrap">Transakcije {total > 0 && <span className="text-slate-500">({total.toLocaleString("sl-SI")})</span>}</span>
        </Button>
        {categoryId != null && (
          <span className="flex items-center gap-1.5 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: categories.find((c) => c.id === categoryId)?.color ?? "#94a3b8" }} />
            {categories.find((c) => c.id === categoryId)?.name ?? "Kategorija"}
          </span>
        )}
        {open && (
          <Input
            className="flex-1"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Iskanje po opisu..."
            iconLeft={<Search size={13} />}
          />
        )}
      </div>

      {/* Bulk action bar */}
      {open && someSelected && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-t border-white/5 bg-indigo-500/5">
          <span className="text-xs text-indigo-300 font-medium shrink-0">{selectedIds.size} izbranih</span>
          <Combobox
            variant="indigo"
            size="sm"
            value={bulkCatId}
            onChange={(val) => setBulkCatId(val as number | null)}
            options={(() => {
              const selectedTxns = transactions.filter((t) => selectedIds.has(t.id));
              const types = new Set(selectedTxns.map((t) => t.type));
              const sharedType = types.size === 1 ? [...types][0] : null;
              return (sharedType ? categories.filter((c) => c.type === sharedType) : categories)
                .map((c) => ({ value: c.id, label: c.name, color: c.color }));
            })()}
            nullable
            nullLabel="— izberi kategorijo —"
            className="flex-1 max-w-xs"
          />
          <Button
            variant="full"
            color="default"
            size="sm"
            onClick={() => void handleBulkCategoryChange()}
            disabled={bulkCatId === null || bulkLoading}
            className="bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40"
            iconLeft={bulkLoading ? <Loader2 size={11} className="animate-spin shrink-0"/> : undefined}
          >
            Nastavi
          </Button>
          <Button
            variant="transparent"
            color="default"
            size="sm"
            onClick={() => { setSelectedIds(new Set()); setBulkCatId(null); }}
            className="text-slate-500 hover:text-slate-300 px-0 py-0"
          >
            Prekliči
          </Button>
        </div>
      )}

      {open && (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-white/5 text-left">
                  <th className="pl-4 pr-2 py-2">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && someSelected}
                      onChange={toggleAll}
                      aria-label="Izberi vse"
                    />
                  </th>
                  <th className="px-4 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">Datum</th>
                  <th className="px-4 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">Prejemnik</th>
                  <th className="px-4 py-2 text-xs font-medium text-slate-500 w-full">Opis</th>
                  <th className="px-4 py-2 text-xs font-medium text-slate-500 whitespace-nowrap min-w-[220px]">Kategorija</th>
                  <th className="px-4 py-2 text-xs font-medium text-slate-500 text-right whitespace-nowrap">Znesek</th>
                  <th className="px-4 py-2 text-xs font-medium text-slate-500 text-right whitespace-nowrap">Stanje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {transactions.map((t) => (
                  <tr key={t.id}
                    className={`transition-colors cursor-pointer ${selectedIds.has(t.id) ? "bg-indigo-500/8 hover:bg-indigo-500/12" : "hover:bg-white/2"}`}
                    onClick={() => toggleOne(t.id)}
                  >
                    <td className="pl-4 pr-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                        aria-label="Izberi transakcijo"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums whitespace-nowrap">{fmtDate(t.date)}</td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{t.prejemnik || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-200 w-full">
                      <span className="block truncate">{t.description}</span>
                    </td>
                    <td className="px-4 py-2.5 min-w-[220px]" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <Combobox
                          variant="ghost"
                          size="sm"
                          value={t.category_id ?? null}
                          onChange={(val) => { if (val !== null) void handleCategoryChange(t.id, val as number); }}
                          options={categories.filter((c) => c.type === t.type).map((c) => ({ value: c.id, label: c.name, color: c.color }))}
                          nullable
                          nullLabel="— nedoločeno —"
                          className="max-w-[200px]"
                        />
                        {changed[t.id] && (
                          <CheckCircle2 size={12} className="text-emerald-400 shrink-0" aria-label="Pravilo ustvarjeno"/>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 font-medium tabular-nums text-right whitespace-nowrap ${t.type === "income" ? "text-emerald-400" : "text-rose-400"}`}>
                      {t.type === "expense" ? "-" : "+"}{fmt(t.amount)}
                    </td>
                    <td className={`px-4 py-2.5 tabular-nums text-right whitespace-nowrap text-xs ${t.stanje == null ? "text-slate-600" : t.stanje >= 0 ? "text-slate-400" : "text-rose-400/70"}`}>
                      {t.stanje == null ? "—" : fmt(t.stanje)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {loading && (
            <div className="px-5 py-4 flex items-center gap-2 text-xs text-slate-500 border-t border-white/5">
              <Loader2 size={13} className="animate-spin text-emerald-400 shrink-0" />
              Nalaganje transakcij...
            </div>
          )}

          {!loading && offset < total && (
            <div className="px-5 py-3 border-t border-white/5">
              <Button
                variant="transparent"
                color="green"
                size="sm"
                onClick={() => void load(offset, true, total - offset)}
                className="px-0 py-0"
              >
                Naloži vse preostale ({total - offset})
              </Button>
            </div>
          )}

          {!loading && transactions.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-slate-500">Ni transakcij za izbrano obdobje.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category breakdown (pie + list synced) ────────────────────────────────────

function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: CategoryRow }> }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div style={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
        <span className="text-slate-200 font-medium">{c.name}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-slate-400">
        {c.income_total > 0 && (
          <span className="text-emerald-400">+ {fmt(c.income_total)}</span>
        )}
        {c.expense_total > 0 && (
          <span className="text-rose-400">− {fmt(c.expense_total)}</span>
        )}
        <span className="text-slate-500 text-[11px] pt-0.5">{c.percentage}% skupaj</span>
      </div>
    </div>
  );
}

function CategoryBreakdown({ byCategory, loading, selectedCategoryId, onSelectCategory }: {
  byCategory: CategoryRow[];
  loading: boolean;
  selectedCategoryId: number | null;
  onSelectCategory: (id: number | null) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll highlighted row into view when activated from the chart
  useEffect(() => {
    if (activeIndex === null || !listRef.current) return;
    const row = listRef.current.children[activeIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="rounded-xl border border-white/5 bg-white/2 p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-4">Kategorije</h2>
        {loading ? (
          <ChartSkeleton height={600} round />
        ) : byCategory.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={600}>
              <PieChart>
                <Pie
                  data={byCategory} dataKey="total" nameKey="name"
                cx="50%" cy="50%" innerRadius={130} outerRadius={240} paddingAngle={2}
                activeIndex={activeIndex ?? undefined}
                activeShape={(props: SectorProps) => (
                  <Sector {...props} outerRadius={(props.outerRadius ?? 240) + 10} opacity={0.9} />
                  )}
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onClick={(_, index) => {
                    const cat = byCategory[index];
                    onSelectCategory(selectedCategoryId === cat.id ? null : cat.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {byCategory.map((c, i) => (
                    <Cell
                      key={i} fill={c.color}
                      opacity={
                        selectedCategoryId !== null
                          ? (byCategory[i].id === selectedCategoryId ? 1 : 0.2)
                          : (activeIndex === null || activeIndex === i ? 1 : 0.35)
                      }
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-4 text-xs text-slate-500 -mt-1">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"/>prihodki</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500 shrink-0"/>odhodki</span>
            </div>
          </>
        ) : (
          <p className="flex items-center justify-center h-[600px] text-sm text-slate-500">Ni podatkov.</p>
        )}
      </div>
      <div className="rounded-xl border border-white/5 bg-white/2 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-slate-300">Razčlenitev</h2>
          {selectedCategoryId !== null && (
            <Button
              variant="transparent"
              color="default"
              size="sm"
              onClick={() => onSelectCategory(null)}
              className="text-slate-500 hover:text-slate-300 px-0 py-0"
            >
              Počisti filter ×
            </Button>
          )}
        </div>
        {loading ? (
          <SkeletonRows count={8} />
        ) : byCategory.length > 0 ? (
          <>
            <div className="flex items-center gap-3 px-2 pb-1 mb-1 border-b border-white/5 pr-5">
              <span className="flex-1" />
              <span className="text-xs text-slate-500 w-8 text-right">%</span>
              <span className="text-xs text-emerald-500/70 w-32 text-right">Prihodki</span>
              <span className="text-xs text-rose-500/70 w-32 text-right">Odhodki</span>
              <span className="text-xs text-slate-500 w-32 text-right">Skupaj</span>
            </div>
            <div ref={listRef} className="space-y-1 max-h-[600px] overflow-y-auto [scrollbar-gutter:stable]">
            {byCategory.map((c, i) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 cursor-pointer transition-colors"
                style={{
                  background: selectedCategoryId === c.id
                    ? `${c.color}28`
                    : activeIndex === i ? `${c.color}18` : "transparent",
                  opacity: selectedCategoryId !== null && selectedCategoryId !== c.id ? 0.4 : 1,
                  outline: selectedCategoryId === c.id ? `1px solid ${c.color}50` : "none",
                }}
                onClick={() => onSelectCategory(selectedCategoryId === c.id ? null : c.id)}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full transition-transform"
                  style={{ background: c.color, transform: activeIndex === i || selectedCategoryId === c.id ? "scale(1.35)" : "scale(1)" }} />
                <span className={`flex-1 truncate text-sm transition-colors ${activeIndex === i || selectedCategoryId === c.id ? "text-slate-100" : "text-slate-300"}`}>{c.name}</span>
                <span className="text-xs text-slate-500 w-8 text-right">{c.percentage}%</span>
                <span className="text-xs font-medium tabular-nums text-emerald-400 w-32 text-right">
                  {c.income_total > 0 ? `+ ${fmt(c.income_total)}` : ""}
                </span>
                <span className="text-xs font-medium tabular-nums text-rose-400 w-32 text-right">
                  {c.expense_total > 0 ? `− ${fmt(c.expense_total)}` : ""}
                </span>
                <span className={`text-sm font-semibold tabular-nums w-32 text-right transition-colors ${
                  c.income_total > c.expense_total ? "text-emerald-400" : c.expense_total > c.income_total ? "text-rose-400" : "text-slate-200"
                }`}>
                  {c.income_total > c.expense_total ? "+" : c.expense_total > c.income_total ? "−" : ""}{fmt(Math.abs(c.income_total - c.expense_total))}
                </span>
              </div>
            ))}
          </div>
          </>
        ) : (
          <p className="flex items-center justify-center h-[600px] text-sm text-slate-500">Ni podatkov.</p>
        )}
      </div>
    </div>
  );
}

// ── Skeleton helpers ───────────────────────────────────────────────────────────

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-8 rounded-lg bg-white/4 animate-pulse"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

function ChartSkeleton({ height, round = false }: { height: number; round?: boolean }) {
  return (
    <div
      className="flex items-center justify-center animate-pulse bg-white/3 rounded-xl"
      style={{ height }}
    >
      {round ? (
        <div className="h-32 w-32 rounded-full bg-white/5" />
      ) : (
        <div className="flex items-end gap-2 px-6 w-full h-full py-4">
          {[60, 85, 45, 70, 55, 90, 40, 75, 50, 80, 65, 35].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-white/5"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
