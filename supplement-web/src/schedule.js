// What to take on a given day, how stock is used up, and history summaries.
// Pure functions so they can be tested without Firebase or a browser.
import { perDose } from "./rotation.js";

export const MEAL_MINUTES = { lunch: 12 * 60 + 30, dinner: 19 * 60 };
export const SECTIONS = [
  { key: "morning", label: "아침", until: 11 * 60 },
  { key: "lunch", label: "점심", until: 17 * 60 },
  { key: "evening", label: "저녁", until: 21 * 60 },
  { key: "night", label: "밤", until: 24 * 60 }
];

export function sectionOf(minutes) {
  return SECTIONS.find((s) => minutes < s.until).key;
}

export function isoDow(day) {
  const g = new Date(day * 86400000).getUTCDay();
  return g === 0 ? 7 : g;
}

export function extraAmount(item) {
  return typeof item.perDose === "number" && item.perDose > 0 ? item.perDose : 1;
}

// Everything to take on `day`: the running cycle, the base set (4번) and extra
// supplements scheduled for that weekday. Each entry has a stable key per day.
export function dayEntries({ cycle, extras, day }) {
  const out = new Map();
  const add = (e) => {
    const prev = out.get(e.key);
    if (prev) prev.amount += e.amount;
    else out.set(e.key, e);
  };
  if (cycle && cycle.startDay <= day) {
    for (const it of cycle.items || []) {
      if (!it.productId) continue;
      add({ key: `cy-${it.meal}-${it.productId}`, kind: "cycle", productId: it.productId, label: it.label,
        amount: perDose(it.amount), minutes: MEAL_MINUTES[it.meal] ?? MEAL_MINUTES.lunch, meal: it.meal });
    }
    const base = cycle.base;
    if (base && (base.startDay ?? cycle.startDay) <= day) {
      for (const it of base.items || []) {
        if (!it.productId) continue;
        add({ key: `base-${it.meal}-${it.productId}`, kind: "base", productId: it.productId, label: it.label,
          amount: perDose(it.amount), minutes: MEAL_MINUTES[it.meal] ?? MEAL_MINUTES.lunch, meal: it.meal });
      }
    }
  }
  const dow = isoDow(day);
  for (const it of extras || []) {
    if (!Array.isArray(it.days) || !it.days.includes(dow)) continue;
    if (typeof it.createdDay === "number" && day < it.createdDay) continue;
    add({ key: `ex-${it.id}`, kind: "extra", productId: it.productId || null, itemId: it.id, label: it.name || "",
      amount: extraAmount(it), minutes: typeof it.timeMinutes === "number" ? it.timeMinutes : 8 * 60 });
  }
  return [...out.values()].sort((a, b) => a.minutes - b.minutes || a.kind.localeCompare(b.kind));
}

// Average units used per day for each product across cycle, base set and extras.
export function dailyUseAll({ cycle, extras }) {
  const use = {};
  const addUse = (pid, n) => { if (pid) use[pid] = (use[pid] || 0) + n; };
  for (const it of (cycle && cycle.items) || []) addUse(it.productId, perDose(it.amount));
  for (const it of (cycle && cycle.base && cycle.base.items) || []) addUse(it.productId, perDose(it.amount));
  for (const it of extras || []) {
    const days = Array.isArray(it.days) ? it.days.length : 7;
    addUse(it.productId, extraAmount(it) * days / 7);
  }
  return use;
}

export function daysLeft(count, perDay) {
  if (typeof count !== "number" || !perDay) return null;
  return Math.max(0, Math.floor(count / perDay));
}

// Which products are in use right now, and where (사이클 / 4번 / 추가).
export function productsInUse({ cycle, extras }) {
  const where = new Map();
  const mark = (pid, tag) => {
    if (!pid) return;
    if (!where.has(pid)) where.set(pid, new Set());
    where.get(pid).add(tag);
  };
  for (const it of (cycle && cycle.items) || []) mark(it.productId, "cycle");
  for (const it of (cycle && cycle.base && cycle.base.items) || []) mark(it.productId, "base");
  for (const it of extras || []) mark(it.productId, "extra");
  return where;
}

// ----- history -----
export function weekStart(day) { return day - (isoDow(day) - 1); }
export function monthKey(day) {
  const d = new Date(day * 86400000);
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
}

// logs: [{ day, status, kind, productId, name, amount, cycleCode, cycleTitle }]
// Groups taken doses by day, week (Mon-Sun) or month, newest first.
export function historyGroups(logs, by) {
  const keyOf = by === "week" ? weekStart : by === "month" ? monthKey : (d) => d;
  const groups = new Map();
  for (const log of logs) {
    if (log.status !== "TAKEN" && log.status !== "SKIPPED") continue;
    const k = keyOf(log.day);
    if (!groups.has(k)) groups.set(k, { key: k, days: new Set(), taken: 0, skipped: 0, cycles: new Map(), products: new Map() });
    const g = groups.get(k);
    if (log.status === "SKIPPED") { g.skipped++; continue; }
    g.taken++;
    g.days.add(log.day);
    if (log.kind === "cycle" && log.cycleCode) g.cycles.set(log.cycleCode, log.cycleTitle || log.cycleCode);
    const pkey = (log.kind || "extra") + ":" + (log.productId || log.name || "?");
    const p = g.products.get(pkey) || { kind: log.kind || "extra", productId: log.productId || null, name: log.name || "", times: 0, units: 0 };
    p.times++;
    p.units += typeof log.amount === "number" ? log.amount : 1;
    g.products.set(pkey, p);
  }
  return [...groups.values()].sort((a, b) => b.key - a.key).map((g) => ({
    key: g.key, activeDays: g.days.size, taken: g.taken, skipped: g.skipped,
    cycles: [...g.cycles.entries()].map(([code, title]) => ({ code, title })),
    products: [...g.products.values()].sort((a, b) => b.times - a.times)
  }));
}
