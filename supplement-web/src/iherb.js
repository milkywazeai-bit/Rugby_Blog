const BRANDS = {
  "california-gold-nutrition": "California Gold Nutrition",
  "now-foods": "NOW Foods",
  "doctor-s-best": "Doctor's Best",
  "jarrow-formulas": "Jarrow Formulas",
  "solgar": "Solgar",
  "life-extension": "Life Extension",
  "nature-s-way": "Nature's Way",
  "sports-research": "Sports Research",
  "thorne": "Thorne",
  "thorne-research": "Thorne Research",
  "garden-of-life": "Garden of Life",
  "nordic-naturals": "Nordic Naturals",
  "swanson": "Swanson",
  "natrol": "Natrol",
  "21st-century": "21st Century",
  "bioschwartz": "BioSchwartz",
  "lake-avenue-nutrition": "Lake Avenue Nutrition",
  "nutricost": "Nutricost",
  "zhou-nutrition": "Zhou Nutrition",
  "renew-life": "Renew Life",
  "culturelle": "Culturelle",
  "megafood": "MegaFood",
  "new-chapter": "New Chapter",
  "source-naturals": "Source Naturals",
  "country-life": "Country Life",
  "kal": "KAL",
  "bluebonnet-nutrition": "Bluebonnet Nutrition",
  "nature-s-bounty": "Nature's Bounty",
  "nature-made": "Nature Made",
  "pure-encapsulations": "Pure Encapsulations",
  "carlson": "Carlson",
  "irwin-naturals": "Irwin Naturals",
  "natural-factors": "Natural Factors",
  "klaire-labs": "Klaire Labs",
  "seeking-health": "Seeking Health",
  "enzymedica": "Enzymedica",
  "hyperbiotics": "Hyperbiotics",
  "physician-s-choice": "Physician's Choice",
  "solaray": "Solaray",
  "healthy-origins": "Healthy Origins",
  "emerald-labs": "Emerald Labs",
  "sundown-naturals": "Sundown Naturals",
  "nature-s-plus": "Nature's Plus",
  "rainbow-light": "Rainbow Light",
  "deva": "Deva",
  "allmax": "ALLMAX",
  "optimum-nutrition": "Optimum Nutrition",
  "mrm-nutrition": "MRM Nutrition",
  "gnc": "GNC",
  "vital-proteins": "Vital Proteins",
  "olly": "OLLY",
  "smarty-pants": "SmartyPants",
  "youtheory": "Youtheory",
  "nature-s-truth": "Nature's Truth",
  "puritan-s-pride": "Puritan's Pride",
  "mason-natural": "Mason Natural",
  "nutrabio-labs": "NutraBio Labs",
  "codeage": "Codeage",
  "seed": "Seed",
  "align": "Align",
  "florastor": "Florastor",
  "probiotic-pearls": "Probiotic Pearls",
  "biogaia": "BioGaia",
  "dr-mercola": "Dr. Mercola",
  "dr-formulas": "Dr. Formulas",
  "global-healing": "Global Healing",
  "ancient-nutrition": "Ancient Nutrition",
  "orgain": "Orgain",
  "nature-s-answer": "Nature's Answer",
  "mary-ruth-s": "MaryRuth's",
  "maryruth-organics": "MaryRuth Organics",
  "sambucol": "Sambucol",
  "terry-naturally": "Terry Naturally",
  "vitables": "Vitables",
  "zarbee-s": "Zarbee's"
};

const FORMS = {
  softgel: "소프트젤", softgels: "소프트젤",
  capsule: "캡슐", capsules: "캡슐", caps: "캡슐", vcaps: "캡슐", vegcaps: "캡슐",
  tablet: "정", tablets: "정", caplet: "정", caplets: "정",
  gummy: "구미", gummies: "구미",
  lozenge: "로젠지", lozenges: "로젠지",
  chewable: "츄어블", chewables: "츄어블",
  packet: "포", packets: "포", stick: "포", sticks: "포",
  pieces: "개", count: "개"
};

