import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlug, parseIherbLinks, findUnsupportedLinks, describeAmount } from "../src/iherb.js";

test("brand, dose and count from a softgel product", () => {
  const p = parseSlug("california-gold-nutrition-dha-700-fish-oil-ultra-concentrated-1-000-mg-30-fish-gelatin-softgels");
  assert.equal(p.brand, "California Gold Nutrition");
  assert.equal(p.dose, "1,000 mg");
  assert.equal(p.count, 30);
  assert.equal(p.form, "소프트젤");
  assert.equal(p.name, "DHA 700 Fish Oil Ultra Concentrated");
});

test("dose in the middle of the slug", () => {
  const p = parseSlug("bioschwartz-omega-3-fish-oil-lemon-3-000-mg-90-softgels");
  assert.equal(p.brand, "BioSchwartz");
  assert.equal(p.dose, "3,000 mg");
  assert.equal(p.count, 90);
  assert.equal(p.name, "Omega 3 Fish Oil Lemon");
});

test("liquid product gets a volume instead of a count", () => {
  const p = parseSlug("california-gold-nutrition-norwegian-omega-3-fish-oil-natural-lemon-16-9-fl-oz-500-ml");
  assert.equal(p.count, null);
  assert.equal(p.volume, "500 ml");
  assert.equal(describeAmount(p), "500 ml");
});

test("probiotic CFU dose and veggie capsules", () => {
  const p = parseSlug("now-foods-probiotic-10-25-billion-cfu-50-veg-capsules");
  assert.equal(p.brand, "NOW Foods");
  assert.equal(p.dose, "25 billion CFU");
  assert.equal(p.count, 50);
  assert.equal(p.form, "캡슐");
});

test("unknown brand keeps every word in the name", () => {
  const p = parseSlug("some-new-brand-magnesium-glycinate-400-mg-120-tablets");
  assert.equal(p.brand, "");
  assert.equal(p.dose, "400 mg");
  assert.equal(p.count, 120);
  assert.equal(p.form, "정");
  assert.equal(p.name, "Some New Brand Magnesium Glycinate");
});

test("extracts several links from pasted text, dedupes, drops query strings", () => {
  const text = `내가 먹는 것들
https://www.iherb.com/pr/bioschwartz-omega-3-fish-oil-lemon-3-000-mg-90-softgels/92970?rcode=ABC
https://kr.iherb.com/pr/california-gold-nutrition-dha-700-fish-oil-ultra-concentrated-1-000-mg-30-fish-gelatin-softgels/82846
https://www.iherb.com/pr/bioschwartz-omega-3-fish-oil-lemon-3-000-mg-90-softgels/92970
https://example.com/pr/not-iherb/1`;
  const links = parseIherbLinks(text);
  assert.equal(links.length, 2);
  assert.equal(links[0].iherbId, "92970");
  assert.equal(links[0].url, "https://www.iherb.com/pr/bioschwartz-omega-3-fish-oil-lemon-3-000-mg-90-softgels/92970");
  assert.equal(links[1].url.startsWith("https://kr.iherb.com/pr/"), true);
});

test("search links are reported as unsupported, short links are not", () => {
  const bad = findUnsupportedLinks("https://iherb.co/abc123 https://www.iherb.com/search?kw=fish https://www.iherb.com/pr/x-1-softgels/1");
  assert.deepEqual(bad, ["https://www.iherb.com/search?kw=fish"]);
});

test("app share text gives a short link that needs a name", () => {
  const text = "iHerb 에 있는 이 제품을 확인해 보세요 https://iherb.co/Hc9Pve6J?rcode=DFE1579&utm_medium=appshare";
  const links = parseIherbLinks(text + "\n" + text);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://iherb.co/Hc9Pve6J");
  assert.equal(links[0].needsName, true);
  assert.equal(links[0].name, "");
});
