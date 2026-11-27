import {
  collection, doc, onSnapshot, query, where, setDoc, updateDoc, deleteDoc, getDocs,
  serverTimestamp, increment, writeBatch, deleteField, runTransaction
} from "firebase/firestore";
import {
  initFirebase, isConfigured, useEmulator, watchAuth, signInWithGoogle, signInTestUser, logOut, db
} from "./firebase.js";
import { parseIherbLinks, findUnsupportedLinks, iherbSearchUrl, describeAmount, isIherbUrl } from "./iherb.js";
import { compressPhoto, isSafePhoto } from "./photo.js";
import { parseShot, photoRect, matchProduct } from "./shot.js";
import {
  defaultPlan, validPlan, methodIndexOf, nextCycle, dailyUse, remaining, cycleStatus, itemsFromPicks, defaultPicks,
  slotOptions, baseSlots, baseItemsFromPicks, defaultBasePicks, planProductIds
} from "./rotation.js";
import {
  dayEntries, dailyUseAll, daysLeft, productsInUse, MEALS, mealTimes, mealLabel, extraMeal, extraMeals, historyGroups, extraAmount, autoTakeList
} from "./schedule.js";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const CAPSULE_PAIRS = [
  ["#2F6F4F", "#DDEAE1"], ["#A5701F", "#F3E5CB"], ["#A24632", "#F2DFD8"],
  ["#3E5C8A", "#DDE6F2"], ["#7A4E8C", "#EADFF0"]
];
const state = {
  user: null,
  sets: [],
  adminUids: null,
  products: [],
  items: [],
  itemsLoaded: false,
  inventory: {},
  inventoryLoaded: false,
  logs: {},
  plan: null,
  planLoaded: false,
  cycle: null,
  cycleLoaded: false,
  tab: "today",
  productQuery: ""
};
let unsubs = [];

const $ = (sel) => document.querySelector(sel);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function fmtTime(mins) { return pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60); }
function epochDay(d = new Date()) { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); }
function isoDowOfEpochDay(day) { const g = new Date(day * 86400000).getUTCDay(); return g === 0 ? 7 : g; }
function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CAPSULE_PAIRS[h % CAPSULE_PAIRS.length];
}
function isAdmin() { return !!(state.user && state.adminUids && state.adminUids.includes(state.user.uid)); }
function productById(id) { return state.products.find((p) => p.id === id) || null; }
function safeIherbUrl(url, name) {
  return isIherbUrl(url) ? new URL(url).href : iherbSearchUrl(name);
}
function photoFor(item) {
  const p = item.productId ? productById(item.productId) : null;
  if (p && isSafePhoto(p.photo)) return p.photo;
  return isSafePhoto(item.photo) ? item.photo : null;
}
function thumbHtml(name, photo, cls = "thumb") {
  if (photo) return `<img class="${cls}" alt="" src="${photo}">`;
  const c = hashColor(name || "?");
  return `<div class="${cls} capsule-wrap"><div class="capsule"><span style="background:${c[0]}"></span><span style="background:${c[1]}"></span></div></div>`;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
function fail(e) {
  console.error(e);
  const code = e && e.code ? e.code : "";
  if (code === "permission-denied") toast("권한이 없어요. 관리자만 할 수 있는 작업이에요.");
  else if (code === "unavailable") toast("인터넷 연결을 확인해주세요. 연결되면 자동으로 저장돼요.");
  else toast("문제가 생겼어요: " + (e && e.message ? e.message : "알 수 없는 오류"));
}

// ---------- screens ----------
function showScreen(name) {
  for (const id of ["screenSetup", "screenLogin", "screenApp"]) $("#" + id).hidden = id !== name;
}

function renderLogin() {
  const ua = navigator.userAgent || "";
  const inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua);
  $("#inAppWarning").hidden = !inApp;
  $("#emulatorLogin").hidden = !useEmulator;
}

// ---------- today ----------
// One list for the day: the running cycle, the base set (4번) and extra supplements.
// "완료" takes the dose out of 재고; undo puts it back.
const KIND_TAG = { cycle: "사이클", base: "4번", extra: "추가" };

function invCount(pid) {
  const v = state.inventory[pid];
  return typeof v === "number" ? v : null;
}

function currentCycleTitle() {
  const cy = state.cycle;
  if (!cy) return "";
  const planned = state.plan ? state.plan.methods.find((x) => x.id === cy.methodId) : null;
  return planned ? planned.title : cy.title;
}

function todayEntries() {
  const day = epochDay();
  return dayEntries({ cycle: state.cycle, extras: state.items, day, times: mealTimes(state.settings) })
    .map((e) => ({ ...e, status: state.logs[day + "_" + e.key] || "PENDING" }));
}

function entryName(e) {
  const p = e.productId ? productById(e.productId) : null;
  if (p) return p.name;
  const it = e.itemId ? state.items.find((x) => x.id === e.itemId) : null;
  return (it && it.name) || e.label || "이름 없음";
}

function unitOf(pid) {
  const p = pid ? productById(pid) : null;
  return (p && p.form) || "개";
}

function fmtNum(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function renderHeader() {
  const d = new Date();
  $("#todayLabel").textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${"일월화수목금토"[d.getDay()]}요일`;
  const list = todayEntries();
  const done = list.filter((e) => e.status === "TAKEN").length;
  const rate = list.length ? done / list.length : 0;
  const c = 2 * Math.PI * 24;
  $("#ringProgress").setAttribute("stroke-dasharray", c.toFixed(1));
  $("#ringProgress").setAttribute("stroke-dashoffset", (c * (1 - rate)).toFixed(1));
  $("#ringPct").textContent = Math.round(rate * 100) + "%";
}

function renderToday() {
  const list = todayEntries();
  const box = $("#todayList");
  if (!list.length) {
    box.innerHTML = `<div class="empty"><strong>오늘 먹을 영양제가 없어요.</strong>
      <span>유산균 사이클을 시작하거나 추가 영양제를 등록하면 여기에 모아서 보여드려요.</span>
      <div class="empty-actions"><button type="button" class="btn-small primary" data-goto="rotation">유산균 사이클</button><button type="button" class="btn-small" data-goto="extras">추가 영양제</button></div></div>`;
    return;
  }
  const code = state.cycle ? cycleCode(state.cycle) : "";
  const use = dailyUseAll({ cycle: state.cycle, extras: state.items });
  const pendingAll = list.filter((e) => e.status === "PENDING").length;
  let html = pendingAll
    ? `<button type="button" class="btn-primary wide take-all" data-take-all>전체 복용 완료 <span>${pendingAll}개</span></button>`
    : `<div class="all-done">오늘 영양제를 다 챙겼어요 ✓</div>`;
  for (const sec of MEALS) {
    const g = list.filter((e) => e.meal === sec.key);
    if (!g.length) continue;
    const done = g.filter((e) => e.status !== "PENDING").length;
    const secBtn = done < g.length ? `<button type="button" class="sec-take" data-take-section="${sec.key}">${sec.label} 모두 완료</button>` : "";
    html += `<section class="section"><div class="section-head"><span class="label">${sec.label}</span><span class="time">${fmtTime(g[0].minutes)}</span><span class="count">${done}/${g.length}</span>${secBtn}</div>`;
    for (const e of g) {
      const p = e.productId ? productById(e.productId) : null;
      const it = e.itemId ? state.items.find((x) => x.id === e.itemId) : null;
      const name = entryName(e);
      const photo = p && isSafePhoto(p.photo) ? p.photo : (it ? photoFor(it) : null);
      const left = e.productId ? invCount(e.productId) : null;
      const dl = left === null ? null : daysLeft(Math.max(0, left), use[e.productId]);
      const tag = e.kind === "cycle" ? `사이클 ${code}` : KIND_TAG[e.kind];
      const memo = it && it.memo ? it.memo : "";
      const when = memo || `${mealLabel(e.meal)} 먹고`;
      const stock = left === null ? "" : `<span class="chip ${dl !== null && dl < 10 ? "low" : "stock"}">재고 ${Math.max(0, left)}</span>`;
      let actions;
      if (e.status === "TAKEN") actions = `<button class="chip taken" data-undo="${esc(e.key)}" title="되돌리기">완료 ✓</button>`;
      else if (e.status === "SKIPPED") actions = `<button class="chip skipped" data-undo="${esc(e.key)}" title="되돌리기">건너뜀</button>`;
      else actions = `<div class="item-actions"><button class="btn-take" data-take="${esc(e.key)}">완료</button><button class="btn-skip" data-skip="${esc(e.key)}">건너뛰기</button></div>`;
      html += `<div class="item${e.status !== "PENDING" ? " done" : ""}">
        ${thumbHtml(name, photo)}
        <div class="item-body">
          <span class="item-name">${esc(name)}</span>
          <span class="item-meta"><span class="chip kind ${e.kind}">${esc(tag)}</span><span>${esc(when)}</span><span>${fmtNum(e.amount)}${esc(unitOf(e.productId))}</span>${stock}</span>
        </div>
        ${actions}
      </div>`;
    }
    html += `</section>`;
  }
  box.innerHTML = html;
}

function logData(day, e, status, extra = {}) {
  return {
    day, key: e.key, kind: e.kind, productId: e.productId || null, name: entryName(e), amount: e.amount, status, at: serverTimestamp(),
    ...(e.kind === "cycle" && state.cycle ? { cycleCode: cycleCode(state.cycle), cycleTitle: currentCycleTitle() } : {}),
    ...extra
  };
}

// Marks one or more of today's doses in a single write, moving stock with them.
async function setStatuses(keys, status) {
  const uid = state.user.uid;
  const day = epochDay();
  const entries = todayEntries().filter((x) => keys.includes(x.key));
  if (!entries.length) return;
  try {
    const batch = writeBatch(db);
    const change = {};
    const add = (pid, n) => { if (pid) change[pid] = (change[pid] || 0) + n; };
    for (const e of entries) {
      const prev = state.logs[day + "_" + e.key];
      const logRef = doc(db, "users", uid, "logs", `${day}_${e.key}`);
      if (status === null) {
        batch.delete(logRef);
        if (prev === "TAKEN") add(e.productId, e.amount);
      } else {
        batch.set(logRef, logData(day, e, status));
        if (status === "TAKEN" && prev !== "TAKEN") add(e.productId, -e.amount);
        if (status !== "TAKEN" && prev === "TAKEN") add(e.productId, e.amount);
      }
    }
    for (const [pid, n] of Object.entries(change)) {
      if (n) batch.set(doc(db, "users", uid, "inventory", pid), { count: increment(n), updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    historyState.loadedAt = 0;
    if (entries.length > 1 && status === "TAKEN") toast(`${entries.length}개를 완료했어요.`);
  } catch (err) { fail(err); }
}
function setStatus(key, status) { return setStatuses([key], status); }

function takePending(sectionKey) {
  const keys = todayEntries()
    .filter((e) => e.status === "PENDING" && (!sectionKey || e.meal === sectionKey))
    .map((e) => e.key);
  if (keys.length) setStatuses(keys, "TAKEN");
}

// ---------- 자동모드 ----------
// Once a day has passed, doses nobody tapped count as taken and come out of stock.
// Runs when the app is open (there is no server); a day missed is caught up on next open.
const AUTO_MAX_DAYS = 30;
function settingsRef() { return doc(db, "users", state.user.uid, "meta", "settings"); }

function renderAutoToggle() {
  const on = !!(state.settings && state.settings.autoMode);
  const b = $("#autoToggle");
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", on);
  $("#autoState").textContent = on ? "켜짐" : "꺼짐";
}

function openAutoSheet() {
  const on = !!(state.settings && state.settings.autoMode);
  openSheet("자동모드", `
    <p class="mc-note">자동모드를 켜면, 하루가 지났을 때 <strong>완료나 건너뛰기를 누르지 않은 영양제를 모두 먹은 걸로</strong> 처리하고 재고에서 빼요.</p>
    <ul class="auto-points">
      <li>매번 완료를 누르지 않아도 재고가 맞게 줄어들어요.</li>
      <li>안 먹은 날은 그날 안에 <strong>건너뛰기</strong>를 눌러 두세요. 건너뛴 건 빼지 않아요.</li>
      <li>앱을 열 때 처리돼요. 며칠 만에 열어도 그동안 지난 날을 한꺼번에 처리해요(최대 ${AUTO_MAX_DAYS}일).</li>
      <li>켠 날(오늘)부터 적용돼요. 지난 날은 건드리지 않아요.</li>
    </ul>
    <div class="sheet-actions"><button type="button" class="btn-primary wide" id="autoSet" data-on="${on ? "0" : "1"}">${on ? "자동모드 끄기" : "자동모드 켜기"}</button></div>`);
}

async function setAutoMode(on) {
  const today = epochDay();
  try {
    await setDoc(settingsRef(), on
      ? { autoMode: true, autoSince: today, autoDoneThrough: today - 1, updatedAt: serverTimestamp() }
      : { autoMode: false, updatedAt: serverTimestamp() }, { merge: true });
    closeSheet();
    toast(on ? "자동모드를 켰어요. 내일부터 어제 것을 자동으로 처리해요." : "자동모드를 껐어요.");
  } catch (e) { fail(e); }
}

let autoRunning = false;
async function runAutoFill() {
  const st = state.settings;
  if (autoRunning || !state.user || !st || !st.autoMode || !state.cycleLoaded || !state.itemsLoaded || !state.logsLoaded) return;
  const toDay = epochDay() - 1;
  const doneThrough = typeof st.autoDoneThrough === "number" ? st.autoDoneThrough : toDay;
  if (doneThrough >= toDay) return;
  autoRunning = true;
  const uid = state.user.uid;
  const fromDay = Math.max(doneThrough + 1, typeof st.autoSince === "number" ? st.autoSince : toDay, toDay - AUTO_MAX_DAYS + 1);
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "logs"), where("day", ">=", fromDay)));
    if (!state.user || state.user.uid !== uid) return;
    const logged = new Set(snap.docs.map((d) => d.id));
    const list = autoTakeList({ cycle: state.cycle, extras: state.items, fromDay, toDay, logged });
    let added = 0;
    await runTransaction(db, async (tx) => {
      // Read the marker inside the transaction so two open devices never both deduct.
      const cur = await tx.get(settingsRef());
      const c = cur.exists() ? cur.data() : {};
      if (!c.autoMode || (typeof c.autoDoneThrough === "number" && c.autoDoneThrough >= toDay)) { added = 0; return; }
      const change = {};
      for (const { day, entry } of list) {
        tx.set(doc(db, "users", uid, "logs", `${day}_${entry.key}`), logData(day, entry, "TAKEN", { auto: true }));
        if (entry.productId) change[entry.productId] = (change[entry.productId] || 0) - entry.amount;
      }
      for (const [pid, n] of Object.entries(change)) {
        tx.set(doc(db, "users", uid, "inventory", pid), { count: increment(n), updatedAt: serverTimestamp() }, { merge: true });
      }
      tx.set(settingsRef(), { autoDoneThrough: toDay, updatedAt: serverTimestamp() }, { merge: true });
      added = list.length;
    });
    if (added) {
      historyState.loadedAt = 0;
      toast(`자동모드: 지난 ${toDay - fromDay + 1}일 동안 안 누른 ${added}개를 먹은 걸로 처리했어요.`);
    }
  } catch (e) {
    if (state.user && state.user.uid === uid) fail(e);
  } finally {
    autoRunning = false;
  }
}

function cycleProgress(cycle, today) {
  const use = dailyUseAll({ cycle, extras: state.items });
  const items = cycle.items || [];
  const main = items.find((it) => it.meal === "lunch" && it.productId) || items.find((it) => it.productId) || null;
  const day = today - cycle.startDay + 1;
  if (!main) return { day, main: null, daysLeft: null };
  const left = invCount(main.productId);
  const dl = left === null ? null : daysLeft(Math.max(0, left), use[main.productId]);
  return { day, main, daysLeft: dl, endDay: dl === null ? null : today + dl };
}

// ---------- products ----------
function renderProducts() {
  const admin = isAdmin();
  const q = state.productQuery.trim().toLowerCase();
  const list = state.products.filter((p) => !q || (p.name + " " + (p.brand || "")).toLowerCase().includes(q));
  const box = $("#productGrid");
  if (!state.products.length) {
    box.innerHTML = admin
      ? `<div class="empty"><strong>공용 제품 목록이 비어 있어요.</strong><br><span>위의 "아이허브 링크로 추가"를 눌러 링크를 붙여넣으면 한 번에 추가돼요.</span></div>`
      : `<div class="empty"><strong>아직 등록된 제품이 없어요.</strong><br><span>관리자가 제품을 추가하면 여기에 보여요. 그 전에는 + 버튼으로 내 스케줄에 직접 추가할 수 있어요.</span></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty">"${esc(state.productQuery)}"에 맞는 제품이 없어요.</div>`;
    return;
  }
  box.innerHTML = list.map((p) => {
    const mine = state.items.some((it) => it.productId === p.id);
    return `<article class="pcard">
      ${thumbHtml(p.name, isSafePhoto(p.photo) ? p.photo : null, "pphoto")}
      <div class="pbody">
        ${p.brand ? `<div class="pbrand">${esc(p.brand)}</div>` : ""}
        <div class="pname">${esc(p.name)}</div>
        <div class="pmeta">${esc(describeAmount(p))}</div>
        <div class="pactions">
          ${mine ? `<span class="chip taken">추가 영양제에 있음</span>` : `<button class="btn-small primary" data-adopt="${esc(p.id)}">추가 영양제로 담기</button>`}
          <a class="iherb-link" href="${esc(safeIherbUrl(p.url, p.name))}" target="_blank" rel="noopener">아이허브</a>
          ${admin ? `<button class="btn-small" data-edit-product="${esc(p.id)}">수정</button>` : ""}
        </div>
      </div>
    </article>`;
  }).join("");
}

