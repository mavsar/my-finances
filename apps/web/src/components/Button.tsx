import { cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "../lib/utils";

// ── Variants ──────────────────────────────────────────────────────────────────

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "font-medium transition-colors cursor-pointer",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  {
    variants: {
      variant: {
        full: "",
        transparent: "",
        outline: "border border-white/10",
      },
      color: {
        default: "",
        green: "",
        red: "",
      },
      size: {
        sm: "px-2.5 py-1 text-xs rounded-md",
        default: "px-3 py-1.5 text-sm rounded-lg",
      },
      iconOnly: {
        true: "p-1 rounded",
        false: "",
      },
    },
    compoundVariants: [
      { variant: "full", color: "green", className: "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" },
      { variant: "full", color: "red", className: "bg-rose-500/10 text-rose-300 hover:bg-rose-500/20" },
      { variant: "full", color: "default", className: "bg-white/5 text-slate-300 hover:bg-white/10" },
      { variant: "transparent", color: "green", className: "text-emerald-400 hover:text-emerald-300" },
      { variant: "transparent", color: "red", className: "text-rose-400 hover:text-rose-300" },
      { variant: "transparent", color: "default", className: "text-slate-400 hover:text-slate-200" },
      { variant: "outline", color: "default", className: "text-slate-400 hover:text-slate-200 hover:border-white/20" },
      { variant: "outline", color: "green", className: "border-emerald-500/30 text-emerald-300 hover:border-emerald-500/50" },
      { variant: "outline", color: "red", className: "border-rose-500/30 text-rose-300 hover:border-rose-500/50" },
    ],
    defaultVariants: {
      variant: "full",
      color: "default",
      size: "default",
      iconOnly: false,
    },
  }
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: "full" | "transparent" | "outline";
  color?: "default" | "green" | "red";
  size?: "sm" | "default";
  iconOnly?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Button({
  variant = "full",
  color = "default",
  size = "default",
  iconOnly = false,
  iconLeft,
  iconRight,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(buttonVariants({ variant, color, size, iconOnly }), className)}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
