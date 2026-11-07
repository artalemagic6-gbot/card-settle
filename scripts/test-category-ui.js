#!/usr/bin/env node
"use strict";
const vm=require("node:vm");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{JSDOM}=require("jsdom");
const root=path.join(__dirname,".."),CU=require("../docs/category-ui.js"),fixture=require("./fixtures/ui-example.json");
assert.equal(CU.shortcutAt(0),"1");assert.equal(CU.shortcutAt(8),"9");assert.equal(CU.shortcutAt(9),"a");assert.equal(CU.shortcutAt(34),"z");assert.equal(CU.shortcutAt(35),"");assert.equal(CU.shortcutIndex("A"),9);assert.equal(CU.shortcutIndex("0"),null);assert.equal(CU.shortcutIndex("ArrowDown"),null);
assert.equal(CU.validColor("#abcdef"),true);assert.equal(CU.validColor("red;display:none"),false);assert.equal(CU.colorFor("개인",{개인:"invalid"}),"#e8c96a");
assert.deepEqual(CU.orderedCategories(["B","A"],[{category:"X"},{category:"B"},{category:""}]),["B","A","X","미분류"]);
assert.deepEqual(CU.categoryTotals(["__proto__"],[{category:"__proto__",amount:-2,chk:true},{category:"새분류",amount:5}]),[{category:"__proto__",amount:-2},{category:"새분류",amount:5}]);
const originalColors={개인:"#123456"};assert.equal(CU.normalizeColors(originalColors,["개인","데이트"]).개인,"#123456");assert.deepEqual(originalColors,{개인:"#123456"});
const dom=new JSDOM(fs.readFileSync(path.join(root,"docs/index.html"),"utf8"),{url:"https://ui-fixture.example.test/",runScripts:"outside-only",pretendToBeVisual:true});
const w=dom.window,d=w.document,alerts=[];w.fetch=async()=>({json:async()=>fixture.config});w.alert=text=>alerts.push(text);w.confirm=()=>true;
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new w.Event("close"))};
const key="card-settle-pages-v2",raw=JSON.stringify(fixture.state);w.localStorage.setItem(key,raw);let saves=0;const set=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(...args){saves++;return set.apply(this,args)};
for(const name of ["settle-edit.js","settle-math.js","category-ui.js","app.js"])vm.runInContext(fs.readFileSync(path.join(root,"docs",name),"utf8"),dom.getInternalVMContext());
const run=s=>vm.runInContext(s,dom.getInternalVMContext()),json=s=>JSON.parse(JSON.stringify(run(s))),el=s=>d.querySelector(s),event=(type,opts={})=>new w.Event(type,{bubbles:true,cancelable:true,...opts});
const press=(node,key,opts={})=>{const e=new w.KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...opts});node.dispatchEvent(e);return e};
const value=(selector,v,type="change")=>{const n=el(selector);n.value=v;n.dispatchEvent(event(type))};
(async()=>{
 await run("start()");assert.equal(saves,0);assert.equal(w.localStorage.getItem(key),raw);assert.equal(el("[data-sidebar-total]").textContent,"550원");assert.equal(run('accountCalcIn(D,"352").need'),0);assert.equal(el("#buffer").closest("dialog").open,false);
 const initialTable=el("[data-settle-table]"),date=el('[data-f="date"]'),label=el('[data-f="label"]'),note=el('[data-f="note"]'),picker=el("[data-cat-picker]");
 assert.ok(date);value('[data-f="date"]',"2026-10-10");assert.equal(run("D.txs[0].date"),"2026-10-10");
 picker.focus();press(picker,"ArrowDown",{altKey:true});assert.equal(picker.getAttribute("aria-expanded"),"true");assert.equal(d.querySelectorAll('[role="option"]').length,10);press(picker,"a");assert.equal(run("D.txs[0].category"),"추가3");assert.equal(picker.textContent,"추가3");assert.equal(el(".category-menu"),null);assert.equal(d.activeElement,picker);assert.equal(el('[data-f="note"]'),note);assert.equal(el('[data-f="date"]'),date);assert.equal(el("[data-settle-table]"),initialTable);
 press(picker,"ArrowDown",{altKey:true});press(picker,"1");assert.equal(run("D.txs[0].category"),"개인");assert.equal(el('[data-row="1"]').style.getPropertyValue("--cat-color"),"#e8c96a");
 press(picker,"ArrowDown",{altKey:true});press(picker,"ArrowDown");press(picker,"Escape");assert.equal(run("D.txs[0].category"),"개인");assert.equal(el(".category-menu"),null);
 press(picker,"ArrowDown",{altKey:true});assert.equal(press(picker,"Tab").defaultPrevented,false);assert.equal(el(".category-menu"),null);press(picker,"ArrowDown",{altKey:true});assert.equal(press(picker,"Tab",{shiftKey:true}).defaultPrevented,false);
 const fields=[...initialTable.querySelectorAll("input,button,select")].filter(n=>n.type!=="hidden");assert.ok(fields.indexOf(picker)>fields.indexOf(label));assert.equal(fields[fields.indexOf(picker)+1],note);assert.equal(fields[fields.indexOf(picker)-1],el('[data-f="amount"]'));
 label.focus();press(label,"2");assert.equal(run("D.txs[0].category"),"개인");assert.equal(el(".category-menu"),null);
 picker.focus();press(picker,"ArrowDown",{altKey:true});note.dispatchEvent(event("pointerdown"));note.focus();assert.equal(el(".category-menu"),null);assert.equal(d.activeElement,note);
 // Numeric edits update totals without replacing any cell.
 value('[data-f="amount"]',"150");assert.equal(el('[data-f="note"]'),note);assert.equal(el("[data-settle-table]"),initialTable);assert.equal(el("[data-sidebar-total]").textContent,"600원");value('[data-f="amount"]',"100");
 el('[data-card="samsung"]').click();assert.equal(el("[data-sidebar-total]").textContent,"550원");el('[data-acct="302"]').click();assert.equal(el("[data-sidebar-total]").textContent,"550원");el('[data-acct="352"]').click();el('[data-card="shinhan"]').click();
 // Safety buffer is transactional draft UI; cancellation cannot mutate model/dirty/storage.
 run("dirty=false");const balance=run('D.accounts["352"].safetyBuffer');el("#account-settings").click();assert.equal(el("#account-dialog").open,true);value("#buffer","0");assert.equal(run('D.accounts["352"].safetyBuffer'),balance);el("#account-cancel").click();assert.equal(run("dirty"),false);assert.equal(el("#account-dialog").open,false);assert.equal(saves,0);
 el("#account-settings").click();el("#buffer").value="0";el("#account-dialog").dispatchEvent(event("cancel"));assert.equal(run('D.accounts["352"].safetyBuffer'),balance);assert.equal(run("dirty"),false);
 el("#account-settings").click();el("#buffer").value="0";el("#account-form").dispatchEvent(event("submit"));assert.equal(run('D.accounts["352"].safetyBuffer'),0);assert.equal(run('S.accounts["352"].safetyBuffer'),balance);assert.equal(saves,0);assert.equal(d.activeElement,el("#account-settings"));
 // Color/order settings update the draft, not history or saved storage.
 const oldLedger=JSON.stringify(json("D.ledger")),oldCycles=JSON.stringify(json("D.cycles"));el('nav [data-view="rules"]').click();value('[data-color="0"]',"#123456","input");assert.equal(run('D.catColors["개인"]'),"#123456");assert.equal(saves,0);el('[data-move="0"][data-step="1"]').click();assert.deepEqual(json("D.cats.slice(0,2)"),["데이트","개인"]);assert.equal(el('[data-cat="1"]').value,"개인");
 el('nav [data-view="settle"]').click();assert.equal(el('[data-row="1"]').style.getPropertyValue("--cat-color"),"#123456");const nextPicker=el("[data-cat-picker]");nextPicker.focus();press(nextPicker,"ArrowDown",{altKey:true});press(nextPicker,"2");assert.equal(run("D.txs[0].category"),"개인");
 const chk=el("[data-chk]");chk.checked=true;chk.dispatchEvent(event("change"));assert.equal(el("[data-sidebar-total]").textContent,"550원");assert.equal(saves,0);el("#save").click();assert.equal(saves,1);assert.equal(el("[data-sidebar-total]").textContent,"450원");assert.equal(run("S.ledger.length"),2);assert.equal(JSON.parse(w.localStorage.getItem(key)).accounts["352"].safetyBuffer,0);assert.equal(JSON.parse(w.localStorage.getItem(key)).catColors["개인"],"#123456");
 await run("start()");assert.equal(saves,1);assert.equal(run('D.accounts["352"].safetyBuffer'),0);assert.equal(run('D.catColors["개인"]'),"#123456");assert.deepEqual(json("D.cats.slice(0,2)"),["데이트","개인"]);
 el('nav [data-view="rules"]').click();const name=el('[data-cat="1"]');name.focus();value('[data-cat="1"]',"내 분류");assert.equal(d.activeElement,name);assert.equal(run('D.txs.find(t=>t.card==="nh").category'),"내 분류");assert.equal(run('D.catColors["내 분류"]'),"#123456");assert.equal(JSON.stringify(json("D.ledger[0]")),JSON.stringify(JSON.parse(oldLedger)[0]));assert.equal(JSON.stringify(json("D.cycles")),oldCycles);
 value('[data-cat="1"]',"데이트");assert.equal(el('[data-cat="1"]').value,"내 분류");const n=run("D.cats.length");el('[data-cdel="1"]').click();assert.equal(run("D.cats.length"),n);assert.ok(alerts.length>=2);
 // Orphan transaction/rule categories cannot be silently merged by rename.
 run('D.txs.push({id:999,card:"nh",category:"고아분류",amount:0});D.catColors["고아분류"]="#abcdef";D.rules.push({match:"예시충돌",category:"규칙고아"})');
 value('[data-cat="1"]',"고아분류");assert.equal(el('[data-cat="1"]').value,"내 분류");assert.equal(run('D.catColors["고아분류"]'),"#abcdef");assert.equal(run('D.txs.find(t=>t.id===999).category'),"고아분류");
 value('[data-cat="1"]',"규칙고아");assert.equal(el('[data-cat="1"]').value,"내 분류");assert.equal(run('D.rules.at(-1).category'),"규칙고아");
 // Render/dispose removes any portal and opens only one menu without stale handlers.
 run('view="settle";D.cur="samsung";render()');const last=el("[data-cat-picker]");press(last,"ArrowDown",{altKey:true});run("render()");assert.equal(el(".category-menu"),null);assert.equal(d.querySelectorAll("[role=listbox]").length,0);
 console.log("test-category-ui: ok (colors/order, all-card sums, shortcuts, stable inputs, draft settings, save/reload, rename safety)");dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
