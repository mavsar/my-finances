import { useBlur } from "../contexts/BlurContext";
import { cx } from "../lib/utils";

const formatter = new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" });

/** Format a number as EUR currency. */
export function fmtMoney(v: number) {
  return formatter.format(v);
}

/**
 * Renders a monetary value (with an optional sign prefix) that respects the
 * global blur toggle. The sign and value are wrapped together so both become
 * blurred at the same time.
 */
export function Money({ value, sign, className }: { value: number; sign?: string; className?: string }) {
  const { blurred } = useBlur();
  return (
    <span
      className={cx(
        "transition-[filter] duration-200",
        blurred && "blur-sm select-none",
        className
      )}
    >
      {sign}{formatter.format(value)}
    </span>
  );
}
