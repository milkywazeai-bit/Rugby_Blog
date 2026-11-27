import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShot, splitTitle, cleanOcr, photoRect, matchProduct, nameSimilarity } from "../src/shot.js";

// Real OCR output from a shared-cart screenshot (text column, 2x scale).
const L = (x0, y0, x1, y1, t) => ({ x0, y0, x1, y1, t });
const CART = [
  L(0, 66, 1489, 144, "5H.          c= N{Q B.@"),
  L(0, 665, 290, 746, "tz 목록"),
  L(0, 847, 1458, 908, "글 장바구니에 추가하려면 \"장바구니에 추가\" HES 누"),
  L(0, 953, 1447, 1017, "상품을 삭제, 수량을 변경하거나 더 많은 상품을 추가하"),
  L(30, 1348, 1399, 1422, "NutriBiotic, 면역력, 비타민C + D3 및 아연,"),
  L(26, 1469, 381, 1541, "캡슐 250정"),
  L(1127, 1880, 1360, 1936, "1 wv"),
  L(1164, 2096, 1461, 2166, "W25,060"),
  L(26, 2416, 1199, 2490, "SIXSTAR, 테스토스테론 부스터, 60정"),
  L(1127, 2946, 1360, 3003, "1 wv"),
  L(1164, 3163, 1461, 3233, "W15,760"),
  L(26, 3482, 1451, 3556, "California Gold Nutrition, 프랑스 해송 껍질"),
  L(26, 3601, 1410, 3682, "추출물, Oligopin®, 100mg, 베지 캡즐 60정"),
  L(1127, 4012, 1360, 4069, "1 wv"),
  L(1164, 4229, 1458, 4299, "w37,215"),
  L(30, 4548, 1397, 4626, "Raw Nutrition, Pump, 비자극성 운동 전 보"),
  L(26, 4669, 965, 4748, "충제, 수박 맛, 502g(17.71oz)"),
  L(1127, 5078, 1360, 5135, "1 wv"),
  L(1164, 5295, 1462, 5365, "W54,344"),
  L(0, 5662, 234, 5751, "리워드"),
  L(0, 5816, 1368, 5901, "TE 회원 전용 혜택,                      x"),
  L(298, 6308, 738, 6371, "장바구니에 추가")
];

test("finds the four products in a shared cart screenshot", () => {
  const items = parseShot(CART, { width: 1598 });
  assert.deepEqual(items.map((i) => i.brand), ["NutriBiotic", "SIXSTAR", "California Gold Nutrition", "Raw Nutrition"]);
  assert.equal(items[0].name, "면역력, 비타민C + D3 및 아연");
  assert.equal(items[0].count, 250);
  assert.equal(items[0].form, "캡슐");
  assert.equal(items[1].name, "테스토스테론 부스터");
  assert.equal(items[1].count, 60);
  assert.equal(items[1].form, "정");
  assert.equal(items[2].name, "프랑스 해송 껍질 추출물, Oligopin");
  assert.equal(items[2].dose, "100mg");
  assert.equal(items[2].form, "캡슐");
  assert.equal(items[3].name, "Pump, 비자극성 운동 전 보 충제, 수박 맛");
  assert.equal(items[3].volume, "502g(17.71oz)");
  assert.equal(items[3].count, null);
  assert.equal(items[1].top, 2416);
});

test("splitTitle without a count keeps the whole name", () => {
  assert.deepEqual(splitTitle("Codeage, 아커만시아"), { brand: "Codeage", name: "아커만시아", dose: "", count: null, form: "", volume: "" });
  assert.equal(splitTitle("그냥 이름").name, "그냥 이름");
});

test("cleanOcr fixes common slips", () => {
  assert.equal(cleanOcr("베지 캡즐  60정 ,"), "베지 캡슐 60정");
  assert.equal(cleanOcr("Oligopin® ,100mg"), "Oligopin, 100mg");
});

test("photoRect stays inside the image", () => {
  const r = photoRect({ top: 5 }, 1080, 2000);
  assert.equal(r.y, 0);
  assert.ok(r.x >= 0 && r.w > 0);
  assert.equal(photoRect({ top: 1990 }, 1080, 2000).y, 2000 - r.h);
});

test("matchProduct forgives OCR slips but not a different product", () => {
  const products = [
    { id: "w03", brand: "NutriBiotic", name: "면역력, 비타민C + D3 및 아연" },
    { id: "w20", brand: "Viva Naturals", name: "비타민C + 아연" }
  ];
  assert.equal(matchProduct({ brand: "NutriBiotic", name: "면역력, 비타민ㅇ@+13 및 아연" }, products).id, "w03");
  assert.equal(matchProduct({ brand: "Nutribiotic", name: "면역력, 비타민C + D3 및 아연" }, products).id, "w03");
  assert.equal(matchProduct({ brand: "SIXSTAR", name: "테스토스테론 부스터" }, products), null);
  assert.equal(matchProduct({ brand: "NutriBiotic", name: "프로바이오틱스 유산균" }, products), null);
  assert.ok(nameSimilarity("abc", "abc") === 1 && nameSimilarity("", "x") === 0);
});
