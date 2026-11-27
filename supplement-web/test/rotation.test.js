import { test } from "node:test";
import assert from "node:assert/strict";
import { planForMonth, upcomingMonths, defaultPlan, validPlan } from "../src/rotation.js";

const plan = { ...defaultPlan(new Date(2026, 0, 1)) };

test("matches the guide: 1월 1-1, 2월 2-1, 3월 3-1, 4월 1-2", () => {
  const codes = [1, 2, 3, 4].map((m) => planForMonth(plan, 2026, m).code);
  assert.deepEqual(codes, ["1-1", "2-1", "3-1", "1-2"]);
  assert.equal(planForMonth(plan, 2026, 4).method.id, "m1");
});

test("continues across the year boundary", () => {
  const r = planForMonth(plan, 2027, 1);
  assert.equal(r.code, "1-5");
  assert.equal(r.method.title, "섭취법 1");
});

test("months before the start are marked", () => {
  const r = planForMonth({ ...plan, startYear: 2026, startMonth: 12 }, 2026, 10);
  assert.equal(r.before, true);
  assert.equal(r.monthsUntilStart, 2);
});

test("upcoming months walk forward month by month", () => {
  const list = upcomingMonths(plan, new Date(2026, 10, 27), 3);
  assert.deepEqual(list.map((x) => [x.year, x.month, x.code]), [[2026, 11, "2-4"], [2026, 12, "3-4"], [2027, 1, "1-5"]]);
});

test("default plan is valid and uses real catalog ids", () => {
  const p = defaultPlan(new Date(2026, 10, 1));
  assert.equal(validPlan(p), true);
  assert.equal(p.startMonth, 11);
  assert.equal(p.methods[0].lunch[0].options.length, 6);
  assert.equal(validPlan({ ...p, methods: [] }), false);
});
