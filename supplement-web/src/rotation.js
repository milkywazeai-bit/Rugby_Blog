// Probiotic cycles. The admin defines the cycle types in config/rotation;
// each person starts their own cycle on the day they confirm it, picks one product
// for "pick one" slots, may drop slots, and enters how many they have on hand.
// A cycle lasts while its main product (the first lunch slot) lasts.

// An option is one product or a set of products taken together: { ids: [...] }.
// (Firestore can't nest arrays, hence the object.) Older plans stored bare ids.
const one = (id) => ({ ids: [id] });
const set = (...ids) => ({ ids });
const ACV = "wish-01";
const BUTYRATE = "wish-02";
const VITC_D_ZINC = "wish-03";
const ENZYMES = "wish-09";
const TRIBUTYRIN = "wish-39";
const GARDEN_OF_LIFE = ["wish-13", "wish-14", "wish-15", "wish-16", "wish-17", "wish-18"].map(one);
const MULTI_STRAIN = ["wish-23", "wish-28", "wish-29", "wish-30", "wish-31", "wish-32"].map(one);
const MUCOSA_SETS = [set("wish-33", "wish-34"), set("wish-36", "wish-35"), set("wish-38", "wish-37")];

export function optionIds(opt) {
  if (typeof opt === "string") return [opt];
  return opt && Array.isArray(opt.ids) ? opt.ids : [];
}

// Every product the cycle plan uses (all methods and the 4번 base set).
export function planProductIds(plan) {
  const ids = new Set();
  const slots = [];
  for (const m of (plan && plan.methods) || []) slots.push(...(m.lunch || []), ...(m.dinner || []));
  slots.push(...((plan && plan.base && plan.base.slots) || []));
  for (const slot of slots) for (const opt of slot.options || []) for (const id of optionIds(opt)) ids.add(id);
  return ids;
}

export function slotOptions(slot) {
  return (slot.options || []).map(optionIds).filter((ids) => ids.length);
}

// Cycles 1-3 rotate; the base set ("4번 사이클") is chosen once when a person
// starts and keeps going under every cycle. Base slots list the meals they're taken at.
export function defaultPlan() {
  return {
    methods: [
      { id: "m1", title: "사이클 1", subtitle: "가든 유산균", lunch: [
        { label: "가든 유산균", options: GARDEN_OF_LIFE, amount: "1캡슐" }
      ], dinner: [] },
      { id: "m2", title: "사이클 2", subtitle: "다균주 + 플로라", lunch: [
        { label: "다균주 유산균", options: MULTI_STRAIN, amount: "1캡슐" },
        { label: "플로라파지", options: [one("wish-07")], amount: "1캡슐" }
      ], dinner: [] },
      { id: "m3", title: "사이클 3", subtitle: "점막 개선", lunch: [
        { label: "점막 개선 세트", options: MUCOSA_SETS, amount: "각 1캡슐" }
      ], dinner: [] }
    ],
    base: {
      title: "사이클 4",
      subtitle: "기본 구성 · 사이클과 상관없이 계속",
      slots: [
        { label: "발효효소", options: [one(ENZYMES)], amount: "1캡슐", meals: ["lunch"] },
        { label: "칼마부티르산 또는 트리부티린", options: [one(BUTYRATE), one(TRIBUTYRIN)], amount: "1캡슐", meals: ["lunch", "dinner"] },
        { label: "애사비", options: [one(ACV)], amount: "1캡슐", meals: ["lunch", "dinner"] },
        { label: "비타민C + D + 아연", options: [one(VITC_D_ZINC)], amount: "1캡슐", meals: ["dinner"] }
      ]
    }
  };
}

export function validPlan(plan) {
  return !!plan
    && Array.isArray(plan.methods) && plan.methods.length > 0
    && plan.methods.every((m) => Array.isArray(m.lunch) && Array.isArray(m.dinner))
    && (!plan.base || Array.isArray(plan.base.slots));
}

export function baseSlots(plan) {
  return plan && plan.base && Array.isArray(plan.base.slots) ? plan.base.slots : [];
}

// Base picks use keys "base:0", "base:1", ...; one pick covers every meal of the slot.
export function baseItemsFromPicks(slots, picks) {
  const out = [];
  slots.forEach((slot, i) => {
    const pick = picks[`base:${i}`];
    if (pick === null || pick === "" || pick === undefined) return;
    const meals = Array.isArray(slot.meals) && slot.meals.length ? slot.meals : ["lunch"];
    for (const meal of ["lunch", "dinner"]) {
      if (!meals.includes(meal)) continue;
      for (const pid of slotOptions(slot)[pick] || []) {
        out.push({ meal, label: slot.label, amount: slot.amount || "", productId: pid });
      }
    }
  });
  return out;
}

export function defaultBasePicks(slots) {
  const picks = {};
  slots.forEach((slot, i) => { picks[`base:${i}`] = slotOptions(slot).length === 1 ? 0 : ""; });
  return picks;
}

