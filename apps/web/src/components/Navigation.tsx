import { BarChart2, LogOut, Settings2, TrendingUp } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { clearToken } from "../lib/api";

const links = [
  { to: "/", label: "Nadzorna plošča", icon: BarChart2, end: true },
  { to: "/nastavitve", label: "Nastavitve", icon: Settings2, end: false },
];

export function Navigation() {
  const navigate = useNavigate();

  function handleLogout() {
    clearToken();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[rgba(7,16,24,0.92)] backdrop-blur-md">
      <div className="flex w-full items-center justify-between px-6 py-3 md:px-10">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <TrendingUp size={20} className="text-emerald-400" />
          <span className="font-semibold text-slate-100 tracking-tight">My Finances</span>
        </div>

        {/* Nav menu */}
        <nav className="flex items-center gap-1">
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

          <button
            onClick={handleLogout}
            className="ml-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            title="Sign out"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
