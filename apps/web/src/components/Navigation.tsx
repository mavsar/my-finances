import { BarChart2, LogOut, Settings2, TrendingUp } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { clearToken } from "../lib/api";
import { useBlur } from "../contexts/BlurContext";
import { Button } from "./Button";

const links = [
  { to: "/", label: "Nadzorna plošča", icon: BarChart2, end: true },
  { to: "/nastavitve", label: "Nastavitve", icon: Settings2, end: false },
];

export function Navigation() {
  const navigate = useNavigate();
  const { blurred, toggle } = useBlur();

  function handleLogout() {
    clearToken();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[rgba(7,16,24,0.92)] backdrop-blur-md">
      <div className="flex w-full items-center gap-4 px-6 py-3 md:px-10">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <TrendingUp size={20} className="text-emerald-400" />
          <span className="font-semibold text-slate-100 tracking-tight">My Finances</span>
        </div>

        {/* Nav links — pushed to the right */}
        <nav className="flex items-center gap-1 ml-auto">
          {/* Blur switcher */}
          <button
            onClick={toggle}
            className="mr-2 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
          >
            <span>{blurred ? "Prikaži vrednosti" : "Skrij vrednosti"}</span>
            {/* Track */}
            <span className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-200 ${
              blurred ? "border-amber-400/50 bg-amber-400/20" : "border-white/15 bg-white/8"
            }`}>
              {/* Thumb */}
              <span className={`absolute h-2.5 w-2.5 rounded-full shadow transition-all duration-200 ${
                blurred
                  ? "left-[calc(100%-0.75rem)] bg-amber-300"
                  : "left-[3px] bg-slate-400"
              }`} />
            </span>
          </button>

          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`
              }
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}

          <Button
            variant="transparent"
            color="default"
            onClick={handleLogout}
            iconLeft={<LogOut size={15} />}
          >
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}
