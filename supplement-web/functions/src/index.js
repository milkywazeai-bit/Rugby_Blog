// Meal reminders while the app is closed.
// Every 5 minutes: for each person who turned notifications on, if one of their meal
// times (내 정보 → 복용 시간) has just come in their time zone and something for that
// meal is still not marked, send one Web Push to each of their devices.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import webpush from "web-push";
import { localParts, dueMeals, mealReminder } from "../../src/reminders.js";
import { mealTimes } from "../../src/schedule.js";

initializeApp();
const db = getFirestore();
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const VAPID_PUBLIC_KEY = defineString("VAPID_PUBLIC_KEY");

export const mealReminders = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Asia/Seoul", region: "asia-northeast3", secrets: [VAPID_PRIVATE_KEY], memory: "256MiB", timeoutSeconds: 120, maxInstances: 1 },
  async () => {
    webpush.setVapidDetails("https://vitaday.web.app", VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
    const subs = await db.collectionGroup("push").get();
    const byUser = new Map();
    for (const d of subs.docs) {
      const uid = d.ref.parent.parent.id;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(d);
    }
    if (!byUser.size) return;
    let products = null;
    const now = new Date();
    let sent = 0;
    for (const [uid, devices] of byUser) {
      try {
        const user = db.collection("users").doc(uid);
        const settingsSnap = await user.collection("meta").doc("settings").get();
        const settings = settingsSnap.exists ? settingsSnap.data() : {};
        const { day, minutes } = localParts(now, settings.tz || "Asia/Seoul");
        const meals = dueMeals(mealTimes(settings), minutes);
        if (!meals.length) continue;
        const sentRef = user.collection("meta").doc("pushlog");
        const sentLog = (await sentRef.get()).data() || {};
        const todo = meals.filter((m) => !sentLog[`${day}_${m}`]);
        if (!todo.length) continue;
        const [cycleSnap, itemsSnap, logsSnap] = await Promise.all([
          user.collection("meta").doc("cycle").get(),
          user.collection("items").get(),
          user.collection("logs").where("day", "==", day).get()
        ]);
        if (!products) {
          products = new Map((await db.collection("products").select("name").get()).docs.map((p) => [p.id, p.data().name]));
        }
        const extras = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const logged = new Set(logsSnap.docs.map((d) => d.data().key || ("ex-" + d.data().itemId)));
        const nameOf = (e) => (e.productId && products.get(e.productId))
          || (e.itemId && extras.find((x) => x.id === e.itemId)?.name) || e.label || "영양제";
        const mark = {};
        for (const meal of todo) {
          mark[`${day}_${meal}`] = true;
          const r = mealReminder({ cycle: cycleSnap.exists ? cycleSnap.data() : null, extras, settings, day, meal, logged, nameOf });
          if (!r) continue;
          const payload = JSON.stringify({ title: r.title, body: r.body, tag: r.tag, url: "/" });
          for (const dev of devices) {
            const { endpoint, keys } = dev.data();
            try {
              await webpush.sendNotification({ endpoint, keys }, payload, { TTL: 3600, urgency: "high" });
              sent++;
            } catch (err) {
              // The device unsubscribed or the browser data was cleared: forget it.
              if (err.statusCode === 404 || err.statusCode === 410) await dev.ref.delete();
              else logger.warn("push failed", { uid, status: err.statusCode });
            }
          }
        }
        // Keep the log small: only the last few days.
        const keep = Object.fromEntries(Object.entries(sentLog).filter(([k]) => parseInt(k, 10) >= day - 2));
        await sentRef.set({ ...keep, ...mark, updatedAt: FieldValue.serverTimestamp() });
      } catch (err) {
        logger.error("reminder failed", { uid, message: err.message });
      }
    }
    if (sent) logger.info("reminders sent", { sent });
  }
);
