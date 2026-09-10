import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, Calculator, Cpu, Database, KeyRound, LayoutDashboard, Layers, LogOut, Network, Radar, ShieldCheck, Sparkles, Users } from "lucide-react";
import { clearAdminToken } from "@/lib/auth";
import { resetStoredDateRange } from "@/lib/dateRangeStore";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Users", icon: Users },
  // Hidden from the sidebar 2026-09-10, NOT removed. The routes in App.jsx are
  // untouched, so /ip-manager, /database and /calculator still work if you type
  // or bookmark them -- this only takes them out of the daily navigation.
  // Uncomment to bring any of them back.
  // { to: "/ip-manager", label: "IP Manager", icon: Network },
  // { to: "/database", label: "Database Monitor", icon: Database },
  // { to: "/calculator", label: "Calculator", icon: Calculator },
  { to: "/partner-api-keys", label: "Partner API Keys", icon: KeyRound },
  { to: "/plans", label: "Plans & Limits", icon: Layers },
  { to: "/models", label: "AI Models", icon: Cpu },
  // One sidebar entry, two tabs (see components/MetaOpsTabs.jsx). They answer
  // adjacent halves of one question — what the cycle did, and what it cost
  // against Meta's quota — and were previously unrelated-looking siblings.
  //
  // `alsoActiveFor` exists because NavLink only knows about its own `to`:
  // without it the sidebar highlight vanishes the moment you switch to the
  // API Usage tab, which reads as "you have navigated away from this section".
  {
    to: "/autopilot-runs",
    label: "Autopilot & Meta",
    icon: Radar,
    alsoActiveFor: ["/meta-usage"],
  },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  function handleLogout() {
    clearAdminToken();
    resetStoredDateRange();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <Link to="/" className="text-base font-semibold tracking-tight">
            AdsGPT
            <span className="ml-1 text-indigo-600">Admin</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon, end, alsoActiveFor }) => {
            // Computed here rather than via NavLink's render-prop `isActive`,
            // because that only knows about this link's own `to` — and one
            // entry now covers two routes. Doing it once avoids repeating the
            // same expression in the className and the children.
            const active =
              (end
                ? location.pathname === to
                : location.pathname.startsWith(to)) ||
              (alsoActiveFor || []).some((p) => location.pathname.startsWith(p));
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-linear-to-r from-indigo-50 to-violet-50 text-indigo-700 shadow-sm"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-linear-to-b from-indigo-500 to-violet-600" />
                ) : null}
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-100 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-700">Admin session</div>
              <div className="truncate text-[11px] text-slate-500">Read-only access</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-7xl p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
