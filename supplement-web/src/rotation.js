// Probiotic rotation: the admin defines a few intake methods (섭취법) and a start month.
// Month n after the start uses method (n mod count); code "method-round" matches the
// shop guide's notation (1월 1-1, 2월 2-1, 3월 3-1, 4월 1-2, ...).

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

export function defaultPlan(now = new Date()) {
  return {
    startYear: now.getFullYear(),
    startMonth: now.getMonth() + 1,
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

export function monthIndex(year, month) {
  return year * 12 + (month - 1);
}

export function planForMonth(plan, year, month) {
  if (!plan || !Array.isArray(plan.methods) || !plan.methods.length) return null;
  const offset = monthIndex(year, month) - monthIndex(plan.startYear, plan.startMonth);
  if (offset < 0) return { before: true, year, month, monthsUntilStart: -offset };
  const n = plan.methods.length;
  const methodIndex = offset % n;
  const round = Math.floor(offset / n) + 1;
  return {
    before: false, year, month, offset, methodIndex, round,
    method: plan.methods[methodIndex],
    code: `${methodIndex + 1}-${round}`
  };
}

export function upcomingMonths(plan, from = new Date(), count = 12) {
  const out = [];
  let y = from.getFullYear();
  let m = from.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(planForMonth(plan, y, m));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function validPlan(plan) {
  return !!plan
    && Number.isInteger(plan.startYear) && Number.isInteger(plan.startMonth)
    && plan.startMonth >= 1 && plan.startMonth <= 12
    && Array.isArray(plan.methods) && plan.methods.length > 0
    && plan.methods.every((m) => Array.isArray(m.lunch) && Array.isArray(m.dinner));
}
