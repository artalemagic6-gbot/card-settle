#!/usr/bin/env node
"use strict";
// Synthetic-only tests for encrypted server storage (no network, no real tokens or data).
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{JSDOM}=require("jsdom");
const root=path.join(__dirname,".."),RS=require("../docs/remote-sync.js"),FG=require("./fixtures/fake-github.js"),fixture=require("./fixtures/ui-example.json");
const KEY="card-settle-pages-v2",clone=x=>JSON.parse(JSON.stringify(x));
const rich=()=>{const s=clone(fixture.state);s.txs[0].sourceAmount=1200;s.txs[0].amount=1000;s.ledger=[{lid:"L1",date:"2026-10-01",orig:"예시",label:"예시",amount:900,sourceAmount:1000,category:"개인",card:"shinhan"}];s.cycles=[{card:"shinhan",used:10,closedAt:"2026-10-02"}];s.learnedRules=[{issuer:"shinhan",cardRef:"A",merchant:"예시",category:"개인"}];s.cardAliases={shinhan:{A:"생활"}};s.lastReconciledAt="2026-10-18T02:30:00+09:00";s.catColors={개인:"#123456"};s.accounts={"352":{balance:5,safetyBuffer:0}};return s};
const {boot}=require("./fixtures/pages-app.js");
const remoteState=async gh=>(await RS.decryptState(gh.file.text,FG.PASS)).state;
const seed=async(gh,state)=>{gh.file={sha:"seed"+(++gh.n),text:await RS.encryptState(state,FG.PASS,"seed-"+gh.n)}};
(async()=>{
 // 1. Encryption: full round trip, random IV/salt, wrong password, tampering, AAD-bound saveId.
 const st=rich(),a=await RS.encryptState(st,FG.PASS,"id-1"),b=await RS.encryptState(st,FG.PASS,"id-1");
 assert.notEqual(JSON.parse(a).iv,JSON.parse(b).iv);assert.notEqual(JSON.parse(a).kdf.salt,JSON.parse(b).kdf.salt);assert.ok(!a.includes("예시")&&!a.includes("1200"));
 const back=await RS.decryptState(a,FG.PASS);assert.deepEqual(back.state,st);assert.equal(back.saveId,"id-1");
 await assert.rejects(RS.decryptState(a,"wrong"),e=>e.kind==="decrypt");
 const t=JSON.parse(a);t.ct=t.ct.slice(0,-4)+(t.ct.slice(-4)==="AAAA"?"BBBB":"AAAA");await assert.rejects(RS.decryptState(JSON.stringify(t),FG.PASS),e=>e.kind==="decrypt");
 const swapped=JSON.parse(a);swapped.saveId="other";await assert.rejects(RS.decryptState(JSON.stringify(swapped),FG.PASS),e=>e.kind==="decrypt");
 await assert.rejects(RS.decryptState("not json",FG.PASS),e=>e.kind==="schema");await assert.rejects(RS.encryptState({txs:"x"},FG.PASS,"id"),e=>e.kind==="schema");
 const tok=await RS.encryptToken(FG.TOKEN,FG.PASS,FG.REMOTE_CFG);assert.ok(!tok.includes(FG.TOKEN));assert.equal(await RS.decryptToken(tok,FG.PASS,FG.REMOTE_CFG),FG.TOKEN);
 await assert.rejects(RS.decryptToken(tok,"wrong",FG.REMOTE_CFG));await assert.rejects(RS.decryptToken(tok,FG.PASS,{...FG.REMOTE_CFG,repo:"other"}));
 assert.equal(RS.validConfig(FG.REMOTE_CFG),true);assert.equal(RS.validConfig({...FG.REMOTE_CFG,token:"x"}),false);assert.equal(RS.validConfig({...FG.REMOTE_CFG,path:"../x"}),false);
 const pub=JSON.parse(fs.readFileSync(path.join(root,"docs/data/remote.json"),"utf8"));assert.equal(RS.validConfig(pub),true);assert.deepEqual(Object.keys(pub).sort(),["branch","owner","path","repo"]);
 for(const f of fs.readdirSync(path.join(root,"docs"),{recursive:true}).filter(f=>/\.(js|json|html)$/.test(f))){const txt=fs.readFileSync(path.join(root,"docs",f),"utf8");assert.doesNotMatch(txt,/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/,`no token-like string in ${f}`)}
 // 2. Client: private check, auth/permission/404 distinctions, no-store authenticated reads.
 {const gh=FG.makeFakeGitHub(),c=RS.makeClient({fetch:gh.fetch,cfg:FG.REMOTE_CFG,token:FG.TOKEN});assert.equal(await c.checkRepo(),true);assert.deepEqual(await c.read(),{exists:false,sha:null,text:null});
  assert.ok(gh.log.every(l=>l.cache==="no-store"&&l.auth));gh.repoPrivate=false;await assert.rejects(c.checkRepo(),e=>e.kind==="public");gh.repoPrivate=true;
  gh.forbidden=true;await assert.rejects(c.checkRepo(),e=>e.kind==="forbidden");await assert.rejects(c.read(),e=>e.kind==="forbidden","403 is never treated as empty");gh.forbidden=false;
  gh.repoExists=false;await assert.rejects(c.checkRepo(),e=>e.kind==="repoMissing");gh.repoExists=true;
  const bad=RS.makeClient({fetch:gh.fetch,cfg:FG.REMOTE_CFG,token:"expired"});await assert.rejects(bad.checkRepo(),e=>e.kind==="auth");await assert.rejects(bad.read(),e=>e.kind==="auth");
  const w1=await c.write("{\"x\":1}",null);await assert.rejects(c.write("{}",null),e=>e.kind==="conflict","create never overwrites");gh.big=true;assert.equal((await c.read()).text,"{\"x\":1}");gh.big=false;
  const r=await RS.saveRemote({client:c,text:"{}",saveId:"s",baseSha:"stale"});assert.equal(r.status,"conflict");assert.equal(gh.file.sha,w1.sha);}
 // 3. Empty device + existing server copy (remembered encrypted token): loads server, writes nothing.
 {const gh=FG.makeFakeGitHub();await seed(gh,rich());const token=await RS.encryptToken(FG.TOKEN,FG.PASS,FG.REMOTE_CFG);const app=await boot({gh,storage:{"card-settle-remote-token-v1":token}});
  assert.equal(app.run("REMOTE.connected"),true);assert.deepEqual(app.json("S.txs.map(t=>t.sourceAmount)"),clone(rich().txs.map(t=>t.sourceAmount)));assert.equal(app.json("S.ledger")[0].sourceAmount,1000);assert.equal(app.run("S.lastReconciledAt"),"2026-10-18T02:30:00+09:00");assert.equal(app.run("S.cardAliases.shinhan.A"),"생활");
  assert.equal(app.writes.length,0,"startup writes nothing");assert.equal(gh.puts,0);assert.equal(app.el("#remote-status").textContent,"서버 연결됨");
  for(let i=0;i<app.w.localStorage.length;i++)assert.ok(!app.w.localStorage.getItem(app.w.localStorage.key(i)).includes(FG.TOKEN));assert.equal(app.w.sessionStorage.length,0);
  // Wrong unlock password: server copy blocked, never blank-saved.
  const wrong=await boot({gh,pass:"wrong-pass",storage:{"card-settle-remote-token-v1":token}});assert.equal(wrong.run("REMOTE.connected"),false);assert.equal(await wrong.save(),false);assert.equal(gh.puts,0);app.dom.window.close();wrong.dom.window.close()}
 // 4. Blank device, no server file: never auto-creates; explicit upload only. Unconnected Save keeps the draft.
 {const gh=FG.makeFakeGitHub(),app=await boot({gh});app.run('D.txs.push({id:77,card:"shinhan",amount:5,category:"개인",orig:"x",label:"x"});touch()');assert.equal(await app.save(),false);assert.equal(app.el("#remote-dialog").hasAttribute("open"),true);assert.equal(app.run("dirty"),true);assert.equal(app.el("#remote-status").textContent,"연결 필요");
  assert.equal(await app.connect(),false);assert.equal(gh.puts,0);assert.ok(app.el("#remote-migrate"));app.w.confirm=()=>false;app.el("#remote-migrate").click();assert.equal(await app.run("saveTask"),false);assert.equal(gh.puts,0);
  app.w.confirm=()=>true;app.el("#remote-migrate").click();assert.equal(await app.run("saveTask"),true);assert.equal(gh.puts,1);assert.equal((await remoteState(gh)).txs.some(t=>t.id===77),false,"unsaved draft is not uploaded");assert.equal(app.run("D.txs.some(t=>t.id===77)"),true,"draft preserved");assert.equal(app.run("dirty"),true);
  assert.equal(await app.save(),true);assert.equal((await remoteState(gh)).txs.some(t=>t.id===77),true);app.dom.window.close()}
 // 5. Local browser data differs from server and no prior link: explicit choice + backups without credentials.
 {const gh=FG.makeFakeGitHub();const server=rich();server.txs=[];await seed(gh,server);const app=await boot({gh,local:rich()});assert.equal(await app.connect(FG.TOKEN,true),false);assert.equal(app.run("REMOTE.connected"),false);assert.equal(app.run("S.txs.length"),rich().txs.length);
  assert.equal(await app.save(),false);assert.equal(gh.puts,0);app.el("#remote-backup-saved").click();const saved=app.run("lastDownload.text");assert.deepEqual(JSON.parse(saved).state.txs.length,rich().txs.length);app.el("#remote-backup-draft").click();
  for(const txt of [saved,app.run("lastDownload.text")]){assert.ok(!txt.includes(FG.TOKEN));assert.ok(!/token/i.test(txt))}
  const stored=app.w.localStorage.getItem("card-settle-remote-token-v1");assert.ok(stored&&!stored.includes(FG.TOKEN),"remembered token only encrypted");
  app.el("#remote-use-server").click();assert.equal(await app.run("saveTask"),true);assert.equal(app.run("S.txs.length"),0);assert.equal(app.run("REMOTE.connected"),true);assert.equal(JSON.parse(app.w.localStorage.getItem(KEY)).txs.length,rich().txs.length,"browser copy kept until next confirmed save");app.dom.window.close()}
 // 6. Two browsers: stale SHA conflicts, draft/pending kept, explicit reload; lost response is idempotent; unknown locks; cache failure after ack; token expiry; double click.
 {const gh=FG.makeFakeGitHub();await seed(gh,rich());const A=await boot({gh}),B=await boot({gh});assert.equal(await A.connect(),true);assert.equal(await B.connect(),true);
  const id=A.run("D.txs[0].id");A.run(`D.txs[0].pending="settle";touch()`);const l0=(await remoteState(gh)).ledger.length;assert.equal(await A.save(),true);assert.equal((await remoteState(gh)).ledger.length,l0+1);assert.equal((await remoteState(gh)).txs.some(t=>t.id===id),false);
  B.run(`D.txs[1].pending="delete";D.txs[2].note="b-edit";touch()`);const bS=JSON.stringify(B.json("S")),bD=JSON.stringify(B.json("D")),puts=gh.puts;assert.equal(await B.save(),false);assert.equal(gh.puts,puts);assert.equal(B.el("#remote-status").textContent,"저장 충돌");assert.equal(JSON.stringify(B.json("S")),bS);assert.equal(JSON.stringify(B.json("D")),bD,"conflict keeps draft and pending");assert.ok(B.el("#remote-reload"));
  B.el("#remote-reload").click();assert.equal(await B.run("saveTask"),true);assert.equal(B.run("S.ledger.length"),l0+1);assert.equal(B.run("dirty"),false);
  // Lost response after the write landed: recognised by saveId, ledger written exactly once.
  A.run(`D.txs[0].pending="settle";touch()`);const settleId=A.run("D.txs[0].id");gh.failQueue.push({method:"PUT",type:"lost"});const before=(await remoteState(gh)).ledger.length;assert.equal(await A.save(),true);assert.equal((await remoteState(gh)).ledger.length,before+1);assert.equal(A.run(`S.txs.some(t=>t.id===${settleId})`),false);assert.equal(await A.save(),true);assert.equal((await remoteState(gh)).ledger.length,before+1,"no replay");
  // Unknown outcome: locked, draft kept; recheck shows not applied; then normal save.
  A.run(`D.txs[0].note="unknown-edit";touch()`);gh.failQueue.push({method:"PUT",status:502},{method:"GET",type:"network"});const dU=JSON.stringify(A.json("D"));assert.equal(await A.save(),false);assert.ok(A.run("REMOTE.unknown"));assert.ok(A.el(".workspace").hasAttribute("inert"));assert.equal(A.el("#save").textContent,"서버 다시 확인");assert.equal(JSON.stringify(A.json("D")),dU);
  assert.equal(await A.save(),false,"recheck: not applied");assert.equal(A.run("REMOTE.unknown"),null);assert.equal(A.el(".workspace").hasAttribute("inert"),false);assert.equal(JSON.stringify(A.json("D")),dU);assert.equal(await A.save(),true);assert.equal((await remoteState(gh)).txs[0].note,"unknown-edit");
  // Server ack then browser cache failure: still saved, no rollback, next save uses new SHA.
  A.run(`D.txs[0].note="cache-fail";touch()`);A.setFailKey(true);const n=A.alerts.length;assert.equal(await A.save(),true);A.setFailKey(false);assert.match(A.alerts[n],/서버에는 저장됐어요/);assert.equal(A.run("REMOTE.sha"),gh.file.sha);assert.equal(A.run("dirty"),false);assert.equal(A.el("#remote-status").textContent,"서버 저장됨");A.run(`D.txs[0].note="after";touch()`);assert.equal(await A.save(),true);
  // Token expiry: draft kept, reconnect at same SHA keeps the draft, then save.
  gh.tokens.clear();A.run(`D.txs[0].note="expired-edit";touch()`);assert.equal(await A.save(),false);assert.equal(A.run("REMOTE.connected"),false);assert.equal(A.el("#remote-status").textContent,"연결 필요");assert.equal(A.run("D.txs[0].note"),"expired-edit");
  gh.tokens.add(FG.TOKEN);assert.equal(await A.connect(),true);assert.equal(A.run("D.txs[0].note"),"expired-edit");assert.equal(await A.save(),true);assert.equal((await remoteState(gh)).txs[0].note,"expired-edit");
  // Double click while saving: one write only; inputs locked during the write.
  A.run(`D.txs[0].note="dbl";touch()`);const p=gh.puts;A.el("#save").click();const first=A.run("saveTask");assert.ok(A.el(".workspace").hasAttribute("inert"));assert.equal(A.el("#save").disabled,true);A.el("#save").click();assert.equal(A.run("saveTask"),first,"disabled button ignores the second click");assert.equal(await A.run("doSave()"),false,"re-entrant save refused");assert.equal(await first,true);assert.equal(gh.puts,p+1);
  // Checked/selected-only rows never settle remotely.
  A.run("selected.add(D.txs[0].id)");const ledgerN=(await remoteState(gh)).ledger.length;assert.equal(await A.save(),true);assert.equal((await remoteState(gh)).ledger.length,ledgerN);assert.ok(!gh.file.text.includes(FG.TOKEN));
  A.dom.window.close();B.dom.window.close()}
 // 7. Link trust needs the exact target + unchanged browser copy; settings/financial-only data is never "blank".
 {const gh=FG.makeFakeGitHub();const server=rich();await seed(gh,server);const target=`${FG.REMOTE_CFG.owner}/${FG.REMOTE_CFG.repo}@${FG.REMOTE_CFG.branch}:${FG.REMOTE_CFG.path}`;
  const settingsOnly={...clone(fixture.state),txs:[],ledger:[],cycles:[],learnedRules:[],lastReconciledAt:"2026-11-01T01:00:00+09:00",accounts:{"352":{balance:0,safetyBuffer:0}},cards:{shinhan:{used:123456}},rules:[{match:"x",category:"개인"}]};
  const cases=[["settings-only",{}],["old marker",{"card-settle-remote-v1":JSON.stringify({repo:`${FG.REMOTE_CFG.owner}/${FG.REMOTE_CFG.repo}/${FG.REMOTE_CFG.path}`,at:"x"})}],["other branch",{"card-settle-remote-v1":JSON.stringify({v:2,target:target.replace("@main","@other"),sha:"x",digest:"0"})}],["changed copy",{"card-settle-remote-v1":JSON.stringify({v:2,target,sha:"x",digest:"0:stale"})}]];
  for(const [name,storage] of cases){const app=await boot({gh,local:settingsOnly,storage});const before=app.json("S");assert.equal(await app.connect(),false,name);assert.equal(app.run("REMOTE.offer.type"),"choose",name);assert.deepEqual(app.json("S"),before,name);assert.equal(app.run("S.cards.shinhan.used"),123456);assert.equal(app.run('S.accounts["352"].safetyBuffer'),0);app.dom.window.close()}
  // A trusted link (written after a confirmed save, copy unchanged) auto-loads the newer server copy.
  const A=await boot({gh,local:settingsOnly});assert.equal(await A.connect(),false);A.el("#remote-use-server").click();assert.equal(await A.run("saveTask"),true);A.run(`D.txs[0].note="linked";touch()`);assert.equal(await A.save(),true);
  const mark=JSON.parse(A.w.localStorage.getItem("card-settle-remote-v1"));assert.equal(mark.v,2);assert.equal(mark.target,target);assert.equal(mark.sha,gh.file.sha);
  const B=await boot({gh,storage:{}});assert.equal(await B.connect(),true);B.run(`D.txs[0].note="from-b";touch()`);assert.equal(await B.save(),true);
  const A2=await boot({gh,local:JSON.parse(A.w.localStorage.getItem(KEY)),storage:{"card-settle-remote-v1":A.w.localStorage.getItem("card-settle-remote-v1")}});assert.equal(await A2.connect(),true);assert.equal(A2.run("S.txs[0].note"),"from-b");
  // Selection-only work survives reconnect (same SHA) and blocks adoption when the server moved.
  A2.run("selected.add(D.txs[1].id)");gh.tokens.clear();assert.equal(await A2.save(),false);gh.tokens.add(FG.TOKEN);assert.equal(await A2.connect(),true);assert.equal(A2.run("selected.size"),1,"same SHA keeps selection");
  gh.tokens.clear();await A2.save();gh.tokens.add(FG.TOKEN);B.run(`D.txs[0].note="moved";touch()`);assert.equal(await B.save(),true);assert.equal(await A2.connect(),false);assert.equal(A2.run("REMOTE.offer.type"),"choose");assert.equal(A2.run("selected.size"),1);assert.equal(A2.run("S.txs[0].note"),"from-b");
  // Explicit reload cancelled keeps token, draft, selection.
  A2.w.confirm=()=>false;A2.run('REMOTE.offer={type:"conflict"};REMOTE.connected=true;D.txs[0].note="mine";touch()');const tokBefore=A2.w.localStorage.getItem("card-settle-remote-token-v1");A2.run("openRemote()");A2.el("#remote-reload").click();assert.equal(await A2.run("saveTask"),false);assert.equal(A2.run("D.txs[0].note"),"mine");assert.equal(A2.run("dirty"),true);assert.equal(A2.run("selected.size"),1);assert.equal(A2.w.localStorage.getItem("card-settle-remote-token-v1"),tokBefore);A2.w.confirm=()=>true;
  // Edits during an in-flight connect are never overwritten; workspace locked; concurrent connect refused.
  const C=await boot({gh});const p1=C.run(`connectRemote(${JSON.stringify(FG.TOKEN)})`);assert.ok(C.el(".workspace").hasAttribute("inert"));await assert.rejects(C.run(`connectRemote(${JSON.stringify(FG.TOKEN)})`),e=>e.kind==="busy");C.run('D.txs.push({id:991,card:"shinhan",amount:1,category:"개인",orig:"z",label:"z"})');assert.equal(await p1,"choose");assert.equal(C.run("D.txs.some(t=>t.id===991)"),true);assert.equal(C.el(".workspace").hasAttribute("inert"),false);
  // Failed reconnect (bad token) keeps the prior working connection.
  const sha=B.run("REMOTE.sha");assert.equal(await B.connect("bad-token"),false);assert.equal(B.run("REMOTE.connected"),true);assert.equal(B.run("REMOTE.sha"),sha);B.run(`D.txs[0].note="still";touch()`);assert.equal(await B.save(),true);
  for(const x of [A,B,A2,C])x.dom.window.close()}
 console.log("test-remote-sync: ok (link trust/settings-only/branch, selection & in-flight connect safety, encryption/tamper, private repo checks, startup load, no auto-write, explicit migration/choice, conflicts, lost response, unknown lock, cache failure, token expiry, double click, backups without credentials)");
})().catch(e=>{console.error(e);process.exitCode=1});
