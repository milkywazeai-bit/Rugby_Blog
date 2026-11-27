import {
  collection, doc, onSnapshot, query, where, addDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, increment, writeBatch
} from "firebase/firestore";
import {
  initFirebase, isConfigured, useEmulator, watchAuth, signInWithGoogle, signInTestUser, logOut, db
} from "./firebase.js";
import { parseIherbLinks, findUnsupportedLinks, iherbSearchUrl, describeAmount, isIherbUrl } from "./iherb.js";
import { compressPhoto, isSafePhoto } from "./photo.js";
import {
  defaultPlan, validPlan, methodIndexOf, nextCycle, dailyUse, remaining, cycleStatus, itemsFromPicks, defaultPicks
} from "./rotation.js";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const CAPSULE_PAIRS = [
  ["#2F6F4F", "#DDEAE1"], ["#A5701F", "#F3E5CB"], ["#A24632", "#F2DFD8"],
  ["#3E5C8A", "#DDE6F2"], ["#7A4E8C", "#EADFF0"]
];
const state = {
  user: null,
  adminUids: null,
  products: [],
  items: [],
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
function todayItems() {
  const day = epochDay();
  const dow = isoDowOfEpochDay(day);
  return state.items
    .filter((it) => Array.isArray(it.days) && it.days.includes(dow))
    .map((it) => ({ item: it, status: state.logs[day + "_" + it.id] || "PENDING" }))
    .sort((a, b) => a.item.timeMinutes - b.item.timeMinutes);
}

function adherence() {
  const today = epochDay();
  let taken = 0, total = 0;
  for (let day = today - 6; day <= today; day++) {
    const dow = isoDowOfEpochDay(day);
    for (const it of state.items) {
      if (!Array.isArray(it.days) || !it.days.includes(dow)) continue;
      if (typeof it.createdDay === "number" && day < it.createdDay) continue;
      total++;
      if (state.logs[day + "_" + it.id] === "TAKEN") taken++;
    }
  }
  return total ? taken / total : 0;
}

function sectionKey(mins) {
  if (mins < 11 * 60) return "morning";
  if (mins < 17 * 60) return "afternoon";
  if (mins < 21 * 60) return "evening";
  return "night";
}

function renderHeader() {
  const d = new Date();
  $("#todayLabel").textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${"일월화수목금토"[d.getDay()]}요일`;
  const rate = adherence();
  const c = 2 * Math.PI * 24;
  $("#ringProgress").setAttribute("stroke-dasharray", c.toFixed(1));
  $("#ringProgress").setAttribute("stroke-dashoffset", (c * (1 - rate)).toFixed(1));
  $("#ringPct").textContent = Math.round(rate * 100) + "%";
}

function renderToday() {
  const list = todayItems();
  const box = $("#todayList");
  if (!state.items.length) {
    box.innerHTML = `<div class="empty"><strong>아직 등록한 영양제가 없어요.</strong><br>
      <span>"제품" 탭에서 골라 담거나, 아래 + 버튼으로 직접 추가하세요.</span></div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty">오늘은 먹을 영양제가 없는 요일이에요.</div>`;
    return;
  }
  const labels = { morning: "아침", afternoon: "낮", evening: "저녁", night: "밤" };
  const groups = { morning: [], afternoon: [], evening: [], night: [] };
  list.forEach((x) => groups[sectionKey(x.item.timeMinutes)].push(x));
  let html = "";
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    if (!g.length) continue;
    html += `<section class="section"><div class="section-head"><span class="label">${labels[key]}</span><span class="count">${g.length}</span></div>`;
    for (const { item, status } of g) {
      const low = item.stockCount <= item.lowStockThreshold ? `<span class="chip low">재고 ${esc(item.stockCount)}개</span>` : "";
      let actions;
      if (status === "TAKEN") actions = `<button class="chip taken" data-undo="${esc(item.id)}" title="되돌리기">완료 ✓</button>`;
      else if (status === "SKIPPED") actions = `<button class="chip skipped" data-undo="${esc(item.id)}" title="되돌리기">건너뜀</button>`;
      else actions = `<div class="item-actions"><button class="btn-take" data-take="${esc(item.id)}">완료</button><button class="btn-skip" data-skip="${esc(item.id)}">건너뛰기</button></div>`;
      html += `<div class="item">
        ${thumbHtml(item.name, photoFor(item))}
        <button class="item-body" data-edit-item="${esc(item.id)}">
          <span class="item-name">${esc(item.name)}</span>
          <span class="item-meta"><span>${fmtTime(item.timeMinutes)}</span><span>${esc(item.dosage)}</span>${low}</span>
        </button>
        ${actions}
      </div>`;
    }
    html += `</section>`;
  }
  box.innerHTML = html;
}

