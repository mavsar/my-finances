import { Checkbox as HLCheckbox } from "@headlessui/react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, Minus } from "lucide-react";
import { cx } from "../lib/utils";

// ── Variants ──────────────────────────────────────────────────────────────────

const checkboxVariants = cva(
  // Base — shared across all variants
  [
    "group relative flex shrink-0 items-center justify-center rounded",
    "border transition-all duration-150 focus:outline-none",
    "focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[#071018]",
    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
  ],
  {
    variants: {
      variant: {
        indigo: [
          "border-white/20 bg-white/5",
          "data-[checked]:border-indigo-500 data-[checked]:bg-indigo-500",
          "data-[indeterminate]:border-indigo-500 data-[indeterminate]:bg-indigo-500",
          "hover:border-indigo-400 hover:bg-indigo-500/10",
          "focus-visible:ring-indigo-500/60",
        ],
        emerald: [
          "border-white/20 bg-white/5",
          "data-[checked]:border-emerald-500 data-[checked]:bg-emerald-500",
          "data-[indeterminate]:border-emerald-500 data-[indeterminate]:bg-emerald-500",
          "hover:border-emerald-400 hover:bg-emerald-500/10",
          "focus-visible:ring-emerald-500/60",
        ],
      },
      size: {
        sm: "h-3.5 w-3.5 rounded",
        md: "h-4 w-4 rounded",
        lg: "h-5 w-5 rounded-md",
      },
    },
    defaultVariants: {
      variant: "indigo",
      size: "sm",
    },
  }
);

const iconSize: Record<NonNullable<VariantProps<typeof checkboxVariants>["size"]>, number> = {
  sm: 9,
  md: 10,
  lg: 12,
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CheckboxProps extends VariantProps<typeof checkboxVariants> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  variant,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: CheckboxProps) {
  const px = iconSize[size ?? "sm"];

  return (
    <HLCheckbox
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      indeterminate={indeterminate}
      aria-label={ariaLabel}
      className={cx(checkboxVariants({ variant, size }), className)}
    >
      {/* Check icon */}
      <Check
        size={px}
        strokeWidth={3}
        className={cx(
          "text-white transition-opacity duration-100",
          checked && !indeterminate ? "opacity-100" : "opacity-0"
        )}
      />
      {/* Indeterminate dash */}
      <Minus
        size={px}
        strokeWidth={3}
        className={cx(
          "absolute text-white transition-opacity duration-100",
          indeterminate ? "opacity-100" : "opacity-0"
        )}
      />
    </HLCheckbox>
  );
}
