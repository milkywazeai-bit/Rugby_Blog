import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPlan, validPlan, nextCycle, dailyUse, remaining, cycleStatus, itemsFromPicks, defaultPicks, perDose
} from "../src/rotation.js";

const plan = defaultPlan();

test("next cycle follows the guide: 1-1, 2-1, 3-1, 1-2", () => {
  let c = { methodId: "m1", methodIndex: 0, round: 1 };
  const codes = ["1-1"];
  for (let i = 0; i < 3; i++) {
    const n = nextCycle(plan, c);
    c = { methodId: plan.methods[n.methodIndex].id, ...n };
    codes.push(`${n.methodIndex + 1}-${n.round}`);
  }
  assert.deepEqual(codes, ["1-1", "2-1", "3-1", "1-2"]);
});

test("single-option slots are pre-picked, pick-one slots wait for a choice", () => {
  const picks = defaultPicks(plan.methods[0]);
  assert.equal(picks["lunch:0"], "");
  assert.equal(picks["lunch:1"], 0);
  assert.equal(picks["dinner:2"], "");
});

test("a previous pick is carried into the next cycle when it is still an option", () => {
  const picks = defaultPicks(plan.methods[1], ["wish-03"]);
  assert.equal(picks["dinner:2"], 1);
});

test("excluded slots are left out; shared products add up per day", () => {
  const picks = { ...defaultPicks(plan.methods[0]), "lunch:0": 1, "dinner:2": null };
  const items = itemsFromPicks(plan.methods[0], picks);
  assert.equal(items.length, 6);
  assert.equal(dailyUse(items)["wish-02"], 2);
  assert.equal(dailyUse(items)["wish-14"], 1);
});

test("remaining stock counts down from the day it was entered", () => {
  assert.equal(remaining({ count: 30, day: 100 }, 1, 100), 30);
  assert.equal(remaining({ count: 30, day: 100 }, 2, 110), 10);
  assert.equal(remaining({ count: 5, day: 100 }, 1, 200), 0);
  assert.equal(remaining(undefined, 1, 100), null);
});

test("cycle status is driven by the main (first lunch) product", () => {
  const cycle = {
    startDay: 100,
    items: [{ meal: "lunch", productId: "wish-14", amount: "1캡슐" }, { meal: "dinner", productId: "wish-02", amount: "1캡슐" }],
    stock: { "wish-14": { count: 12, day: 100 }, "wish-02": { count: 250, day: 100 } }
  };
  const s = cycleStatus(cycle, 104);
  assert.equal(s.day, 5);
  assert.equal(s.left, 8);
  assert.equal(s.daysLeft, 8);
  assert.equal(s.endDay, 112);
});

test("cycle 2: Floraphage is fixed, multi-strain is pick one of 6", () => {
  const m = plan.methods[1];
  assert.equal(m.lunch[0].options.length, 6);
  assert.deepEqual(m.lunch[1].options, [{ ids: ["wish-07"] }]);
  assert.equal(defaultPicks(m)["lunch:1"], 0);
});

test("cycle 3: picking a set adds every product in it, main product first", () => {
  const m = plan.methods[2];
  const picks = { ...defaultPicks(m), "lunch:0": 1, "dinner:2": 0 };
  const lunch = itemsFromPicks(m, picks).filter((it) => it.meal === "lunch").map((it) => it.productId);
  assert.deepEqual(lunch.slice(0, 2), ["wish-36", "wish-35"]);
});

test("older plans with bare product ids still work", () => {
  const old = { lunch: [{ label: "x", options: ["a", "b"], amount: "1캡슐" }], dinner: [] };
  assert.deepEqual(itemsFromPicks(old, { "lunch:0": 1 }).map((it) => it.productId), ["b"]);
  assert.equal(defaultPicks(old, ["b"])["lunch:0"], 1);
});

test("dose amounts are read from labels like 2캡슐", () => {
  assert.equal(perDose("2캡슐"), 2);
  assert.equal(perDose(""), 1);
});

test("default plan is valid", () => {
  assert.equal(validPlan(plan), true);
  assert.equal(validPlan({ methods: [] }), false);
});
