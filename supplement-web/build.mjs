import { build } from "esbuild";

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
