#!/usr/bin/env node
/** Usage: node scripts/export-staging-to-docs.js [file.xlsx]  (default sample-all-cards.xlsx)
 *  Parses card excel → docs/data/staging/staging.enc + meta.json (encrypted) + config.json */
const fs = require("fs"), path = require("path");
const { parseWorkbook } = require("../lib/parsers");
const { classify } = require("../lib/classify");
const { CATS, CARDS, ACCOUNTS, DEFAULT_RULES } = require("../lib/db");
const root = path.join(__dirname, "..");
const xlsx = process.argv[2] || (fs.existsSync(path.join(root,"private","sample-all-cards.xlsx"))?path.join(root,"private","sample-all-cards.xlsx"):path.join(root,"sample-all-cards.xlsx"));
const out = path.join(root, "docs", "data", "staging");
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.unlinkSync(path.join(out, f));
const by = {};
for (const r of parseWorkbook(xlsx)) {
  for (const t of r.rows || []) {
    if (t.cancelled) continue;
    (by[r.card] ||= []).push({
      date: t.date || "", merchant: t.merchant || "", amount: Number(t.amount) || 0,
      category: t.category || classify(t.merchant, DEFAULT_RULES), note: t.note || "",
      approval_no: t.approval_no || t.approvalNo || null,
    });
  }
}
const crypto = require("crypto");
const pass = process.env.CARD_SETTLE_PASS || fs.readFileSync(path.join(root, ".card-settle-passphrase"), "utf8").trim();
const index = { generated: new Date().toISOString(), source: path.basename(xlsx), cards: {} };
for (const [card, rows] of Object.entries(by)) {
  index.cards[card] = { count: rows.length, sum: rows.reduce((s, x) => s + x.amount, 0) };
}
// Encrypt {index, cards:{card:rows}} with PBKDF2-SHA256 + AES-256-GCM (Web Crypto compatible)
const ITER = 100000, salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(pass, salt, ITER, 32, "sha256");
const ci = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([ci.update(JSON.stringify({ index, cards: by }), "utf8"), ci.final(), ci.getAuthTag()]);
fs.writeFileSync(path.join(out, "staging.enc"), ct.toString("base64"));
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify({ v: 1, file: "staging.enc",
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITER, salt: salt.toString("base64") },
  cipher: { name: "AES-GCM", length: 256, iv: iv.toString("base64"), tag: "appended-16-bytes" },
  cards: Object.keys(by), generated: index.generated }, null, 1));
fs.writeFileSync(path.join(root, "docs", "data", "config.json"),
  JSON.stringify({ cats: CATS, cards: CARDS, accounts: ACCOUNTS, rules: DEFAULT_RULES }, null, 1));
console.log(index.cards);
