import { useSyncExternalStore } from "react";

const STORAGE_KEY = "adsgpt_admin_date_range";
const listeners = new Set();
let cachedRange;

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function lastFourteenDaysRangeISO() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 13);
  return { preset: "last_14d", from: toISO(from), to: toISO(to) };
}

export function thisMonthRangeISO() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), 1);
  return { preset: "this_month", from: toISO(from), to: toISO(to) };
}

function normalizeRange(value) {
  if (!value || typeof value.from !== "string" || typeof value.to !== "string") {
    return thisMonthRangeISO();
  }
  return {
    preset: typeof value.preset === "string" ? value.preset : "custom",
    from: value.from,
    to: value.to,
  };
}

function readStoredRange() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeRange(JSON.parse(raw)) : thisMonthRangeISO();
  } catch {
    return thisMonthRangeISO();
  }
}

export function getStoredDateRange() {
  if (!cachedRange) cachedRange = readStoredRange();
  return cachedRange;
}

export function setStoredDateRange(range) {
  cachedRange = normalizeRange(range);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedRange));
  } catch {
    /* Storage is an enhancement; the in-memory range still works. */
  }
  listeners.forEach((listener) => listener());
}

export function resetStoredDateRange() {
  cachedRange = thisMonthRangeISO();
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAdminDateRange() {
  const range = useSyncExternalStore(subscribe, getStoredDateRange, thisMonthRangeISO);
  return [range, setStoredDateRange];
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      cachedRange = event.newValue
        ? normalizeRange(JSON.parse(event.newValue))
        : thisMonthRangeISO();
    } catch {
      cachedRange = thisMonthRangeISO();
    }
    listeners.forEach((listener) => listener());
  });
}