export function methodIndexOf(plan, cycle) {
  const byId = plan.methods.findIndex((m) => m.id === cycle.methodId);
  return byId !== -1 ? byId : Math.min(cycle.methodIndex || 0, plan.methods.length - 1);
}

// Code "method-round" as in the guide: 1-1, 2-1, 3-1, then 1-2 ...
export function nextCycle(plan, cycle) {
  const methodIndex = (methodIndexOf(plan, cycle) + 1) % plan.methods.length;
  return { methodIndex, round: methodIndex === 0 ? (cycle.round || 1) + 1 : (cycle.round || 1) };
}

export function perDose(amount) {
  const m = String(amount || "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 1;
}

export function dailyUse(items) {
  const use = {};
  for (const it of items || []) {
    if (!it.productId) continue;
    use[it.productId] = (use[it.productId] || 0) + perDose(it.amount);
  }
  return use;
}

// entry = { count, day }: how many were on hand on that day.
export function remaining(entry, perDay, today) {
  if (!entry || typeof entry.count !== "number") return null;
  const used = Math.max(0, today - entry.day) * (perDay || 0);
  return Math.max(0, entry.count - used);
}

export function cycleStatus(cycle, today) {
  const items = cycle.items || [];
  const use = dailyUse(items);
  const main = items.find((it) => it.meal === "lunch" && it.productId) || items.find((it) => it.productId) || null;
  const day = today - cycle.startDay + 1;
  if (!main) return { day, main: null, left: null, daysLeft: null };
  const perDay = use[main.productId];
  const left = remaining((cycle.stock || {})[main.productId], perDay, today);
  const daysLeft = left === null || !perDay ? null : Math.floor(left / perDay);
  return { day, main, left, daysLeft, endDay: daysLeft === null ? null : today + daysLeft };
}

// Items a person would take for one cycle type with their picks applied.
// picks: { "lunch:0": option index | null (excluded) | "" (not chosen yet) }
// A set option adds one item per product in the set.
export function itemsFromPicks(method, picks) {
  const out = [];
  for (const meal of ["lunch", "dinner"]) {
    method[meal].forEach((slot, i) => {
      const pick = picks[`${meal}:${i}`];
      if (pick === null || pick === "" || pick === undefined) return;
      for (const pid of slotOptions(slot)[pick] || []) {
        out.push({ meal, label: slot.label, amount: slot.amount || "", productId: pid });
      }
    });
  }
  return out;
}

// What was eaten in earlier rounds of one cycle type: productId → ["1-1", ...].
// Reads the running cycle and its history (entries saved with productIds).
export function pastPicks(plan, cycle, methodIndex) {
  const out = new Map();
  const m = plan && plan.methods[methodIndex];
  if (!m || !cycle) return out;
  const entries = [...(cycle.history || []), { methodId: cycle.methodId, round: cycle.round, items: cycle.items }];
  for (const h of entries) {
    if (h.methodId !== m.id) continue;
    const code = `${methodIndex + 1}-${h.round || 1}`;
    const ids = Array.isArray(h.productIds) ? h.productIds : (h.items || []).map((it) => it.productId);
    for (const id of ids) {
      if (!id) continue;
      const list = out.get(id) || [];
      if (!list.includes(code)) list.push(code);
      out.set(id, list);
    }
  }
  return out;
}

export function defaultPicks(method, carryOver = []) {
  const picks = {};
  for (const meal of ["lunch", "dinner"]) {
    method[meal].forEach((slot, i) => {
      const opts = slotOptions(slot);
      const kept = opts.findIndex((ids) => ids.some((id) => carryOver.includes(id)));
      picks[`${meal}:${i}`] = opts.length === 1 ? 0 : (kept !== -1 ? kept : "");
    });
  }
  return picks;
}

// ----- per-person "먹는 방법" for cycle / 4번 items -----
// Items hold one row per product per meal. For editing they are grouped by
// product: which meals, and how many each time (the number inside `amount`).
const MEAL_ORDER = ["morning", "lunch", "dinner"];

export function mealPlanOf(items) {
  const rows = [];
  for (const it of items || []) {
    if (!it.productId) continue;
    let r = rows.find((x) => x.productId === it.productId);
    if (!r) {
      r = { productId: it.productId, label: it.label || "", amount: it.amount || "", dose: perDose(it.amount), meals: [] };
      rows.push(r);
    }
    if (!r.meals.includes(it.meal)) r.meals.push(it.meal);
  }
  rows.forEach((r) => r.meals.sort((a, b) => MEAL_ORDER.indexOf(a) - MEAL_ORDER.indexOf(b)));
  return rows;
}

export function itemsFromMealPlan(rows) {
  const out = [];
  for (const r of rows) {
    const dose = Number(r.dose) > 0 ? Number(r.dose) : 1;
    const amount = /\d/.test(r.amount || "") ? r.amount.replace(/\d+(?:\.\d+)?/, String(dose)) : `${dose}${r.amount || "개"}`;
    for (const meal of MEAL_ORDER) {
      if (r.meals.includes(meal)) out.push({ meal, label: r.label, amount, productId: r.productId });
    }
  }
  return out;
}
