import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayEntries, dailyUseAll, daysLeft, productsInUse, historyGroups, weekStart, monthKey, isoDow, DEFAULT_MEAL_TIMES, autoTakeList, mealTimes, extraMeal
} from "../src/schedule.js";

const DAY = 20784; // 2026-11-27, a Friday
const cycle = {
  startDay: DAY, round: 1,
  items: [{ meal: "lunch", label: "가든 유산균", amount: "1캡슐", productId: "gol" }],
  base: {
    startDay: DAY,
    items: [
      { meal: "lunch", label: "트리부티린", amount: "1캡슐", productId: "tri" },
      { meal: "dinner", label: "트리부티린", amount: "1캡슐", productId: "tri" },
      { meal: "dinner", label: "비타민", amount: "1캡슐", productId: "vit" }
    ]
  }
};
const extras = [
  { id: "e1", productId: "omega", perDose: 2, timeMinutes: 8 * 60, days: [1, 2, 3, 4, 5, 6, 7] },
  { id: "e2", productId: "mag", perDose: 1, timeMinutes: 22 * 60, days: [1, 3] }
];

test("Friday is weekday 5", () => {
  assert.equal(isoDow(DAY), 5);
});

test("today's list by meal: cycle, base set, extras, only on scheduled days", () => {
  const entries = dayEntries({ cycle, extras, day: DAY });
  assert.deepEqual(entries.map((e) => e.key), ["ex-e1", "cy-lunch-gol", "base-lunch-tri", "base-dinner-tri", "base-dinner-vit"]);
  assert.equal(entries.find((e) => e.key === "ex-e1").amount, 2);
  assert.equal(entries.find((e) => e.key === "cy-lunch-gol").minutes, DEFAULT_MEAL_TIMES.lunch);
});

test("nothing from the cycle before it starts", () => {
  const entries = dayEntries({ cycle, extras: [], day: DAY - 1 });
  assert.equal(entries.length, 0);
});

test("magnesium only on Mon/Wed", () => {
  const monday = DAY + 3;
  assert.ok(dayEntries({ cycle: null, extras, day: monday }).some((e) => e.key === "ex-e2"));
});

test("old extras with a clock time map to a meal", () => {
  assert.equal(extraMeal({ timeMinutes: 8 * 60 }), "morning");
  assert.equal(extraMeal({ timeMinutes: 13 * 60 }), "lunch");
  assert.equal(extraMeal({ timeMinutes: 22 * 60 }), "dinner");
  assert.equal(extraMeal({ meal: "dinner", timeMinutes: 8 * 60 }), "dinner");
  assert.equal(extraMeal({}), "morning");
});

test("daily use adds cycle, base (both meals) and extras averaged over the week", () => {
  const use = dailyUseAll({ cycle, extras });
  assert.equal(use.tri, 2);
  assert.equal(use.gol, 1);
  assert.equal(use.omega, 2);
  assert.ok(Math.abs(use.mag - 2 / 7) < 1e-9);
  assert.equal(daysLeft(9, use.tri), 4);
  assert.equal(daysLeft(5, 0), null);
});

test("products in use are tagged by where they come from", () => {
  const where = productsInUse({ cycle, extras });
  assert.deepEqual([...where.get("tri")], ["base"]);
  assert.deepEqual([...where.get("omega")], ["extra"]);
});

test("history groups by day, week and month with cycles and products", () => {
  const logs = [
    { day: DAY, status: "TAKEN", kind: "cycle", productId: "gol", amount: 1, cycleCode: "1-1", cycleTitle: "사이클 1" },
    { day: DAY, status: "TAKEN", kind: "extra", productId: "omega", amount: 2 },
    { day: DAY - 1, status: "TAKEN", kind: "extra", productId: "omega", amount: 2 },
    { day: DAY - 1, status: "SKIPPED", kind: "base", productId: "tri" },
    { day: DAY - 30, status: "TAKEN", kind: "cycle", productId: "x", cycleCode: "3-1", cycleTitle: "사이클 3" }
  ];
  const byDay = historyGroups(logs, "day");
  assert.equal(byDay[0].key, DAY);
  assert.equal(byDay[0].taken, 2);
  assert.equal(byDay[1].skipped, 1);
  const byWeek = historyGroups(logs, "week");
  assert.equal(byWeek[0].key, weekStart(DAY));
  assert.equal(byWeek[0].activeDays, 2);
  assert.equal(byWeek[0].products.find((p) => p.productId === "omega").units, 4);
  const byMonth = historyGroups(logs, "month");
  assert.equal(byMonth[0].key, 202611);
  assert.equal(byMonth[1].key, monthKey(DAY - 30));
  assert.deepEqual(byMonth[1].cycles, [{ code: "3-1", title: "사이클 3" }]);
});

test("autoTakeList fills only doses with no log, across days", () => {
  const cycle = { startDay: DAY - 1, items: [{ meal: "lunch", productId: "p1", amount: "1캡슐" }], base: null };
  const extras = [{ id: "x", productId: "p2", perDose: 2, timeMinutes: 480, days: [1, 2, 3, 4, 5, 6, 7] }];
  const logged = new Set([`${DAY - 1}_ex-x`]);
  const list = autoTakeList({ cycle, extras, fromDay: DAY - 2, toDay: DAY - 1, logged });
  const ids = list.map((x) => x.day + "_" + x.entry.key).sort();
  // DAY-2: cycle not started yet, only the extra. DAY-1: the extra already has a log.
  assert.deepEqual(ids, [`${DAY - 2}_ex-x`, `${DAY - 1}_cy-lunch-p1`].sort());
  assert.equal(list.find((x) => x.entry.key === "ex-x").entry.amount, 2);
});

test("autoTakeList returns nothing for an empty range", () => {
  assert.deepEqual(autoTakeList({ cycle: null, extras: [], fromDay: DAY, toDay: DAY - 1, logged: new Set() }), []);
});

test("each person's meal times order and time the doses", () => {
  const times = mealTimes({ mealTimes: { morning: 7 * 60, lunch: 12 * 60, dinner: 18 * 60 + 30 } });
  const extras = [
    { id: "a", productId: "pa", meal: "dinner", days: [1, 2, 3, 4, 5, 6, 7] },
    { id: "b", productId: "pb", meal: "morning", days: [1, 2, 3, 4, 5, 6, 7] }
  ];
  const cycle = { startDay: DAY, items: [{ meal: "lunch", productId: "pc", amount: "1캡슐" }] };
  const list = dayEntries({ cycle, extras, day: DAY, times });
  assert.deepEqual(list.map((e) => e.meal), ["morning", "lunch", "dinner"]);
  assert.deepEqual(list.map((e) => e.minutes), [7 * 60, 12 * 60, 18 * 60 + 30]);
});

test("mealTimes falls back to defaults for missing or bad values", () => {
  assert.deepEqual(mealTimes(null), DEFAULT_MEAL_TIMES);
  assert.deepEqual(mealTimes({ mealTimes: { morning: -5, lunch: "x", dinner: 1200 } }), { ...DEFAULT_MEAL_TIMES, dinner: 1200 });
});
