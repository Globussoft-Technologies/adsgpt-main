import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DateRange } from "react-date-range";
import { addDays, format, subMonths } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useAdminDateRange } from "@/lib/dateRangeStore";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import "./date-range-picker.css";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_3d", label: "Last 3 Days" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_14d", label: "Last 14 Days" },
  { value: "last_28d", label: "Last 28 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "last_90d", label: "Last 90 Days" },
  { value: "last_2m", label: "Last 2 Months" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "lifetime", label: "Lifetime" },
  { value: "maximum", label: "Maximum" },
];

function toISO(date) {
  return format(date, "yyyy-MM-dd");
}

function fromISO(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfQuarter(date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function resolvePreset(value) {
  const today = new Date();
  const day = (offset) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  let from = today;
  let to = today;

  switch (value) {
    case "yesterday":
      from = to = day(-1);
      break;
    case "last_3d":
    case "last_7d":
    case "last_14d":
    case "last_28d":
    case "last_30d":
    case "last_90d": {
      const days = Number(value.match(/\d+/)?.[0] || 1);
      from = day(-(days - 1));
      break;
    }
    case "last_2m":
      from = addDays(subMonths(today, 2), 1);
      break;
    case "this_month":
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case "last_month":
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
      break;
    case "this_quarter":
      from = startOfQuarter(today);
      break;
    case "last_quarter": {
      const currentQuarter = startOfQuarter(today);
      from = new Date(currentQuarter.getFullYear(), currentQuarter.getMonth() - 3, 1);
      to = new Date(currentQuarter.getFullYear(), currentQuarter.getMonth(), 0);
      break;
    }
    case "this_year":
      from = new Date(today.getFullYear(), 0, 1);
      break;
    case "last_year":
      from = new Date(today.getFullYear() - 1, 0, 1);
      to = new Date(today.getFullYear() - 1, 11, 31);
      break;
    case "lifetime":
    case "maximum":
      return { preset: value, from: "", to: "" };
    default:
      break;
  }

  return { preset: value, from: toISO(from), to: toISO(to) };
}

function seedDraft(range) {
  const today = new Date();
  return {
    startDate: fromISO(range.from) || new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13),
    endDate: fromISO(range.to) || today,
    key: "selection",
  };
}

export default function DateRangePicker({
  from,
  to,
  preset,
  onChange,
  className = "",
  ariaLabel = "Date range",
  emptyLabel = "Select dates",
}) {
  const [storedRange, setStoredRange] = useAdminDateRange();
  const controlled = typeof from === "string" && typeof to === "string" && typeof onChange === "function";
  const range = controlled ? { preset: preset || "custom", from, to } : storedRange;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => seedDraft(range));

  useEffect(() => {
    if (open) setDraft(seedDraft(range));
  }, [open, range.from, range.to]);

  const label = useMemo(() => {
    const preset = PRESETS.find((item) => item.value === range.preset);
    if (preset) return preset.label;
    if (!range.from || !range.to) return emptyLabel;
    const from = fromISO(range.from);
    const to = fromISO(range.to);
    if (!from || !to) return "Custom Range";
    return range.from === range.to
      ? format(from, "MMM d, yyyy")
      : `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`;
  }, [emptyLabel, range]);

  const valid = draft.startDate && draft.endDate && draft.startDate <= draft.endDate;

  function selectPreset(preset) {
    const nextRange = resolvePreset(preset.value);
    if (controlled) onChange(nextRange);
    else setStoredRange(nextRange);
    setOpen(false);
  }

  function applyCustomRange() {
    if (!valid) return;
    const nextRange = { preset: "custom", from: toISO(draft.startDate), to: toISO(draft.endDate) };
    if (controlled) onChange(nextRange);
    else setStoredRange(nextRange);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`admin-date-range-trigger ${className}`.trim()}
          aria-label={`${ariaLabel}: ${label}`}
        >
          <CalendarDays aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={12} className="admin-date-range-popover">
          <div className="admin-date-range-layout">
            <div className="admin-date-range-presets" aria-label="Date range presets">
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.value}
                  className={range.preset === preset.value ? "is-active" : ""}
                  onClick={() => selectPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="admin-date-range-calendar">
              <DateRange
                editableDateInputs
                onChange={(item) => setDraft(item.selection)}
                moveRangeOnFirstSelection={false}
                ranges={[draft]}
                months={1}
                direction="horizontal"
                rangeColors={["#22d3ee"]}
                color="#22d3ee"
                maxDate={new Date()}
              />
              <div className="admin-date-range-footer">
                <span>{valid ? `${toISO(draft.startDate)} → ${toISO(draft.endDate)}` : "Pick a start and end date"}</span>
                <button type="button" disabled={!valid} onClick={applyCustomRange}>Apply</button>
              </div>
            </div>
          </div>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
