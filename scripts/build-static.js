#!/usr/bin/env node
/** Copy public/ to dist/ for static hosting of the UI shell (API still needs Node). */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "public");
const dest = path.join(__dirname, "..", "dist");

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
}
console.log("Copied public/ → dist/");
console.log("Note: GitHub Pages can host dist/, but /api/* needs a Node host (Render/Railway) or this box.");
