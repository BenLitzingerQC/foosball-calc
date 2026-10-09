// Bundles the page into a single, self-contained HTML file.
//
// Purpose: one file that can be handed around via AirDrop, chat or a cloud
// folder and opened straight over file:// -- no server, no network. The hosted
// page stays the normal route; this is the fallback.
//
// Run: pixi run build  ->  dist/foosball-calc.html

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

const css = read("assets", "style.css");
const elo = read("assets", "elo.js");
const app = read("assets", "app.js");
const icon = read("assets", "icon.svg");

// elo.js becomes an inline preamble: the exports drop out and the ordering
// replaces the import.
const eloInline = elo.replace(/^export (const|function|class) /gm, "$1 ");

const appImport = /^import\s*\{[\s\S]*?\}\s*from\s*"\.\/elo\.js";\n/m;
if (!appImport.test(app)) {
  throw new Error("Import of ./elo.js not found in app.js -- adjust the build.");
}
const appInline = app.replace(appImport, "");

const dataUri = `data:image/svg+xml;base64,${Buffer.from(icon, "utf8").toString("base64")}`;

let html = read("index.html");

const replace = (pattern, replacement, label) => {
  if (!pattern.test(html)) throw new Error(`${label} not found -- adjust the build.`);
  html = html.replace(pattern, replacement);
};

// Manifest and Apple icon point at sibling files that do not exist here.
replace(/\s*<link rel="manifest"[^>]*>/, "", "manifest link");
replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "", "apple-touch-icon link");
replace(/<link rel="icon" href="assets\/icon\.svg"/, `<link rel="icon" href="${dataUri}"`, "favicon");
replace(
  /\s*<link rel="stylesheet" href="assets\/style\.css" \/>/,
  `\n    <style>\n${css}\n    </style>`,
  "stylesheet link",
);
replace(
  /<script type="module" src="assets\/app\.js"><\/script>/,
  `<script type="module">\n${eloInline}\n${appInline}\n    </script>`,
  "script tag",
);

const out = join(root, "dist");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "foosball-calc.html"), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`wrote dist/foosball-calc.html (${kb} kB, no external files)`);
