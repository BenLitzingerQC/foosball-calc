// Bündelt die Seite in eine einzige, selbstgenügsame HTML-Datei.
//
// Zweck: eine Datei, die sich per AirDrop, Chat oder Cloud-Ordner weitergeben
// und direkt über file:// öffnen lässt -- ohne Server, ohne Netz. Der normale
// Weg bleibt die gehostete Seite; das hier ist die Rückfallebene.
//
// Lauf: pixi run build  ->  dist/foosball-calc.html

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

const css = read("assets", "style.css");
const elo = read("assets", "elo.js");
const app = read("assets", "app.js");
const icon = read("assets", "icon.svg");

// Aus elo.js wird ein Inline-Vorspann: die Exporte entfallen, die Reihenfolge
// ersetzt den Import.
const eloInline = elo.replace(/^export (const|function|class) /gm, "$1 ");

const appImport = /^import\s*\{[\s\S]*?\}\s*from\s*"\.\/elo\.js";\n/m;
if (!appImport.test(app)) {
  throw new Error("Import von ./elo.js in app.js nicht gefunden -- Build anpassen.");
}
const appInline = app.replace(appImport, "");

const dataUri = `data:image/svg+xml;base64,${Buffer.from(icon, "utf8").toString("base64")}`;

let html = read("index.html");

const replace = (pattern, replacement, label) => {
  if (!pattern.test(html)) throw new Error(`${label} nicht gefunden -- Build anpassen.`);
  html = html.replace(pattern, replacement);
};

// Manifest und Apple-Icon zeigen auf Nachbardateien, die es hier nicht gibt.
replace(/\s*<link rel="manifest"[^>]*>/, "", "Manifest-Link");
replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "", "Apple-Icon-Link");
replace(/<link rel="icon" href="assets\/icon\.svg"/, `<link rel="icon" href="${dataUri}"`, "Favicon");
replace(
  /\s*<link rel="stylesheet" href="assets\/style\.css" \/>/,
  `\n    <style>\n${css}\n    </style>`,
  "Stylesheet-Link",
);
replace(
  /<script type="module" src="assets\/app\.js"><\/script>/,
  `<script type="module">\n${eloInline}\n${appInline}\n    </script>`,
  "Script-Tag",
);

const out = join(root, "dist");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "foosball-calc.html"), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`dist/foosball-calc.html geschrieben (${kb} kB, keine externen Dateien)`);
