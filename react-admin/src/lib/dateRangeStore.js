import { currentMonthRangeISO } from "@/components/DateRangePicker.jsx";

const STORAGE_KEY = "adsgpt_admin_date_range";

// Session-scoped: persists while navigating between pages, but clears when
// the tab/browser closes, and is explicitly reset on every fresh login.
export function getStoredDateRange() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return currentMonthRangeISO();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.from !== "string" || typeof parsed?.to !== "string") {
      return currentMonthRangeISO();
    }
    return parsed;
  } catch {
    return currentMonthRangeISO();
  }
}

export function setStoredDateRange(range) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(range));
  } catch {
    /* ignore */
  }
}

export function resetStoredDateRange() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
