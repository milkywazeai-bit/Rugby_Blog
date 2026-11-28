import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPlan, validPlan, nextCycle, dailyUse, remaining, cycleStatus, itemsFromPicks, defaultPicks, perDose,
  baseSlots, baseItemsFromPicks, defaultBasePicks, planProductIds, pastPicks, mealPlanOf, itemsFromMealPlan
} from "../src/rotation.js";

const plan = defaultPlan();

test("cycles 1-3 rotate: 1-1, 2-1, 3-1, 1-2", () => {
  assert.equal(plan.methods.length, 3);
  let c = { methodId: "m1", methodIndex: 0, round: 1 };
  const codes = ["1-1"];
  for (let i = 0; i < 3; i++) {
    const n = nextCycle(plan, c);
    c = { methodId: plan.methods[n.methodIndex].id, ...n };
    codes.push(`${n.methodIndex + 1}-${n.round}`);
  }
  assert.deepEqual(codes, ["1-1", "2-1", "3-1", "1-2"]);
});

test("cycles hold only their own products; the base set is separate", () => {
  const all = plan.methods.flatMap((m) => [...m.lunch, ...m.dinner]).map((s) => s.label);
  assert.ok(!all.includes("발효효소") && !all.includes("애사비"));
  assert.deepEqual(baseSlots(plan).map((s) => s.label), ["발효효소", "칼마부티르산 또는 트리부티린", "애사비", "비타민C + D + 아연"]);
});

test("cycle 1: garden probiotic is pick one of 6", () => {
  const picks = defaultPicks(plan.methods[0]);
  assert.equal(picks["lunch:0"], "");
  assert.equal(itemsFromPicks(plan.methods[0], { "lunch:0": 1 })[0].productId, "wish-14");
});

test("cycle 2: Floraphage is fixed, multi-strain is pick one of 6", () => {
  const m = plan.methods[1];
  assert.equal(m.lunch[0].options.length, 6);
  assert.deepEqual(m.lunch[1].options, [{ ids: ["wish-07"] }]);
  assert.equal(defaultPicks(m)["lunch:1"], 0);
});

test("cycle 3: picking a set adds every product in it, main product first", () => {
  const items = itemsFromPicks(plan.methods[2], { "lunch:0": 1 });
  assert.deepEqual(items.map((it) => it.productId), ["wish-36", "wish-35"]);
});

test("base: butyrate or tributyrin is one choice covering lunch and dinner", () => {
  const slots = baseSlots(plan);
  const picks = defaultBasePicks(slots);
  assert.equal(picks["base:1"], "");
  assert.equal(picks["base:0"], 0);
  const items = baseItemsFromPicks(slots, { ...picks, "base:1": 1 });
  assert.deepEqual(items.filter((it) => it.productId === "wish-39").map((it) => it.meal), ["lunch", "dinner"]);
  assert.equal(dailyUse(items)["wish-39"], 2);
  assert.equal(dailyUse(items)["wish-01"], 2);
  assert.equal(dailyUse(items)["wish-03"], 1);
});

test("base: an excluded slot is left out", () => {
  const slots = baseSlots(plan);
  const items = baseItemsFromPicks(slots, { ...defaultBasePicks(slots), "base:1": 0, "base:3": null });
  assert.ok(!items.some((it) => it.productId === "wish-03"));
});

test("a previous pick is carried into the next cycle when it is still an option", () => {
  const old = { lunch: [{ label: "x", options: [{ ids: ["a"] }, { ids: ["b"] }] }], dinner: [] };
  assert.equal(defaultPicks(old, ["b"])["lunch:0"], 1);
});

test("older plans with bare product ids still work", () => {
  const old = { lunch: [{ label: "x", options: ["a", "b"], amount: "1캡슐" }], dinner: [] };
  assert.deepEqual(itemsFromPicks(old, { "lunch:0": 1 }).map((it) => it.productId), ["b"]);
});

