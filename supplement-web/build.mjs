import { build } from "esbuild";
import { mkdirSync, copyFileSync, cpSync } from "fs";

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  sourcemap: false,
  outfile: "public/app.js",
  logLevel: "info"
});

// Screenshot reading (관리자 → 캡처로 추가) runs Tesseract in the browser. Its files are
// served from our own site and only downloaded when an admin uses that feature.
const ocr = {
  "public/ocr/tesseract.min.js": "node_modules/tesseract.js/dist/tesseract.min.js",
  "public/ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "public/ocr/core/tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "public/ocr/core/tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  // Korean: the full model reads iHerb's product names noticeably better than the small one.
  "public/ocr/lang/kor.traineddata.gz": "node_modules/@tesseract.js-data/kor/4.0.0/kor.traineddata.gz",
  "public/ocr/lang/eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"
};
mkdirSync("public/ocr/core", { recursive: true });
mkdirSync("public/ocr/lang", { recursive: true });
for (const [to, from] of Object.entries(ocr)) copyFileSync(from, to);

// Pretendard (an SF Pro / Apple SD Gothic Neo look-alike), served from our site.
// The browser fetches only the slices of Korean it needs.
const pd = "node_modules/pretendard/dist/web/variable/";
mkdirSync("public/fonts/pretendard", { recursive: true });
copyFileSync(pd + "pretendardvariable-dynamic-subset.css", "public/fonts/pretendard/pretendardvariable-dynamic-subset.css");
cpSync(pd + "woff2-dynamic-subset", "public/fonts/pretendard/woff2-dynamic-subset", { recursive: true });
