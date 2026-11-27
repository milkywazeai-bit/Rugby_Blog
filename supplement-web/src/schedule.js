// What to take on a given day, how stock is used up, and history summaries.
// Pure functions so they can be tested without Firebase or a browser.
import { perDose } from "./rotation.js";

// Everything is taken with a meal: 아침, 점심 or 저녁. Each person sets the clock
// time of their meals (내 정보 → 복용 시간), used for ordering and reminders.
export const MEALS = [
  { key: "morning", label: "아침" },
  { key: "lunch", label: "점심" },
  { key: "dinner", label: "저녁" }
];
export const DEFAULT_MEAL_TIMES = { morning: 8 * 60, lunch: 12 * 60 + 30, dinner: 19 * 60 };
const MEAL_KEYS = MEALS.map((m) => m.key);

export function mealTimes(settings) {
  const t = (settings && settings.mealTimes) || {};
  const out = {};
  for (const k of MEAL_KEYS) out[k] = Number.isInteger(t[k]) && t[k] >= 0 && t[k] < 1440 ? t[k] : DEFAULT_MEAL_TIMES[k];
  return out;
}

export function mealLabel(key) {
  const m = MEALS.find((x) => x.key === key);
  return m ? m.label : "";
}

// Extras saved before meals existed have a clock time instead: map it to a meal.
export function extraMeal(item) {
  if (MEAL_KEYS.includes(item.meal)) return item.meal;
  const m = typeof item.timeMinutes === "number" ? item.timeMinutes : 8 * 60;
  if (m < 11 * 60) return "morning";
  if (m < 16 * 60) return "lunch";
  return "dinner";
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
export function dayEntries({ cycle, extras, day, times = DEFAULT_MEAL_TIMES }) {
  const at = (meal) => times[meal] ?? DEFAULT_MEAL_TIMES[meal] ?? DEFAULT_MEAL_TIMES.lunch;
  const order = (meal) => Math.max(0, MEAL_KEYS.indexOf(meal));
  const out = new Map();
  const add = (e) => {
    const prev = out.get(e.key);
    if (prev) prev.amount += e.amount;
    else out.set(e.key, e);
  };
  if (cycle && cycle.startDay <= day) {
    for (const it of cycle.items || []) {
      if (!it.productId) continue;
      const meal = MEAL_KEYS.includes(it.meal) ? it.meal : "lunch";
      add({ key: `cy-${it.meal}-${it.productId}`, kind: "cycle", productId: it.productId, label: it.label,
        amount: perDose(it.amount), minutes: at(meal), meal });
    }
    const base = cycle.base;
    if (base && (base.startDay ?? cycle.startDay) <= day) {
      for (const it of base.items || []) {
        if (!it.productId) continue;
        const meal = MEAL_KEYS.includes(it.meal) ? it.meal : "lunch";
        add({ key: `base-${it.meal}-${it.productId}`, kind: "base", productId: it.productId, label: it.label,
          amount: perDose(it.amount), minutes: at(meal), meal });
      }
    }
  }
  const dow = isoDow(day);
  for (const it of extras || []) {
    if (!Array.isArray(it.days) || !it.days.includes(dow)) continue;
    if (typeof it.createdDay === "number" && day < it.createdDay) continue;
    const meal = extraMeal(it);
    add({ key: `ex-${it.id}`, kind: "extra", productId: it.productId || null, itemId: it.id, label: it.name || "",
      amount: extraAmount(it), minutes: at(meal), meal });
  }
  const kindOrder = { cycle: 0, base: 1, extra: 2 };
  return [...out.values()].sort((a, b) => order(a.meal) - order(b.meal) || kindOrder[a.kind] - kindOrder[b.kind]);
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

// 자동모드: doses from `fromDay` to `toDay` (inclusive) that nobody marked
// (no log at all) count as taken. `logged` holds "day_key" ids that already
// have a log, so a 건너뛰기 or an earlier 완료 is never touched.
export function autoTakeList({ cycle, extras, fromDay, toDay, logged }) {
  // Which meal a dose belongs to does not change what is taken, so default times are fine here.
  const out = [];
  for (let day = fromDay; day <= toDay; day++) {
    for (const e of dayEntries({ cycle, extras, day })) {
      if (!logged.has(day + "_" + e.key)) out.push({ day, entry: e });
    }
  }
  return out;
}