async function setStatus(itemId, status) {
  const uid = state.user.uid;
  const day = epochDay();
  const key = day + "_" + itemId;
  const prev = state.logs[key];
  const item = state.items.find((x) => x.id === itemId);
  try {
    const batch = writeBatch(db);
    const logRef = doc(db, "users", uid, "logs", key);
    const itemRef = doc(db, "users", uid, "items", itemId);
    if (status === null) {
      batch.delete(logRef);
      if (prev === "TAKEN") batch.update(itemRef, { stockCount: increment(1) });
    } else {
      batch.set(logRef, { day, itemId, status, at: serverTimestamp() });
      if (status === "TAKEN" && prev !== "TAKEN" && item && item.stockCount > 0) batch.update(itemRef, { stockCount: increment(-1) });
      if (status !== "TAKEN" && prev === "TAKEN") batch.update(itemRef, { stockCount: increment(1) });
    }
    await batch.commit();
  } catch (e) { fail(e); }
}

// ---------- products ----------
function renderProducts() {
  const admin = isAdmin();
  $("#productsAdminNote").hidden = !admin;
  const q = state.productQuery.trim().toLowerCase();
  const list = state.products.filter((p) => !q || (p.name + " " + (p.brand || "")).toLowerCase().includes(q));
  const box = $("#productGrid");
  if (!state.products.length) {
    box.innerHTML = admin
      ? `<div class="empty"><strong>공용 제품 목록이 비어 있어요.</strong><br><span>아래 + 버튼을 눌러 아이허브 링크를 붙여넣으면 한 번에 추가돼요.</span></div>`
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
          ${mine ? `<span class="chip taken">내 스케줄에 있음</span>` : `<button class="btn-small primary" data-adopt="${esc(p.id)}">내 스케줄에 추가</button>`}
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

function slotHtml(slot) {
  const prods = (slot.options || []).map(productById).filter(Boolean);
  const choose = prods.length > 1;
  const cards = prods.length
    ? prods.map((p) => `<a class="opt" href="${esc(safeIherbUrl(p.url, productLabel(p)))}" target="_blank" rel="noopener">
        ${thumbHtml(p.name, isSafePhoto(p.photo) ? p.photo : null, "opt-photo")}
        <span class="opt-text">${p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}<span class="opt-name">${esc(p.name)}</span></span>
      </a>`).join("")
    : `<span class="opt-missing">연결된 제품이 없어요${isAdmin() ? " — 사이클 구성 편집에서 골라주세요" : ""}</span>`;
  return `<div class="slot">
    <div class="slot-head"><span class="slot-label">${esc(slot.label)}</span>${choose ? `<span class="chip pick">${prods.length}개 중 택1</span>` : ""}<span class="slot-amount">${esc(slot.amount || "")}</span></div>
    <div class="opts${choose ? " scroll" : ""}">${cards}</div>
  </div>`;
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
      ? "사이클을 고르고 택1 제품을 정하면 오늘부터 시작돼요."
      : "관리자가 아직 사이클 구성을 만들지 않았어요.";
    return;
  }
  const today = epochDay();
  const st = cycleStatus(cycle, today);
  const use = dailyUse(cycle.items);
  const mealList = (meal) => (cycle.items || []).filter((it) => it.meal === meal).map((it) => {
    const left = remaining((cycle.stock || {})[it.productId], use[it.productId], today);
    const low = left !== null && left <= use[it.productId] * 3;
    return `<div class="cy-item"><div class="cy-label">${esc(it.label)}<span class="slot-amount">${esc(it.amount)}</span></div>
      ${productRow(it.productId, left === null ? "" : `<span class="cy-left${low ? " low" : ""}">남은 약 ${left}개</span>`)}</div>`;
  }).join("") || `<p class="mc-note">없음</p>`;
  const mainName = st.main ? (productById(st.main.productId)?.name || st.main.label) : "";
  const ending = st.daysLeft === null ? ""
    : st.daysLeft <= 0
      ? `<div class="cy-alert">${esc(mainName)}이(가) 다 떨어졌을 거예요. 다음 사이클을 시작하세요.</div>`
      : `<p class="mc-note">${esc(mainName)} 기준 약 ${st.daysLeft}일 남았어요 · ${fmtDay(st.endDay)}쯤 다음 사이클로 넘어가요</p>`;
  $("#rotNow").innerHTML = `<div class="month-card now">
    <div class="mc-when">지금 사이클 <span class="chip code">${esc(cycleCode(cycle))}</span><span class="cy-days">${fmtDay(cycle.startDay)} 시작 · ${st.day}일째</span></div>
    <div class="mc-title">${esc(cycle.title)}${cycle.subtitle ? ` <span class="mc-sub">${esc(cycle.subtitle)}</span>` : ""}</div>
    ${ending}
    <div class="meal"><div class="meal-head">점심 먹고</div>${mealList("lunch")}</div>
    <div class="meal"><div class="meal-head">저녁 먹고</div>${mealList("dinner")}</div>
    <div class="cy-actions"><button class="btn-small" id="cyStock" type="button">보유 개수 수정</button>
      ${plan ? `<button class="btn-small primary" id="cyNext" type="button">다음 사이클 시작</button>` : ""}</div>
  </div>`;
  if (plan) {
    const n = nextCycle(plan, cycle);
    const m = plan.methods[n.methodIndex];
    $("#rotNext").innerHTML = `<div class="month-card">
      <div class="mc-when">다음 사이클 미리보기 <span class="chip code">${n.methodIndex + 1}-${n.round}</span></div>
      <div class="mc-title">${esc(m.title)}${m.subtitle ? ` <span class="mc-sub">${esc(m.subtitle)}</span>` : ""}</div>
      <div class="meal"><div class="meal-head">점심 먹고</div>${m.lunch.map(slotHtml).join("")}</div>
      <div class="meal"><div class="meal-head">저녁 먹고</div>${m.dinner.map(slotHtml).join("")}</div>
    </div>`;
  } else {
    $("#rotNext").innerHTML = "";
  }
}

// ----- start / next cycle sheet -----
let setup = null;

function openCycleSetup(methodIndex) {
  setup = { step: methodIndex === undefined ? 1 : 2, methodIndex, picks: null, stock: {} };
  if (setup.step === 2) preparePicks();
  openSheet(state.cycle ? "다음 사이클 시작" : "나의 사이클 추가하기", `<div id="cycleSetup"></div>`);
  renderCycleSetup();
}

function preparePicks() {
  const prevIds = (state.cycle?.items || []).map((it) => it.productId);
  setup.picks = defaultPicks(state.plan.methods[setup.methodIndex], prevIds);
}

function stockDefault(pid) {
  if (setup.stock[pid] !== undefined) return setup.stock[pid];
  const cy = state.cycle;
  if (cy && cy.stock && cy.stock[pid]) return remaining(cy.stock[pid], dailyUse(cy.items)[pid], epochDay());
  const p = productById(pid);
  return p && p.count ? p.count : 30;
}

function renderCycleSetup(keepScroll = true) {
  const box = $("#cycleSetup");
  if (!box || !setup) return;
  const sheet = $(".sheet");
  const scroll = keepScroll ? sheet.scrollTop : 0;
  const plan = state.plan;
  if (setup.step === 1) {
    box.innerHTML = `<p class="hint">어떤 사이클로 시작할까요? 고른 사이클이 끝나면 다음 사이클로 순서대로 넘어가요.</p>` +
      plan.methods.map((m, i) => {
        const ids = [...new Set([...m.lunch, ...m.dinner].flatMap((s) => s.options || []))].slice(0, 8);
        return `<button type="button" class="cy-choice" data-cy-method="${i}">
          <span class="cy-choice-head"><span class="chip code">${i + 1}</span><strong>${esc(m.title)}</strong><span class="mc-sub">${esc(m.subtitle || "")}</span></span>
          <span class="cy-thumbs">${ids.map((id) => { const p = productById(id); return thumbHtml(p ? p.name : "?", p && isSafePhoto(p.photo) ? p.photo : null, "cy-thumb"); }).join("")}</span>
          <span class="mc-note">점심: ${m.lunch.map((s) => esc(s.label)).join(", ")}<br>저녁: ${m.dinner.map((s) => esc(s.label)).join(", ")}</span>
        </button>`;
      }).join("");
    sheet.scrollTop = 0;
    return;
  }
  const m = plan.methods[setup.methodIndex];
  const slotPicker = (slot, meal, i) => {
    const key = `${meal}:${i}`;
    const cur = setup.picks[key];
    const opts = slot.options || [];
    const multi = opts.length > 1;
    const excluded = cur === null;
    const optBtns = opts.map((id) => {
      const p = productById(id);
      const name = p ? p.name : "삭제된 제품";
      return `<button type="button" class="opt pickable${cur === id ? " on" : ""}" data-cy-pick="${key}" data-pid="${esc(id)}"${p ? "" : " disabled"} aria-pressed="${cur === id}">
        ${thumbHtml(name, p && isSafePhoto(p.photo) ? p.photo : null, "opt-photo")}
        <span class="opt-text">${p && p.brand ? `<span class="opt-brand">${esc(p.brand)}</span>` : ""}<span class="opt-name">${esc(name)}</span></span>
        <span class="tick" aria-hidden="true"></span></button>`;
    }).join("");
    return `<div class="slot cy-slot${excluded ? " excluded" : ""}${multi && cur === "" ? " need" : ""}" data-slot="${key}">
      <div class="slot-head"><span class="slot-label">${esc(slot.label)}</span>${multi && !excluded ? `<span class="chip pick">${opts.length}개 중 택1</span>` : ""}<span class="slot-amount">${esc(slot.amount || "")}</span>
        <button type="button" class="link-btn" data-cy-exclude="${key}">${excluded ? "다시 넣기" : "빼기"}</button></div>
      ${excluded ? `<p class="mc-note">이번 사이클에서는 안 먹어요</p>` : `<div class="opts">${optBtns}</div>`}
    </div>`;
  };
  const items = itemsFromPicks(m, setup.picks);
  const pids = [...new Set(items.map((it) => it.productId))];
  const use = dailyUse(items);
  box.innerHTML = `<div class="cy-setup-head"><span class="chip code">${setup.methodIndex + 1}</span><strong>${esc(m.title)}</strong><span class="mc-sub">${esc(m.subtitle || "")}</span>
      <button type="button" class="link-btn" data-cy-back>다른 사이클 고르기</button></div>
    <div class="meal"><div class="meal-head">점심 먹고</div>${m.lunch.map((s, i) => slotPicker(s, "lunch", i)).join("")}</div>
    <div class="meal"><div class="meal-head">저녁 먹고</div>${m.dinner.map((s, i) => slotPicker(s, "dinner", i)).join("")}</div>
    <div class="meal"><div class="meal-head">지금 가지고 있는 개수</div>
      <p class="hint">이미 먹고 있던 제품은 남은 개수로 고쳐주세요. 새 통이면 그대로 두면 돼요.</p>
      ${pids.map((pid) => `<div class="cy-stock">${productRow(pid)}
        <label class="cy-stock-in"><input type="number" min="0" inputmode="numeric" data-cy-stock="${esc(pid)}" value="${esc(stockDefault(pid))}" aria-label="보유 개수"><span>개<br>하루 ${use[pid]}개</span></label></div>`).join("")
        || `<p class="mc-note">고른 제품이 없어요.</p>`}
    </div>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button>
      <button type="button" class="btn-primary" id="cyConfirm">사이클 확정 — 오늘(${fmtDay(epochDay())})부터</button></div>`;
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
    setup.picks[t.dataset.cyPick] = t.dataset.pid;
    renderCycleSetup();
  } else if (t.dataset.cyExclude) {
    const key = t.dataset.cyExclude;
    if (setup.picks[key] === null) {
      const [meal, i] = key.split(":");
      const opts = state.plan.methods[setup.methodIndex][meal][parseInt(i, 10)].options || [];
      setup.picks[key] = opts.length === 1 ? opts[0] : "";
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
  if (!items.length) { toast("최소 한 가지 제품은 있어야 해요."); return; }
  const today = epochDay();
  const stock = {};
  for (const pid of new Set(items.map((it) => it.productId))) {
    stock[pid] = { count: Math.max(0, parseInt(stockDefault(pid), 10) || 0), day: today };
  }
  const prev = state.cycle;
  let round = 1;
  if (prev) {
    const prevIdx = methodIndexOf(plan, prev);
    round = setup.methodIndex <= prevIdx ? (prev.round || 1) + 1 : (prev.round || 1);
  }
  const history = prev
    ? [...(prev.history || []).slice(-23), { methodId: prev.methodId, title: prev.title, round: prev.round || 1, startDay: prev.startDay, endDay: today }]
    : [];
  try {
    await setDoc(doc(db, "users", state.user.uid, "meta", "cycle"), {
      methodId: m.id, methodIndex: setup.methodIndex, title: m.title, subtitle: m.subtitle || "",
      round, startDay: today, items, stock, history, updatedAt: serverTimestamp()
    });
    setup = null;
    closeSheet();
    toast(prev ? "다음 사이클을 시작했어요. 오늘이 1일째예요." : "사이클을 시작했어요. 오늘이 1일째예요.");
  } catch (e) { fail(e); }
}

function openStockSheet() {
  const cy = state.cycle;
  const today = epochDay();
  const use = dailyUse(cy.items);
  const pids = [...new Set((cy.items || []).map((it) => it.productId))];
  openSheet("보유 개수 수정", `<form id="stockForm">
    <p class="hint">지금 실제로 남아 있는 개수를 적어주세요. 오늘부터 다시 계산해요.</p>
    ${pids.map((pid) => `<div class="cy-stock">${productRow(pid)}
      <label class="cy-stock-in"><input type="number" min="0" inputmode="numeric" name="${esc(pid)}" value="${esc(remaining(cy.stock?.[pid], use[pid], today) ?? "")}" aria-label="보유 개수"><span>개<br>하루 ${use[pid]}개</span></label></div>`).join("")}
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button><button type="submit" class="btn-primary">저장</button></div>
  </form>`);
}

async function saveStock(form) {
  const today = epochDay();
  const stock = { ...(state.cycle.stock || {}) };
  form.querySelectorAll("input[type=number]").forEach((inp) => {
    if (inp.value !== "") stock[inp.name] = { count: Math.max(0, parseInt(inp.value, 10) || 0), day: today };
  });
  try {
    await updateDoc(doc(db, "users", state.user.uid, "meta", "cycle"), { stock });
    closeSheet();
    toast("보유 개수를 고쳤어요.");
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
      <div class="ps-opts">${(slot.options || []).map((id) => {
        const p = productById(id);
        return `<span class="ps-chip${p ? "" : " gone"}">${esc(p ? productLabel(p) : "삭제된 제품")}<button type="button" data-opt-del="${esc(id)}" aria-label="빼기">✕</button></span>`;
      }).join("")}</div>
      <select data-opt-add aria-label="제품 추가"><option value="">+ 제품 추가${(slot.options || []).length ? " (2개 이상이면 택1)" : ""}</option>${optionList}</select>
    </div>`;
  box.innerHTML = `<form id="planForm">
    <p class="hint">모든 사용자가 사이클을 고를 때 보는 구성이에요. 첫 번째 점심 칸이 사이클의 주인공이라, 이 제품이 떨어지면 다음 사이클로 넘어가요. 이미 진행 중인 사이클은 그대로이고 다음 사이클부터 반영돼요.</p>
    ${draftPlan.methods.map((m, mi) => `<section class="pm" data-m="${mi}">
      <div class="pm-head"><span class="chip code">${mi + 1}</span>
        <input data-pm="title" value="${esc(m.title)}" placeholder="섭취법 ${mi + 1}" aria-label="사이클 이름">
        <input data-pm="subtitle" value="${esc(m.subtitle || "")}" placeholder="설명 (예: 가든 유산균)" aria-label="설명"></div>
      ${["lunch", "dinner"].map((meal) => `<div class="pm-meal"><div class="meal-head">${meal === "lunch" ? "점심 먹고" : "저녁 먹고"}</div>
        ${m[meal].map((slot, si) => slotEditor(slot, mi, meal, si)).join("")}
        <button type="button" class="btn-small" data-slot-add="${meal}" data-m="${mi}">+ 칸 추가</button></div>`).join("")}
      ${draftPlan.methods.length > 1 ? `<button type="button" class="btn-danger-text" data-method-del="${mi}">${esc(m.title || "이 사이클")} 삭제</button>` : ""}
    </section>`).join("")}
    <button type="button" class="rot-add" data-method-add>+ 사이클 추가</button>
    <div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button>
      <button type="submit" class="btn-primary">저장 — 모든 사용자에게 적용</button></div>
  </form>`;
  sheet.scrollTop = scroll;
}

function editorTarget(el) {
  const ps = el.closest(".ps");
  const mi = parseInt((ps || el.closest("[data-m]")).dataset.m, 10);
  const method = draftPlan.methods[mi];
  const slot = ps ? method[ps.dataset.meal][parseInt(ps.dataset.s, 10)] : null;
  return { mi, method, ps, slot };
}

function handleEditorClick(e) {
  if (!draftPlan || !e.target.closest("#planEditor")) return false;
  const t = e.target.closest("[data-ps-del],[data-opt-del],[data-slot-add],[data-method-del],[data-method-add]");
  if (!t) return false;
  if ("methodAdd" in t.dataset) {
    const n = draftPlan.methods.length + 1;
    draftPlan.methods.push({ id: "m" + Date.now().toString(36), title: "섭취법 " + n, subtitle: "", lunch: [], dinner: [] });
  } else if (t.dataset.methodDel) {
    if (!confirm("이 사이클을 삭제할까요? 저장하기 전까지는 적용되지 않아요.")) return true;
    draftPlan.methods.splice(parseInt(t.dataset.methodDel, 10), 1);
  } else if (t.dataset.slotAdd) {
    const { method } = editorTarget(t);
    method[t.dataset.slotAdd].push({ label: "", options: [], amount: "1캡슐" });
  } else {
    const { method, ps, slot } = editorTarget(t);
    if ("psDel" in t.dataset) method[ps.dataset.meal].splice(parseInt(ps.dataset.s, 10), 1);
    else if (t.dataset.optDel) slot.options = slot.options.filter((id) => id !== t.dataset.optDel);
  }
  renderRotationEditor();
  return true;
}

function handleEditorChange(t) {
  if (!draftPlan || !t.closest("#planEditor")) return false;
  if (t.matches("[data-opt-add]") && t.value) {
    const { slot } = editorTarget(t);
    if (!slot.options.includes(t.value)) slot.options.push(t.value);
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
  if (t.dataset.ps) { editorTarget(t).slot[t.dataset.ps] = t.value; return true; }
  return false;
}

async function savePlan() {
  const plan = { methods: draftPlan.methods };
  plan.methods.forEach((m) => {
    m.title = (m.title || "").trim() || "섭취법";
    ["lunch", "dinner"].forEach((meal) => {
      m[meal] = m[meal].filter((s) => (s.label || "").trim() || s.options.length)
        .map((s) => ({ label: (s.label || "").trim() || "이름 없음", options: s.options, amount: (s.amount || "").trim() }));
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

// ---------- me ----------
function renderMe() {
  const u = state.user;
  $("#meName").textContent = u.displayName || "이름 없음";
  $("#meEmail").textContent = u.email || "";
  const admin = isAdmin();
  const noAdmin = state.adminUids !== null && state.adminUids.length === 0;
  $("#meRole").textContent = admin ? "관리자 — 공용 제품 목록을 수정할 수 있어요" : "사용자 — 공용 목록을 보고 내 스케줄에 담을 수 있어요";
  $("#claimAdmin").hidden = !noAdmin;
  const notify = localStorage.getItem("notify") === "1" && "Notification" in window && Notification.permission === "granted";
  $("#notifyBtn").textContent = notify ? "알림 끄기" : "알림 켜기";
  $("#notifyState").textContent = notify ? "켜짐 — 이 앱이 열려 있는 동안 복용 시간에 알려드려요." : "꺼짐";
}

function renderAll() {
  if (!state.user) return;
  renderHeader();
  renderToday();
  renderProducts();
  renderRotation();
  renderMe();
  $("#fab").hidden = !(state.tab === "today" || state.tab === "products");
  $("#fab").setAttribute("aria-label", state.tab === "products" ? "아이허브 링크로 추가" : "영양제 직접 추가");
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  try { localStorage.setItem("tab", tab); } catch { /* private mode */ }
  renderAll();
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

function openItemSheet(itemId, fromProductId) {
  const it = itemId ? state.items.find((x) => x.id === itemId) : null;
  const prod = productById(fromProductId || (it && it.productId));
  const base = it || {
    name: prod ? prod.name : "",
    dosage: prod ? describeAmount(prod) : "",
    stockCount: prod && prod.count ? prod.count : 30,
    lowStockThreshold: 5,
    timeMinutes: 8 * 60,
    days: [1, 2, 3, 4, 5, 6, 7],
    productId: prod ? prod.id : null,
    photo: null
  };
  sheetPhoto = isSafePhoto(base.photo) ? base.photo : null;
  const usesProductPhoto = prod && isSafePhoto(prod.photo);
  openSheet(it ? "영양제 수정" : "영양제 추가", `
    <form id="itemForm" data-id="${esc(itemId || "")}" data-product="${esc(base.productId || "")}">
      ${usesProductPhoto
        ? `<div class="photo-field"><div class="photo-preview"><img alt="" src="${prod.photo}"></div><p class="hint">공용 제품 목록의 사진을 쓰고 있어요.</p></div>`
        : photoPicker(sheetPhoto, "직접 찍은 영양제 통 사진을 추천해요. 이 사진은 나만 볼 수 있어요.")}
      <div class="field"><label for="fName">이름</label>
        <input id="fName" required maxlength="80" value="${esc(base.name)}" placeholder="예: 오메가3">
        <a class="iherb-link" id="fNameIherb" target="_blank" rel="noopener" href="${esc(prod ? safeIherbUrl(prod.url, prod.name) : safeIherbUrl(base.url, base.name))}">아이허브에서 보기 →</a>
      </div>
      <div class="field"><label for="fDosage">용량 / 설명</label>
        <input id="fDosage" maxlength="80" value="${esc(base.dosage)}" placeholder="예: 1,000 mg · 1캡슐"></div>
      <div class="row2">
        <div class="field"><label for="fStock">현재 재고</label><input id="fStock" type="number" min="0" inputmode="numeric" value="${esc(base.stockCount)}"></div>
        <div class="field"><label for="fLow">부족 알림 기준</label><input id="fLow" type="number" min="0" inputmode="numeric" value="${esc(base.lowStockThreshold)}"></div>
      </div>
      <div class="field"><label for="fTime">복용 시간</label><input id="fTime" type="time" value="${fmtTime(base.timeMinutes)}"></div>
      <div class="field"><span class="label-like">요일</span>
        <div class="days">${DAY_LABELS.map((l, i) => `<button type="button" class="day-chip ${base.days.includes(i + 1) ? "on" : ""}" data-day="${i + 1}" aria-pressed="${base.days.includes(i + 1)}">${l}</button>`).join("")}</div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn-secondary" data-close-sheet>취소</button>
        <button type="submit" class="btn-primary">저장</button>
      </div>
      ${it ? `<button type="button" class="btn-danger-text" data-delete-item="${esc(it.id)}">이 영양제 삭제</button>` : ""}
    </form>`);
}

async function saveItemForm(form) {
  const name = $("#fName").value.trim();
  if (!name) { $("#fName").focus(); return; }
  const days = [...form.querySelectorAll(".day-chip.on")].map((b) => parseInt(b.dataset.day, 10));
  if (!days.length) { toast("요일을 하나 이상 골라주세요."); return; }
  const [hh, mm] = ($("#fTime").value || "08:00").split(":").map(Number);
  const data = {
    name,
    dosage: $("#fDosage").value.trim(),
    stockCount: Math.max(0, parseInt($("#fStock").value, 10) || 0),
    lowStockThreshold: Math.max(0, parseInt($("#fLow").value, 10) || 0),
    timeMinutes: (hh || 0) * 60 + (mm || 0),
    days,
    productId: form.dataset.product || null,
    photo: form.dataset.product && productById(form.dataset.product)?.photo ? null : sheetPhoto
  };
  const uid = state.user.uid;
  try {
    if (form.dataset.id) {
      await updateDoc(doc(db, "users", uid, "items", form.dataset.id), data);
    } else {
      await addDoc(collection(db, "users", uid, "items"), { ...data, createdDay: epochDay(), createdAt: serverTimestamp() });
    }
    closeSheet();
    toast("저장했어요.");
  } catch (e) { fail(e); }
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
        ${r.duplicate ? `<span class="chip low">이미 목록에 있어요 — 건너뜀</span>` : ""}
      </div>
      <button type="button" class="rot-del" data-import-remove="${i}" aria-label="빼기">✕</button>
    </div>`).join("") +
    `<div class="sheet-actions"><button type="button" class="btn-secondary" data-close-sheet>취소</button>
      <button type="button" class="btn-primary" id="importSave">${admin ? "공용 목록에 저장" : "내 스케줄에 추가"} (${importRows.filter((r) => !r.duplicate).length}개)</button></div>
    ${admin ? `<label class="check"><input type="checkbox" id="importAlsoMine" checked> 내 스케줄에도 추가 (매일 08:00, 나중에 수정 가능)</label>` : ""}`;
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
  if (!rows.length) { toast("저장할 제품이 없어요."); return; }
  const alsoMine = admin && $("#importAlsoMine") && $("#importAlsoMine").checked;
  const uid = state.user.uid;
  try {
    const batch = writeBatch(db);
    for (const r of rows) {
      const product = {
        name: r.name.trim(), brand: (r.brand || "").trim(), dose: (r.dose || "").trim(),
        count: r.count || null, form: r.form || "", volume: r.volume || "",
        url: r.url, iherbId: r.iherbId, photo: r.photo || null
      };
      let productId = null;
      if (admin) {
        const ref = doc(collection(db, "products"));
        productId = ref.id;
        batch.set(ref, { ...product, createdBy: uid, createdAt: serverTimestamp() });
      }
      if (!admin || alsoMine) {
        batch.set(doc(collection(db, "users", uid, "items")), {
          name: product.name,
          dosage: describeAmount(product),
          stockCount: product.count || 30,
          lowStockThreshold: 5,
          timeMinutes: 8 * 60,
          days: [1, 2, 3, 4, 5, 6, 7],
          productId,
          iherbId: product.iherbId,
          url: product.url,
          photo: admin ? null : product.photo,
          createdDay: epochDay(),
          createdAt: serverTimestamp()
        });
      }
    }
    await batch.commit();
    closeSheet();
    toast(`${rows.length}개를 저장했어요.`);
  } catch (e) { fail(e); }
}

// ---------- notifications (while the app is open) ----------
function checkReminders() {
  if (!state.user || localStorage.getItem("notify") !== "1") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const day = epochDay(now);
  for (const { item, status } of todayItems()) {
    if (status !== "PENDING" || item.timeMinutes !== mins) continue;
    const key = "notified_" + day + "_" + item.id;
    if (localStorage.getItem(key)) continue;
    localStorage.setItem(key, "1");
    try { new Notification("복용 시간이에요", { body: `${item.name} ${item.dosage ? "(" + item.dosage + ")" : ""}`, icon: "icons/icon-192.png" }); } catch { /* some mobile browsers only allow SW notifications */ }
  }
}

// ---------- data subscriptions ----------
function subscribe(uid) {
  const today = epochDay();
  unsubs.push(onSnapshot(doc(db, "config", "admins"), (s) => {
    state.adminUids = s.exists() && Array.isArray(s.data().uids) ? s.data().uids : [];
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(collection(db, "products"), (s) => {
    state.products = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.brand + a.name).localeCompare(b.brand + b.name, "ko"));
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(collection(db, "users", uid, "items"), (s) => {
    state.items = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(query(collection(db, "users", uid, "logs"), where("day", ">=", today - 6)), (s) => {
    const logs = {};
    s.docs.forEach((d) => { const v = d.data(); logs[v.day + "_" + v.itemId] = v.status; });
    state.logs = logs;
    renderAll();
  }, fail));
  unsubs.push(onSnapshot(doc(db, "config", "rotation"), (s) => {
    state.plan = s.exists() && validPlan(s.data()) ? s.data() : null;
    state.planLoaded = true;
    renderRotation();
  }, fail));
  unsubs.push(onSnapshot(doc(db, "users", uid, "meta", "cycle"), (s) => {
    state.cycle = s.exists() ? s.data() : null;
    state.cycleLoaded = true;
    renderRotation();
  }, fail));
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
  $("#fab").addEventListener("click", () => (state.tab === "products" ? openImportSheet() : openItemSheet(null, null)));
  $("#logout").addEventListener("click", () => logOut());
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
    }
    renderMe();
  });

  document.addEventListener("click", (e) => {
    if (handleEditorClick(e) || handleSetupClick(e)) return;
    const t = e.target.closest("[data-take],[data-skip],[data-undo],[data-edit-item],[data-adopt],[data-edit-product],[data-close-sheet],[data-delete-item],[data-delete-product],[data-photo-clear],[data-import-remove],.day-chip,#importParse,#importSave,#rotEdit,#rotStart,#cyStock,#cyNext,#cyReset,#cyConfirm");
    if (!t) return;
    if (t.dataset.take) setStatus(t.dataset.take, "TAKEN");
    else if (t.dataset.skip) setStatus(t.dataset.skip, "SKIPPED");
    else if (t.dataset.undo) setStatus(t.dataset.undo, null);
    else if (t.dataset.editItem) openItemSheet(t.dataset.editItem);
    else if (t.dataset.adopt) openItemSheet(null, t.dataset.adopt);
    else if (t.dataset.editProduct) openProductSheet(t.dataset.editProduct);
    else if ("closeSheet" in t.dataset) closeSheet();
    else if (t.dataset.deleteItem) {
      if (!confirm("이 영양제를 내 스케줄에서 삭제할까요?")) return;
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
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (handleEditorChange(t)) return;
    if (t.matches("[data-photo-input]")) {
      handlePhotoInput(t, (data) => {
        sheetPhoto = data;
        $("#photoPreview").innerHTML = `<img alt="" src="${data}">`;
      });
    } else if (t.matches("[data-import-photo]")) {
      const i = parseInt(t.dataset.importPhoto, 10);
      handlePhotoInput(t, (data) => { importRows[i].photo = data; renderImportRows(); });
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (handleEditorInput(t)) return;
    if (t.id === "fName") $("#fNameIherb").href = iherbSearchUrl(t.value);
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
    state.products = []; state.items = []; state.logs = {}; state.plan = null; state.planLoaded = false; state.cycle = null; state.cycleLoaded = false;
    if (!user) { closeSheet(); showScreen("screenLogin"); return; }
    showScreen("screenApp");
    switchTab(state.tab);
    subscribe(user.uid);
  });
  setInterval(checkReminders, 20000);
  setInterval(() => { if (state.user) { renderHeader(); renderToday(); } }, 60000);
  if ("serviceWorker" in navigator && !useEmulator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
