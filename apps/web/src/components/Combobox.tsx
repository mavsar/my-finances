import {
  Combobox as HLCombobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { cva } from "class-variance-authority";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cx, normalize } from "../lib/utils";

// ── Variants ──────────────────────────────────────────────────────────────────

const triggerVariants = cva(
  "relative flex w-full cursor-default items-center transition-colors",
  {
    variants: {
      variant: {
        default: [
          "rounded-lg border border-white/10 bg-white/5",
          "focus-within:ring-1 focus-within:ring-emerald-500/50",
        ],
        indigo: [
          "rounded-lg border border-white/10 bg-white/5",
          "focus-within:ring-1 focus-within:ring-indigo-500/50",
        ],
        ghost: [
          "border-transparent bg-transparent",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const comboInputVariants = cva(
  [
    "w-full bg-transparent focus:outline-none border-none",
    "placeholder:text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  {
    variants: {
      variant: {
        default: "text-slate-200",
        indigo: "text-slate-200",
        ghost: "text-slate-300",
      },
      size: {
        sm: "py-1.5 pl-3 pr-8 text-sm",
        md: "py-2 pl-3 pr-8 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComboboxOption {
  value: string | number;
  label: string;
  color?: string;
}

export interface ComboboxProps {
  value: string | number | null;
  onChange: (value: string | number | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  variant?: "default" | "indigo" | "ghost";
  size?: "sm" | "md";
  searchable?: boolean;
  nullable?: boolean;
  nullLabel?: string;
  autoFocus?: boolean;
  iconLeft?: ReactNode;
  /** Layout/positioning only (e.g. flex-1, w-32, margin). Do not use for styling. */
  className?: string;
  disabled?: boolean;
}

// ── Sentinel for the null/empty option ────────────────────────────────────────

const NULL_VALUE = "__null__";

// ── Component ─────────────────────────────────────────────────────────────────

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  variant = "default",
  size = "sm",
  searchable = true,
  nullable = false,
  nullLabel = "— izberi —",
  autoFocus,
  iconLeft,
  className,
  disabled,
}: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  // Build full option list, prepend null option when nullable
  const nullOpt: ComboboxOption = { value: NULL_VALUE, label: nullLabel };
  const allOptions: ComboboxOption[] = nullable ? [nullOpt, ...options] : options;

  // Resolve selected option from primitive value
  const selectedOption =
    value === null || value === ""
      ? nullable
        ? nullOpt
        : null
      : (options.find((o) => o.value === value) ?? null);

  // Filter options by query
  const filtered =
    query === "" || !searchable
      ? allOptions
      : allOptions.filter((o) =>
          normalize(o.label).includes(normalize(query))
        );

  function handleChange(opt: ComboboxOption | null) {
    setQuery("");
    if (!opt || opt.value === NULL_VALUE) onChange(null);
    else onChange(opt.value);
  }

  // Show color dot inside trigger only for non-ghost variants
  const showDot = variant !== "ghost" && !!selectedOption?.color;
  // iconLeft shifts padding just like in Input
  const hasLeftSlot = !!iconLeft || showDot;

  return (
    <div className={cx("relative", className)}>
      <HLCombobox
        value={selectedOption}
        onChange={handleChange}
        onClose={() => { setQuery(""); setIsFocused(false); }}
        disabled={disabled}
        immediate
      >
        {/* ── Trigger ─────────────────────────────────────────────────────── */}
        <div className={triggerVariants({ variant })}>
          {iconLeft && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none shrink-0">
              {iconLeft}
            </span>
          )}
          {showDot && !iconLeft && (
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none shrink-0"
              style={{ background: selectedOption!.color }}
            />
          )}

          <ComboboxInput
            className={cx(
              comboInputVariants({ variant, size }),
              hasLeftSlot && "pl-7"
            )}
            displayValue={(opt: ComboboxOption | null) => isFocused ? query : (opt?.label ?? "")}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (searchable) { setIsFocused(true); setQuery(""); } }}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            readOnly={!searchable}
            autoFocus={autoFocus}
          />

          <ComboboxButton
            className={cx(
              "group absolute inset-y-0 right-0 flex items-center",
              size === "md" ? "px-2.5" : "px-2"
            )}
          >
            <ChevronDown
              size={14}
              className="text-slate-400 transition-transform group-data-[open]:rotate-180"
            />
          </ComboboxButton>
        </div>

        {/* ── Options panel ───────────────────────────────────────────────── */}
        <ComboboxOptions
          className={cx(
            "absolute z-50 w-full overflow-auto text-sm",
            "mt-1 rounded-lg border border-white/10 bg-[#0f2035] shadow-xl",
            "focus:outline-none max-h-60",
          )}
        >
          {filtered.length === 0 && query !== "" ? (
            <div className="px-3 py-2 text-slate-500">
              Ni rezultatov.
            </div>
          ) : (
            filtered.map((opt) => (
              <ComboboxOption
                key={String(opt.value)}
                value={opt}
                className="group flex cursor-default select-none items-center gap-2 px-3 py-1.5 text-slate-300 data-[focus]:bg-white/8 data-[selected]:text-slate-100"
              >
                {opt.color && (
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: opt.color }}
                  />
                )}
                <span className="flex-1 truncate">{opt.label}</span>
                {opt.value !== NULL_VALUE && (
                  <Check
                    size={12}
                    className="ml-auto shrink-0 text-emerald-400 opacity-0 group-data-[selected]:opacity-100"
                  />
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </HLCombobox>
    </div>
  );
}
