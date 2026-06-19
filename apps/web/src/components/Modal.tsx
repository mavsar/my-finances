import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Modal({ open, onClose, title, children, footer, size = "sm" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidth = size === "sm" ? "max-w-sm" : size === "md" ? "max-w-xl" : "max-w-3xl";

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`relative flex flex-col w-full ${maxWidth} max-h-[90vh] rounded-2xl border border-white/10 bg-[#0b1e32] shadow-2xl`}
      >
        {/* Fixed header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <Button
            iconOnly
            variant="transparent"
            color="default"
            onClick={onClose}
            aria-label="Zapri"
          >
            <X size={16} />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto p-6">{children}</div>

        {/* Fixed footer */}
        {footer && (
          <div className="shrink-0 border-t border-white/5 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