const UPPER = new Set(["dha", "epa", "cfu", "d3", "k2", "b12", "b6", "coq10", "nac", "msm", "mk", "mk-7", "hcl", "dhea", "gaba", "pqq", "ala", "vit", "iu", "c", "d", "e", "a", "k", "b"]);

function titleCase(tokens) {
  return tokens
    .map((t) => {
      if (UPPER.has(t)) return t.toUpperCase();
      if (/^\d/.test(t)) return t;
      return t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join(" ");
}

function joinThousands(groups) {
  return groups.split("-").join(",");
}

export function parseSlug(slug) {
  let rest = String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const result = { brand: "", name: "", dose: "", count: null, form: "", volume: "" };

  const brandKey = Object.keys(BRANDS)
    .sort((a, b) => b.length - a.length)
    .find((k) => rest === k || rest.startsWith(k + "-"));
  if (brandKey) {
    result.brand = BRANDS[brandKey];
    rest = rest.slice(brandKey.length).replace(/^-/, "");
  }

  const countMatch = rest.match(/(?:^|-)(\d+)-((?:[a-z]+-){0,4}?)(softgels?|capsules?|caps|vcaps|vegcaps|tablets?|caplets?|gumm(?:y|ies)|lozenges?|chewables?|packets?|sticks?|pieces|count)$/);
  if (countMatch) {
    result.count = parseInt(countMatch[1], 10);
    result.form = FORMS[countMatch[3]] || "";
    rest = rest.slice(0, countMatch.index);
  } else {
    const vol = rest.match(/(?:^|-)(?:(\d+(?:-\d+)?)-fl-oz-)?(\d+(?:-\d+)?)-(ml|g|kg|lb|lbs|oz)$/);
    if (vol) {
      result.volume = vol[2].replace("-", ".") + " " + vol[3];
      rest = rest.slice(0, vol.index);
    }
  }

  const cfu = rest.match(/(?:^|-)(\d+)-billion-cfus?(?=-|$)/);
  const dose = rest.match(/(?:^|-)(\d{1,3}(?:-\d{3})*)-(mg|mcg|iu|g)(?=-|$)/);
  if (cfu) {
    result.dose = cfu[1] + " billion CFU";
    rest = (rest.slice(0, cfu.index) + "-" + rest.slice(cfu.index + cfu[0].length)).replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  } else if (dose) {
    result.dose = joinThousands(dose[1]) + " " + (dose[2] === "iu" ? "IU" : dose[2]);
    rest = (rest.slice(0, dose.index) + "-" + rest.slice(dose.index + dose[0].length)).replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  }

  result.name = titleCase(rest.split("-").filter(Boolean)) || "이름 없음";
  return result;
}

export function parseIherbLinks(text) {
  const found = [];
  const seen = new Set();
  const urls = String(text || "").match(/https?:\/\/[^\s"'<>]+/g) || [];
  for (const raw of urls) {
    let u;
    try { u = new URL(raw); } catch { continue; }
    if (!/(^|\.)iherb\.com$/i.test(u.hostname)) continue;
    const m = u.pathname.match(/\/pr\/([^/]+)\/(\d+)/i);
    if (!m) continue;
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const slug = decodeURIComponent(m[1]);
    found.push({
      iherbId: id,
      url: "https://" + u.hostname.toLowerCase() + "/pr/" + m[1] + "/" + id,
      ...parseSlug(slug)
    });
  }
  return found;
}

export function findUnsupportedLinks(text) {
  const urls = String(text || "").match(/https?:\/\/[^\s"'<>]+/g) || [];
  return urls.filter((raw) => {
    try {
      const u = new URL(raw);
      const isIherb = /(^|\.)iherb\.(com|co)$/i.test(u.hostname);
      return isIherb && !/\/pr\/[^/]+\/\d+/i.test(u.pathname);
    } catch { return false; }
  });
}

export function iherbSearchUrl(name) {
  return "https://www.iherb.com/search?kw=" + encodeURIComponent(name || "");
}

export function describeAmount(p) {
  const parts = [];
  if (p.dose) parts.push(p.dose);
  if (p.count) parts.push(p.count + (p.form || "개"));
  else if (p.volume) parts.push(p.volume);
  return parts.join(" · ");
}
