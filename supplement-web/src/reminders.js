// Meal reminders sent by the server (Cloud Functions) while the app is closed.
// Pure functions shared by the function and the tests.
import { dayEntries, mealTimes, MEALS } from "./schedule.js";

// Local calendar day (same epoch-day numbering as the app) and minutes after
// midnight for `date` in `timeZone`.
export function localParts(date, timeZone) {
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "Asia/Seoul"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const day = Math.floor(Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000);
  return { day, minutes: (+parts.hour % 24) * 60 + +parts.minute };
}

// The meal whose time has just come: from its time to `windowMin` minutes later.
// The window is wider than the schedule interval so a late run still catches it;
// the sent-log keeps it to one reminder per meal per day.
export function dueMeals(times, minutes, windowMin = 20) {
  return MEALS.filter((m) => minutes >= times[m.key] && minutes < times[m.key] + windowMin).map((m) => m.key);
}

// What to say for one person and one meal, or null when nothing is left to take.
// logged: Set of entry keys that already have a log today (taken or skipped).
export function mealReminder({ cycle, extras, settings, day, meal, logged, nameOf }) {
  const times = mealTimes(settings);
  const pending = dayEntries({ cycle, extras, day, times })
    .filter((e) => e.meal === meal && !logged.has(e.key));
  if (!pending.length) return null;
  const label = MEALS.find((m) => m.key === meal).label;
  const names = [...new Set(pending.map(nameOf))];
  const body = names.length > 3 ? `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}개` : names.join(", ");
  return { title: `${label} 영양제 드실 시간이에요`, body, tag: `meal-${meal}`, count: pending.length };
}
