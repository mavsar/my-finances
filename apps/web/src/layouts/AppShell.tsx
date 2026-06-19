import type { PropsWithChildren } from "react";
import { Navigation } from "../components/Navigation";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="relative min-h-[100lvh] bg-[#071018]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.12),transparent_50%),radial-gradient(ellipse_at_top_right,rgba(212,168,83,0.08),transparent_45%),radial-gradient(ellipse_at_bottom,rgba(14,116,144,0.08),transparent_55%)]"
      />
      <Navigation />
      <main className="relative z-10 px-6 py-6 pb-12 md:px-10">
        {children}
      </main>
    </div>
  );
}
