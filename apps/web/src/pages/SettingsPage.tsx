import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit2,
  FileText,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, sseUrl } from "../lib/api";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { Combobox } from "../components/Combobox";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { normalize } from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  color: string;
  type: "income" | "expense";
  transaction_count: number;
}

interface UploadedFile {
  id: number;
  original_name: string;
  status: "pending" | "processing" | "done" | "error";
  transactions_count: number;
  error_message: string | null;
  uploaded_at: string;
  processed_at: string | null;
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

interface FileProgress {
  name: string;
  status: "čakanje" | "branje" | "razčlenjevanje" | "pravila" | "kategoriziranje" | "shranjevanje" | "uspešno" | "napaka" | "ponovni pregled" | "preverjeno" | "popravljeno";
  progress: number;
  transactionsCount?: number;
  error?: string;
  isRecheck?: boolean;
  corrections?: RecheckCorrection[];
  restored?: number;
  removed?: number;
}

interface UploadJob {
  active: boolean;
  fileProgress: FileProgress[];
  currentFileIndex: number;
  done: boolean;
}

const PRESET_COLORS = [
  // Reds & crimsons
  "#ff4757", "#ff6b81", "#ff6348", "#e74c3c",
  // Oranges & coral
  "#ff9f43", "#fa8231", "#ff7f50", "#e67e22",
  // Yellows & golds
  "#ffd32a", "#f9ca24", "#fdcb6e", "#f0932b",
  // Limes & yellow-greens
  "#c0fb2d", "#a3e635", "#badc58", "#b8e994",
  // Greens
  "#2ed573", "#26de81", "#10b981", "#1e9e5e",
  // Teals & aquas
  "#1dd1a1", "#00d2d3", "#0abde3", "#01aaa4",
  // Light blues
  "#74b9ff", "#60a5fa", "#45aaf2", "#3498db",
  // Deep blues
  "#2e86de", "#0652dd", "#3c40c4", "#1e3799",
  // Indigos
  "#6366f1", "#818cf8", "#5352ed", "#4f46e5",
  // Violets & purples
  "#6c5ce7", "#8b5cf6", "#a855f7", "#9b59b6",
  // Pinks & magentas
  "#f472b6", "#ec4899", "#e84393", "#fd79a8",
  // Extra vivids
  "#e056fd", "#b33fc0", "#ff6c9d", "#94a3b8",
  // Grays — light to dark
  "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8",
  "#64748b", "#475569", "#334155", "#1e293b",
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("sl-SI", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

// ─── Settings Page ─────────────────────────────────────────────────────────────

const TABS = [
  { id: "kategorije",     label: "Kategorije" },
  { id: "pravila",        label: "Pravila" },
  { id: "kategorizacija", label: "Kategorizacija" },
  { id: "datoteke",       label: "Datoteke" },
] as const;

type TabId = typeof TABS[number]["id"];
const TAB_IDS = TABS.map((t) => t.id) as unknown as string[];

export function SettingsPage() {
  const { tab: tabParam } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const tab: TabId = TAB_IDS.includes(tabParam ?? "") ? (tabParam as TabId) : "kategorije";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Nastavitve</h1>
        <p className="text-sm text-slate-400 mt-0.5">Upravljanje kategorij, pravil in nalaganje bančnih izpiskov</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 rounded-xl border border-white/5 bg-white/2 p-1">
        {TABS.map((t) => (
          <Button
            key={t.id}
            onClick={() => navigate(`/nastavitve/${t.id}`)}
            variant={tab === t.id ? "full" : "transparent"}
            color={tab === t.id ? "green" : "default"}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "kategorije" && <CategoriesSection />}
      {tab === "pravila" && <RulesSection />}
      {tab === "kategorizacija" && <RecategorizeSection />}
      {tab === "datoteke" && (
        <div className="space-y-6">
          <UploadSection />
          <HistorySection />
        </div>
      )}
    </div>
  );
}

// ─── Shared skeleton ──────────────────────────────────────────────────────────

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-10 rounded-lg bg-white/4 animate-pulse"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

// ─── Categories Section ────────────────────────────────────────────────────────

function CategoriesSection() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", color: "#22c55e", type: "expense" as "income" | "expense" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch("/api/categories").then((r) => r.json());
    setCategories(data as Category[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openAdd() {
    setNewCat({ name: "", color: "#22c55e", type: "expense" });
    setError("");
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
    setError("");
  }

  function openEdit(c: Category) {
    setEditing(c);
    setError("");
  }

  function closeEdit() {
    setEditing(null);
    setError("");
  }

  async function handleAdd() {
    if (!newCat.name.trim()) { setError("Ime kategorije je obvezno"); return; }
    setSaving(true); setError("");
    const res = await apiFetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCat),
    });
    if (res.ok) {
      closeAdd();
      await load();
    } else {
      const d = await res.json() as { error?: string };
      setError(d.error ?? "Napaka pri shranjevanju");
    }
    setSaving(false);
  }

  async function handleUpdate() {
    if (!editing) return;
    setSaving(true); setError("");
    const res = await apiFetch(`/api/categories/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, color: editing.color, type: editing.type }),
    });
    if (res.ok) {
      closeEdit();
      await load();
    } else {
      const d = await res.json() as { error?: string };
      setError(d.error ?? "Napaka pri shranjevanju");
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Ali res želite izbrisati to kategorijo?")) return;
    await apiFetch(`/api/categories/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="rounded-xl border border-white/5 bg-white/2 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-medium text-slate-200">Kategorije</h2>
        <Button
          variant="full"
          color="green"
          onClick={openAdd}
          iconLeft={<Plus size={14} />}
        >
          Dodaj
        </Button>
      </div>

      {/* Add modal */}
      <Modal
        open={adding}
        onClose={closeAdd}
        title="Nova kategorija"
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="full" color="green" onClick={handleAdd} disabled={saving}>
              {saving ? "Shranjujem..." : "Shrani"}
            </Button>
            <Button variant="outline" color="default" onClick={closeAdd}>
              Prekliči
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <CategoryForm
            name={newCat.name}
            color={newCat.color}
            type={newCat.type}
            onChange={(f) => setNewCat((p) => ({ ...p, ...f }))}
          />
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={editing !== null}
        onClose={closeEdit}
        title="Uredi kategorijo"
        size="md"
        footer={
          <div className="flex gap-2">
            <Button variant="full" color="green" onClick={handleUpdate} disabled={saving}>
              {saving ? "Shranjujem..." : "Shrani"}
            </Button>
            <Button variant="outline" color="default" onClick={closeEdit}>
              Prekliči
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {editing && (
            <CategoryForm
              name={editing.name}
              color={editing.color}
              type={editing.type}
              onChange={(f) => setEditing((p) => p ? { ...p, ...f } : p)}
            />
          )}
        </div>
      </Modal>

      {/* List */}
      {loading ? (
        <SkeletonRows count={6} />
      ) : (
        <div className="space-y-1.5">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/3 group transition-colors">
              <span className="h-3 w-3 rounded-full shrink-0" style={{ background: c.color }} />
              <span className="flex-1 text-sm text-slate-200">{c.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                c.type === "income" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
              }`}>
                {c.type === "income" ? "prihodek" : "odhodek"}
              </span>
              <span className="text-xs text-slate-500">{c.transaction_count} txn</span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button iconOnly variant="transparent" color="default" onClick={() => openEdit(c)}>
                  <Edit2 size={13} />
                </Button>
                <Button iconOnly variant="transparent" color="red" onClick={() => handleDelete(c.id)}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryForm({
  name, color, type, onChange,
}: {
  name: string;
  color: string;
  type: "income" | "expense";
  onChange: (fields: Partial<{ name: string; color: string; type: "income" | "expense" }>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Input
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Ime kategorije"
          className="flex-1"
        />
        <Combobox
          value={type}
          onChange={(val) => onChange({ type: val as "income" | "expense" })}
          options={[
            { value: "expense", label: "Odhodek" },
            { value: "income", label: "Prihodek" },
          ]}
          searchable={false}
          className="w-32 shrink-0"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange({ color: c })}
            className={`cursor-pointer h-6 w-6 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-white/40" : "hover:scale-110"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => onChange({ color: e.target.value })}
          className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
          title="Izberi barvo"
        />
      </div>
    </div>
  );
}

// ─── Upload Section ─────────────────────────────────────────────────────────

function UploadSection() {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [job, setJob] = useState<UploadJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);

  function handleFiles(files: File[]) {
    const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setSelectedFiles(pdfs);
  }

  async function startUpload() {
    if (selectedFiles.length === 0) return;

    const form = new FormData();
    selectedFiles.forEach((f) => form.append("files", f));

    const initialProgress: FileProgress[] = selectedFiles.map((f) => ({
      name: f.name,
      status: "čakanje",
      progress: 0,
    }));

    setJob({ active: true, fileProgress: initialProgress, currentFileIndex: 0, done: false });
    setSelectedFiles([]);

    const res = await apiFetch("/api/files/upload", { method: "POST", body: form });
    const { jobId } = (await res.json()) as { jobId: string };

    if (esRef.current) esRef.current.close();
    const es = new EventSource(sseUrl(`/api/files/jobs/${jobId}/events`));
    esRef.current = es;

    es.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as Record<string, unknown>;

      setJob((prev) => {
        if (!prev) return prev;
        const fp = [...prev.fileProgress];
        const idx = typeof event.fileIndex === "number" ? event.fileIndex - 1 : prev.currentFileIndex;

        if (event.type === "file_start") {
          const isRecheck = event.isRecheck === true;
          if (fp[idx]) fp[idx] = { ...fp[idx], status: isRecheck ? "ponovni pregled" : "branje", progress: 10, isRecheck };
          return { ...prev, currentFileIndex: idx, fileProgress: fp };
        }

        if (event.type === "step") {
          const step = event.step as string;
          const progress = typeof event.progress === "number" ? event.progress : 50;
          const status: FileProgress["status"] =
            step === "parsing"          ? "branje" :
            step === "extracting"       ? "razčlenjevanje" :
            step === "rules"            ? "pravila" :
            step === "categorizing"     ? "kategoriziranje" :
            step === "recheck"          ? "ponovni pregled" :
            step === "recheck_compare"  ? "ponovni pregled" :
            step === "recheck_fix"      ? "ponovni pregled" :
            "shranjevanje";
          if (fp[idx]) fp[idx] = { ...fp[idx], status, progress };
          return { ...prev, fileProgress: fp };
        }

        if (event.type === "file_done") {
          const count = typeof event.transactionsCount === "number" ? event.transactionsCount : 0;
          if (fp[idx]) fp[idx] = { ...fp[idx], status: "uspešno", progress: 100, transactionsCount: count };
          return { ...prev, fileProgress: fp };
        }

        if (event.type === "recheck_done") {
          const count = typeof event.correctionsCount === "number" ? event.correctionsCount : 0;
          const restored = typeof event.restored === "number" ? event.restored : 0;
          const removed = typeof event.removed === "number" ? event.removed : 0;
          const corrections = Array.isArray(event.corrections) ? (event.corrections as RecheckCorrection[]) : [];
          const changed = count > 0 || restored > 0 || removed > 0;
          if (fp[idx]) fp[idx] = {
            ...fp[idx],
            status: changed ? "popravljeno" : "preverjeno",
            progress: 100,
            transactionsCount: count,
            corrections,
            restored,
            removed,
          };
          return { ...prev, fileProgress: fp };
        }

        if (event.type === "file_error") {
          if (fp[idx]) fp[idx] = { ...fp[idx], status: "napaka", progress: 100, error: event.error as string };
          return { ...prev, fileProgress: fp };
        }

        if (event.type === "done") {
          es.close();
          return { ...prev, done: true, active: false };
        }

        return prev;
      });
    };

    es.onerror = () => {
      es.close();
      setJob((prev) => prev ? { ...prev, active: false, done: true } : prev);
    };
  }

  const overallProgress = job
    ? Math.round(job.fileProgress.reduce((s, f) => s + f.progress, 0) / Math.max(job.fileProgress.length, 1))
    : 0;

  return (
    <section className="rounded-xl border border-white/5 bg-white/2 p-5 space-y-4">
      <h2 className="text-base font-medium text-slate-200">Nalaganje bančnih izpiskov</h2>

      {/* Drop zone */}
      {(!job || job.done) && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver
                ? "border-emerald-400/50 bg-emerald-400/5"
                : "border-white/10 hover:border-white/20 hover:bg-white/2"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
            />
            <Upload size={28} className="mx-auto text-slate-500 mb-3" />
            <p className="text-sm text-slate-300 font-medium">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} ${selectedFiles.length === 1 ? "datoteka" : "datoteke/datotek"} izbrane`
                : "Povlecite PDF datoteke sem ali kliknite za izbiro"}
            </p>
            <p className="text-xs text-slate-500 mt-1">Podprte so datoteke PDF (do 50 MB vsaka)</p>
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <div className="max-h-36 overflow-y-auto space-y-1">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white/3 px-3 py-1.5">
                    <FileText size={14} className="text-slate-400 shrink-0" />
                    <span className="flex-1 truncate text-sm text-slate-300">{f.name}</span>
                    <span className="text-xs text-slate-500">
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                ))}
              </div>
              <Button
                variant="full"
                color="green"
                onClick={() => void startUpload()}
              >
                Naloži {selectedFiles.length} {selectedFiles.length === 1 ? "datoteko" : "datotek"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Progress */}
      {job && !job.done && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-emerald-400 shrink-0" />
            <span className="text-sm text-slate-300">Obdelava datotek...</span>
            <span className="ml-auto text-sm font-medium text-emerald-400">{overallProgress}%</span>
          </div>
          <ProgressBar value={overallProgress} />
          <div className="space-y-2">
            {job.fileProgress.map((f, i) => (
              <FileProgressRow key={i} file={f} />
            ))}
          </div>
        </div>
      )}

      {/* Done summary */}
      {job?.done && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
            <CheckCircle2 size={16} />
            <span>Obdelava zaključena</span>
          </div>
          <div className="space-y-1.5">
            {job.fileProgress.map((f, i) => (
              <FileProgressRow key={i} file={f} />
            ))}
          </div>
          <Button
            variant="transparent"
            color="default"
            size="sm"
            onClick={() => setJob(null)}
          >
            Zapri poročilo
          </Button>
        </div>
      )}
    </section>
  );
}

function FileProgressRow({ file }: { file: FileProgress }) {
  const fmtAmt = (n: number) =>
    new Intl.NumberFormat("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const statusConfig: Record<FileProgress["status"], { label: string; color: string }> = {
    čakanje:           { label: "Čakanje...", color: "text-slate-500" },
    branje:            { label: "Branje PDF...", color: "text-amber-400" },
    razčlenjevanje:    { label: "Razčlenjevanje transakcij...", color: "text-blue-400" },
    pravila:           { label: "Preverjanje pravil...", color: "text-sky-400" },
    kategoriziranje:   { label: "Kategoriziranje novih vzorcev...", color: "text-violet-400" },
    shranjevanje:      { label: "Shranjevanje...", color: "text-purple-400" },
    "ponovni pregled": { label: "Ponovni pregled obstoječih podatkov...", color: "text-amber-400" },
    preverjeno:        { label: "Brez sprememb — vse vrednosti pravilne", color: "text-emerald-400" },
    popravljeno:       { label: (() => {
                          const parts: string[] = [];
                          if (file.transactionsCount) parts.push(`popravljeno ${file.transactionsCount}`);
                          if (file.restored) parts.push(`dodano ${file.restored}`);
                          if (file.removed) parts.push(`odstranjeno ${file.removed}`);
                          return parts.length ? `Usklajeno — ${parts.join(", ")}` : "Usklajeno";
                        })(), color: "text-orange-400" },
    uspešno:           { label: file.transactionsCount !== undefined ? `${file.transactionsCount} transakcij` : "Uspešno", color: "text-emerald-400" },
    napaka:            { label: file.error ?? "Napaka", color: "text-rose-400" },
  };

  const { label, color } = statusConfig[file.status];
  const isTerminal = ["uspešno", "napaka", "preverjeno", "popravljeno"].includes(file.status);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {(file.status === "uspešno" || file.status === "preverjeno") && (
          <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
        )}
        {file.status === "napaka" && <XCircle size={13} className="text-rose-400 shrink-0" />}
        {file.status === "popravljeno" && <AlertCircle size={13} className="text-orange-400 shrink-0" />}
        {!isTerminal && (
          <Loader2 size={13} className="animate-spin text-slate-400 shrink-0" />
        )}
        <span className="flex-1 truncate text-sm text-slate-300">{file.name}</span>
        <span className={`text-xs ${color}`}>{label}</span>
      </div>
      {file.progress > 0 && file.progress < 100 && (
        <ProgressBar value={file.progress} slim />
      )}
      {file.status === "popravljeno" && file.corrections && file.corrections.length > 0 && (
        <div className="ml-5 mt-2 space-y-1.5 border-l-2 border-orange-400/30 pl-3">
          <p className="text-xs font-medium text-orange-300">Popravljene transakcije:</p>
          {file.corrections.map((c, ci) => {
            const typeChanged = c.prevType !== c.newType;
            const amountChanged = Math.abs(c.prevAmount - c.newAmount) > 0.02;
            return (
              <div key={ci} className="rounded-lg bg-orange-400/5 px-2.5 py-1.5 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-500">{c.date}</span>
                  <span className="flex-1 truncate text-slate-300">{c.description}</span>
                </div>
                {typeChanged && (
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-14 shrink-0">Tip:</span>
                    <span className={c.prevType === "expense" ? "text-rose-400 font-medium" : "text-emerald-400 font-medium"}>
                      {c.prevType === "expense" ? "− odhodek" : "+ prihodek"}
                    </span>
                    <span className="text-slate-500 mx-1">→</span>
                    <span className={c.newType === "expense" ? "text-rose-400 font-medium" : "text-emerald-400 font-medium"}>
                      {c.newType === "expense" ? "− odhodek" : "+ prihodek"}
                    </span>
                  </div>
                )}
                {amountChanged && (
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-14 shrink-0">Znesek:</span>
                    <span className="font-mono text-slate-400 line-through">{fmtAmt(c.prevAmount)} €</span>
                    <span className="text-slate-500 mx-1">→</span>
                    <span className="font-mono text-orange-300 font-medium">{fmtAmt(c.newAmount)} €</span>
                  </div>
                )}
                {c.newStanje != null && (
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500 w-14 shrink-0">Stanje:</span>
                    <span className="font-mono text-slate-400">{fmtAmt(c.newStanje)} €</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, slim = false }: { value: number; slim?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-full bg-slate-800 ${slim ? "h-1" : "h-2"}`}>
      <div
        className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

// ─── History Section ──────────────────────────────────────────────────────────

/** Extracts YYYYMMDD from a filename, returns null if not found. */
function extractFileDate(name: string): string | null {
  const m = name.match(/(\d{8})/);
  return m ? m[1] : null;
}

function formatFileDate(raw: string): string {
  // raw = "YYYYMMDD"
  const y = raw.slice(0, 4), mo = raw.slice(4, 6), d = raw.slice(6, 8);
  return `${d}. ${mo}. ${y}`;
}

type HistorySort = "upload" | "filedate";

function HistorySection() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [sort, setSort] = useState<HistorySort>("upload");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch("/api/files").then((r) => r.json());
    setFiles(data as UploadedFile[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Ali res želite izbrisati "${name}" in vse njene transakcije?`)) return;
    await apiFetch(`/api/files/${id}`, { method: "DELETE" });
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    await load();
  }

  async function handleBulkDelete() {
    if (!confirm(`Ali res želite izbrisati ${selectedIds.size} datotek in vse njihove transakcije?`)) return;
    setBulkDeleting(true);
    await Promise.all([...selectedIds].map((id) => apiFetch(`/api/files/${id}`, { method: "DELETE" })));
    setSelectedIds(new Set());
    setBulkDeleting(false);
    await load();
  }

  const sortedFiles = useMemo(() => {
    if (sort === "filedate") {
      return [...files].sort((a, b) => {
        const da = extractFileDate(a.original_name) ?? "00000000";
        const db = extractFileDate(b.original_name) ?? "00000000";
        return db.localeCompare(da); // newest first
      });
    }
    // "upload" — keep server order (already DESC by uploaded_at)
    return files;
  }, [files, sort]);

  const allSelected = sortedFiles.length > 0 && sortedFiles.every((f) => selectedIds.has(f.id));
  const someSelected = selectedIds.size > 0;
  const indeterminate = someSelected && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedFiles.map((f) => f.id)));
    }
  }

  const statusConfig: Record<UploadedFile["status"], { label: string; cls: string }> = {
    pending: { label: "V čakanju", cls: "bg-slate-500/15 text-slate-300" },
    processing: { label: "Obdelava...", cls: "bg-amber-500/15 text-amber-300" },
    done: { label: "Uspešno", cls: "bg-emerald-500/15 text-emerald-300" },
    error: { label: "Napaka", cls: "bg-rose-500/15 text-rose-300" },
  };

  return (
    <section className="rounded-xl border border-white/5 bg-white/2 p-5">
      <div className="flex items-center gap-3">
        <Button
          variant="transparent"
          color="default"
          onClick={() => setExpanded((v) => !v)}
        >
          <span>Zgodovina nalaganj {files.length > 0 && <span className="ml-2 text-sm text-slate-500">({files.length})</span>}</span>
          {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </Button>
        {!loading && files.length > 1 && (
          <div className="flex rounded-lg border border-white/10 overflow-hidden shrink-0 text-xs font-medium">
            <Button
              onClick={() => setSort("upload")}
              variant={sort === "upload" ? "full" : "transparent"}
              color={sort === "upload" ? "green" : "default"}
              size="sm"
            >
              Datum nalaganja
            </Button>
            <Button
              onClick={() => setSort("filedate")}
              variant={sort === "filedate" ? "full" : "transparent"}
              color={sort === "filedate" ? "green" : "default"}
              size="sm"
            >
              Datum izpiska
            </Button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-4 space-y-1.5">
          {loading ? (
            <SkeletonRows count={4} />
          ) : sortedFiles.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">Še ni naloženih datotek.</p>
          ) : (
            <>
              {/* Select-all header */}
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-white/5 mb-1">
                <Checkbox
                  checked={allSelected}
                  indeterminate={indeterminate}
                  onChange={toggleAll}
                  aria-label="Izberi vse"
                />
                <span className="text-xs text-slate-500">
                  {someSelected ? `${selectedIds.size} izbranih` : "Izberi vse"}
                </span>
              </div>

              {/* Bulk action bar */}
              {someSelected && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-rose-500/8 border border-rose-500/20 mb-1">
                  <span className="text-xs text-rose-300 font-medium flex-1">
                    {selectedIds.size} {selectedIds.size === 1 ? "datoteka izbrana" : "datotek izbranih"}
                  </span>
                  <Button
                    size="sm"
                    variant="full"
                    color="red"
                    disabled={bulkDeleting}
                    onClick={() => void handleBulkDelete()}
                  >
                    <Trash2 size={13} />
                    {bulkDeleting ? "Brisanje..." : `Izbriši ${selectedIds.size}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="transparent"
                    color="default"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <X size={13} />
                  </Button>
                </div>
              )}

              {sortedFiles.map((f) => {
                const { label, cls } = statusConfig[f.status];
                const fileDate = extractFileDate(f.original_name);
                const isSelected = selectedIds.has(f.id);
                return (
                  <div
                    key={f.id}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${isSelected ? "bg-white/5" : "hover:bg-white/3"}`}
                    onClick={() => setSelectedIds((prev) => {
                      const n = new Set(prev);
                      isSelected ? n.delete(f.id) : n.add(f.id);
                      return n;
                    })}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={(checked) => setSelectedIds((prev) => {
                        const n = new Set(prev);
                        checked ? n.add(f.id) : n.delete(f.id);
                        return n;
                      })}
                    />
                    <FileText size={15} className="text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm text-slate-200">{f.original_name}</p>
                      {f.status === "error" && f.error_message && (
                        <p className="truncate text-xs text-rose-400 mt-0.5">{f.error_message}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-slate-500">Naloženo: {formatDate(f.uploaded_at)}</p>
                        {fileDate && (
                          <p className="text-xs text-slate-600">· Izpisek: {formatFileDate(fileDate)}</p>
                        )}
                      </div>
                    </div>
                    {f.status === "done" && (
                      <span className="text-xs text-slate-400">{f.transactions_count} txn</span>
                    )}
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${cls}`}>{label}</span>
                    <Button
                      iconOnly
                      variant="transparent"
                      color="red"
                      onClick={(e) => { e.stopPropagation(); void handleDelete(f.id, f.original_name); }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Rules Section ─────────────────────────────────────────────────────────────

interface RuleCondition {
  pattern: string;
  op?: "AND" | "OR";
}

interface Rule {
  id: number;
  pattern: string;
  conditions: string | null; // serialized JSON of RuleCondition[]
  is_locked: number;
  category_id: number;
  category_name: string;
  category_color: string;
  match_count: number;
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

function RuleTransactions({ conditions, categoryId }: { conditions: RuleCondition[]; categoryId: number }) {
  const [txns, setTxns] = useState<RuleTxn[] | null>(null);
  const [loading, setLoading] = useState(false);

  const key = conditions.map((c) => `${c.op ?? "FIRST"}:${c.pattern}`).join("|");

  useEffect(() => {
    const filled = conditions.filter((c) => c.pattern.trim());
    if (filled.length === 0) { setTxns([]); return; }

    setLoading(true);
    const uniquePatterns = [...new Set(filled.map((c) => c.pattern.trim()))];

    void Promise.all(
      uniquePatterns.map((p) =>
        apiFetch(`/api/transactions?search=${encodeURIComponent(p)}&category_id=${categoryId}&limit=500&word=1`)
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

      setTxns(
        [...resultIds]
          .map((id) => allById.get(id)!)
          .filter(Boolean)
          .sort((a, b) => b.date.localeCompare(a.date))
      );
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
        <Loader2 size={11} className="animate-spin text-slate-400 shrink-0" />
        Nalaganje transakcij...
      </div>
    );
  }

  if (!txns || txns.length === 0) {
    return <p className="px-3 py-3 text-xs text-slate-500">Ni ujemajočih transakcij.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
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
              <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{t.prejemnik || "—"}</td>
              <td className="px-3 py-1.5 text-slate-400 max-w-[260px]">
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
  );
}

function BulkCategoryModal({
  count,
  categories,
  onConfirm,
  onClose,
}: {
  count: number;
  categories: Category[];
  onConfirm: (categoryId: number) => void;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (!categoryId) return;
    setSaving(true);
    await onConfirm(categoryId);
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nastavi kategorijo"
      footer={
        <div className="flex gap-2">
          <Button
            variant="full"
            color="green"
            onClick={() => void confirm()}
            disabled={saving || !categoryId}
          >
            {saving ? "Posodabljam..." : "Potrdi"}
          </Button>
          <Button
            variant="outline"
            color="default"
            onClick={onClose}
          >
            Prekliči
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Izbranih <span className="text-slate-200 font-medium">{count}</span> {count === 1 ? "pravilo" : "pravil"} bo posodobljenih skupaj z vsemi ujemajočimi transakcijami.
        </p>

        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Kategorija</label>
          <Combobox
            value={categoryId || null}
            onChange={(val) => setCategoryId((val as number) ?? categories[0]?.id ?? 0)}
            options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
            placeholder="Izberi kategorijo..."
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}

function ModalRuleTransactions({ conditions }: { conditions: RuleCondition[] }) {
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
            // AND — keep only IDs present in both sets
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
        <div>
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

function parseRuleConditions(rule: Rule): RuleCondition[] {
  if (!rule.conditions) return [{ pattern: rule.pattern }];
  try {
    const parsed = JSON.parse(rule.conditions) as RuleCondition[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [{ pattern: rule.pattern }];
  } catch {
    return [{ pattern: rule.pattern }];
  }
}

function formatConditionsLabel(conditions: RuleCondition[]): string {
  return conditions
    .map((c, i) => (i === 0 ? c.pattern : `${c.op ?? "AND"} ${c.pattern}`))
    .join("  ");
}

function ConditionsBuilder({
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

function RulesSection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [editConditions, setEditConditions] = useState<RuleCondition[]>([{ pattern: "" }]);
  const [editCategoryId, setEditCategoryId] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);

  // Create form
  const [creating, setCreating] = useState(false);
  const [newConditions, setNewConditions] = useState<RuleCondition[]>([{ pattern: "" }]);
  const [newCategoryId, setNewCategoryId] = useState<number>(0);
  const [createSaving, setCreateSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rulesData, catsData] = await Promise.all([
      apiFetch("/api/rules").then((r) => r.json()),
      apiFetch("/api/categories").then((r) => r.json()),
    ]);
    setRules(rulesData as Rule[]);
    setCategories(catsData as Category[]);
    if (!newCategoryId && (catsData as Category[]).length > 0) {
      setNewCategoryId((catsData as Category[])[0].id);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredRules = search.trim()
    ? rules.filter((r) =>
        normalize(r.pattern).includes(normalize(search)) ||
        normalize(r.category_name).includes(normalize(search))
      )
    : rules;

  const allFilteredSelected =
    filteredRules.length > 0 && filteredRules.every((r) => selectedIds.has(r.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredRules.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredRules.forEach((r) => next.add(r.id));
        return next;
      });
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startEdit(r: Rule) {
    setEditId(r.id);
    setEditConditions(parseRuleConditions(r));
    setEditCategoryId(r.category_id);
  }

  async function handleDelete(id: number) {
    if (!confirm("Izbrisati pravilo?")) return;
    await apiFetch(`/api/rules/${id}`, { method: "DELETE" });
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    await load();
  }

  async function handleSave(id: number) {
    if (editConditions.some((c) => !c.pattern.trim())) return;
    setSaving(true);
    await apiFetch(`/api/rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conditions: editConditions.map((c) => ({ ...c, pattern: c.pattern.trim() })),
        category_id: editCategoryId,
      }),
    });
    setSaving(false);
    setEditId(null);
    await load();
  }

  async function handleCreate() {
    if (!newCategoryId || newConditions.some((c) => !c.pattern.trim())) return;
    setCreateSaving(true);
    await apiFetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conditions: newConditions.map((c) => ({ ...c, pattern: c.pattern.trim() })),
        category_id: newCategoryId,
      }),
    });
    setCreateSaving(false);
    setCreating(false);
    setNewConditions([{ pattern: "" }]);
    setNewCategoryId(0);
    await load();
  }

  async function handleBulkDelete() {
    if (!confirm(`Izbrisati ${selectedIds.size} pravil?`)) return;
    setBulkDeleting(true);
    await Promise.all([...selectedIds].map((id) => apiFetch(`/api/rules/${id}`, { method: "DELETE" })));
    setSelectedIds(new Set());
    setBulkDeleting(false);
    await load();
  }

  async function handleBulkCategory(categoryId: number) {
    await apiFetch("/api/rules/bulk-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule_ids: [...selectedIds], category_id: categoryId }),
    });
    setSelectedIds(new Set());
    setBulkModalOpen(false);
    await load();
  }

  return (
    <>
      {bulkModalOpen && (
        <BulkCategoryModal
          count={selectedIds.size}
          categories={categories}
          onConfirm={handleBulkCategory}
          onClose={() => setBulkModalOpen(false)}
        />
      )}

      {/* Add rule modal */}
      <Modal
        open={creating}
        onClose={() => { setCreating(false); setNewConditions([{ pattern: "" }]); }}
        title="Novo pravilo"
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button
              variant="full"
              color="green"
              onClick={() => void handleCreate()}
              disabled={createSaving || newConditions.some((c) => !c.pattern.trim()) || !newCategoryId}
            >
              {createSaving ? "Ustvarjam..." : "Ustvari pravilo"}
            </Button>
            <Button
              variant="outline"
              color="default"
              onClick={() => { setCreating(false); setNewConditions([{ pattern: "" }]); }}
            >
              Prekliči
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <ConditionsBuilder conditions={newConditions} onChange={setNewConditions} />
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 shrink-0">Kategorija:</label>
            <Combobox
              value={newCategoryId || null}
              onChange={(val) => setNewCategoryId((val as number) ?? 0)}
              options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
              placeholder="Izberi kategorijo..."
              className="flex-1"
            />
          </div>
          <ModalRuleTransactions conditions={newConditions} />
        </div>
      </Modal>

      {/* Edit rule modal */}
      <Modal
        open={editId !== null}
        onClose={() => setEditId(null)}
        title="Uredi pravilo"
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button
              variant="full"
              color="green"
              onClick={() => { if (editId !== null) void handleSave(editId); }}
              disabled={saving || editConditions.some((c) => !c.pattern.trim())}
            >
              {saving ? "Shranjujem..." : "Shrani in posodobi transakcije"}
            </Button>
            <Button
              variant="outline"
              color="default"
              onClick={() => setEditId(null)}
            >
              Prekliči
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <ConditionsBuilder conditions={editConditions} onChange={setEditConditions} />
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 shrink-0">Kategorija:</label>
            <Combobox
              value={editCategoryId || null}
              onChange={(val) => setEditCategoryId((val as number) ?? 0)}
              options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
              placeholder="Izberi kategorijo..."
              className="flex-1"
            />
          </div>
          <ModalRuleTransactions conditions={editConditions} />
        </div>
      </Modal>

      <section className="rounded-xl border border-white/5 bg-white/2 p-5">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-base font-medium text-slate-200">
            Pravila kategorij
            {rules.length > 0 && <span className="ml-2 text-sm text-slate-500">({rules.length})</span>}
          </span>
          {!loading && (
            <Button
              variant="full"
              color="green"
              onClick={() => { setCreating((v) => !v); setNewConditions([{ pattern: "" }]); }}
              iconLeft={<Plus size={14}/>}
            >
              Novo pravilo
            </Button>
          )}
        </div>

        <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">
              Pravila se ustvarijo samodejno pri nalaganju PDF datotek (na podlagi prejemnika in opisa) in pri ročni spremembi kategorije. Ko vzorec obstaja, Gemini ni klican — obdelava je hitrejša. Sprememba kategorije takoj posodobi vse ujemajoče transakcije.
            </p>

            {loading ? (
              <SkeletonRows count={5} />
            ) : (
            <>
            {/* Search */}
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedIds(new Set()); }}
              placeholder="Iskanje po vzorcu ali kategoriji..."
              iconLeft={<Search size={13} />}
            />

            {rules.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-500">
                Še ni pravil. Spremenite kategorijo transakcije na nadzorni plošči.
              </p>
            )}

            {rules.length > 0 && filteredRules.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-500">Ni rezultatov za &ldquo;{search}&rdquo;</p>
            )}

            {filteredRules.length > 0 && (
              <>
                {/* Select-all row */}
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <Checkbox
                    checked={allFilteredSelected}
                    indeterminate={!allFilteredSelected && selectedIds.size > 0}
                    onChange={toggleSelectAll}
                    variant="emerald"
                    aria-label="Izberi vsa pravila"
                  />
                  <span className="flex-1 text-xs text-slate-500">
                    {allFilteredSelected
                      ? `Vseh ${filteredRules.length} odznači`
                      : `Izberi vseh ${filteredRules.length}`}
                  </span>
                  {selectedIds.size > 0 && (
                    <>
                      <Button
                        variant="full"
                        color="green"
                        size="sm"
                        onClick={() => setBulkModalOpen(true)}
                        iconLeft={<Edit2 size={11}/>}
                      >
                        Nastavi kategorijo ({selectedIds.size})
                      </Button>
                      <Button
                        variant="full"
                        color="red"
                        size="sm"
                        disabled={bulkDeleting}
                        onClick={() => void handleBulkDelete()}
                        iconLeft={<Trash2 size={11}/>}
                      >
                        {bulkDeleting ? "Brisanje..." : `Izbriši (${selectedIds.size})`}
                      </Button>
                    </>
                  )}
                </div>

                {/* Rule rows */}
                <div className="space-y-1">
                  {filteredRules.map((r) => (
                    <div
                      key={r.id}
                      className={`group rounded-lg border transition-colors ${
                        selectedIds.has(r.id)
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-white/5 bg-white/2"
                      }`}
                    >
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <Checkbox
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          variant="emerald"
                          aria-label="Izberi pravilo"
                        />
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: r.category_color }}/>
                        <span className="flex-1 min-w-0 text-sm text-slate-300 font-mono truncate">
                          {formatConditionsLabel(parseRuleConditions(r))}
                        </span>
                        {r.is_locked === 1 && (
                          <span className="shrink-0 inline-flex" title="Ročno ustvarjeno/urejeno pravilo (IN/ALI logika) — ima prednost pred samodejnimi pravili">
                            <Lock size={11} className="text-amber-400/70" />
                          </span>
                        )}
                        <span className="text-xs text-slate-500 shrink-0">→</span>
                        <span className="text-xs text-slate-300 shrink-0">{r.category_name}</span>
                        <Button
                          variant="transparent"
                          color="default"
                          size="sm"
                          onClick={() => setExpandedRuleId(expandedRuleId === r.id ? null : r.id)}
                          title={expandedRuleId === r.id ? "Skrij transakcije" : "Prikaži transakcije"}
                        >
                          {expandedRuleId === r.id
                            ? <ChevronDown size={13}/>
                            : <ChevronRight size={13}/>
                          }
                          <span className="tabular-nums">{r.match_count}</span>
                        </Button>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button iconOnly variant="transparent" color="default" onClick={() => startEdit(r)}>
                            <Edit2 size={13}/>
                          </Button>
                          <Button iconOnly variant="transparent" color="red" onClick={() => void handleDelete(r.id)}>
                            <Trash2 size={13}/>
                          </Button>
                        </div>
                      </div>
                      {expandedRuleId === r.id && (
                        <div className="border-t border-white/5 bg-white/1">
                          <RuleTransactions conditions={
                            (() => {
                              try { return r.conditions ? (JSON.parse(r.conditions) as RuleCondition[]) : [{ pattern: r.pattern }]; }
                              catch { return [{ pattern: r.pattern }]; }
                            })()
                          } categoryId={r.category_id} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            </>
            )}
          </div>
      </section>
    </>
  );
}

// ─── Recategorize Section ──────────────────────────────────────────────────────

interface ReJob {
  active: boolean;
  done: boolean;
  messages: Array<{ text: string; type: "info" | "success" | "error" }>;
  progress: number;
}

function RecategorizeSection() {
  const [job, setJob] = useState<ReJob | null>(null);
  const esRef = useRef<EventSource | null>(null);

  async function start(scope: "all" | "uncategorized") {
    if (esRef.current) esRef.current.close();
    setJob({ active: true, done: false, messages: [], progress: 0 });

    const res = await apiFetch("/api/transactions/recategorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const { jobId } = (await res.json()) as { jobId: string };

    const es = new EventSource(sseUrl(`/api/transactions/recategorize/${jobId}/events`));
    esRef.current = es;

    es.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as Record<string, unknown>;

      setJob((prev) => {
        if (!prev) return prev;
        const msgs = [...prev.messages];

        if (event.type === "start") {
          msgs.push({ text: `Začetek: ${event.total as number} transakcij`, type: "info" });
          return { ...prev, messages: msgs, progress: 5 };
        }
        if (event.type === "rules_applied") {
          msgs.push({ text: `Pravila: ${event.count as number} posodobljenih, ${event.remaining as number} za AI`, type: "info" });
          return { ...prev, messages: msgs, progress: 30 };
        }
        if (event.type === "gemini_start") {
          msgs.push({ text: `AI analiza: ${event.totalBatches as number} ${(event.totalBatches as number) === 1 ? "serija" : "serij"} po 100`, type: "info" });
          return { ...prev, messages: msgs, progress: 35 };
        }
        if (event.type === "gemini_batch") {
          const pct = 35 + Math.round(((event.batchIndex as number) / (event.totalBatches as number)) * 60);
          return { ...prev, progress: pct };
        }
        if (event.type === "done") {
          es.close();
          msgs.push({ text: `Zaključeno: ${event.rulesApplied as number} s pravili + ${event.geminiApplied as number} z AI`, type: "success" });
          return { ...prev, messages: msgs, progress: 100, done: true, active: false };
        }
        if (event.type === "error") {
          es.close();
          msgs.push({ text: event.message as string, type: "error" });
          return { ...prev, messages: msgs, done: true, active: false };
        }
        return prev;
      });
    };

    es.onerror = () => { es.close(); setJob((prev) => prev ? { ...prev, active: false, done: true } : prev); };
  }

  return (
    <section className="rounded-xl border border-white/5 bg-white/2 p-5 space-y-4">
      <div>
        <h2 className="text-base font-medium text-slate-200">Ponovna kategorizacija</h2>
        <p className="text-xs text-slate-500 mt-1">
          Ponovno razporedi transakcije v kategorije — najprej pravila, nato AI za preostale.
        </p>
      </div>

      {(!job || job.done) && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="full"
            color="green"
            onClick={() => void start("all")}
            iconLeft={<RefreshCw size={14}/>}
          >
            Vse transakcije
          </Button>
          <Button
            variant="full"
            color="default"
            onClick={() => void start("uncategorized")}
            iconLeft={<RefreshCw size={14}/>}
          >
            Samo nekategorizirane
          </Button>
        </div>
      )}

      {job && (
        <div className="space-y-3">
          {job.active && (
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 size={14} className="animate-spin text-emerald-400"/>
              <span>Obdelava...</span>
              <span className="ml-auto text-emerald-400 font-medium">{job.progress}%</span>
            </div>
          )}
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
              style={{ width: `${job.progress}%` }}/>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {job.messages.map((m, i) => (
              <div key={i} className={`flex items-start gap-2 text-xs ${m.type === "success" ? "text-emerald-400" : m.type === "error" ? "text-rose-400" : "text-slate-400"}`}>
                {m.type === "success" && <CheckCircle2 size={12} className="shrink-0 mt-0.5"/>}
                {m.type === "error" && <AlertCircle size={12} className="shrink-0 mt-0.5"/>}
                {m.type === "info" && <span className="shrink-0 mt-0.5 text-slate-500">›</span>}
                <span>{m.text}</span>
              </div>
            ))}
          </div>
          {job.done && (
            <Button
              variant="transparent"
              color="default"
              size="sm"
              onClick={() => setJob(null)}
            >
              Zapri poročilo
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

