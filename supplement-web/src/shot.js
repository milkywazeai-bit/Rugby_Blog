// Turns text read (OCR) from an iHerb screenshot — shared cart, wishlist, order
// list — into product rows. iHerb lays each product out as a photo on the left
// and "Brand, Name, ..., 60정" on the right, followed by quantity and price.
// Pure functions so they can be tested without a browser.

const PRICE = /^[₩Ww]\s?[\d,.]+$|^[\d,]+\s?원$/;
const QTY = /^\d{1,2}(\s*[a-zA-Z⌄∨]{0,3})?$/;
const COUNT = /(\d{1,4})\s*(베지\s?캡슐|소프트젤|캡슐|정|구미|츄어블|로젠지|포|개)\s*$/;
const FORM_WORD = /^(베지\s?캡슐|캡슐|소프트젤|구미|츄어블|로젠지|정)$/;
const DOSE = /^\d[\d,.]*\s?(mg|mcg|µg|ug|iu|g|억\s?cfu)$/i;
const VOLUME = /^\d[\d,.]*\s?(g|kg|ml|l|oz)\b/i;

// Common OCR slips on iHerb's Korean product names.
export function cleanOcr(text) {
  return String(text)
    .replace(/[®™©|]/g, "")
    .replace(/캡즐|캡술|캡슬|캡술/g, "캡슐")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

// "California Gold Nutrition, 프랑스 해송 껍질 추출물, Oligopin, 100mg, 베지 캡슐 60정"
//   → brand, name, dose, count, form
export function splitTitle(title) {
  const out = { brand: "", name: "", dose: "", count: null, form: "", volume: "" };
  const segs = cleanOcr(title).split(", ").map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) { out.name = segs.join(" "); return out; }
  out.brand = segs.shift();
  const last = segs[segs.length - 1];
  const m = last.match(COUNT);
  if (m) {
    out.count = parseInt(m[1], 10);
    const rest = last.slice(0, m.index).trim();
    const word = FORM_WORD.test(rest) ? rest : m[2];
    out.form = /캡슐/.test(word) ? "캡슐" : word;
    if (rest && !FORM_WORD.test(rest)) segs[segs.length - 1] = rest;
    else segs.pop();
  } else if (segs.length > 1 && VOLUME.test(last)) {
    out.volume = segs.pop();
  }
  const di = segs.findIndex((s, i) => i > 0 && DOSE.test(s));
  if (di !== -1) out.dose = segs.splice(di, 1)[0];
  out.name = segs.join(", ");
  return out;
}

// lines: [{ t, x0, y0, x1, y1 }] in image pixels. `textLeft` is where the text
// column starts (lines cut off at that edge belong to headers, not products).
export function parseShot(lines, { width, textLeft = 0 }) {
  const minX = textLeft + width * 0.005;
  const sorted = [...lines].filter((l) => l.t && l.t.trim()).sort((a, b) => a.y0 - b.y0);
  const heights = sorted.map((l) => l.y1 - l.y0).sort((a, b) => a - b);
  const lineH = heights.length ? heights[Math.floor(heights.length / 2)] : 20;
  const cards = [];
  let cur = null;
  let lastBottom = -Infinity;
  const close = () => { if (cur && cur.lines.length) cards.push(cur); cur = null; };
  for (const l of sorted) {
    const t = l.t.trim();
    if (PRICE.test(t) || QTY.test(t)) { close(); continue; }
    if (l.x0 <= minX || !/[A-Za-z가-힣]/.test(t)) { close(); continue; }
    if (cur && l.y0 - lastBottom > lineH * 1.8) close();
    if (!cur) cur = { lines: [], top: l.y0 };
    cur.lines.push(t);
    cur.bottom = l.y1;
    lastBottom = l.y1;
  }
  close();
  return cards
    .map((c) => ({ title: cleanOcr(c.lines.join(" ")), top: c.top, bottom: c.bottom }))
    .filter((c) => c.title.includes(","))
    .map((c) => ({ ...splitTitle(c.title), title: c.title, top: c.top, bottom: c.bottom }));
}

// Where the product photo sits: left of the text, starting near the title.
export function photoRect(item, width, height) {
  const size = Math.round(width * 0.22);
  const x = Math.round(width * 0.04);
  const y = Math.max(0, Math.min(height - size, Math.round(item.top - width * 0.02)));
  return { x, y, w: size, h: size };
}

// How alike two product names are (0..1), forgiving OCR slips: Dice score on
// character pairs, ignoring spaces and punctuation.
export function nameSimilarity(a, b) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s,.()®™+\-/]/g, "");
  const pairs = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const px = pairs(x), py = pairs(y);
  let both = 0;
  for (const [p, n] of px) both += Math.min(n, py.get(p) || 0);
  const total = Math.max(1, x.length - 1) + Math.max(1, y.length - 1);
  return (2 * both) / total;
}

// The catalog product a screenshot row most likely is: same brand, similar name.
export function matchProduct(item, products) {
  let best = null, score = 0;
  for (const p of products) {
    if (nameSimilarity(p.brand, item.brand) < 0.8) continue;
    const s = nameSimilarity(p.name, item.name);
    if (s > score) { best = p; score = s; }
  }
  return score >= 0.6 ? best : null;
}
