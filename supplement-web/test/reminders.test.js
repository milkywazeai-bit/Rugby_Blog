import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts, dueMeals, mealReminder } from "../src/reminders.js";
import { DEFAULT_MEAL_TIMES } from "../src/schedule.js";

const DAY = 20784; // 2026-11-27, a Friday

test("localParts uses the person's time zone", () => {
  // 2026-11-27 03:30 UTC = 12:30 in Seoul (UTC+9)
  const d = new Date(Date.UTC(2026, 10, 27, 3, 30));
  assert.deepEqual(localParts(d, "Asia/Seoul"), { day: DAY, minutes: 12 * 60 + 30 });
  // 2026-11-27 23:10 UTC is already the 28th in Seoul
  assert.deepEqual(localParts(new Date(Date.UTC(2026, 10, 27, 23, 10)), "Asia/Seoul"), { day: DAY + 1, minutes: 8 * 60 + 10 });
  // a bad zone falls back to Seoul instead of throwing
  assert.equal(localParts(d, "Not/AZone").minutes, 12 * 60 + 30);
});

test("dueMeals: from the meal time until the window closes", () => {
  const t = DEFAULT_MEAL_TIMES; // 08:00 / 12:30 / 19:00
  assert.deepEqual(dueMeals(t, 8 * 60 - 1), []);
  assert.deepEqual(dueMeals(t, 8 * 60), ["morning"]);
  assert.deepEqual(dueMeals(t, 8 * 60 + 19), ["morning"]);
  assert.deepEqual(dueMeals(t, 8 * 60 + 20), []);
  assert.deepEqual(dueMeals(t, 19 * 60 + 5), ["dinner"]);
});

const cycle = { startDay: DAY, items: [{ meal: "lunch", productId: "gol", amount: "1캡슐" }], base: { items: [{ meal: "lunch", productId: "tri", amount: "1캡슐" }] } };
const extras = [{ id: "x", productId: "omega", meals: ["morning", "dinner"], days: [1, 2, 3, 4, 5, 6, 7] }];
const names = { gol: "프로바이오틱", tri: "트리부티린", omega: "오메가3" };
const nameOf = (e) => names[e.productId];

test("mealReminder lists what is still pending for that meal", () => {
  const r = mealReminder({ cycle, extras, settings: {}, day: DAY, meal: "lunch", logged: new Set(), nameOf });
  assert.equal(r.title, "점심 영양제 드실 시간이에요");
  assert.equal(r.body, "프로바이오틱, 트리부티린");
  assert.equal(r.tag, "meal-lunch");
});

test("mealReminder skips what was already taken or skipped, and stays quiet when nothing is left", () => {
  const r = mealReminder({ cycle, extras, settings: {}, day: DAY, meal: "lunch", logged: new Set(["cy-lunch-gol"]), nameOf });
  assert.equal(r.body, "트리부티린");
  assert.equal(mealReminder({ cycle, extras, settings: {}, day: DAY, meal: "lunch", logged: new Set(["cy-lunch-gol", "base-lunch-tri"]), nameOf }), null);
  assert.equal(mealReminder({ cycle: null, extras: [], settings: {}, day: DAY, meal: "dinner", logged: new Set(), nameOf }), null);
});

test("mealReminder keeps long lists short", () => {
  const many = ["a", "b", "c", "d", "e"].map((id) => ({ id, productId: id, meals: ["morning"], days: [1, 2, 3, 4, 5, 6, 7] }));
  const r = mealReminder({ cycle: null, extras: many, settings: {}, day: DAY, meal: "morning", logged: new Set(), nameOf: (e) => e.productId });
  assert.equal(r.body, "a, b, c 외 2개");
});
