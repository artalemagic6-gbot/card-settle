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
const FG=require("./fixtures/fake-github.js"),gh=FG.makeFakeGitHub();
const prepRemote=w=>{Object.defineProperty(w,"crypto",{value:require("node:crypto").webcrypto,configurable:true});if(!w.TextEncoder)w.TextEncoder=TextEncoder;if(!w.TextDecoder)w.TextDecoder=TextDecoder};
const dom=new JSDOM(fs.readFileSync(path.join(root,"docs/index.html"),"utf8"),{url:"https://ui-fixture.example.test/",runScripts:"outside-only",pretendToBeVisual:true});
const w=dom.window,d=w.document,alerts=[];prepRemote(w);FG.routeFetch(w,{config:fixture.config,gh});w.alert=text=>alerts.push(text);w.confirm=()=>true;
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new w.Event("close"))};
const key="card-settle-pages-v2",raw=JSON.stringify(fixture.state);w.localStorage.setItem(key,raw);let saves=0;const set=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(...args){if(args[0]===key)saves++;return set.apply(this,args)};
for(const name of ["settle-edit.js","settle-math.js","category-ui.js","category-state.js","settle-tools.js","settle-workflow.js","remote-sync.js","app.js"])vm.runInContext(fs.readFileSync(path.join(root,"docs",name),"utf8"),dom.getInternalVMContext());
const saveClick=async()=>{el("#save").click();return run("saveTask")},run=s=>vm.runInContext(s,dom.getInternalVMContext()),json=s=>JSON.parse(JSON.stringify(run(s))),el=s=>d.querySelector(s),event=(type,opts={})=>new w.Event(type,{bubbles:true,cancelable:true,...opts});
const press=(node,key,opts={})=>{const e=new w.KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...opts});node.dispatchEvent(e);return e};
const value=(selector,v,type="change")=>{const n=el(selector);n.value=v;n.dispatchEvent(event(type))};
(async()=>{
 run(`PASS=${JSON.stringify(FG.PASS)}`);await run("start()");assert.equal(saves,0);assert.equal(w.localStorage.getItem(key),raw);assert.equal(el("#remote-status").textContent,"연결 필요");assert.equal(await FG.connectAndMigrate(run,el),"migrated");assert.equal(saves,0);assert.equal(gh.puts,1);assert.equal(el("[data-sidebar-total]").textContent,"550원");assert.equal(run('accountCalcIn(D,"352").need'),0);assert.equal(el("#buffer").closest("dialog").open,false);
 const initialTable=el("[data-settle-table]"),date=el('[data-f="date"]'),label=el('[data-f="label"]'),note=el('[data-f="note"]'),picker=el("[data-cat-picker]");
 assert.ok(date);value('[data-f="date"]',"2026-10-10");assert.equal(run("D.txs[0].date"),"2026-10-10");
 picker.focus();press(picker,"ArrowDown",{altKey:true});assert.equal(picker.getAttribute("aria-expanded"),"true");assert.equal(d.querySelectorAll('[role="option"]').length,10);press(picker,"a");assert.equal(run("catName(D.txs[0].category)"),"추가3");assert.equal(picker.textContent,"추가3");assert.equal(el(".category-menu"),null);assert.equal(d.activeElement,picker);assert.equal(el('[data-f="note"]'),note);assert.equal(el('[data-f="date"]'),date);assert.equal(el("[data-settle-table]"),initialTable);
 press(picker,"ArrowDown",{altKey:true});press(picker,"1");assert.equal(run("catName(D.txs[0].category)"),"개인");assert.equal(el('[data-row="1"]').style.getPropertyValue("--cat-color"),"#e8c96a");
 press(picker,"ArrowDown",{altKey:true});press(picker,"ArrowDown");press(picker,"Escape");assert.equal(run("catName(D.txs[0].category)"),"개인");assert.equal(el(".category-menu"),null);
 press(picker,"ArrowDown",{altKey:true});assert.equal(press(picker,"Tab").defaultPrevented,false);assert.equal(el(".category-menu"),null);press(picker,"ArrowDown",{altKey:true});assert.equal(press(picker,"Tab",{shiftKey:true}).defaultPrevented,false);
 const fields=[...initialTable.querySelectorAll("input,button,select")].filter(n=>n.type!=="hidden");assert.ok(fields.indexOf(picker)>fields.indexOf(label));assert.equal(fields[fields.indexOf(picker)+1],note);assert.equal(fields[fields.indexOf(picker)-1],el('[data-f="amount"]'));
 label.focus();press(label,"2");assert.equal(run("catName(D.txs[0].category)"),"개인");assert.equal(el(".category-menu"),null);
 picker.focus();press(picker,"ArrowDown",{altKey:true});note.dispatchEvent(event("pointerdown"));note.focus();assert.equal(el(".category-menu"),null);assert.equal(d.activeElement,note);
 // Numeric edits update totals without replacing any cell.
 value('[data-f="amount"]',"150");assert.equal(el('[data-f="note"]'),note);assert.equal(el("[data-settle-table]"),initialTable);assert.equal(el("[data-sidebar-total]").textContent,"600원");value('[data-f="amount"]',"100");
 el('[data-card="samsung"]').click();assert.equal(el("[data-sidebar-total]").textContent,"550원");el('[data-acct="302"]').click();assert.equal(el("[data-sidebar-total]").textContent,"550원");el('[data-acct="352"]').click();el('[data-card="shinhan"]').click();
 // Safety buffer is transactional draft UI; cancellation cannot mutate model/dirty/storage.
 run("dirty=false");const balance=run('D.accounts["352"].safetyBuffer');el("#account-settings").click();assert.equal(el("#account-dialog").open,true);value("#buffer","0");assert.equal(run('D.accounts["352"].safetyBuffer'),balance);el("#account-cancel").click();assert.equal(run("dirty"),false);assert.equal(el("#account-dialog").open,false);assert.equal(saves,0);
 el("#account-settings").click();el("#buffer").value="0";el("#account-dialog").dispatchEvent(event("cancel"));assert.equal(run('D.accounts["352"].safetyBuffer'),balance);assert.equal(run("dirty"),false);
 el("#account-settings").click();el("#buffer").value="0";el("#account-form").dispatchEvent(event("submit"));assert.equal(run('D.accounts["352"].safetyBuffer'),0);assert.equal(run('S.accounts["352"].safetyBuffer'),balance);assert.equal(saves,0);assert.equal(d.activeElement,el("#account-settings"));
 // Color/order settings update the draft, not history or saved storage.
 const oldLedger=JSON.stringify(json("D.ledger")),oldCycles=JSON.stringify(json("D.cycles"));el('nav [data-view="rules"]').click();value('[data-color="0"]',"#123456","input");assert.equal(run('D.catColors[CS.sourceId(D,"개인")]'),"#123456");assert.equal(saves,0);el('[data-move="0"][data-step="1"]').click();assert.deepEqual(json("D.cats.slice(0,2).map(id=>catName(id))"),["데이트","개인"]);assert.equal(el('[data-cat="1"]').value,"개인");
 el('nav [data-view="settle"]').click();assert.equal(el('[data-row="1"]').style.getPropertyValue("--cat-color"),"#123456");const nextPicker=el("[data-cat-picker]");nextPicker.focus();press(nextPicker,"ArrowDown",{altKey:true});press(nextPicker,"2");assert.equal(run("catName(D.txs[0].category)"),"개인");
 const chk=el("[data-chk]");chk.checked=true;chk.dispatchEvent(event("change"));assert.equal(el("[data-sidebar-total]").textContent,"550원");assert.equal(saves,0);el("#settle-selected").click();assert.equal(el("[data-sidebar-total]").textContent,"450원");assert.equal(saves,0);await saveClick();assert.equal(saves,1);assert.equal(el("[data-sidebar-total]").textContent,"450원");assert.equal(run("S.ledger.length"),2);assert.equal(JSON.parse(w.localStorage.getItem(key)).accounts["352"].safetyBuffer,0);assert.equal(JSON.parse(w.localStorage.getItem(key)).catColors[run('CS.sourceId(D,"개인")')],"#123456");
 await run("start()");assert.equal(saves,1);assert.equal(await FG.connectAndMigrate(run,el),"adopted");assert.equal(run('D.accounts["352"].safetyBuffer'),0);assert.equal(run('D.catColors[CS.sourceId(D,"개인")]'),"#123456");assert.deepEqual(json("D.cats.slice(0,2).map(id=>catName(id))"),["데이트","개인"]);
 el('nav [data-view="rules"]').click();const name=el('[data-cat="1"]');name.focus();value('[data-cat="1"]',"내 분류");assert.equal(d.activeElement,name);assert.equal(run('catName(D.txs.find(t=>t.card==="nh").category)'),"내 분류");assert.equal(run('D.catColors[CS.findName(D,"내 분류")]'),"#123456");assert.equal(JSON.stringify(json("D.ledger[0]")),JSON.stringify(JSON.parse(oldLedger)[0]));assert.equal(JSON.stringify(json("D.cycles")),oldCycles);
 value('[data-cat="1"]',"데이트");assert.equal(el('[data-cat="1"]').value,"내 분류");const n=run("D.cats.length");el('[data-cdel="1"]').click();assert.equal(run("D.cats.length"),n);assert.ok(alerts.length>=2);
 // Orphan transaction/rule categories cannot be silently merged by rename.
 run('D.txs.push({id:999,card:"nh",category:"고아분류",amount:0});D.catColors["고아분류"]="#abcdef";D.rules.push({match:"예시충돌",category:"규칙고아"});CS.migrate(D)');
 value('[data-cat="1"]',"고아분류");assert.equal(el('[data-cat="1"]').value,"내 분류");assert.equal(run('D.catColors[CS.findName(D,"고아분류")]'),"#abcdef");assert.equal(run('catName(D.txs.find(t=>t.id===999).category)'),"고아분류");
 value('[data-cat="1"]',"규칙고아");assert.equal(el('[data-cat="1"]').value,"내 분류");assert.equal(run('catName(D.rules.at(-1).category)'),"규칙고아");
 // Render/dispose removes any portal and opens only one menu without stale handlers.
 run('view="settle";D.cur="samsung";render()');const last=el("[data-cat-picker]");press(last,"ArrowDown",{altKey:true});run("render()");assert.equal(el(".category-menu"),null);assert.equal(d.querySelectorAll("[role=listbox]").length,0);
 // Sidebar issuer filter is view-only: no storage writes, dirty flag, or table re-render.
 run('view="settle";D.acct="352";D.cur="shinhan";render();dirty=false');const fSaves=saves,fTable=el("[data-settle-table]"),fDraft=JSON.stringify(json("D")),fMeta=el("#category-sidebar").ownerDocument.querySelector(".account-card")?.textContent;
 const sum=(card)=>json("D.txs").filter(t=>!card||t.card===card).reduce((n,t)=>n+t.amount,0),wonT=n=>n.toLocaleString("ko-KR")+"원",sel=()=>el("#sidebar-issuer");
 assert.equal(sel().options.length,1+fixture.config.cards.length);assert.equal(sel().value,"");assert.equal(el("[data-sidebar-total]").textContent,wonT(sum()));
 sel().value="nh";sel().dispatchEvent(event("change"));assert.equal(el("[data-sidebar-total]").textContent,wonT(sum("nh")));assert.equal(saves,fSaves);assert.equal(run("dirty"),false);assert.equal(JSON.stringify(json("D")),fDraft);assert.equal(el("[data-settle-table]"),fTable);assert.equal(el(".account-card")?.textContent,fMeta);
 const cats=[...d.querySelectorAll(".category-total")].map(n=>n.firstElementChild.textContent);assert.deepEqual(cats,json("CU.orderedCategories(D.cats,D.txs).map(id=>catName(id))"));
 const emptyIssuer=fixture.config.cards.find(c=>!json("D.txs").some(t=>t.card===c.id));if(emptyIssuer){sel().value=emptyIssuer.id;sel().dispatchEvent(event("change"));assert.equal(el("[data-sidebar-total]").textContent,"0원");assert.ok([...d.querySelectorAll(".category-total")].every(n=>n.classList.contains("is-zero")))}
 sel().value="samsung";sel().dispatchEvent(event("change"));const before=sum("samsung");
 run('D.txs.find(t=>t.card==="samsung").amount+=7;refreshCategorySidebar()');assert.equal(sel().value,"samsung");assert.equal(el("[data-sidebar-total]").textContent,wonT(before+7));
 el('nav [data-view="rules"]').click();el('nav [data-view="settle"]').click();assert.equal(sel().value,"samsung");
 run('D.txs.push({id:9999,card:"samsung",date:"2026-11-01",orig:"x",label:"x",amount:5,category:"개인",pending:"settle"});refreshCategorySidebar()');assert.equal(el("[data-sidebar-total]").textContent,wonT(before+7));
 await saveClick();assert.equal(sel().value,"samsung");assert.equal(el("[data-sidebar-total]").textContent,wonT(sum("samsung")));
 run('sidebarIssuer="bogus";refreshCategorySidebar()');assert.equal(sel().value,"");assert.equal(el("[data-sidebar-total]").textContent,wonT(sum()));
 // Selection is view-only; 정산/삭제 stage intents that only top Save applies.
 run(`view="settle";D.acct="352";D.cur="shinhan";S.txs=[{id:501,card:"shinhan",date:"2026-11-01",orig:"가나마트",label:"가나",amount:1000,sourceAmount:1200,category:"개인",note:""},{id:502,card:"shinhan",date:"2026-11-02",orig:"다라마트",label:"다라",amount:2000,category:"개인",note:""},{id:503,card:"shinhan",date:"2026-11-03",orig:"마바",label:"마바",amount:3000,category:"개인",note:"",chk:true},{id:504,card:"samsung",date:"2026-11-04",orig:"사아",label:"사아",amount:4000,category:"개인",note:""}];S.learnedRules=[];D=draftOf(S);selected.clear();dirty=false;render()`);
 el("#sidebar-issuer").value="shinhan";el("#sidebar-issuer").dispatchEvent(event("change"));
 const box=id=>el(`[data-chk="${id}"]`),pick=(id,on=true)=>{box(id).checked=on;box(id).dispatchEvent(event("change"))},s0=saves,ledger0=run("S.ledger.length"),draft0=JSON.stringify(json("D"));
 assert.equal(run("D.txs.some(t=>'chk' in t)"),false,"legacy chk never carries into draft");assert.equal(box(503).checked,false);assert.equal(el("#addv").textContent,"+ 수기 입력");assert.equal(el("#chkall").textContent,"전체");
 assert.ok(el("#chkall").parentElement===el("#settle-selected").parentElement&&el("#delete-selected").parentElement.classList.contains("toolbar-actions"));
 pick(501);box(501).focus();assert.equal(run("dirty"),false);assert.equal(saves,s0);assert.equal(JSON.stringify(json("D")),draft0);assert.equal(d.activeElement,box(501));
 await saveClick();assert.equal(run("S.ledger.length"),ledger0,"select+Save never settles");assert.deepEqual(json("S.txs.map(t=>t.id)"),[501,502,503,504]);const s1=saves;
 run("selected.add(504)");el("#chkall").click();assert.deepEqual(json("[...selected].sort()"),[501,502,503,504]);el("#chkall").click();assert.deepEqual(json("[...selected]"),[504],"전체 toggles current issuer only");run("selected.clear()");el("#chkall").click();assert.equal(run("selected.has(504)"),false);assert.ok([501,502,503].every(id=>box(id).checked));
 pick(502,false);pick(503,false);run('D.txs.find(t=>t.id===501).category="데이트";D.txs.find(t=>t.id===501).categoryEdited=true;D.txs.find(t=>t.id===502).category="데이트";D.txs.find(t=>t.id===502).categoryEdited=true');
 el("#settle-selected").click();assert.equal(run("D.txs.find(t=>t.id===501).pending"),"settle");assert.equal(run("selected.size"),0);assert.ok(el('[data-row="501"]').classList.contains("pending-settle"));assert.equal(run("dirty"),true);assert.equal(saves,s1);
 pick(502);const asked=[];w.confirm=m=>{asked.push(m);return false};el("#delete-selected").click();assert.match(asked[0],/1건/);assert.equal(run("D.txs.find(t=>t.id===502).pending"),undefined);assert.equal(run("selected.has(502)"),true);
 w.confirm=()=>true;el("#delete-selected").click();assert.equal(run("D.txs.find(t=>t.id===502).pending"),"delete");assert.ok(el('[data-row="502"]').classList.contains("pending-delete"));pick(503);
 assert.equal(el("[data-sidebar-total]").textContent,"3,000원","pending rows are excluded in preview");assert.equal(run('calc("shinhan").done'),1000);assert.equal(el("#sidebar-issuer").value,"shinhan");
 const sBefore=JSON.stringify(json("S")),dBefore=JSON.stringify(json("D")),puts=gh.puts;gh.failQueue.push({method:"PUT",type:"network"});assert.equal(await run("doSave()"),false);assert.equal(gh.puts,puts,"network failure before write");assert.equal(run("REMOTE.unknown"),null);
 assert.equal(JSON.stringify(json("S")),sBefore);assert.equal(JSON.stringify(json("D")),dBefore,"failed Save keeps draft and intents");assert.equal(run("dirty"),true);
 await saveClick();const L=json("S.ledger").slice(ledger0);assert.equal(L.length,1);assert.equal(L[0].orig,"가나마트");assert.equal(L[0].sourceAmount,1200);assert.equal(L[0].amount,1000);assert.equal("pending" in L[0],false);
 assert.deepEqual(json("S.txs.map(t=>t.id)"),[503,504],"checked-only row stays, deleted row gone");assert.equal(JSON.parse(w.localStorage.getItem(key)).txs.some(t=>"pending" in t||"chk" in t),false);
 assert.deepEqual(json("S.learnedRules.map(r=>r.merchant)"),["가나마트"],"deleted rows never teach categories");assert.equal(el("#sidebar-issuer").value,"shinhan");
 await saveClick();assert.equal(run("S.ledger.length"),ledger0+1,"no duplicate ledger");
 // Row ✕ uses the same pending-delete path and can be undone.
 el('[data-del="503"]').click();assert.equal(run("D.txs.find(t=>t.id===503).pending"),"delete");el('[data-undo="503"]').click();assert.equal(run("D.txs.find(t=>t.id===503).pending"),undefined);
 console.log("test-category-ui: ok (issuer filter, select/settle/delete intents, colors/order, all-card sums, shortcuts, stable inputs, draft settings, save/reload, rename safety)");dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