// ---------- probiotic cycles ----------
// The admin defines cycle types in config/rotation; each person runs their own
// cycle (users/{uid}/meta/cycle), started on the day they confirm it.
function productLabel(p) { return (p.brand ? p.brand + " " : "") + p.name; }
function fmtDay(day) { const d = new Date(day * 86400000); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`; }
function cycleCode(cycle) {
  const idx = state.plan ? methodIndexOf(state.plan, cycle) : (cycle.methodIndex || 0);
  return `${idx + 1}-${cycle.round || 1}`;
}

function productRow(pid, right = "") {
  const p = productById(pid);
  const name = p ? p.name : "삭제된 제품";
  return `<div class="cy-prod">${thumbHtml(name, p && isSafePhoto(p.photo) ? p.photo : null, "opt-photo")}
    <span class="opt-text">${p && p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}<span class="opt-name">${esc(name)}</span></span>${right}</div>`;
}

// One option card: a single product, or a set of products taken together.
function optionInner(ids) {
  const prods = ids.map((id) => productById(id));
  if (prods.length === 1) {
    const p = prods[0];
    const name = p ? p.name : "삭제된 제품";
    return `${thumbHtml(name, p && isSafePhoto(p.photo) ? p.photo : null, "opt-photo")}
      <span class="opt-text">${p && p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}<span class="opt-name">${esc(name)}</span></span>`;
  }
  return `<span class="set-photos">${prods.map((p) => thumbHtml(p ? p.name : "?", p && isSafePhoto(p.photo) ? p.photo : null, "opt-photo")).join("")}</span>
    <span class="opt-text"><span class="opt-brand">${prods.length}개 세트</span>${prods.map((p) => `<span class="opt-name">${esc(p ? productLabel(p) : "삭제된 제품")}</span>`).join("")}</span>`;
}

function slotHtml(slot) {
  const opts = slotOptions(slot).filter((ids) => ids.some((id) => productById(id)));
  const choose = opts.length > 1;
  const cards = opts.length
    ? opts.map((ids) => {
        const p = productById(ids[0]);
        const href = ids.length === 1 && p ? safeIherbUrl(p.url, productLabel(p)) : null;
        return href
          ? `<a class="opt" href="${esc(href)}" target="_blank" rel="noopener">${optionInner(ids)}</a>`
          : `<div class="opt${ids.length > 1 ? " set" : ""}">${optionInner(ids)}</div>`;
      }).join("")
    : `<span class="opt-missing">연결된 제품이 없어요${isAdmin() ? " — 사이클 구성 편집에서 골라주세요" : ""}</span>`;
  return `<div class="slot">
    <div class="slot-head"><span class="slot-label">${esc(slot.label)}</span>${choose ? `<span class="chip pick">${opts.length}개 중 택1</span>` : ""}<span class="slot-amount">${esc(slot.amount || "")}</span></div>
    <div class="opts${choose ? " scroll" : ""}">${cards}</div>
  </div>`;
}

// Everything a person takes now: the rotating cycle plus the base set ("4번").
function allItems(cycle) {
  return [...(cycle.items || []), ...((cycle.base && cycle.base.items) || [])];
}

const MEAL_NAMES = { lunch: "점심", dinner: "저녁" };

function itemRows(items, use) {
  return items.map((it) => {
    const raw = invCount(it.productId);
    const left = raw === null ? null : Math.max(0, raw);
    const dl = left === null ? null : daysLeft(left, use[it.productId]);
    const low = dl !== null && dl < LOW_DAYS;
    return `<div class="cy-item"><div class="cy-label">${esc(it.label)}<span class="slot-amount">${esc(it.amount)}</span></div>
      ${productRow(it.productId, left === null ? "" : `<span class="cy-left${low ? " low" : ""}">재고 ${left}개</span>`)}</div>`;
  }).join("");
}

function mealSections(items, use, stock, today) {
  return ["lunch", "dinner"].map((meal) => {
    const list = items.filter((it) => it.meal === meal);
    return list.length ? `<div class="meal"><div class="meal-head">${MEAL_NAMES[meal]} 먹고</div>${itemRows(list, use)}</div>` : "";
  }).join("") || `<p class="mc-note">없음</p>`;
}

function renderRotation() {
  const plan = state.plan;
  const cycle = state.cycle;
  const admin = isAdmin();
  $("#rotEdit").hidden = !(admin && plan);
  const loaded = state.planLoaded && state.cycleLoaded;
  $("#rotEmpty").hidden = !loaded || !!cycle;
  $("#rotContent").hidden = !loaded || !cycle;
  if (!loaded) return;
  if (!cycle) {
    const canStart = !!plan || admin;
    $("#rotStart").hidden = !canStart;
    $("#rotEmptyText").textContent = canStart
      ? "사이클과 4번 기본 구성을 고르면 오늘부터 시작돼요."
      : "관리자가 아직 사이클 구성을 만들지 않았어요.";
    return;
  }
  const today = epochDay();
  const st = cycleProgress(cycle, today);
  const use = dailyUseAll({ cycle, extras: state.items });
  const mainName = st.main ? (productById(st.main.productId)?.name || st.main.label) : "";
  const ending = st.daysLeft === null ? ""
    : st.daysLeft <= 0
      ? `<div class="cy-alert">${esc(mainName)}이(가) 다 떨어졌어요. 다음 사이클을 시작하세요.</div>`
      : `<p class="mc-note">${esc(mainName)} 기준 약 ${st.daysLeft}일 남았어요<br>${fmtDay(st.endDay)}쯤 다음 사이클로 넘어가요</p>`;
  const base = cycle.base;
  const planned = plan ? plan.methods.find((x) => x.id === cycle.methodId) : null;
  const cur = planned ? { title: planned.title, subtitle: planned.subtitle } : { title: cycle.title, subtitle: cycle.subtitle };
  $("#rotNow").innerHTML = `<div class="month-card now">
    <div class="mc-when">지금 사이클 <span class="chip code">${esc(cycleCode(cycle))}</span><span class="cy-days">${fmtDay(cycle.startDay)} 시작 · ${st.day}일째</span></div>
    <div class="mc-title">${esc(cur.title)}${cur.subtitle ? ` <span class="mc-sub">${esc(cur.subtitle)}</span>` : ""}</div>
    ${ending}
    ${mealSections(cycle.items || [], use, cycle.stock, today)}
    <div class="cy-actions"><button class="btn-small" data-restock="" type="button">새 통 추가</button><button class="btn-small" id="cyStock" type="button">보유 개수 수정</button>
      ${plan ? `<button class="btn-small primary" id="cyNext" type="button">다음 사이클 시작</button>` : ""}</div>
  </div>
  ${base && (base.items || []).length ? `<div class="month-card base">
    <div class="mc-when">계속 먹는 기본 구성 <span class="cy-days">${fmtDay(base.startDay)}부터 · ${today - base.startDay + 1}일째</span></div>
    <div class="mc-title">${esc(base.title || "4번 사이클")}${base.subtitle ? ` <span class="mc-sub">${esc(base.subtitle)}</span>` : ""}</div>
    ${mealSections(base.items, use, cycle.stock, today)}
    <div class="cy-actions"><button class="btn-small" data-restock="" type="button">새 통 추가</button></div>
  </div>` : ""}`;
  if (plan) {
    const n = nextCycle(plan, cycle);
    const m = plan.methods[n.methodIndex];
    $("#rotNext").innerHTML = `<div class="month-card">
      <div class="mc-when">다음 사이클 미리보기 <span class="chip code">${n.methodIndex + 1}-${n.round}</span></div>
      <div class="mc-title">${esc(m.title)}${m.subtitle ? ` <span class="mc-sub">${esc(m.subtitle)}</span>` : ""}</div>
      ${["lunch", "dinner"].map((meal) => m[meal].length ? `<div class="meal"><div class="meal-head">${MEAL_NAMES[meal]} 먹고</div>${m[meal].map(slotHtml).join("")}</div>` : "").join("")}
      ${base ? `<p class="mc-note">4번 기본 구성은 그대로 계속 먹어요.</p>` : ""}
    </div>`;
  } else {
    $("#rotNext").innerHTML = "";
  }
}

// ----- start / next cycle sheet -----
// The base set is chosen only when starting (or for an older cycle that has none).
let setup = null;

function openCycleSetup(methodIndex) {
  setup = {
    step: methodIndex === undefined ? 1 : 2, methodIndex, picks: null, stock: {},
    withBase: !state.cycle || !state.cycle.base
  };
  if (setup.step === 2) preparePicks();
  openSheet(state.cycle ? "다음 사이클 시작" : "나의 사이클 추가하기", `<div id="cycleSetup"></div>`);
  renderCycleSetup();
}

function preparePicks() {
  const prevIds = (state.cycle?.items || []).map((it) => it.productId);
  setup.picks = defaultPicks(state.plan.methods[setup.methodIndex], prevIds);
  if (setup.withBase) Object.assign(setup.picks, defaultBasePicks(baseSlots(state.plan)));
}

function stockDefault(pid) {
  if (setup.stock[pid] !== undefined) return setup.stock[pid];
  const have = invCount(pid);
  if (have !== null) return Math.max(0, have);
  const p = productById(pid);
  return p && p.count ? p.count : 30;
}

function slotForKey(key) {
  const [part, i] = key.split(":");
  const idx = parseInt(i, 10);
  return part === "base" ? baseSlots(state.plan)[idx] : state.plan.methods[setup.methodIndex][part][idx];
}

function slotPicker(slot, key) {
  const cur = setup.picks[key];
  const opts = slotOptions(slot);
  const multi = opts.length > 1;
  const excluded = cur === null;
  const meals = key.startsWith("base:") ? (slot.meals && slot.meals.length ? slot.meals : ["lunch"]) : null;
  const optBtns = opts.map((ids, oi) => {
    const ok = ids.every((id) => productById(id));
    return `<button type="button" class="opt pickable${ids.length > 1 ? " set" : ""}${cur === oi ? " on" : ""}" data-cy-pick="${key}" data-opt="${oi}"${ok ? "" : " disabled"} aria-pressed="${cur === oi}">
      ${optionInner(ids)}<span class="tick" aria-hidden="true"></span></button>`;
  }).join("");
  return `<div class="slot cy-slot${excluded ? " excluded" : ""}${multi && cur === "" ? " need" : ""}" data-slot="${key}">
    <div class="slot-head"><span class="slot-label">${esc(slot.label)}</span>${multi && !excluded ? `<span class="chip pick">${opts.length}개 중 택1</span>` : ""}
      ${meals ? `<span class="chip meals">${meals.map((m) => MEAL_NAMES[m]).join("·")}</span>` : ""}<span class="slot-amount">${esc(slot.amount || "")}</span>
      <button type="button" class="link-btn" data-cy-exclude="${key}">${excluded ? "다시 넣기" : "빼기"}</button></div>
    ${excluded ? `<p class="mc-note">안 먹어요</p>` : `<div class="opts">${optBtns}</div>`}
  </div>`;
}

function renderCycleSetup(keepScroll = true) {
  const box = $("#cycleSetup");
  if (!box || !setup) return;
  const sheet = $(".sheet");
  const scroll = keepScroll ? sheet.scrollTop : 0;
  const plan = state.plan;
  if (setup.step === 1) {
    box.innerHTML = `<p class="hint">어떤 사이클로 시작할까요? 1 → 2 → 3 순서로 돌아가요.${setup.withBase ? " 다음 화면에서 계속 먹을 4번 기본 구성도 함께 정해요." : ""}</p>` +
      plan.methods.map((m, i) => {
        const ids = [...new Set([...m.lunch, ...m.dinner].flatMap((s) => slotOptions(s).flat()))].slice(0, 8);
        const parts = ["lunch", "dinner"].filter((meal) => m[meal].length).map((meal) => `${MEAL_NAMES[meal]}: ${m[meal].map((s) => esc(s.label)).join(", ")}`);
        return `<button type="button" class="cy-choice" data-cy-method="${i}">
          <span class="cy-choice-head"><span class="chip code">${i + 1}</span><strong>${esc(m.title)}</strong><span class="mc-sub">${esc(m.subtitle || "")}</span></span>
          <span class="cy-thumbs">${ids.map((id) => { const p = productById(id); return thumbHtml(p ? p.name : "?", p && isSafePhoto(p.photo) ? p.photo : null, "cy-thumb"); }).join("")}</span>
          <span class="mc-note">${parts.join("<br>")}</span>
        </button>`;
      }).join("");
    sheet.scrollTop = 0;
    return;
  }
  const m = plan.methods[setup.methodIndex];
  const slots = baseSlots(plan);
  const cycleItems = itemsFromPicks(m, setup.picks);
  const baseItems = setup.withBase ? baseItemsFromPicks(slots, setup.picks) : [];
  const pids = [...new Set([...cycleItems, ...baseItems].map((it) => it.productId))];
  const use = dailyUse([...cycleItems, ...baseItems]);
  box.innerHTML = `<div class="cy-setup-head"><span class="chip code">${setup.methodIndex + 1}</span><strong>${esc(m.title)}</strong><span class="mc-sub">${esc(m.subtitle || "")}</span>
      <button type="button" class="link-btn" data-cy-back>다른 사이클 고르기</button></div>
    ${["lunch", "dinner"].map((meal) => m[meal].length ? `<div class="meal"><div class="meal-head">${MEAL_NAMES[meal]} 먹고</div>${m[meal].map((s, i) => slotPicker(s, `${meal}:${i}`)).join("")}</div>` : "").join("")}
    ${setup.withBase && slots.length ? `<div class="base-block">
      <div class="cy-setup-head"><span class="chip code">4</span><strong>${esc(plan.base.title || "4번 사이클")}</strong><span class="mc-sub">${esc(plan.base.subtitle || "")}</span></div>
      <p class="hint">지금 한 번만 정하면 사이클이 바뀌어도 계속 먹어요.</p>
      ${slots.map((s, i) => slotPicker(s, `base:${i}`)).join("")}
    </div>` : (state.cycle && state.cycle.base ? `<p class="mc-note">4번 기본 구성은 지금처럼 계속 먹어요.</p>` : "")}
    <div class="meal"><div class="meal-head">지금 가지고 있는 개수</div>
      <p class="hint">이미 먹고 있던 제품은 남은 개수로 고쳐주세요. 새 통이면 그대로 두면 돼요.</p>
      ${pids.map((pid) => `<div class="cy-stock">${productRow(pid)}
        <label class="cy-stock-in"><input type="number" min="0" inputmode="numeric" data-cy-stock="${esc(pid)}" value="${esc(stockDefault(pid))}" aria-label="보유 개수"><span>개<br>하루 ${use[pid]}개</span></label></div>`).join("")
        || `<p class="mc-note">고른 제품이 없어요.</p>`}
    </div>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button>
      <button type="button" class="btn-primary" id="cyConfirm">${state.cycle ? "사이클 확정" : "시작하기"} — 오늘(${fmtDay(epochDay())})부터</button></div>`;
  sheet.scrollTop = scroll;
}

function handleSetupClick(e) {
  if (!setup || !e.target.closest("#cycleSetup")) return false;
  const t = e.target.closest("[data-cy-method],[data-cy-back],[data-cy-pick],[data-cy-exclude]");
  if (!t) return false;
  if (t.dataset.cyMethod !== undefined) {
    setup.methodIndex = parseInt(t.dataset.cyMethod, 10);
    setup.step = 2;
    setup.stock = {};
    preparePicks();
    renderCycleSetup(false);
  } else if ("cyBack" in t.dataset) {
    setup.step = 1;
    renderCycleSetup(false);
  } else if (t.dataset.cyPick) {
    setup.picks[t.dataset.cyPick] = parseInt(t.dataset.opt, 10);
    renderCycleSetup();
  } else if (t.dataset.cyExclude) {
    const key = t.dataset.cyExclude;
    if (setup.picks[key] === null) {
      setup.picks[key] = slotOptions(slotForKey(key)).length === 1 ? 0 : "";
    } else {
      setup.picks[key] = null;
    }
    renderCycleSetup();
  }
  return true;
}

async function confirmCycle() {
  const plan = state.plan;
  const m = plan.methods[setup.methodIndex];
  const missing = Object.keys(setup.picks).find((k) => setup.picks[k] === "");
  if (missing) {
    toast("택1 칸에서 제품을 골라주세요. 안 드실 거면 '빼기'를 누르세요.");
    const el = document.querySelector(`[data-slot="${missing}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  const items = itemsFromPicks(m, setup.picks);
  if (!items.length) { toast("사이클 제품을 최소 한 가지는 골라주세요."); return; }
  const today = epochDay();
  const prev = state.cycle;
  const base = setup.withBase
    ? { title: plan.base?.title || "4번 사이클", subtitle: plan.base?.subtitle || "", startDay: today, items: baseItemsFromPicks(baseSlots(plan), setup.picks) }
    : prev.base;
  const stock = {};
  for (const pid of new Set([...items, ...(setup.withBase ? base.items : [])].map((it) => it.productId))) {
    stock[pid] = Math.max(0, parseInt(stockDefault(pid), 10) || 0);
  }
  let round = 1;
  if (prev) {
    const prevIdx = methodIndexOf(plan, prev);
    round = setup.methodIndex <= prevIdx ? (prev.round || 1) + 1 : (prev.round || 1);
  }
  const history = prev
    ? [...(prev.history || []).slice(-23), { methodId: prev.methodId, title: prev.title, round: prev.round || 1, startDay: prev.startDay, endDay: today }]
    : [];
  try {
    const uid = state.user.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid, "meta", "cycle"), {
      methodId: m.id, methodIndex: setup.methodIndex, title: m.title, subtitle: m.subtitle || "",
      round, startDay: today, items, base: base || null, history, updatedAt: serverTimestamp()
    });
    for (const [pid, count] of Object.entries(stock)) {
      batch.set(doc(db, "users", uid, "inventory", pid), { count, updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    setup = null;
    closeSheet();
    toast(prev ? "다음 사이클을 시작했어요. 오늘이 1일째예요." : "시작했어요. 오늘이 1일째예요.");
  } catch (e) { fail(e); }
}

async function startFirstCycle() {
  if (!state.plan) {
    if (!isAdmin()) return;
    try {
      const plan = defaultPlan();
      await setDoc(doc(db, "config", "rotation"), { ...plan, updatedAt: serverTimestamp(), updatedBy: state.user.uid });
      state.plan = plan;
    } catch (e) { fail(e); return; }
  }
  openCycleSetup();
}

async function resetCycle() {
  if (!confirm("지금 사이클을 지우고 처음부터 다시 설정할까요?")) return;
  try {
    await deleteDoc(doc(db, "users", state.user.uid, "meta", "cycle"));
    toast("사이클을 지웠어요. + 버튼으로 다시 시작하세요.");
  } catch (e) { fail(e); }
}

// ----- admin: cycle types editor (works on a copy until "저장") -----
let draftPlan = null;

function openRotationEditor() {
  draftPlan = JSON.parse(JSON.stringify(state.plan || defaultPlan()));
  draftPlan.methods.forEach((m) => ["lunch", "dinner"].forEach((meal) => m[meal].forEach((slot) => {
    slot.options = slotOptions(slot).map((ids) => ({ ids }));
  })));
  if (!draftPlan.base) draftPlan.base = defaultPlan().base;
  draftPlan.base.slots.forEach((slot) => {
    slot.options = slotOptions(slot).map((ids) => ({ ids }));
    if (!Array.isArray(slot.meals) || !slot.meals.length) slot.meals = ["lunch"];
  });
  openSheet("사이클 구성 편집", `<div id="planEditor"></div>`);
  renderRotationEditor();
}

function renderRotationEditor() {
  const box = $("#planEditor");
  if (!box) return;
  const sheet = $(".sheet");
  const scroll = sheet.scrollTop;
  const catalog = [...state.products].sort((a, b) => productLabel(a).localeCompare(productLabel(b), "ko"));
  const optionList = catalog.map((p) => `<option value="${esc(p.id)}">${esc(productLabel(p))}</option>`).join("");
  const slotEditor = (slot, mi, meal, si) => `<div class="ps" data-m="${mi}" data-meal="${meal}" data-s="${si}">
      <div class="ps-row">
        <input data-ps="label" value="${esc(slot.label)}" placeholder="칸 이름 (예: 발효효소)" aria-label="칸 이름">
        <input data-ps="amount" class="ps-amount" value="${esc(slot.amount || "")}" placeholder="1캡슐" aria-label="양">
        <button type="button" class="rot-del" data-ps-del aria-label="칸 삭제">✕</button>
      </div>
      ${mi === "base" ? `<div class="ps-meals">${["lunch", "dinner"].map((meal) => `<label class="check"><input type="checkbox" data-ps-meal="${meal}"${slot.meals.includes(meal) ? " checked" : ""}> ${meal === "lunch" ? "점심" : "저녁"}</label>`).join("")}</div>` : ""}
      ${slot.options.map((opt, oi) => `<div class="ps-option" data-o="${oi}">
        <span class="ps-num">${slot.options.length > 1 ? "선택지 " + (oi + 1) : "제품"}</span>
        <div class="ps-opts">${opt.ids.map((id) => {
          const p = productById(id);
          return `<span class="ps-chip${p ? "" : " gone"}">${esc(p ? productLabel(p) : "삭제된 제품")}<button type="button" data-opt-del="${esc(id)}" aria-label="빼기">✕</button></span>`;
        }).join("")}
        <select data-opt-join aria-label="같이 먹을 제품 추가"><option value="">+ 같이 먹을 제품 (세트로 묶기)</option>${optionList}</select></div>
      </div>`).join("")}
      <select data-opt-add aria-label="선택지 추가"><option value="">+ ${slot.options.length ? "다른 선택지 추가 (2개 이상이면 택1)" : "제품 추가"}</option>${optionList}</select>
    </div>`;
  box.innerHTML = `<form id="planForm">
    <p class="hint">모든 사용자가 사이클을 고를 때 보는 구성이에요. 첫 번째 점심 칸이 사이클의 주인공이라, 이 제품이 떨어지면 다음 사이클로 넘어가요. 이미 진행 중인 사이클은 그대로이고 다음 사이클부터 반영돼요.</p>
    ${draftPlan.methods.map((m, mi) => `<section class="pm" data-m="${mi}">
      <div class="pm-head"><span class="chip code">${mi + 1}</span>
        <input data-pm="title" value="${esc(m.title)}" placeholder="사이클 ${mi + 1}" aria-label="사이클 이름">
        <input data-pm="subtitle" value="${esc(m.subtitle || "")}" placeholder="설명 (예: 가든 유산균)" aria-label="설명"></div>
      ${["lunch", "dinner"].map((meal) => `<div class="pm-meal"><div class="meal-head">${meal === "lunch" ? "점심 먹고" : "저녁 먹고"}</div>
        ${m[meal].map((slot, si) => slotEditor(slot, mi, meal, si)).join("")}
        <button type="button" class="btn-small" data-slot-add="${meal}" data-m="${mi}">+ 칸 추가</button></div>`).join("")}
      ${draftPlan.methods.length > 1 ? `<button type="button" class="btn-danger-text" data-method-del="${mi}">${esc(m.title || "이 사이클")} 삭제</button>` : ""}
    </section>`).join("")}
    <button type="button" class="rot-add" data-method-add>+ 사이클 추가</button>
    <section class="pm base" data-m="base">
      <div class="pm-head"><span class="chip code">4</span>
        <input data-pb="title" value="${esc(draftPlan.base.title || "")}" placeholder="4번 사이클" aria-label="기본 구성 이름">
        <input data-pb="subtitle" value="${esc(draftPlan.base.subtitle || "")}" placeholder="설명" aria-label="설명"></div>
      <p class="hint">처음 시작할 때 한 번 고르고, 사이클이 바뀌어도 계속 먹는 기본 구성이에요. 칸마다 먹는 때(점심·저녁)를 고르세요.</p>
      ${draftPlan.base.slots.map((slot, si) => slotEditor(slot, "base", "base", si)).join("")}
      <button type="button" class="btn-small" data-slot-add="base" data-m="base">+ 칸 추가</button>
    </section>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button>
      <button type="submit" class="btn-primary">저장 — 모든 사용자에게 적용</button></div>
  </form>`;
  sheet.scrollTop = scroll;
}

function editorTarget(el) {
  const ps = el.closest(".ps");
  const m = (ps || el.closest("[data-m]")).dataset.m;
  if (m === "base") {
    const list = draftPlan.base.slots;
    return { base: true, method: null, list, ps, slot: ps ? list[parseInt(ps.dataset.s, 10)] : null };
  }
  const mi = parseInt(m, 10);
  const method = draftPlan.methods[mi];
  const list = ps ? method[ps.dataset.meal] : null;
  return { mi, method, list, ps, slot: ps ? list[parseInt(ps.dataset.s, 10)] : null };
}

function handleEditorClick(e) {
  if (!draftPlan || !e.target.closest("#planEditor")) return false;
  const t = e.target.closest("[data-ps-del],[data-opt-del],[data-slot-add],[data-method-del],[data-method-add]");
  if (!t) return false;
  if ("methodAdd" in t.dataset) {
    const n = draftPlan.methods.length + 1;
    draftPlan.methods.push({ id: "m" + Date.now().toString(36), title: "사이클 " + n, subtitle: "", lunch: [], dinner: [] });
  } else if (t.dataset.methodDel) {
    if (!confirm("이 사이클을 삭제할까요? 저장하기 전까지는 적용되지 않아요.")) return true;
    draftPlan.methods.splice(parseInt(t.dataset.methodDel, 10), 1);
  } else if (t.dataset.slotAdd === "base") {
    draftPlan.base.slots.push({ label: "", options: [], amount: "1캡슐", meals: ["lunch"] });
  } else if (t.dataset.slotAdd) {
    const { method } = editorTarget(t);
    method[t.dataset.slotAdd].push({ label: "", options: [], amount: "1캡슐" });
  } else {
    const { list, ps, slot } = editorTarget(t);
    if ("psDel" in t.dataset) list.splice(parseInt(ps.dataset.s, 10), 1);
    else if (t.dataset.optDel) {
      const opt = slot.options[parseInt(t.closest(".ps-option").dataset.o, 10)];
      opt.ids = opt.ids.filter((id) => id !== t.dataset.optDel);
      slot.options = slot.options.filter((o) => o.ids.length);
    }
  }
  renderRotationEditor();
  return true;
}

function handleEditorChange(t) {
  if (!draftPlan || !t.closest("#planEditor")) return false;
  if (t.matches("[data-opt-add]") && t.value) {
    const { slot } = editorTarget(t);
    slot.options.push({ ids: [t.value] });
    renderRotationEditor();
    return true;
  }
  if (t.matches("[data-ps-meal]")) {
    const { slot } = editorTarget(t);
    const meal = t.dataset.psMeal;
    slot.meals = t.checked ? [...new Set([...slot.meals, meal])] : slot.meals.filter((x) => x !== meal);
    if (!slot.meals.length) { slot.meals = [meal]; t.checked = true; toast("점심이나 저녁 중 하나는 골라야 해요."); }
    return true;
  }
  if (t.matches("[data-opt-join]") && t.value) {
    const { slot } = editorTarget(t);
    const opt = slot.options[parseInt(t.closest(".ps-option").dataset.o, 10)];
    if (!opt.ids.includes(t.value)) opt.ids.push(t.value);
    renderRotationEditor();
    return true;
  }
  return false;
}

function handleEditorInput(t) {
  if (setup && t.dataset.cyStock) {
    setup.stock[t.dataset.cyStock] = Math.max(0, parseInt(t.value, 10) || 0);
    return true;
  }
  if (!draftPlan || !t.closest("#planEditor")) return false;
  if (t.dataset.pm) { editorTarget(t).method[t.dataset.pm] = t.value; return true; }
  if (t.dataset.pb) { draftPlan.base[t.dataset.pb] = t.value; return true; }
  if (t.dataset.ps) { editorTarget(t).slot[t.dataset.ps] = t.value; return true; }
  return false;
}

async function savePlan() {
  const clean = (s) => ({ label: (s.label || "").trim() || "이름 없음", options: s.options.filter((o) => o.ids.length), amount: (s.amount || "").trim() });
  const plan = {
    methods: draftPlan.methods,
    base: {
      title: (draftPlan.base.title || "").trim() || "4번 사이클",
      subtitle: (draftPlan.base.subtitle || "").trim(),
      slots: draftPlan.base.slots.filter((s) => (s.label || "").trim() || s.options.length).map((s) => ({ ...clean(s), meals: s.meals }))
    }
  };
  plan.methods.forEach((m) => {
    m.title = (m.title || "").trim() || "사이클";
    ["lunch", "dinner"].forEach((meal) => {
      m[meal] = m[meal].filter((s) => (s.label || "").trim() || s.options.length)
        .map(clean);
    });
  });
  if (!validPlan(plan)) { toast("사이클이 하나 이상 있어야 해요."); return; }
  try {
    await setDoc(doc(db, "config", "rotation"), { ...plan, updatedAt: serverTimestamp(), updatedBy: state.user.uid });
    draftPlan = null;
    closeSheet();
    toast("사이클 구성을 저장했어요. 모든 사용자에게 바로 적용돼요.");
  } catch (e) { fail(e); }
}

// ---------- 재고 (inventory) ----------
// users/{uid}/inventory/{productId}.count is the real count: set when a cycle or extra
// is set up, raised by "새 통 추가", lowered by "완료" in 오늘.
const WHERE_TAG = { cycle: "유산균 사이클", base: "4번", extra: "추가 영양제" };
const LOW_DAYS = 10;

function inventoryRows() {
  const where = productsInUse({ cycle: state.cycle, extras: state.items });
  const use = dailyUseAll({ cycle: state.cycle, extras: state.items });
  const rows = [];
  for (const [pid, tags] of where) {
    const count = invCount(pid);
    rows.push({ pid, tags: [...tags], count, perDay: use[pid] || 0, days: count === null ? null : daysLeft(Math.max(0, count), use[pid]) });
  }
  for (const [pid, count] of Object.entries(state.inventory)) {
    if (!where.has(pid) && count > 0) rows.push({ pid, tags: [], count, perDay: 0, days: null, ahead: true });
  }
  return rows.sort((a, b) => (a.ahead ? 1 : 0) - (b.ahead ? 1 : 0) || (a.days ?? 1e9) - (b.days ?? 1e9));
}

function renderInventory() {
  const rows = inventoryRows();
  const box = $("#invList");
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><strong>재고가 비어 있어요.</strong><span>유산균 사이클을 시작하거나 추가 영양제를 등록하면 그 제품들이 여기 나와요.</span></div>`;
    return;
  }
  const inUse = rows.filter((r) => !r.ahead);
  const ahead = rows.filter((r) => r.ahead);
  const row = (r) => {
    const p = productById(r.pid);
    const low = r.days !== null && r.days < LOW_DAYS;
    const sub = r.ahead ? "미리 사둔 것 · 사이클이나 추가 영양제에 넣으면 자동으로 쓰여요"
      : r.count === null ? "개수를 아직 안 넣었어요"
      : `하루 ${fmtNum(r.perDay)}개 · ${r.days === null ? "" : r.days <= 0 ? "다 떨어졌어요" : `약 ${r.days}일 치`}`;
    return `<div class="inv-row${low ? " low" : ""}">
      ${productRow(r.pid, `<span class="inv-count">${r.count === null ? "—" : Math.max(0, r.count)}<small>개</small></span>`)}
      <div class="inv-meta">${r.tags.map((t) => `<span class="chip kind ${t}">${WHERE_TAG[t]}</span>`).join("")}<span class="inv-sub${low ? " low" : ""}">${esc(sub)}</span></div>
      <div class="inv-actions">
        ${p ? `<a class="iherb-link" href="${esc(safeIherbUrl(p.url, productLabel(p)))}" target="_blank" rel="noopener">아이허브</a>` : ""}
        <button type="button" class="btn-small" data-inv-edit="${esc(r.pid)}">개수 수정</button>
        <button type="button" class="btn-small primary" data-restock="${esc(r.pid)}">+ 새 통</button>
      </div>
    </div>`;
  };
  box.innerHTML = `${inUse.length ? `<h3 class="sub-head">먹고 있는 제품</h3>${inUse.map(row).join("")}` : ""}
    ${ahead.length ? `<h3 class="sub-head">미리 사둔 제품</h3>${ahead.map(row).join("")}` : ""}`;
}

// ----- new bottles bought -----
// Bottles are added on top of what's on hand. Products bought ahead (not taken yet)
// keep their count and are used once they're put into a cycle or extras.
let restock = null;

function openRestockSheet(focusPid) {
  const pids = inventoryRows().map((r) => r.pid);
  if (focusPid && !pids.includes(focusPid)) pids.unshift(focusPid);
  restock = { rows: pids.map((pid) => ({ pid, n: pid === focusPid ? 1 : 0, per: productById(pid)?.count || 30 })) };
  openSheet("새 통 추가", `<form id="restockForm"></form>`);
  renderRestock();
}

function restockLeft(pid) {
  return Math.max(0, invCount(pid) ?? 0);
}

function renderRestock() {
  const form = $("#restockForm");
  if (!form || !restock) return;
  const sheet = $(".sheet");
  const scroll = sheet.scrollTop;
  const listed = new Set(restock.rows.map((r) => r.pid));
  const others = state.products.filter((p) => !listed.has(p.id)).sort((a, b) => productLabel(a).localeCompare(productLabel(b), "ko"));
  form.innerHTML = `<p class="hint">산 만큼 통 수를 올려주세요. 지금 개수에 더해져요. 아직 안 먹는 제품을 미리 샀다면 아래에서 추가하세요.</p>
    ${restock.rows.map((r, i) => {
      const left = restockLeft(r.pid);
      return `<div class="rs-row" data-rs="${i}">${productRow(r.pid)}
        <div class="rs-ctrl">
          <div class="stepper"><button type="button" data-rs-step="-1" aria-label="한 통 빼기">−</button><span class="rs-n">${r.n}통</span><button type="button" data-rs-step="1" aria-label="한 통 더하기">+</button></div>
          <label class="rs-per">한 통 <input type="number" min="1" inputmode="numeric" data-rs-per value="${esc(r.per)}">개</label>
          <span class="rs-result">지금 ${left}개${r.n ? ` → <strong>${left + r.n * r.per}개</strong>` : ""}</span>
        </div></div>`;
    }).join("")}
    <select id="rsAdd" aria-label="다른 제품 추가"><option value="">+ 다른 제품도 샀어요</option>${others.map((p) => `<option value="${esc(p.id)}">${esc(productLabel(p))}</option>`).join("")}</select>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button><button type="submit" class="btn-primary">추가하기</button></div>`;
  sheet.scrollTop = scroll;
}

function handleRestockClick(e) {
  if (!restock || !e.target.closest("#restockForm")) return false;
  const t = e.target.closest("[data-rs-step]");
  if (!t) return false;
  const row = restock.rows[parseInt(t.closest(".rs-row").dataset.rs, 10)];
  row.n = Math.max(0, row.n + parseInt(t.dataset.rsStep, 10));
  renderRestock();
  return true;
}

function handleRestockChange(t) {
  if (!restock || !t.closest("#restockForm")) return false;
  if (t.id === "rsAdd" && t.value) {
    restock.rows.push({ pid: t.value, n: 1, per: productById(t.value)?.count || 30 });
    renderRestock();
    return true;
  }
  if (t.matches("[data-rs-per]")) {
    restock.rows[parseInt(t.closest(".rs-row").dataset.rs, 10)].per = Math.max(1, parseInt(t.value, 10) || 1);
    renderRestock();
    return true;
  }
  return false;
}

async function saveRestock() {
  const uid = state.user.uid;
  const batch = writeBatch(db);
  let bottles = 0;
  for (const r of restock.rows) {
    if (!r.n) continue;
    batch.set(doc(db, "users", uid, "inventory", r.pid), { count: restockLeft(r.pid) + r.n * Math.max(1, r.per), updatedAt: serverTimestamp() }, { merge: true });
    bottles += r.n;
  }
  if (!bottles) { toast("산 통 수를 + 버튼으로 올려주세요."); return; }
  try {
    await batch.commit();
    restock = null;
    closeSheet();
    toast(`${bottles}통을 재고에 추가했어요.`);
  } catch (e) { fail(e); }
}

// ----- exact counts -----
function openInventoryEdit(pids, title = "개수 수정") {
  const use = dailyUseAll({ cycle: state.cycle, extras: state.items });
  openSheet(title, `<form id="stockForm">
    <p class="hint">지금 실제로 남아 있는 개수를 적어주세요.</p>
    ${pids.map((pid) => `<div class="cy-stock">${productRow(pid)}
      <label class="cy-stock-in"><input type="number" min="0" inputmode="numeric" name="${esc(pid)}" value="${esc(invCount(pid) === null ? "" : Math.max(0, invCount(pid)))}" aria-label="보유 개수"><span>개${use[pid] ? `<br>하루 ${fmtNum(use[pid])}개` : ""}</span></label></div>`).join("")}
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button><button type="submit" class="btn-primary">저장</button></div>
  </form>`);
}

function openStockSheet() {
  openInventoryEdit([...new Set(allItems(state.cycle).map((it) => it.productId))], "보유 개수 수정");
}

async function saveStock(form) {
  const uid = state.user.uid;
  const batch = writeBatch(db);
  form.querySelectorAll("input[type=number]").forEach((inp) => {
    if (inp.value !== "") batch.set(doc(db, "users", uid, "inventory", inp.name), { count: Math.max(0, parseInt(inp.value, 10) || 0), updatedAt: serverTimestamp() }, { merge: true });
  });
  try {
    await batch.commit();
    closeSheet();
    toast("개수를 고쳤어요.");
  } catch (e) { fail(e); }
}

// ----- running low (내 정보) -----
function renderLowStock() {
  const list = inventoryRows().filter((r) => !r.ahead && r.days !== null && r.days < LOW_DAYS);
  $("#lowCount").textContent = list.length ? `${list.length}개` : "";
  $("#lowCount").hidden = !list.length;
  $("#lowStock").innerHTML = list.length ? list.map((r) => {
    const p = productById(r.pid);
    const url = p ? safeIherbUrl(p.url, productLabel(p)) : iherbSearchUrl("");
    return `<div class="low-row">
      ${productRow(r.pid, `<span class="low-left${r.days <= 0 ? " out" : ""}">${r.days <= 0 ? "다 떨어짐" : `약 ${r.days}일 치`}<br><small>${Math.max(0, r.count)}개 남음</small></span>`)}
      <a class="iherb-link low-link" href="${esc(url)}" target="_blank" rel="noopener">아이허브에서 주문하기 →</a>
    </div>`;
  }).join("") : `<p class="mc-note">10일 안에 떨어지는 제품이 없어요.</p>`;
}

// ----- history (내 정보) -----
const historyState = { by: "day", logs: null, loading: false, loadedAt: 0 };
const HISTORY_LIMIT = { day: 14, week: 8, month: 6 };

async function loadHistory(force = false) {
  if (!state.user || historyState.loading) return;
  // Wait for the first logs snapshot: a query sent right at sign-in can go out before the auth token does.
  if (!state.logsLoaded) { renderHistory(); return; }
  if (!force && historyState.logs && Date.now() - historyState.loadedAt < 60000) { renderHistory(); return; }
  historyState.loading = true;
  renderHistory();
  const uid = state.user.uid;
  try {
    const snap = await getDocs(query(collection(db, "users", uid, "logs"), where("day", ">=", epochDay() - 190)));
    // Signed out (or switched account) while this was loading: drop the result.
    if (!state.user || state.user.uid !== uid) { historyState.loading = false; return; }
    historyState.logs = snap.docs.map((d) => {
      const v = d.data();
      if (v.kind) return v;
      const it = state.items.find((x) => x.id === v.itemId);
      return { ...v, kind: "extra", productId: it ? it.productId : null, name: it ? it.name : "" };
    });
    historyState.loadedAt = Date.now();
  } catch (e) {
    if (state.user && state.user.uid === uid) fail(e);
  }
  historyState.loading = false;
  renderHistory();
}

function historyLabel(by, key) {
  if (by === "month") return `${Math.floor(key / 100)}년 ${key % 100}월`;
  const d = new Date(key * 86400000);
  const md = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  if (by === "week") {
    const end = new Date((key + 6) * 86400000);
    return `${md} ~ ${end.getUTCMonth() + 1}월 ${end.getUTCDate()}일`;
  }
  const today = epochDay();
  const rel = key === today ? " · 오늘" : key === today - 1 ? " · 어제" : "";
  return `${md} (${"일월화수목금토"[d.getUTCDay()]})${rel}`;
}

function renderHistory() {
  document.querySelectorAll("[data-history]").forEach((b) => b.classList.toggle("on", b.dataset.history === historyState.by));
  const box = $("#historyList");
  if (!historyState.logs) {
    box.innerHTML = `<p class="mc-note">${historyState.loading || !state.logsLoaded ? "불러오는 중이에요…" : ""}</p>`;
    return;
  }
  const by = historyState.by;
  const groups = historyGroups(historyState.logs, by).slice(0, HISTORY_LIMIT[by]);
  if (!groups.length) {
    box.innerHTML = `<p class="mc-note">아직 기록이 없어요. 오늘 탭에서 완료를 누르면 여기에 쌓여요.</p>`;
    return;
  }
  const kindOrder = ["cycle", "base", "extra"];
  box.innerHTML = groups.map((g) => {
    const byKind = kindOrder.map((k) => [k, g.products.filter((p) => p.kind === k)]).filter(([, l]) => l.length);
    return `<div class="hist">
      <div class="hist-head"><strong>${esc(historyLabel(by, g.key))}</strong>
        <span class="hist-stats">${by === "day" ? "" : `${g.activeDays}일 먹음 · `}완료 ${g.taken}${g.skipped ? ` · 건너뜀 ${g.skipped}` : ""}</span></div>
      ${g.cycles.length ? `<div class="hist-cycles">${g.cycles.map((c) => `<span class="chip code">${esc(c.code)}</span><span class="hist-ctitle">${esc(c.title)}</span>`).join("")}</div>` : ""}
      ${byKind.map(([k, list]) => `<div class="hist-kind"><span class="chip kind ${k}">${KIND_TAG[k] === "사이클" ? "유산균 사이클" : KIND_TAG[k] === "추가" ? "추가 영양제" : "4번"}</span>
        <span class="hist-prods">${list.map((p) => {
          const prod = p.productId ? productById(p.productId) : null;
          const name = prod ? prod.name : p.name || "이름 없음";
          return `${esc(name)}${by === "day" ? "" : ` <small>${p.times}회</small>`}`;
        }).join(", ")}</span></div>`).join("")}
    </div>`;
  }).join("");
}

// ---------- extra supplements (추가 영양제) ----------
function daysText(days) {
  const d = [...(days || [])].sort();
  if (d.length === 7) return "매일";
  if (d.join() === "1,2,3,4,5") return "평일";
  return d.map((x) => DAY_LABELS[x - 1]).join("·");
}

function renderExtras() {
  const box = $("#extrasList");
  const order = (it) => MEALS.findIndex((m) => m.key === extraMeals(it)[0]);
  const items = [...state.items].sort((a, b) => order(a) - order(b));
  if (!items.length) {
    box.innerHTML = `<div class="empty"><strong>아직 추가 영양제가 없어요.</strong><span>유산균 사이클 말고 따로 챙겨 먹는 영양제를 제품 목록에서 골라 추가하세요.</span></div>`;
    return;
  }
  box.innerHTML = items.map((it) => {
    const p = it.productId ? productById(it.productId) : null;
    const name = p ? p.name : it.name || "이름 없음";
    const left = it.productId ? invCount(it.productId) : null;
    return `<div class="item">
      ${thumbHtml(name, photoFor(it))}
      <button class="item-body" data-edit-item="${esc(it.id)}">
        ${p && p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}
        <span class="item-name">${esc(name)}</span>
        <span class="item-meta">${it.setTitle ? `<span class="chip set">${esc(it.setTitle)}</span>` : ""}${extraMeals(it).map((m) => `<span class="chip meal">${mealLabel(m)}</span>`).join("")}${it.memo ? `<span>${esc(it.memo)}</span>` : ""}<span>${esc(daysText(it.days))}</span><span>${fmtNum(extraAmount(it))}${esc(unitOf(it.productId))}씩</span>${left === null ? "" : `<span class="chip stock">재고 ${Math.max(0, left)}</span>`}</span>
      </button>
      <button class="btn-small" data-edit-item="${esc(it.id)}">수정</button>
    </div>`;
  }).join("");
}

// Step 1: pick a product from the shared catalog.
function openProductPicker() {
  openSheet("제품 목록에서 고르기", `<input id="pickSearch" class="search" type="search" placeholder="제품명이나 브랜드로 찾기" aria-label="제품 검색"><p class="hint">유산균 사이클(4번 포함) 제품은 여기서 빠져 있어요. 유산균 사이클 탭에서 관리해요.</p><div id="pickList"></div>`);
  renderProductPicker("");
}

function renderProductPicker(q) {
  const box = $("#pickList");
  if (!box) return;
  const query = q.trim().toLowerCase();
  const mine = new Set(state.items.map((it) => it.productId).filter(Boolean));
  // 유산균 사이클 products are managed in their own tab, so they are not offered here.
  const cycleIds = planProductIds(state.plan || defaultPlan());
  const list = state.products.filter((p) => !cycleIds.has(p.id) && (!query || productLabel(p).toLowerCase().includes(query)));
  box.innerHTML = list.length ? list.map((p) => `<button type="button" class="opt pick-row" data-pick-product="${esc(p.id)}">
      ${thumbHtml(p.name, isSafePhoto(p.photo) ? p.photo : null, "opt-photo")}
      <span class="opt-text">${p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}<span class="opt-name">${esc(p.name)}</span><span class="opt-brand">${esc(describeAmount(p))}</span></span>
      ${mine.has(p.id) ? `<span class="chip taken">추가됨</span>` : ""}
    </button>`).join("")
    : `<p class="mc-note">${query ? `"${esc(q)}"에 맞는 제품이 없어요.` : "제품 목록이 비어 있어요."}${isAdmin() ? " 제품 탭에서 추가할 수 있어요." : " 관리자에게 추가를 요청해주세요."}</p>`;
}

// Step 2: how much, when, which days, and how many are on hand.
function openItemSheet(itemId, fromProductId) {
  const it = itemId ? state.items.find((x) => x.id === itemId) : null;
  const prod = productById(fromProductId || (it && it.productId));
  const base = it || { perDose: 1, meal: "morning", days: [1, 2, 3, 4, 5, 6, 7], productId: prod ? prod.id : null };
  const meals = extraMeals(base);
  const name = prod ? prod.name : (it && it.name) || "";
  const stock = prod ? (invCount(prod.id) ?? prod.count ?? 30) : "";
  openSheet(it ? "추가 영양제 수정" : "추가 영양제 등록", `
    <form id="itemForm" data-id="${esc(itemId || "")}" data-product="${esc(base.productId || "")}">
      ${prod ? `<div class="pick-head">${productRow(prod.id)}<a class="iherb-link" target="_blank" rel="noopener" href="${esc(safeIherbUrl(prod.url, productLabel(prod)))}">아이허브에서 보기 →</a></div>`
        : `<div class="field"><label for="fName">이름</label><input id="fName" required maxlength="80" value="${esc(name)}"></div>`}
      <div class="field"><span class="label-like">언제 먹나요 <small>(여러 개 고를 수 있어요)</small></span>
        <div class="meal-pick" role="group" aria-label="먹는 때">${MEALS.map((m) => `<button type="button" class="meal-chip ${meals.includes(m.key) ? "on" : ""}" data-meal="${m.key}" aria-pressed="${meals.includes(m.key)}">${m.label}</button>`).join("")}</div>
        <p class="hint">고른 끼니마다 "한 번에 몇 개"만큼 먹어요. 끼니 시간은 내 정보 → 복용 시간에서 바꿀 수 있어요.</p>
      </div>
      <div class="field"><label for="fDose">한 번에 몇 개</label><input id="fDose" type="number" min="0.5" step="0.5" inputmode="decimal" value="${esc(extraAmount(base))}"></div>
      <div class="field"><label for="fMemo">메모 (선택)</label><input id="fMemo" maxlength="40" placeholder="예: 운동 전 공복" value="${esc(base.memo || "")}"></div>
      <div class="field"><span class="label-like">요일</span>
        <div class="days">${DAY_LABELS.map((l, i) => `<button type="button" class="day-chip ${base.days.includes(i + 1) ? "on" : ""}" data-day="${i + 1}" aria-pressed="${base.days.includes(i + 1)}">${l}</button>`).join("")}</div>
      </div>
      ${prod ? `<div class="field"><label for="fStock">지금 가지고 있는 개수</label><input id="fStock" type="number" min="0" inputmode="numeric" value="${esc(stock)}">
        <p class="hint">재고 탭과 같은 숫자예요. 오늘 탭에서 완료를 누르면 줄어들어요.</p></div>` : ""}
      <div class="sheet-actions">
        <button type="button" class="btn-secondary" data-close-sheet>취소</button>
        <button type="submit" class="btn-primary">저장</button>
      </div>
      ${it ? `<button type="button" class="btn-danger-text" data-delete-item="${esc(it.id)}">추가 영양제에서 빼기</button>` : ""}
    </form>`);
}

async function saveItemForm(form) {
  const pid = form.dataset.product || null;
  const prod = pid ? productById(pid) : null;
  const name = prod ? prod.name : ($("#fName") ? $("#fName").value.trim() : "");
  if (!name) { if ($("#fName")) $("#fName").focus(); return; }
  const days = [...form.querySelectorAll(".day-chip.on")].map((b) => parseInt(b.dataset.day, 10));
  if (!days.length) { toast("요일을 하나 이상 골라주세요."); return; }
  const meals = [...form.querySelectorAll(".meal-chip.on")].map((b) => b.dataset.meal);
  if (!meals.length) { toast("아침·점심·저녁 중 하나 이상 골라주세요."); return; }
  const perDose = Math.max(0.5, parseFloat($("#fDose").value) || 1);
  const data = { name, productId: pid, perDose, meals, days, memo: ($("#fMemo").value || "").trim().slice(0, 40) };
  const uid = state.user.uid;
  try {
    const batch = writeBatch(db);
    if (form.dataset.id) batch.update(doc(db, "users", uid, "items", form.dataset.id), { ...data, timeMinutes: deleteField(), meal: deleteField() });
    else batch.set(doc(collection(db, "users", uid, "items")), { ...data, createdDay: epochDay(), createdAt: serverTimestamp() });
    const stockInput = $("#fStock");
    if (pid && stockInput && stockInput.value !== "") {
      batch.set(doc(db, "users", uid, "inventory", pid), { count: Math.max(0, parseInt(stockInput.value, 10) || 0), updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    closeSheet();
    toast(form.dataset.id ? "수정했어요." : "추가 영양제에 넣었어요. 오늘 탭에 나와요.");
  } catch (e) { fail(e); }
}

// ---------- 상황별 세트 ----------
// The admin builds named sets (운동 전 부스터 ...) in the 관리자 tab; anyone can add
// a whole set to their 추가 영양제 in one go.
let adminView = "products";
let setDraft = null;

function cleanSetItem(it) {
  return {
    productId: String(it.productId),
    perDose: Math.max(0.5, Number(it.perDose) || 1),
    meals: extraMeals({ meals: Array.isArray(it.meals) ? it.meals : [] }),
    memo: String(it.memo || "").slice(0, 40)
  };
}

function setItemText(it) {
  const parts = [extraMeals(it).map(mealLabel).join("·"), `${fmtNum(it.perDose)}${unitOf(it.productId)}씩`];
  if (it.memo) parts.push(it.memo);
  return parts.join(" · ");
}

function setCard(s, actions) {
  const items = s.items || [];
  return `<article class="set-card">
    <div class="set-head"><strong>${esc(s.title)}</strong><span class="chip">${items.length}가지</span></div>
    ${s.note ? `<p class="set-note">${esc(s.note)}</p>` : ""}
    <div class="set-items">${items.map((it) => `<div class="set-line">${productRow(it.productId)}<span class="set-dose">${esc(setItemText(it))}</span></div>`).join("")}</div>
    ${actions}
  </article>`;
}

function renderAdmin() {
  document.querySelectorAll("[data-admin-view]").forEach((b) => b.classList.toggle("on", b.dataset.adminView === adminView));
  $("#adminProducts").hidden = adminView !== "products";
  $("#adminSets").hidden = adminView !== "sets";
  renderProducts();
  const box = $("#setAdminList");
  box.innerHTML = state.sets.length
    ? state.sets.map((s) => setCard(s, `<div class="set-actions"><button type="button" class="btn-small" data-set-edit="${esc(s.id)}">수정</button></div>`)).join("")
    : `<div class="empty"><strong>아직 상황별 세트가 없어요.</strong><span>"+ 새 세트"로 운동 전 부스터처럼 같이 먹는 제품 묶음을 만들면, 사용자가 추가 영양제 탭에서 한 번에 등록할 수 있어요.</span></div>`;
}

function openSetEditor(id, presetItems = null) {
  const s = id ? state.sets.find((x) => x.id === id) : null;
  setDraft = { id: s ? s.id : null, title: s ? s.title : "", note: s ? s.note || "" : "", items: s ? (s.items || []).map(cleanSetItem) : (presetItems || []), query: "" };
  openSheet(s ? "세트 수정" : "새 상황별 세트", `<form id="setForm">
    <div class="field"><label for="setTitle">세트 이름</label><input id="setTitle" maxlength="60" placeholder="예: 운동 퍼포먼스 부스터" value="${esc(setDraft.title)}"></div>
    <div class="field"><label for="setNote">설명 · 먹는 법</label><textarea id="setNote" rows="3" maxlength="400" placeholder="예: 운동 전 공복에 같이 먹어요.">${esc(setDraft.note)}</textarea></div>
    <div class="field"><span class="label-like">들어가는 제품</span><div id="setItems"></div></div>
    <div class="field"><label for="setPickSearch">제품 넣기</label><input id="setPickSearch" class="search" type="search" placeholder="제품명이나 브랜드로 찾기" autocomplete="off"><div id="setPickList"></div></div>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button><button type="submit" class="btn-primary">저장</button></div>
    ${s ? `<button type="button" class="btn-danger-text" data-set-delete="${esc(s.id)}">이 세트 삭제</button>` : ""}
  </form>`);
  renderSetItems();
  renderSetPick();
}

function renderSetItems() {
  const box = $("#setItems");
  if (!box || !setDraft) return;
  box.innerHTML = setDraft.items.length ? setDraft.items.map((it, i) => `<div class="set-edit-row">
      <div class="set-line">${productRow(it.productId)}<button type="button" class="btn-small" data-set-remove="${i}" aria-label="빼기">빼기</button></div>
      <div class="set-edit-fields">
        <label class="mini">한 번에 <input type="number" min="0.5" step="0.5" inputmode="decimal" data-set-dose="${i}" value="${esc(it.perDose)}"> ${esc(unitOf(it.productId))}</label>
        <div class="meal-pick small">${MEALS.map((m) => `<button type="button" class="set-meal ${it.meals.includes(m.key) ? "on" : ""}" data-set-meal="${i}" data-meal="${m.key}" aria-pressed="${it.meals.includes(m.key)}">${m.label}</button>`).join("")}</div>
        <input class="set-memo" maxlength="40" data-set-memo="${i}" placeholder="메모 (예: 운동 전 공복)" value="${esc(it.memo)}">
      </div>
    </div>`).join("") : `<p class="mc-note">아래에서 제품을 찾아 넣어주세요.</p>`;
}

function renderSetPick() {
  const box = $("#setPickList");
  if (!box || !setDraft) return;
  const q = setDraft.query.trim().toLowerCase();
  if (!q) { box.innerHTML = ""; return; }
  const have = new Set(setDraft.items.map((it) => it.productId));
  const list = state.products.filter((p) => !have.has(p.id) && productLabel(p).toLowerCase().includes(q)).slice(0, 20);
  box.innerHTML = list.length
    ? list.map((p) => `<button type="button" class="opt pick-row" data-set-add="${esc(p.id)}">${thumbHtml(p.name, isSafePhoto(p.photo) ? p.photo : null, "opt-photo")}<span class="opt-text">${p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}<span class="opt-name">${esc(p.name)}</span></span><span class="chip">+ 넣기</span></button>`).join("")
    : `<p class="mc-note">"${esc(setDraft.query)}"에 맞는 제품이 없어요. 먼저 제품 관리에서 아이허브 링크로 추가해주세요.</p>`;
}

function handleSetClick(e) {
  const t = e.target.closest("[data-admin-view],#setNew,[data-set-edit],[data-set-add],[data-set-remove],[data-set-meal],[data-set-delete],[data-set-use]");
  if (!t) return false;
  if (t.dataset.adminView) { adminView = t.dataset.adminView; renderAdmin(); }
  else if (t.id === "setNew") openSetEditor(null);
  else if (t.dataset.setEdit) openSetEditor(t.dataset.setEdit);
  else if (t.dataset.setUse) openSetAdd(t.dataset.setUse);
  else if (t.dataset.setDelete) {
    if (!confirm("이 세트를 삭제할까요? 이미 추가 영양제에 넣은 사람의 영양제는 그대로 남아요.")) return true;
    deleteDoc(doc(db, "sets", t.dataset.setDelete)).then(() => { closeSheet(); toast("세트를 삭제했어요."); }, fail);
  } else if (setDraft) {
    if (t.dataset.setAdd) {
      const p = productById(t.dataset.setAdd);
      setDraft.items.push({ productId: t.dataset.setAdd, perDose: 1, meals: ["morning"], memo: "" });
      setDraft.query = "";
      $("#setPickSearch").value = "";
      renderSetItems();
      renderSetPick();
      if (p) toast(`${p.name}을(를) 넣었어요.`);
    } else if (t.dataset.setRemove) {
      setDraft.items.splice(parseInt(t.dataset.setRemove, 10), 1);
      renderSetItems();
    } else if (t.dataset.setMeal) {
      const it = setDraft.items[parseInt(t.dataset.setMeal, 10)];
      const on = it.meals.includes(t.dataset.meal);
      if (on && it.meals.length === 1) { toast("끼니를 하나 이상 골라주세요."); return true; }
      it.meals = on ? it.meals.filter((m) => m !== t.dataset.meal) : extraMeals({ meals: [...it.meals, t.dataset.meal] });
      renderSetItems();
    }
  }
  return true;
}

function handleSetInput(t) {
  if (!setDraft) return false;
  if (t.id === "setTitle") setDraft.title = t.value;
  else if (t.id === "setNote") setDraft.note = t.value;
  else if (t.id === "setPickSearch") { setDraft.query = t.value; renderSetPick(); }
  else if (t.dataset.setDose) setDraft.items[parseInt(t.dataset.setDose, 10)].perDose = parseFloat(t.value) || 1;
  else if (t.dataset.setMemo) setDraft.items[parseInt(t.dataset.setMemo, 10)].memo = t.value;
  else return false;
  return true;
}

async function saveSet() {
  const title = setDraft.title.trim();
  if (!title) { toast("세트 이름을 적어주세요."); $("#setTitle").focus(); return; }
  if (!setDraft.items.length) { toast("제품을 하나 이상 넣어주세요."); return; }
  const data = { title, note: setDraft.note.trim(), items: setDraft.items.map(cleanSetItem), updatedAt: serverTimestamp() };
  try {
    if (setDraft.id) await setDoc(doc(db, "sets", setDraft.id), data);
    else await setDoc(doc(collection(db, "sets")), { ...data, createdAt: serverTimestamp() });
    closeSheet();
    toast("세트를 저장했어요. 추가 영양제 탭에서 모두에게 보여요.");
  } catch (e) { fail(e); }
}

// 추가 영양제 tab: offer the sets.
function renderSetOffers() {
  const box = $("#setOffers");
  if (!state.sets.length) { box.innerHTML = ""; box.hidden = true; return; }
  box.hidden = false;
  const mine = new Set(state.items.map((it) => it.productId));
  box.innerHTML = `<h3 class="sub-head">상황별 세트</h3><p class="hint">상황에 맞게 같이 먹는 조합이에요. 한 번에 추가 영양제로 넣을 수 있어요.</p>` +
    state.sets.map((s) => {
      const all = (s.items || []).length && (s.items || []).every((it) => mine.has(it.productId));
      return setCard(s, `<div class="set-actions">${all ? `<span class="chip taken">모두 추가됨</span>` : ""}<button type="button" class="${all ? "btn-small" : "btn-small primary"}" data-set-use="${esc(s.id)}">${all ? "다시 보기" : "이 세트 한 번에 추가"}</button></div>`);
    }).join("");
}

function openSetAdd(id) {
  const s = state.sets.find((x) => x.id === id);
  if (!s) return;
  const mine = new Set(state.items.map((it) => it.productId));
  const cycleUse = productsInUse({ cycle: state.cycle, extras: [] });
  const rows = (s.items || []).map((raw, i) => {
    const it = cleanSetItem(raw);
    const p = productById(it.productId);
    const reason = mine.has(it.productId) ? "이미 추가 영양제에 있어요" : cycleUse.has(it.productId) ? "유산균 사이클에서 먹고 있어요" : "";
    const stock = invCount(it.productId) ?? (p && p.count) ?? 30;
    return `<div class="set-add-row${reason ? " muted" : ""}">
      <label class="set-add-top"><input type="checkbox" data-set-pick="${i}" ${reason ? "" : "checked"}>${productRow(it.productId)}</label>
      <div class="set-add-meta"><span class="set-dose">${esc(setItemText(it))}</span>${reason ? `<span class="chip low">${reason}</span>` : ""}</div>
      <label class="mini">가지고 있는 개수 <input type="number" min="0" inputmode="numeric" data-set-stock="${i}" value="${esc(stock)}"></label>
    </div>`;
  }).join("");
  openSheet(s.title, `<form id="setAddForm" data-set="${esc(s.id)}">
    ${s.note ? `<p class="set-note">${esc(s.note)}</p>` : ""}
    <p class="hint">체크한 제품이 추가 영양제에 매일로 들어가요. 넣은 뒤에 하나씩 수정할 수 있어요.</p>
    ${rows}
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button><button type="submit" class="btn-primary">추가하기</button></div>
  </form>`);
}

async function saveSetAdd(form) {
  const s = state.sets.find((x) => x.id === form.dataset.set);
  if (!s) return;
  const picked = [...form.querySelectorAll("[data-set-pick]:checked")].map((c) => parseInt(c.dataset.setPick, 10));
  if (!picked.length) { toast("추가할 제품을 하나 이상 체크해주세요."); return; }
  const uid = state.user.uid;
  const batch = writeBatch(db);
  for (const i of picked) {
    const it = cleanSetItem(s.items[i]);
    const p = productById(it.productId);
    batch.set(doc(collection(db, "users", uid, "items")), {
      name: p ? p.name : "", productId: it.productId, perDose: it.perDose, meals: it.meals, days: [1, 2, 3, 4, 5, 6, 7],
      memo: it.memo, setId: s.id, setTitle: s.title, createdDay: epochDay(), createdAt: serverTimestamp()
    });
    const stockInput = form.querySelector(`[data-set-stock="${i}"]`);
    if (stockInput && stockInput.value !== "") {
      batch.set(doc(db, "users", uid, "inventory", it.productId), { count: Math.max(0, parseInt(stockInput.value, 10) || 0), updatedAt: serverTimestamp() }, { merge: true });
    }
  }
  try {
    await batch.commit();
    closeSheet();
    toast(`${s.title}: ${picked.length}가지를 추가 영양제에 넣었어요.`);
  } catch (e) { fail(e); }
}

// ---------- me ----------
function renderMe() {
  const u = state.user;
  $("#meName").textContent = u.displayName || "이름 없음";
  $("#meEmail").textContent = u.email || "";
  const admin = isAdmin();
  const noAdmin = state.adminUids !== null && state.adminUids.length === 0;
  $("#meRole").textContent = admin ? "관리자 — 제품 탭에서 공용 제품 목록을 관리해요" : "";
  $("#claimAdmin").hidden = !noAdmin;
  renderLowStock();
  if (state.tab === "me") renderHistory();
  renderMealTimes();
  renderNotify();
}

function renderMealTimes() {
  const box = $("#mealTimes");
  if (!box || box.contains(document.activeElement)) return;
  const t = mealTimes(state.settings);
  box.innerHTML = MEALS.map((m) => `<label class="mt-row"><span>${m.label}</span><input type="time" data-meal-time="${m.key}" value="${fmtTime(t[m.key])}" step="300"></label>`).join("");
}

async function saveMealTime(input) {
  const [hh, mm] = (input.value || "").split(":").map(Number);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return;
  const t = mealTimes(state.settings);
  const was = t[input.dataset.mealTime];
  if (was === hh * 60 + mm) return;
  t[input.dataset.mealTime] = hh * 60 + mm;
  const keys = MEALS.map((m) => m.key);
  for (let i = 1; i < keys.length; i++) {
    if (t[keys[i]] <= t[keys[i - 1]]) { toast("아침 → 점심 → 저녁 순서로 시간을 정해주세요."); input.value = fmtTime(was); return; }
  }
  try {
    await setDoc(settingsRef(), { mealTimes: t, updatedAt: serverTimestamp() }, { merge: true });
    toast(`${mealLabel(input.dataset.mealTime)} 시간을 ${fmtTime(t[input.dataset.mealTime])}로 바꿨어요.`);
  } catch (e) { fail(e); }
}

function notifyOn() {
  return localStorage.getItem("notify") === "1" && "Notification" in window && Notification.permission === "granted";
}

function renderNotify() {
  const on = notifyOn();
  $("#notifyBtn").textContent = on ? "알림 끄기" : "알림 켜기";
  const t = mealTimes(state.settings);
  $("#notifyState").textContent = on
    ? `켜짐 — 아침 ${fmtTime(t.morning)} · 점심 ${fmtTime(t.lunch)} · 저녁 ${fmtTime(t.dinner)}에 아직 안 먹은 게 있으면 알려드려요.`
    : "꺼짐";
}

const TABS = ["today", "rotation", "extras", "inventory", "me", "products"];

function renderAll() {
  if (!state.user) return;
  const admin = isAdmin();
  $("#tabProducts").hidden = !admin;
  if (state.tab === "products" && state.adminUids !== null && !admin) { switchTab("today"); return; }
  renderHeader();
  renderToday();
  renderRotation();
  renderExtras();
  renderSetOffers();
  renderInventory();
  if (admin) renderAdmin();
  renderMe();
}

function switchTab(tab) {
  if (!TABS.includes(tab)) tab = "today";
  state.tab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  try { localStorage.setItem("tab", tab); } catch { /* private mode */ }
  window.scrollTo(0, 0);
  renderAll();
  if (tab === "me") loadHistory();
}

// ---------- sheets ----------
function openSheet(title, html) {
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = html;
  $("#scrim").hidden = false;
  document.body.classList.add("sheet-open");
}
function closeSheet() {
  draftPlan = null;
  setDraft = null;
  restock = null;
  setup = null;
  $("#scrim").hidden = true;
  $("#sheetBody").innerHTML = "";
  document.body.classList.remove("sheet-open");
}

function photoPicker(current, note = "") {
  return `<div class="photo-field">
    <div class="photo-preview" id="photoPreview">${current ? `<img alt="" src="${current}">` : `<span>사진 없음</span>`}</div>
    <div class="photo-buttons">
      <label class="btn-small">사진 찍기<input type="file" accept="image/*" capture="environment" data-photo-input hidden></label>
      <label class="btn-small">앨범에서 선택<input type="file" accept="image/*" data-photo-input hidden></label>
      ${current ? `<button type="button" class="btn-small" data-photo-clear>사진 빼기</button>` : ""}
    </div>
    ${note ? `<p class="hint">${note}</p>` : ""}
  </div>`;
}

let sheetPhoto = null;
async function handlePhotoInput(input, onDone) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const data = await compressPhoto(file);
    onDone(data);
  } catch (e) { toast(e.message); }
  input.value = "";
}

function openProductSheet(productId) {
  const p = productById(productId);
  if (!p) return;
  sheetPhoto = isSafePhoto(p.photo) ? p.photo : null;
  openSheet("공용 제품 수정", `
    <form id="productForm" data-id="${esc(p.id)}">
      ${photoPicker(sheetPhoto, "모든 사용자에게 보이는 사진이에요. 직접 찍은 사진만 올려주세요 (아이허브 사진은 저작권 문제가 있어요).")}
      <div class="field"><label for="pName">제품명</label><input id="pName" required maxlength="120" value="${esc(p.name)}"></div>
      <div class="field"><label for="pBrand">브랜드</label><input id="pBrand" maxlength="80" value="${esc(p.brand)}"></div>
      <div class="row2">
        <div class="field"><label for="pDose">함량</label><input id="pDose" maxlength="40" value="${esc(p.dose)}" placeholder="1,000 mg"></div>
        <div class="field"><label for="pCount">개수</label><input id="pCount" type="number" min="0" inputmode="numeric" value="${esc(p.count ?? "")}"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="pForm">형태</label><input id="pForm" maxlength="20" value="${esc(p.form)}" placeholder="캡슐"></div>
        <div class="field"><label for="pVolume">용량(액상·분말)</label><input id="pVolume" maxlength="20" value="${esc(p.volume)}" placeholder="500 ml"></div>
      </div>
      <div class="field"><label for="pUrl">아이허브 링크</label><input id="pUrl" type="url" maxlength="400" value="${esc(p.url)}"></div>
      <div class="sheet-actions">
        <button type="button" class="btn-secondary" data-close-sheet>취소</button>
        <button type="submit" class="btn-primary">저장</button>
      </div>
      <button type="button" class="btn-danger-text" data-delete-product="${esc(p.id)}">공용 목록에서 삭제</button>
    </form>`);
}

async function saveProductForm(form) {
  const name = $("#pName").value.trim();
  if (!name) { $("#pName").focus(); return; }
  const count = parseInt($("#pCount").value, 10);
  try {
    await updateDoc(doc(db, "products", form.dataset.id), {
      name,
      brand: $("#pBrand").value.trim(),
      dose: $("#pDose").value.trim(),
      count: Number.isFinite(count) && count > 0 ? count : null,
      form: $("#pForm").value.trim(),
      volume: $("#pVolume").value.trim(),
      url: $("#pUrl").value.trim(),
      photo: sheetPhoto,
      updatedAt: serverTimestamp()
    });
    closeSheet();
    toast("공용 목록을 수정했어요.");
  } catch (e) { fail(e); }
}

// ---------- import from links ----------
let importRows = [];
function openImportSheet() {
  importRows = [];
  const admin = isAdmin();
  openSheet("아이허브 링크로 추가", `
    <p class="hint">아이허브에서 <strong>공유 → 링크 복사</strong> 한 내용을 그대로 붙여넣으세요. 여러 개를 한꺼번에 붙여넣어도 돼요.
      아이허브 <strong>앱</strong>의 공유 링크는 이름이 안 들어 있어서 이름만 직접 적으시면 돼요. 아이허브 <strong>웹사이트</strong> 주소창의 주소를 붙여넣으면 이름까지 자동으로 채워져요.
      ${admin ? "관리자라서 <strong>공용 제품 목록</strong>에 저장돼요." : "<strong>내 스케줄</strong>에 저장돼요."}</p>
    <textarea id="importText" rows="5" placeholder="https://iherb.co/...&#10;https://kr.iherb.com/pr/.../12345"></textarea>
    <div class="sheet-actions"><button type="button" class="btn-primary" id="importParse">링크 읽기</button></div>
    <div id="importResult"></div>`);
}

function renderImportRows() {
  const admin = isAdmin();
  const box = $("#importResult");
  if (!importRows.length) { box.innerHTML = ""; return; }
  const needName = importRows.some((r) => r.needsName && !r.duplicate);
  box.innerHTML = `<p class="hint">${needName ? "<strong>이름 칸이 비어 있는 제품</strong>은 링크를 눌러 확인하고 이름을 적어주세요. " : ""}틀린 곳은 고쳐주세요.</p>` +
    importRows.map((r, i) => `<div class="import-row" data-index="${i}">
      <div class="import-photo">${thumbHtml(r.name, r.photo, "pphoto")}
        <label class="btn-small">사진<input type="file" accept="image/*" data-import-photo="${i}" hidden></label></div>
      <div class="import-fields">
        <input data-imp="name" class="${r.needsName && !r.name.trim() ? "need" : ""}" value="${esc(r.name)}" placeholder="${r.needsName ? "제품 이름을 적어주세요" : "제품명"}" aria-label="제품명">
        ${r.needsName ? `<a class="iherb-link" href="${esc(r.url)}" target="_blank" rel="noopener">어떤 제품인지 링크 열어 확인 →</a>` : ""}
        <input data-imp="brand" value="${esc(r.brand)}" placeholder="브랜드" aria-label="브랜드">
        <div class="row2"><input data-imp="dose" value="${esc(r.dose)}" placeholder="함량" aria-label="함량">
          <input data-imp="count" type="number" min="0" value="${esc(r.count ?? "")}" placeholder="개수" aria-label="개수"></div>
        ${r.duplicate ? `<span class="chip low">이미 목록에 있어요 — ${r.existingId ? "있는 제품을 써요" : "건너뜀"}</span>` : ""}
        ${r.fromShot ? `<a class="iherb-link" href="${esc(r.url)}" target="_blank" rel="noopener">아이허브에서 찾아보기 →</a>` : ""}
      </div>
      <button type="button" class="rot-del" data-import-remove="${i}" aria-label="빼기">✕</button>
    </div>`).join("") +
    `<div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button>
      <button type="button" class="btn-primary" id="importSave">${admin ? "공용 목록에 저장" : "내 스케줄에 추가"} (${importRows.filter((r) => !r.duplicate).length}개)</button></div>
`;
}

function parseImport() {
  const text = $("#importText").value;
  const links = parseIherbLinks(text);
  const bad = findUnsupportedLinks(text);
  const admin = isAdmin();
  importRows = links.map((l) => ({
    ...l,
    photo: null,
    duplicate: admin
      ? state.products.some((p) => (l.iherbId && p.iherbId === l.iherbId) || p.url === l.url)
      : state.items.some((it) => (l.iherbId && it.iherbId === l.iherbId) || it.url === l.url)
  }));
  renderImportRows();
  const firstEmpty = $("#importResult input.need");
  if (firstEmpty) firstEmpty.focus();
  if (bad.length) toast(`제품 링크가 아닌 주소 ${bad.length}개는 건너뛰었어요. 제품 페이지에서 공유해주세요.`);
  else if (!links.length) toast("아이허브 제품 링크를 찾지 못했어요. 제품 페이지에서 공유 → 링크 복사를 해주세요.");
}

async function saveImport() {
  const admin = isAdmin();
  const unnamed = importRows.findIndex((r) => !r.duplicate && !r.name.trim());
  if (unnamed !== -1) {
    toast("이름이 비어 있는 제품이 있어요. 이름을 적거나 ✕로 빼주세요.");
    const el = document.querySelector(`.import-row[data-index="${unnamed}"] [data-imp="name"]`);
    if (el) { el.classList.add("need"); el.focus(); }
    return;
  }
  const rows = importRows.filter((r) => !r.duplicate);
  const makeSet = !!($("#shotMakeSet") && $("#shotMakeSet").checked);
  if (!rows.length && !makeSet) { toast("저장할 제품이 없어요."); return; }
  if (!admin) { toast("제품 추가는 관리자만 할 수 있어요."); return; }
  const uid = state.user.uid;
  try {
    const batch = writeBatch(db);
    const ids = [];
    for (const r of importRows) {
      if (r.duplicate) { if (r.existingId) ids.push(r.existingId); continue; }
      const ref = doc(collection(db, "products"));
      ids.push(ref.id);
      batch.set(ref, {
        name: r.name.trim(), brand: (r.brand || "").trim(), dose: (r.dose || "").trim(),
        count: r.count || null, form: r.form || "", volume: r.volume || "",
        url: r.url, iherbId: r.iherbId || null, photo: r.photo || null, createdBy: uid, createdAt: serverTimestamp()
      });
    }
    if (rows.length) await batch.commit();
    closeSheet();
    if (rows.length) toast(`${rows.length}개를 저장했어요.`);
    if (makeSet && ids.length) {
      adminView = "sets";
      renderAdmin();
      openSetEditor(null, ids.map((id) => ({ productId: id, perDose: 1, meals: ["morning"], memo: "" })));
    }
  } catch (e) { fail(e); }
}

// ---------- 캡처로 추가 (admin) ----------
// Reads product names out of an iHerb screenshot in the browser (no server).
let ocrScript = null;
function loadOcr() {
  if (!ocrScript) {
    ocrScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "ocr/tesseract.min.js";
      s.onload = resolve;
      s.onerror = () => { ocrScript = null; reject(new Error("글자 인식 도구를 불러오지 못했어요. 인터넷 연결을 확인해주세요.")); };
      document.head.appendChild(s);
    });
  }
  return ocrScript;
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("사진을 읽을 수 없어요.")); };
    img.src = url;
  });
}

function cropPhoto(img, r) {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 320;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 320, 320);
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, 320, 320);
  return c.toDataURL("image/jpeg", 0.82);
}

async function readShot(file, status) {
  await loadOcr();
  const img = await fileToImage(file);
  const W = img.naturalWidth, H = img.naturalHeight;
  // Only the text column, enlarged and in grey: reads Korean much better.
  const left = Math.round(W * 0.26);
  const scale = Math.min(2, Math.sqrt(12e6 / ((W - left) * H)));
  const c = document.createElement("canvas");
  c.width = Math.round((W - left) * scale); c.height = Math.round(H * scale);
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, left, 0, W - left, H, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height);
  const a = px.data;
  for (let i = 0; i < a.length; i += 4) { const v = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; a[i] = a[i + 1] = a[i + 2] = v; }
  g.putImageData(px, 0, 0);
  const base = new URL("ocr/", location.href).href;
  const worker = await window.Tesseract.createWorker(["kor", "eng"], 1, {
    workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang", gzip: true,
    logger: (m) => {
      const pct = Math.round((m.progress || 0) * 100);
      if (/traineddata/.test(m.status)) status(`한글 인식 데이터 받는 중… ${pct}% (처음 한 번만)`);
      else if (/recogniz/.test(m.status)) status(`글자 읽는 중… ${pct}%`);
    }
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(c);
    const lines = (data.lines || []).map((l) => ({ t: l.text, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 }));
    return parseShot(lines, { width: c.width }).map((it) => {
      const top = it.top / scale;
      return { ...it, photo: cropPhoto(img, photoRect({ top }, W, H)) };
    });
  } finally {
    await worker.terminate();
  }
}

const normName = (s) => String(s || "").toLowerCase().replace(/[\s,.()®]/g, "");

function openShotSheet() {
  importRows = [];
  openSheet("캡처로 제품 추가", `
    <p class="hint">아이허브 앱의 <strong>공유된 상품 목록·장바구니·위시리스트</strong> 화면을 캡처해서 올리면, 제품 이름과 사진을 읽어서 채워줘요. 여러 장을 한 번에 골라도 돼요.
      글자를 기계가 읽는 거라 <strong>틀린 글자는 고쳐주세요.</strong> 처음 한 번은 한글 인식 데이터(약 7MB)를 받느라 시간이 조금 걸려요.</p>
    <label class="btn-primary wide shot-pick">캡처 사진 고르기<input type="file" accept="image/*" multiple id="shotFile" hidden></label>
    <p id="shotStatus" class="mc-note" aria-live="polite"></p>
    <label class="check-row"><input type="checkbox" id="shotMakeSet" checked> 저장한 뒤 이 제품들로 상황별 세트 만들기</label>
    <div id="importResult"></div>`);
}

async function handleShotFiles(files) {
  const status = (msg) => { const el = $("#shotStatus"); if (el) el.textContent = msg; };
  const list = [...files].filter((f) => /^image\//.test(f.type));
  if (!list.length) return;
  let found = 0;
  try {
    for (const [n, f] of list.entries()) {
      status(list.length > 1 ? `${n + 1}/${list.length}번째 사진 읽는 중…` : "사진 읽는 중…");
      const items = await readShot(f, (m) => status(list.length > 1 ? `${n + 1}/${list.length} · ${m}` : m));
      for (const it of items) {
        const existing = matchProduct(it, state.products);
        if (importRows.some((r) => (existing && r.existingId === existing.id) || (normName(r.brand) === normName(it.brand) && normName(r.name) === normName(it.name)))) continue;
        importRows.push({
          name: existing ? existing.name : it.name, brand: existing ? existing.brand || it.brand : it.brand, dose: it.dose, count: it.count, form: it.form, volume: it.volume,
          url: iherbSearchUrl(`${it.brand} ${it.name}`), iherbId: null, photo: it.photo,
          duplicate: !!existing, existingId: existing ? existing.id : null, fromShot: true
        });
        found++;
      }
    }
  } catch (e) {
    status("");
    fail(e);
    return;
  }
  status(found ? `${found}개 제품을 찾았어요. 아래에서 확인해주세요.` : "제품을 찾지 못했어요. 제품 이름이 보이게 다시 캡처해주세요.");
  renderImportRows();
}

// ---------- notifications (while the app is open) ----------
function checkReminders() {
  if (!state.user || localStorage.getItem("notify") !== "1") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const day = epochDay(now);
  const t = mealTimes(state.settings);
  for (const m of MEALS) {
    // Due from the meal time until 30 minutes later, once per meal per day.
    if (mins < t[m.key] || mins >= t[m.key] + 30) continue;
    const flag = `notified_${day}_${m.key}`;
    if (localStorage.getItem(flag)) continue;
    const due = todayEntries().filter((e) => e.status === "PENDING" && e.meal === m.key);
    if (!due.length) continue;
    localStorage.setItem(flag, "1");
    showReminder(`${m.label} 영양제 드실 시간이에요`, due.map(entryName).join(", "), `meal-${m.key}`);
  }
}

async function showReminder(title, body, tag) {
  const opts = { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch { /* fall back below */ }
  try { new Notification(title, opts); } catch { /* some mobile browsers only allow SW notifications */ }
}

// ---------- data subscriptions ----------
function subscribe(uid) {
  const today = epochDay();
  unsubs.push(onSnapshot(doc(db, "users", uid, "meta", "settings"), (s) => {
    state.settings = s.exists() ? s.data() : {};
    renderAutoToggle();
    renderAll();
    runAutoFill();
  }, fail));
  unsubs.push(onSnapshot(doc(db, "config", "admins"), (s) => {
    state.adminUids = s.exists() && Array.isArray(s.data().uids) ? s.data().uids : [];
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(collection(db, "sets"), (s) => {
    state.sets = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko"));
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(collection(db, "products"), (s) => {
    state.products = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.brand + a.name).localeCompare(b.brand + b.name, "ko"));
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(collection(db, "users", uid, "items"), (s) => {
    state.items = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.itemsLoaded = true;
    migrateStock();
    runAutoFill();
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(collection(db, "users", uid, "inventory"), (s) => {
    const inv = {};
    s.docs.forEach((d) => { const c = d.data().count; if (typeof c === "number") inv[d.id] = c; });
    state.inventory = inv;
    state.inventoryLoaded = true;
    migrateStock();
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(query(collection(db, "users", uid, "logs"), where("day", ">=", today - 6)), (s) => {
    const logs = {};
    s.docs.forEach((d) => { const v = d.data(); logs[v.day + "_" + (v.key || "ex-" + v.itemId)] = v.status; });
    state.logs = logs;
    const first = !state.logsLoaded;
    state.logsLoaded = true;
    renderAll();
    runAutoFill();
    if (first && state.tab === "me") loadHistory();
  }, fail));
  unsubs.push(onSnapshot(doc(db, "config", "rotation"), (s) => {
    state.plan = s.exists() && validPlan(s.data()) ? s.data() : null;
    state.planLoaded = true;
    renderRotation();
  }, fail));
  unsubs.push(onSnapshot(doc(db, "users", uid, "meta", "cycle"), (s) => {
    state.cycle = s.exists() ? s.data() : null;
    state.cycleLoaded = true;
    migrateStock();
    runAutoFill();
    renderAll();
  }, fail));
}
// Counts used to live on the cycle (estimated by date) and on each schedule item.
// Move them into 재고 once, without overwriting counts that are already there.
let migrated = false;
async function migrateStock() {
  if (migrated || !state.user || !state.cycleLoaded || !state.inventoryLoaded || !state.itemsLoaded) return;
  migrated = true;
  const uid = state.user.uid;
  const today = epochDay();
  const batch = writeBatch(db);
  let writes = 0;
  const cy = state.cycle;
  if (cy && cy.stock) {
    const use = dailyUse(allItems(cy));
    for (const [pid, entry] of Object.entries(cy.stock)) {
      if (invCount(pid) !== null) continue;
      batch.set(doc(db, "users", uid, "inventory", pid), { count: remaining(entry, use[pid] || 0, today) ?? 0, updatedAt: serverTimestamp() }, { merge: true });
      writes++;
    }
    batch.update(doc(db, "users", uid, "meta", "cycle"), { stock: deleteField() });
    writes++;
  }
  for (const it of state.items) {
    if (!it.productId || typeof it.stockCount !== "number" || invCount(it.productId) !== null) continue;
    batch.set(doc(db, "users", uid, "inventory", it.productId), { count: it.stockCount, updatedAt: serverTimestamp() }, { merge: true });
    writes++;
  }
  if (writes) { try { await batch.commit(); } catch (e) { console.error(e); } }
}

function unsubscribeAll() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

// ---------- events ----------
function wire() {
  $("#googleLogin").addEventListener("click", async () => {
    try { await signInWithGoogle(); } catch (e) {
      if (e && e.code === "auth/popup-closed-by-user") return;
      if (e && e.code === "auth/unauthorized-domain") toast("이 주소는 로그인 허용 목록에 없어요. Firebase 콘솔의 승인된 도메인을 확인해주세요.");
      else fail(e);
    }
  });
  document.querySelectorAll("[data-test-user]").forEach((b) => b.addEventListener("click", () => {
    const [sub, email, name] = b.dataset.testUser.split("|");
    signInTestUser(sub, email, name).catch(fail);
  }));
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#importOpen").addEventListener("click", openImportSheet);
  $("#shotOpen").addEventListener("click", openShotSheet);
  $("#extraAdd").addEventListener("click", openProductPicker);
  $("#invRestock").addEventListener("click", () => openRestockSheet());
  document.querySelectorAll("[data-history]").forEach((b) => b.addEventListener("click", () => {
    historyState.by = b.dataset.history;
    renderHistory();
  }));
  // Stop listening first, or the listeners fire permission errors once auth is gone.
  $("#logout").addEventListener("click", () => { unsubscribeAll(); logOut(); });
  $("#productSearch").addEventListener("input", (e) => { state.productQuery = e.target.value; renderProducts(); });

  $("#claimAdmin").addEventListener("click", async () => {
    try {
      await setDoc(doc(db, "config", "admins"), { uids: [state.user.uid] });
      toast("관리자로 등록됐어요.");
    } catch (e) { fail(e); }
  });

  $("#notifyBtn").addEventListener("click", async () => {
    if (!("Notification" in window)) { toast("이 브라우저는 알림을 지원하지 않아요."); return; }
    if (localStorage.getItem("notify") === "1" && Notification.permission === "granted") {
      localStorage.setItem("notify", "0");
    } else {
      const perm = await Notification.requestPermission();
      localStorage.setItem("notify", perm === "granted" ? "1" : "0");
      if (perm !== "granted") toast("알림이 차단되어 있어요. 브라우저 설정에서 허용해주세요.");
      else showReminder("알림이 켜졌어요", "아침·점심·저녁 복용 시간에 이렇게 알려드릴게요.", "notify-test");
    }
    renderMe();
  });

  document.addEventListener("change", (e) => {
    if (e.target.matches && e.target.matches("[data-meal-time]")) saveMealTime(e.target);
  });

  document.addEventListener("click", (e) => {
    if (handleEditorClick(e) || handleSetupClick(e) || handleRestockClick(e) || handleSetClick(e)) return;
    const t = e.target.closest(".meal-chip,[data-take-all],[data-take-section],#autoToggle,#autoSet,[data-take],[data-skip],[data-undo],[data-edit-item],[data-adopt],[data-edit-product],[data-close-sheet],[data-delete-item],[data-delete-product],[data-photo-clear],[data-import-remove],.day-chip,#importParse,#importSave,#rotEdit,#rotStart,#cyStock,#cyNext,#cyReset,#cyConfirm,[data-restock],[data-goto],[data-pick-product],[data-inv-edit]");
    if (!t) return;
    if (t.classList.contains("meal-chip")) {
      t.classList.toggle("on");
      t.setAttribute("aria-pressed", t.classList.contains("on"));
    } else if ("takeAll" in t.dataset) takePending(null);
    else if (t.dataset.takeSection) takePending(t.dataset.takeSection);
    else if (t.id === "autoToggle") openAutoSheet();
    else if (t.id === "autoSet") setAutoMode(t.dataset.on === "1");
    else if (t.dataset.take) setStatus(t.dataset.take, "TAKEN");
    else if (t.dataset.skip) setStatus(t.dataset.skip, "SKIPPED");
    else if (t.dataset.undo) setStatus(t.dataset.undo, null);
    else if (t.dataset.editItem) openItemSheet(t.dataset.editItem);
    else if (t.dataset.adopt) openItemSheet(null, t.dataset.adopt);
    else if (t.dataset.editProduct) openProductSheet(t.dataset.editProduct);
    else if ("closeSheet" in t.dataset) closeSheet();
    else if (t.dataset.deleteItem) {
      if (!confirm("이 영양제를 추가 영양제에서 뺄까요? 재고 개수는 그대로 남아요.")) return;
      deleteDoc(doc(db, "users", state.user.uid, "items", t.dataset.deleteItem)).then(() => { closeSheet(); toast("삭제했어요."); }, fail);
    } else if (t.dataset.deleteProduct) {
      if (!confirm("공용 목록에서 삭제하면 모든 사용자에게서 사라져요. 삭제할까요?")) return;
      deleteDoc(doc(db, "products", t.dataset.deleteProduct)).then(() => { closeSheet(); toast("공용 목록에서 삭제했어요."); }, fail);
    } else if ("photoClear" in t.dataset) {
      sheetPhoto = null;
      $("#photoPreview").innerHTML = "<span>사진 없음</span>";
      t.remove();
    } else if (t.dataset.importRemove) {
      importRows.splice(parseInt(t.dataset.importRemove, 10), 1);
      renderImportRows();
    } else if (t.classList.contains("day-chip")) {
      t.classList.toggle("on");
      t.setAttribute("aria-pressed", t.classList.contains("on"));
    } else if (t.id === "importParse") parseImport();
    else if (t.id === "importSave") saveImport();
    else if (t.id === "rotEdit") openRotationEditor();
    else if (t.id === "rotStart") startFirstCycle();
    else if (t.id === "cyStock") openStockSheet();
    else if ("restock" in t.dataset) openRestockSheet(t.dataset.restock || undefined);
    else if (t.dataset.goto) switchTab(t.dataset.goto);
    else if (t.dataset.pickProduct) openItemSheet(null, t.dataset.pickProduct);
    else if (t.dataset.invEdit) openInventoryEdit([t.dataset.invEdit]);
    else if (t.id === "cyNext") openCycleSetup(nextCycle(state.plan, state.cycle).methodIndex);
    else if (t.id === "cyReset") resetCycle();
    else if (t.id === "cyConfirm") confirmCycle();
  });

  document.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "itemForm") saveItemForm(e.target);
    else if (e.target.id === "productForm") saveProductForm(e.target);
    else if (e.target.id === "planForm") savePlan();
    else if (e.target.id === "stockForm") saveStock(e.target);
    else if (e.target.id === "restockForm") saveRestock();
    else if (e.target.id === "setForm") saveSet();
    else if (e.target.id === "setAddForm") saveSetAdd(e.target);
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (handleEditorChange(t) || handleRestockChange(t)) return;
    if (t.matches("[data-photo-input]")) {
      handlePhotoInput(t, (data) => {
        sheetPhoto = data;
        $("#photoPreview").innerHTML = `<img alt="" src="${data}">`;
      });
    } else if (t.id === "shotFile") {
      handleShotFiles(t.files);
      t.value = "";
    } else if (t.matches("[data-import-photo]")) {
      const i = parseInt(t.dataset.importPhoto, 10);
      handlePhotoInput(t, (data) => { importRows[i].photo = data; renderImportRows(); });
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (handleEditorInput(t) || handleSetInput(t)) return;
    if (t.id === "pickSearch") renderProductPicker(t.value);
    else if (t.dataset.imp) {
      const row = importRows[parseInt(t.closest(".import-row").dataset.index, 10)];
      row[t.dataset.imp] = t.dataset.imp === "count" ? (parseInt(t.value, 10) || null) : t.value;
      if (t.dataset.imp === "name") t.classList.toggle("need", !!row.needsName && !t.value.trim());
    }
  });

  $("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#scrim").hidden) closeSheet(); });
}

// ---------- boot ----------
function boot() {
  if (!isConfigured) { showScreen("screenSetup"); return; }
  initFirebase();
  wire();
  renderLogin();
  try { const t = localStorage.getItem("tab"); if (t) state.tab = t; } catch { /* ignore */ }
  watchAuth((user) => {
    unsubscribeAll();
    state.user = user;
    state.adminUids = null;
    state.products = []; state.sets = []; state.items = []; state.logs = {}; state.plan = null; state.planLoaded = false; state.cycle = null; state.cycleLoaded = false;
    state.itemsLoaded = false; state.inventory = {}; state.inventoryLoaded = false; state.logsLoaded = false; state.settings = null;
    historyState.logs = null; historyState.loadedAt = 0; historyState.loading = false;
    migrated = false;
    if (!user) { closeSheet(); showScreen("screenLogin"); return; }
    showScreen("screenApp");
    switchTab(state.tab);
    subscribe(user.uid);
  });
  setInterval(checkReminders, 20000);
  setInterval(() => { if (state.user) { renderHeader(); renderToday(); runAutoFill(); } }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.user) { renderHeader(); renderToday(); runAutoFill(); } });
  if ("serviceWorker" in navigator && !useEmulator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
