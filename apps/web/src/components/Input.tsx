import { Input as HLInput } from "@headlessui/react";
import { cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "../lib/utils";

// ── Variants ──────────────────────────────────────────────────────────────────

const inputVariants = cva(
  [
    "w-full rounded-lg border border-white/10 bg-white/5",
    "text-slate-200 placeholder:text-slate-500",
    "focus:outline-none focus:ring-1 transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  {
    variants: {
      variant: {
        default: "focus:ring-emerald-500/50",
        indigo: "focus:ring-indigo-500/50",
      },
      size: {
        sm: "px-3 py-1.5 text-sm",
        md: "px-3 py-2 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InputProps extends Omit<ComponentPropsWithoutRef<"input">, "size"> {
  variant?: "default" | "indigo";
  size?: "sm" | "md";
  iconLeft?: ReactNode;
  mono?: boolean;
  /** Layout/positioning only (e.g. flex-1, w-full, margin). Do not use for styling. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Input({
  variant = "default",
  size = "sm",
  iconLeft,
  mono = false,
  className,
  ...props
}: InputProps) {
  return (
    <div className={cx("relative", className)}>
      {iconLeft && (
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none">
          {iconLeft}
        </span>
      )}
      <HLInput
        {...(props as ComponentPropsWithoutRef<typeof HLInput>)}
        className={cx(
          inputVariants({ variant, size }),
          iconLeft && "pl-7",
          mono && "font-mono",
        )}
      />
    </div>
  );
}
