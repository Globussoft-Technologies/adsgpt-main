/**
 * Tab strip shared by the two Meta-operations pages.
 *
 * WHY THEY ARE ONE SECTION. They answer adjacent halves of the same question.
 * "Autopilot Runs" says what the hourly cycle did and how long it took;
 * "API Usage" says how much of Meta's shared quota that cost and whose traffic
 * filled which meter. When a run fails with a rate-limit error, the answer is
 * on the other tab — as two unrelated sidebar entries, that connection was a
 * thing you had to already know.
 *
 * TABS, NOT A MERGED PAGE. The two have genuinely different shapes: runs are a
 * timeline you watch live on a 3s poll, usage is a range you slice by source
 * and account over a date picker. Stacking them would mean one date control
 * governing two things it does not mean the same way, and a live-polling panel
 * sitting above a static report. Tabs keep each page's own controls coherent
 * while making the other half one click away.
 *
 * Routes are deliberately UNCHANGED — /meta-usage, /meta-usage/users/:userId
 * and /autopilot-runs all still resolve, so existing links and bookmarks keep
 * working. This only changes navigation, not addressing.
 */
import { NavLink } from "react-router-dom";
import { Activity, Radar } from "lucide-react";

const TABS = [
  { to: "/autopilot-runs", label: "Autopilot Runs", icon: Radar, end: true },
  { to: "/meta-usage", label: "API Usage", icon: Activity, end: false },
];

export default function MetaOpsTabs() {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex gap-1" aria-label="Meta operations">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition",
                isActive
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
              ].join(" ")
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