test("remaining stock counts down from the day it was entered", () => {
  assert.equal(remaining({ count: 30, day: 100 }, 1, 100), 30);
  assert.equal(remaining({ count: 30, day: 100 }, 2, 110), 10);
  assert.equal(remaining({ count: 5, day: 100 }, 1, 200), 0);
  assert.equal(remaining(undefined, 1, 100), null);
});

test("cycle status is driven by the cycle's main (first lunch) product", () => {
  const cycle = {
    startDay: 100,
    items: [{ meal: "lunch", productId: "wish-14", amount: "1캡슐" }],
    stock: { "wish-14": { count: 12, day: 100 } }
  };
  const s = cycleStatus(cycle, 104);
  assert.equal(s.day, 5);
  assert.equal(s.left, 8);
  assert.equal(s.daysLeft, 8);
  assert.equal(s.endDay, 112);
});

test("dose amounts are read from labels like 2캡슐", () => {
  assert.equal(perDose("2캡슐"), 2);
  assert.equal(perDose("각 1캡슐"), 1);
  assert.equal(perDose(""), 1);
});

test("plan validation", () => {
  assert.equal(validPlan(plan), true);
  assert.equal(validPlan({ methods: [] }), false);
  assert.equal(validPlan({ methods: plan.methods }), true);
});

test("planProductIds lists every product in methods and the base set", () => {
  const ids = planProductIds(defaultPlan());
  for (const id of ["wish-13", "wish-18", "wish-07", "wish-23", "wish-33", "wish-37", "wish-09", "wish-02", "wish-39", "wish-01", "wish-03"]) assert.ok(ids.has(id), id);
  assert.equal(planProductIds(null).size, 0);
});

test("pastPicks: what earlier rounds of the same cycle type used", () => {
  const plan = defaultPlan();
  const cycle = {
    methodId: plan.methods[2].id, round: 1, items: [{ productId: "wish-33" }, { productId: "wish-34" }],
    history: [
      { methodId: plan.methods[0].id, round: 1, productIds: ["wish-14"] },
      { methodId: plan.methods[1].id, round: 1, productIds: ["wish-29", "wish-07"] },
      { methodId: plan.methods[0].id, round: 2, productIds: ["wish-16"] },
      { methodId: plan.methods[0].id, round: 3 }
    ]
  };
  const c1 = pastPicks(plan, cycle, 0);
  assert.deepEqual(c1.get("wish-14"), ["1-1"]);
  assert.deepEqual(c1.get("wish-16"), ["1-2"]);
  assert.equal(c1.has("wish-29"), false);
  const c3 = pastPicks(plan, cycle, 2);
  assert.deepEqual(c3.get("wish-33"), ["3-1"]);
  assert.equal(pastPicks(plan, null, 0).size, 0);
});

test("먹는 방법: group items by product and rebuild them with new meals and dose", () => {
  const items = [
    { meal: "lunch", label: "부티르산", amount: "1캡슐", productId: "but" },
    { meal: "dinner", label: "부티르산", amount: "1캡슐", productId: "but" },
    { meal: "dinner", label: "비타민", amount: "1캡슐", productId: "vit" },
    { meal: "lunch", label: "세트", amount: "각 1캡슐", productId: "a" }
  ];
  const rows = mealPlanOf(items);
  assert.deepEqual(rows.map((r) => [r.productId, r.meals.join("+"), r.dose]), [["but", "lunch+dinner", 1], ["vit", "dinner", 1], ["a", "lunch", 1]]);
  rows[0].meals = ["dinner"];
  rows[1].meals = ["morning", "dinner"]; rows[1].dose = 2;
  const back = itemsFromMealPlan(rows);
  assert.deepEqual(back.map((i) => `${i.productId}:${i.meal}:${i.amount}`), ["but:dinner:1캡슐", "vit:morning:2캡슐", "vit:dinner:2캡슐", "a:lunch:각 1캡슐"]);
  assert.equal(dailyUse(back).vit, 4);
  assert.equal(dailyUse(back).but, 1);
});
