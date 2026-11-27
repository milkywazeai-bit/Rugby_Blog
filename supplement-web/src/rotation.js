// Probiotic cycles. The admin defines the cycle types (섭취법) in config/rotation;
// each person starts their own cycle on the day they confirm it, picks one product
// for "pick one" slots, may drop slots, and enters how many they have on hand.
// A cycle lasts while its main product (the first lunch slot) lasts.

const ACV = "wish-01";
const BUTYRATE = "wish-02";
const ENZYMES = "wish-09";
const VITC_ZINC = ["wish-20", "wish-03"];
const GARDEN_OF_LIFE = ["wish-13", "wish-14", "wish-15", "wish-16", "wish-17", "wish-18"];

function common(lunchFirst) {
  return {
    lunch: [
      ...lunchFirst,
      { label: "발효효소", options: [ENZYMES], amount: "1캡슐" },
      { label: "칼마부티르산", options: [BUTYRATE], amount: "1캡슐" },
      { label: "애사비", options: [ACV], amount: "1캡슐" }
    ],
    dinner: [
      { label: "칼마부티르산", options: [BUTYRATE], amount: "1캡슐" },
      { label: "애사비", options: [ACV], amount: "1캡슐" },
      { label: "비타민C + 아연", options: VITC_ZINC, amount: "1캡슐" }
    ]
  };
}

export function defaultPlan() {
  return {
    methods: [
      { id: "m1", title: "섭취법 1", subtitle: "가든 유산균", ...common([
        { label: "가든 유산균", options: GARDEN_OF_LIFE, amount: "1캡슐" }
      ]) },
      { id: "m2", title: "섭취법 2", subtitle: "다균주 + 플로라", ...common([
        { label: "다균주 제품", options: ["wish-23"], amount: "1캡슐" },
        { label: "플로라파지", options: ["wish-07"], amount: "1캡슐" }
      ]) },
      { id: "m3", title: "섭취법 3", subtitle: "점막 개선", ...common([
        { label: "점막개선 제품", options: ["wish-22"], amount: "1캡슐" },
        { label: "폴리페놀 또는 NAG", options: ["wish-21"], amount: "1캡슐" }
      ]) }
    ]
  };
}

export function validPlan(plan) {
  return !!plan
    && Array.isArray(plan.methods) && plan.methods.length > 0
    && plan.methods.every((m) => Array.isArray(m.lunch) && Array.isArray(m.dinner));
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
// picks: { "lunch:0": productId | null(excluded) | "" (not chosen yet) }
export function itemsFromPicks(method, picks) {
  const out = [];
  for (const meal of ["lunch", "dinner"]) {
    method[meal].forEach((slot, i) => {
      const pid = picks[`${meal}:${i}`];
      if (pid) out.push({ meal, label: slot.label, amount: slot.amount || "", productId: pid });
    });
  }
  return out;
}

export function defaultPicks(method, carryOver = []) {
  const picks = {};
  for (const meal of ["lunch", "dinner"]) {
    method[meal].forEach((slot, i) => {
      const opts = slot.options || [];
      const kept = opts.find((id) => carryOver.includes(id));
      picks[`${meal}:${i}`] = opts.length === 1 ? opts[0] : (kept || "");
    });
  }
  return picks;
}
