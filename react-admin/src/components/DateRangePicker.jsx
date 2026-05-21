import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DateRange } from "react-date-range";
import { format } from "date-fns";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import "./date-range-picker.css";

function toISO(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromISO(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISO(new Date());
}

// Whole current calendar month, with the end clamped to today
// (so we don't ship a future end date to the API).
export function currentMonthRangeISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const end = lastOfMonth > now ? now : lastOfMonth;
  return { from: toISO(start), to: toISO(end) };
}

export default function DateRangePicker({ from, to, onChange }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const startDate = fromISO(from) || today;
  const endDate = fromISO(to) || today;
  const isStartActive = !!from;
  const isEndActive = !!to;
  const hasFilter = isStartActive || isEndActive;

  function handleSelect(item) {
    const s = item.selection.startDate;
    const e = item.selection.endDate;
    onChange({ from: toISO(s), to: toISO(e) });
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange({ from: "", to: "" });
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md focus:outline-none"
        >
          <PillButton
            active={isStartActive}
            label={isStartActive ? format(startDate, "MMM d, yyyy") : "Any date"}
          />
          <PillButton
            active={isEndActive}
            label={isEndActive ? format(endDate, "MMM d, yyyy") : "Any date"}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          <DateRange
            ranges={[{ startDate, endDate, key: "selection" }]}
            onChange={handleSelect}
            moveRangeOnFirstSelection={false}
            months={1}
            direction="horizontal"
            rangeColors={["#6366f1"]}
            color="#6366f1"
            showDateDisplay={false}
            maxDate={new Date()}
            shownDate={endDate}
          />
          <div className="flex items-center justify-between border-t border-slate-100 px-2 pt-2 text-xs">
            <button
              type="button"
              onClick={handleClear}
              disabled={!hasFilter}
              className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-indigo-600 px-3 py-1 font-medium text-white transition hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PillButton({ label, active }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition " +
        (active
          ? "border-2 border-indigo-500 text-slate-900 bg-white"
          : "border border-slate-300 text-slate-500 bg-white hover:border-slate-400")
      }
    >
      {label}
    </span>
  );
}
