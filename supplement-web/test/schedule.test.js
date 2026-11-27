import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayEntries, dailyUseAll, daysLeft, productsInUse, sectionOf, historyGroups, weekStart, monthKey, isoDow, MEAL_MINUTES
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

test("today's list: cycle + base at meals, extras at their time, only on scheduled days", () => {
  const entries = dayEntries({ cycle, extras, day: DAY });
  assert.deepEqual(entries.map((e) => e.key), ["ex-e1", "base-lunch-tri", "cy-lunch-gol", "base-dinner-tri", "base-dinner-vit"]);
  assert.equal(entries.find((e) => e.key === "ex-e1").amount, 2);
  assert.equal(entries.find((e) => e.key === "cy-lunch-gol").minutes, MEAL_MINUTES.lunch);
});

test("nothing from the cycle before it starts", () => {
  const entries = dayEntries({ cycle, extras: [], day: DAY - 1 });
  assert.equal(entries.length, 0);
});

test("magnesium only on Mon/Wed", () => {
  const monday = DAY + 3;
  assert.ok(dayEntries({ cycle: null, extras, day: monday }).some((e) => e.key === "ex-e2"));
});

test("sections: morning / lunch / evening / night", () => {
  assert.equal(sectionOf(8 * 60), "morning");
  assert.equal(sectionOf(MEAL_MINUTES.lunch), "lunch");
  assert.equal(sectionOf(MEAL_MINUTES.dinner), "evening");
  assert.equal(sectionOf(22 * 60), "night");
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
