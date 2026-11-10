#!/usr/bin/env node
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.join(__dirname,".."),SM=require("../docs/settle-math.js");
const configs=[{id:"352",name:"352계좌",balance:0},{id:"302",name:"302계좌",balance:0},{id:"other",name:"기타",balance:0}];
const CFG={accounts:configs,cats:["개인"],rules:[],cards:[{id:"shinhan",name:"신한",account:"352",sort:1,payDay:14},{id:"samsung",name:"삼성",account:"352",sort:2,payDay:13},{id:"hana",name:"하나",account:"352",sort:3,payDay:13},{id:"nh",name:"농협",account:"302",sort:1,payDay:1}]};
const fixture={v:2,acct:"352",cur:"shinhan",nextId:4,accounts:{"352":{name:"352계좌",balance:559090},"302":{name:"302계좌",balance:100000},other:{name:"기타",balance:0}},cards:{shinhan:{used:50889,cycleStart:"2026-10-01"},samsung:{used:3560900},hana:{used:172090},nh:{used:0}},txs:[{id:1,card:"shinhan",amount:50889,date:"2026-11-07",orig:"원본",label:"내역",category:"개인",note:"메모",chk:false},{id:2,card:"samsung",amount:3554300,chk:false},{id:3,card:"hana",amount:119600,chk:false}],ledger:[],cycles:[],cats:["개인"],rules:[]};
const clone=x=>JSON.parse(JSON.stringify(x));
assert.equal(SM.defaultBuffer("352"),500000);assert.equal(SM.defaultBuffer("302"),100000);assert.equal(SM.defaultBuffer("other"),0);
const prior=clone(fixture.accounts),original=JSON.stringify(prior);const normalized=SM.normalizeAccounts(prior,configs);
assert.equal(JSON.stringify(prior),original,"normalization must not mutate saved input");assert.equal(normalized["352"].safetyBuffer,500000);assert.equal(normalized["352"].balance,559090);
prior["352"].safetyBuffer=0;assert.equal(SM.normalizeAccounts(prior,configs)["352"].safetyBuffer,0);assert.equal(SM.normalizeAccounts(JSON.parse(JSON.stringify(prior)),configs)["352"].safetyBuffer,0);
assert.equal(SM.cardTotals({used:10,openSum:-5}).deposit,15);assert.equal(SM.cardTotals({used:10,openSum:15}).deposit,-5);assert.equal(SM.number(Infinity),0);
const FG=require("./fixtures/fake-github.js"),RS=require("../docs/remote-sync.js"),gh=FG.makeFakeGitHub(),other=new Map();
let storage=JSON.stringify(fixture),saveCount=0,htmlWrites=0;const nodes=new Map();
const node=id=>{if(!nodes.has(id)){let html="";nodes.set(id,{hidden:false,style:{},textContent:"",className:"",addEventListener(){},setAttribute(){},toggleAttribute(){},classList:{toggle(){}},querySelector(){return node("button")},get innerHTML(){return html},set innerHTML(v){html=v;if(id==="#app"||id==="table[data-settle-table]")htmlWrites++}})}return nodes.get(id)};
const ctx={console,Date,Set,Map,Uint8Array,TextEncoder,Number,JSON,setTimeout,clearTimeout,fetch:async(u,o)=>String(u).startsWith("https://api.github.com/")?gh.fetch(u,o):String(u).includes("remote.json")?FG.resp(200,FG.REMOTE_CFG):({json:async()=>clone(CFG)}),crypto:globalThis.crypto,btoa,atob,TextDecoder,URL,confirm:()=>true,alert:()=>{},document:{querySelector:node,querySelectorAll:()=>[],getElementById:id=>node("#"+id)},sessionStorage:{getItem:()=>null},localStorage:{getItem:key=>key==="card-settle-pages-v2"?storage:other.get(key)??null,setItem:(key,value)=>{if(key==="card-settle-pages-v2"){storage=value;saveCount++}else other.set(key,value)},removeItem:key=>other.delete(key)},window:{}};
vm.createContext(ctx);for(const f of ["settle-edit.js","settle-math.js","category-ui.js","category-state.js","settle-tools.js","settle-workflow.js","remote-sync.js","app.js"])vm.runInContext(fs.readFileSync(path.join(root,"docs",f),"utf8"),ctx);
const run=s=>vm.runInContext(s,ctx),result=s=>JSON.parse(JSON.stringify(run(s))),connect=`connectRemote(${JSON.stringify(FG.TOKEN)})`;run(`PASS=${JSON.stringify(FG.PASS)}`);
(async()=>{
 // Exercise actual startup/migration: no storage writes and no data loss.
 run("render=()=>{}");await run("start()");assert.equal(saveCount,0);assert.equal(storage,JSON.stringify(fixture));assert.equal(run('D.accounts["352"].safetyBuffer'),500000);assert.deepEqual(result("D.txs.map(t=>({...t,category:catName(t.category)}))"),fixture.txs.map(({chk,...t})=>({...t,category:t.category||"미분류"})),"legacy chk is dropped from the draft only");
 // Server mode: unconnected Save refuses; explicit first upload of the saved browser state; startup wrote nothing.
 assert.equal(run("REMOTE.connected"),false);assert.equal(gh.puts,0);assert.equal(await run(connect),"migrate");assert.equal(gh.puts,0,"connect never auto-writes");assert.equal(await run("firstUpload()"),true);assert.equal(gh.puts,1);assert.equal(saveCount,0,"migration uploads saved state; no browser state rewrite");
 assert.deepEqual(result('CFG.cards.filter(c=>c.account==="352").map(c=>calc(c.id).deposit)'),[0,6600,52490]);
 assert.deepEqual(result('accountCalcIn(D,"352")'),{used:3783879,cardDeposit:59090,safetyBuffer:500000,deposit:559090,balance:559090,need:0});
 assert.equal(run('accountCalcIn(D,"302").need'),0);
 run('D.accounts["352"].balance=560090');assert.equal(run('accountCalcIn(D,"352").need'),-1000);assert.equal(run('calc("samsung").deposit'),6600);
 run('D.accounts["352"].balance=559090;D.txs[0].amount-=1000');assert.equal(run('calc("shinhan").deposit'),1000);assert.equal(run('accountCalcIn(D,"352").need'),1000);
 run('D.txs[0].amount+=1000;CFG.cards.reverse()');assert.equal(run('accountCalcIn(D,"352").need'),0);assert.equal(run('calc("shinhan").deposit'),0);
 // Legacy chk / selection alone never settles: Save keeps the row and writes no ledger.
 await run('D.txs[0].chk=true;selected.add(D.txs[0].id);doSave()');assert.equal(run("S.ledger.length"),0);assert.equal(run('S.txs.some(t=>t.card==="shinhan")'),true);assert.equal(JSON.parse(storage).txs.some(t=>"chk" in t),false);
 // Pending settlement previews deposit immediately; top Save moves it once.
 run('D.txs[0].pending="settle"');assert.equal(run('calc("shinhan").deposit'),50889);assert.equal(run('accountCalcIn(D,"352").need'),50889);assert.equal(saveCount,1);
 const table=node("table[data-settle-table]"),beforeWrites=htmlWrites;run("refreshSettleMeta()");assert.equal(node("table[data-settle-table]"),table);assert.equal(htmlWrites,beforeWrites,"summary must not replace input/table DOM");assert.equal(node("#account-deposit").textContent,"609,979원");
 await run("doSave()");assert.equal(saveCount,2);assert.equal(run('calc("shinhan").deposit'),50889);assert.equal(run('accountCalcIn(D,"352").need'),50889);assert.equal(run("S.ledger.length"),1);assert.equal(run('S.txs.some(t=>t.card==="shinhan")'),false);
 await run("doSave()");assert.equal(run("S.ledger.length"),1,"second Save must not duplicate ledger");
 await run('D.accounts["352"].safetyBuffer=0;doSave()');assert.equal(JSON.parse(storage).accounts["352"].safetyBuffer,0);const count=saveCount;await run("start()");assert.equal(await run(connect),"adopted");assert.equal(run('D.accounts["352"].safetyBuffer'),0);assert.equal(saveCount,count,"reload must not save");
 // Preserve old historical meanings; new snapshots explicitly name account-level need.
 await run('S.cycles=[{cardName:"신한",used:100,start:"2026-01-01",closedAt:"2026-02-01",need:77,openLeft:1}];D=clone(S);D.cards.shinhan.used+=1;doSave()');
 const cycles=result("S.cycles");assert.equal(cycles[0].need,77);assert.equal(cycles[1].formulaVersion,3);assert.equal(cycles[1].cardDeposit,50889);assert.equal(cycles[1].accountNeed,cycles[1].cardDeposit+6600+52490-559090);
 const history=run("historyView()");assert.match(history,/이전 방식 카드 필요액/);assert.match(history,/352 계좌 필요/);
 // Account model uses all open rows, not a UI category/search subset.
 run('D.txs.push({id:9,card:"samsung",amount:-140000,category:"다른분류"})');assert.equal(run('calc("samsung").deposit'),146600);
 const app=fs.readFileSync(path.join(root,"docs/app.js"),"utf8");assert.doesNotMatch(app,/Math\.max\(0,used-bal\)/);assert.match(app,/on\("#account-form"[^\n]+refreshSettleMeta/);
 const index=fs.readFileSync(path.join(root,"docs/index.html"),"utf8");assert.ok(index.indexOf("settle-math.js")<index.indexOf("./app.js"));assert.match(index,/app\.js\?v=\d{8}[a-z]/);
 // Saved chk/pending never revive processing after restart.
 {const st=JSON.parse(storage);st.txs=[{id:801,card:"shinhan",amount:10,orig:"a",label:"a",category:"개인",pending:"settle",chk:true},{id:802,card:"shinhan",amount:20,orig:"b",label:"b",category:"개인",pending:"delete"}];storage=JSON.stringify(st);const raw=storage,n=saveCount,l=run("S.ledger.length"),putsBefore=gh.puts;gh.file={sha:"seeded",text:await RS.encryptState(st,FG.PASS,"seed-1")};
 await run("start()");assert.equal(saveCount,n);assert.equal(storage,raw);assert.equal(run("D.txs.some(t=>'chk' in t||'pending' in t)"),false);assert.equal(run("selected.size"),0);assert.equal(await run(connect),"adopted");assert.equal(run("D.txs.some(t=>'chk' in t||'pending' in t)"),false);assert.equal(run("S.ledger.length"),l);
 await run("doSave()");assert.deepEqual(result("S.txs.map(t=>t.id)"),[801,802]);assert.equal(run("S.ledger.length"),l);assert.equal(JSON.parse(storage).txs.some(t=>"pending" in t||"chk" in t),false);const remote=(await RS.decryptState(gh.file.text,FG.PASS)).state;assert.deepEqual(remote.txs.map(t=>t.id),[801,802]);assert.equal(remote.txs.some(t=>"pending" in t||"chk" in t),false);assert.equal(gh.puts,putsBefore+1);}
 console.log("test-settle-math: ok (restart-safe intents, original formulas, signed totals, migration, startup, top-save ledger, history, stable DOM)");
})().catch(e=>{console.error(e);process.exitCode=1});
