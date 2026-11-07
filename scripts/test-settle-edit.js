#!/usr/bin/env node
/** Regression checks for manual date edit + Tab-safe inline field updates (no browser). */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const helpersSrc = fs.readFileSync(path.join(root, "docs/settle-edit.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "docs/app.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(root, "docs/index.html"), "utf8");

const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(helpersSrc, sandbox);
const SE = sandbox.SettleEdit;
assert.ok(SE, "SettleEdit exported");

// --- date cell ---
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const virtual = { id: 7, virtual: true, date: "2026-03-15T12:00:00.000Z" };
const imported = { id: 8, virtual: false, date: "2026-03-14 09:00" };
const vHtml = SE.rowDateHtml(virtual, esc);
assert.match(vHtml, /type="date"/);
assert.match(vHtml, /data-f="date"/);
assert.match(vHtml, /value="2026-03-15"/);
assert.ok(!/type="date"/.test(SE.rowDateHtml(imported, esc)), "imported date stays read-only text");
assert.equal(SE.dateInputValue("2026-11-06 anything"), "2026-11-06");

// --- applyField ---
const tx = { id: 1, date: "2026-01-01", label: "a", amount: 10, category: "개인", note: "" };
assert.equal(SE.applyField(tx, "date", "2026-02-02"), true);
assert.equal(tx.date, "2026-02-02");
assert.equal(SE.applyField(tx, "amount", "326"), true);
assert.equal(tx.amount, 326);
assert.equal(SE.applyField(tx, "label", "개인차액"), true);
assert.equal(SE.fieldAffectsSummary("amount"), true);
assert.equal(SE.fieldAffectsSummary("label"), false);
assert.equal(SE.fieldAffectsSummary("date"), false);

// --- tab order contract ---
assert.deepEqual(SE.fieldTabOrder(true), ["date", "physical", "label", "amount", "category", "note", "chk", "del"]);
assert.deepEqual(SE.fieldTabOrder(false), ["physical", "label", "category", "note", "chk", "del"]);
assert.equal(SE.nextField(SE.fieldTabOrder(true), "date", false), "physical");
assert.equal(SE.nextField(SE.fieldTabOrder(true), "label", false), "amount");
assert.equal(SE.nextField(SE.fieldTabOrder(true), "amount", true), "label");
assert.equal(SE.nextField(SE.fieldTabOrder(false), "label", false), "category");
assert.equal(SE.nextField(SE.fieldTabOrder(false), "note", false), "chk");

// --- app wiring: inline edits must not call render() ---
assert.match(appSrc, /SE\.rowDateHtml/);
assert.match(appSrc, /refreshSettleMeta/);
assert.match(appSrc, /SE\.applyField/);
// data-f onchange should touch + maybe refreshSettleMeta, not render()
const fieldHandler = appSrc.match(/all\("\[data-f\]",[^\n]+/);
assert.ok(fieldHandler, "data-f handler present");
assert.ok(!/render\(\)/.test(fieldHandler[0]), "data-f onchange must not full-render");
assert.match(fieldHandler[0], /refreshSettleMeta/);
const chkHandler = appSrc.match(/all\("\[data-chk\]",[^\n]+/);
assert.ok(chkHandler, "chk handler present");
assert.ok(!/render\(\)/.test(chkHandler[0]), "checkbox onchange must not full-render");
assert.match(appSrc, /on\("#bal".*refreshSettleMeta/s);
assert.match(appSrc, /on\("#used".*refreshSettleMeta/s);

// structural actions still render
assert.match(appSrc, /data-del[\s\S]*render\(\)/);
assert.match(appSrc, /#addv[\s\S]*render\(\)/);

// cache bust + helper script
assert.match(indexSrc, /settle-edit\.js\?v=/);
assert.match(indexSrc, /app\.js\?v=/);
// gate CSS fix must remain elsewhere
const css = fs.readFileSync(path.join(root, "docs/style.css"), "utf8");
assert.match(css, /#gate\[hidden\]\{display:none!important\}/);

console.log("test-settle-edit: ok");
