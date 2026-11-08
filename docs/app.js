const KEY="card-settle-pages-v2",OLD="card-settle-pages-v1";const $=s=>document.querySelector(s);const won=n=>Math.round(n||0).toLocaleString("ko-KR")+"원";
let CFG,S,D,STG=null,view="settle",dirty=false;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));const now=()=>new Date().toISOString();
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const SE=globalThis.SettleEdit,SM=globalThis.SettleMath,CU=globalThis.CategoryUI,U=globalThis.SettleTools,WF=globalThis.SettleWorkflow;
let categoryPickers=[],accountDialogTrigger=null,settleSort={key:null,dir:1};
// --- gate ---
async function decrypt(pass){
 const meta=await (await fetch("./data/staging/meta.json",{cache:"no-store"})).json();
 const encRes=await fetch("./data/staging/"+meta.file,{cache:"no-store"});
 if(!encRes.ok) throw new Error("내역 파일을 못 불러왔어요 ("+encRes.status+")");
 const enc=(await encRes.text()).trim();
 const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
 const key=await crypto.subtle.deriveKey({name:"PBKDF2",hash:meta.kdf.hash,iterations:meta.kdf.iterations,salt:b64(meta.kdf.salt)},km,{name:"AES-GCM",length:256},false,["decrypt"]);
 const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(meta.cipher.iv)},key,b64(enc));
 return JSON.parse(new TextDecoder().decode(pt));
}
function tick(){return new Promise(r=>setTimeout(r,30))}
async function unlock(pass){pass=String(pass||"").trim();
 try{
  await tick();
  STG=await decrypt(pass);
  PASS=pass;
  await start();
  sessionStorage.setItem("cs_pass",pass);
  const g=$("#gate"),m=$("#main");if(g){g.hidden=true;g.style.display="none"}if(m){m.hidden=false;m.style.display=""}
  return true;
 }catch(e){
  console.warn("unlock",e);
  sessionStorage.removeItem("cs_pass");
  const g=$("#gate"),m=$("#main");if(g){g.hidden=false;g.style.display=""}if(m){m.hidden=true;m.style.display="none"}
  const msg=String(e&&e.message||e);
  if(/OperationError|decrypt|AES/i.test(msg)||e.name==="OperationError") return {ok:false,err:"암호가 틀렸어요."};
  return {ok:false,err:"입장 실패: "+msg};
 }
}
$("#gf").onsubmit=async e=>{e.preventDefault();const btn=e.submitter||$("#gf").querySelector("button");
 $("#gerr").textContent="확인 중…";if(btn)btn.disabled=true;
 try{const r=await unlock($("#gp").value);if(r!==true)$("#gerr").textContent=(r&&r.err)||"암호가 틀렸어요.";}
 finally{if(btn)btn.disabled=false}};
document.getElementById("gshow")?.addEventListener("change",e=>{$("#gp").type=e.target.checked?"text":"password"});
(async()=>{try{const p=sessionStorage.getItem("cs_pass");if(p){const r=await unlock(p);if(r===true)return}}catch(_){}const g=$("#gate");if(g){g.hidden=false;g.style.display=""}})();
// --- data ---
function shortName(m){let s=String(m||"").trim();
 s=s.replace(/^(네이버페이|naverpay|카카오페이|kakaopay|토스페이|토스|페이코|payco|NHN|KG이니시스|나이스페이|다날|쿠팡페이)[\s_\-:()（）]*/i,"").replace(/\(주\)|㈜|주식회사|\s+/g," ").trim();
 return s||String(m||"")}
function blank(){return{v:2,acct:"352",cur:"shinhan",nextId:1,txs:[],ledger:[],cycles:[],cats:[...CFG.cats],catColors:CU.normalizeColors({},CFG.cats),
 accounts:SM.normalizeAccounts({},CFG.accounts),
 cards:Object.fromEntries(CFG.cards.map(c=>[c.id,{used:0,cycleStart:now()}])),rules:CFG.rules.map(r=>({...r}))}}
function migrate(o){const s=blank();Object.assign(s,{acct:o.acct||s.acct,cur:o.cur||s.cur,nextId:o.nextId||1,rules:o.rules||s.rules,accounts:o.accounts||s.accounts});
 for(const c in o.cards||{})s.cards[c]={used:o.cards[c].used||0,cycleStart:now()};
 for(const t of o.txs||[]){const x={...t,orig:t.orig||t.merchant,label:t.label||shortName(t.merchant)};if(t.settled)s.ledger.push(rec(x,s));else s.txs.push({...x,chk:false})}return s}
function rec(t,s){const c=CFG.cards.find(x=>x.id===t.card)||{};return{lid:"L"+(s.ledger.length+1)+"-"+Date.now().toString(36)+"-"+t.id,date:t.date,orig:t.orig,label:t.label,amount:t.amount,
 sourceAmount:U.parseMoney(t.sourceAmount??t.amount),amountEstimated:!!t.amountEstimated,category:t.category,note:t.note||"",card:t.card,cardName:c.name,cardRef:U.safeCard(t.cardRef),physicalRef:U.cardRef(t),cardLabel:U.cardLabel(t,s),account:c.account,approval_no:t.approval_no||null,virtual:!!t.virtual,
 cycleStart:s.cards[t.card]?.cycleStart||null,cycleUsed:s.cards[t.card]?.used||0,loadedAt:t.loadedAt||null,settledAt:now()}}
function normalizeState(s){s.accounts=SM.normalizeAccounts(s.accounts,CFG.accounts);s.cats=s.cats||[...CFG.cats];
 s.cards=s.cards||{};for(const c of CFG.cards)if(!s.cards[c.id])s.cards[c.id]={used:0,cycleStart:now()};
 s.txs=s.txs||[];s.ledger=s.ledger||[];s.cycles=s.cycles||[];s.catColors=CU.normalizeColors(s.catColors,s.cats);Object.assign(s,U.normalizedState(s));return s}
async function start(){CFG=await (await fetch("./data/config.json",{cache:"no-store"})).json();
 // Browser copy is read unchanged (no startup writes). With a server connection the confirmed server copy wins.
 const raw=localStorage.getItem(KEY);if(raw)S=JSON.parse(raw);else{const o=localStorage.getItem(OLD);S=o?migrate(JSON.parse(o)):blank()}
 normalizeState(S);D=draftOf(S);dirty=false;
 document.querySelectorAll("nav button[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll("nav button[data-view]").forEach(x=>x.classList.toggle("on",x===b));render()});
 $("#save").onclick=()=>{saveTask=doSave();return saveTask};window.onbeforeunload=e=>{if(dirty||REMOTE.busy||REMOTE.unknown){e.preventDefault();e.returnValue=""}};bindRemoteUi();
 connectGen++;REMOTE={...REMOTE,cfg:await loadRemoteCfg(),client:null,sha:null,connected:false,connecting:false,offer:null,unknown:null,busy:false,error:""};
 const stored=REMOTE.cfg&&PASS?localStorage.getItem(RKEY_TOKEN):null;
 if(stored){try{await connectRemote(await RS.decryptToken(stored,PASS,REMOTE.cfg),{auto:true})}catch(e){REMOTE.error=String(e&&e.message||e)}}
 remoteStatus(REMOTE.connected?"서버 연결됨":"연결 필요");render()}
// Selection is view-only (ids, never saved). Pending intent lives on draft rows as t.pending and only takes effect at top Save.
const selected=new Set();
function draftOf(st){const d=clone(st);for(const t of d.txs||[]){delete t.chk;delete t.pending}return d}
function persist(state=S){localStorage.setItem(KEY,JSON.stringify(state))}
function touch(){dirty=true;$("#dirty").textContent="저장 안 됨"}
function buildNext(){const next=clone(D);const drop=new Set(next.txs.filter(t=>t.pending==="delete").map(t=>t.id));next.txs=next.txs.filter(t=>!drop.has(t.id));Object.assign(next,U.normalizedState(next),U.learn(next,now()));
 // Prepare a complete next state first. Storage failure must not move rows or teach rules.
 if(next.lastReconciledAt!==S.lastReconciledAt)next.cutoffHistory.push({previous:S.lastReconciledAt,current:next.lastReconciledAt,savedAt:now()});
 for(const c of CFG.cards){const o=S.cards[c.id]||{},n=next.cards[c.id];if(o.used&&n.used!==o.used){
  next.cycles.push({card:c.id,cardName:c.name,used:o.used,start:o.cycleStart,closedAt:now(),formulaVersion:3,accountId:c.account,cardDeposit:calcIn(S,c.id).deposit,accountNeed:accountCalcIn(S,c.account).need,safetyBuffer:accountCalcIn(S,c.account).safetyBuffer,openLeft:S.txs.filter(t=>t.card===c.id).length,balance:S.accounts[c.account].balance});n.cycleStart=now()}}
 const keep=[];for(const t of next.txs){delete t.categoryEdited;const settle=t.pending==="settle";delete t.chk;delete t.pending;if(settle)next.ledger.push(rec(t,next));else keep.push(t)}next.txs=keep;
 return next}
// --- server storage (private GitHub repo, client-side encrypted) ---
const RS=globalThis.RemoteSync,RKEY_TOKEN="card-settle-remote-token-v1",RKEY_MARK="card-settle-remote-v1";
let PASS="",saveTask=null,connectGen=0,REMOTE={cfg:null,client:null,sha:null,connected:false,busy:false,connecting:false,unknown:null,offer:null,error:""};
async function loadRemoteCfg(){try{const r=await fetch("./data/remote.json",{cache:"no-store"});const c=await r.json();return RS.validConfig(c)?c:null}catch(_){return null}}
const repoTarget=()=>REMOTE.cfg?`${REMOTE.cfg.owner}/${REMOTE.cfg.repo}@${REMOTE.cfg.branch}:${REMOTE.cfg.path}`:"";
// Change detector for the browser copy (not a security hash): the link is trusted only while that copy is byte-identical.
function digest(text){if(text==null)return "none";let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return `${text.length}:${(h2>>>0).toString(16)}${(h1>>>0).toString(16)}`}
function readMark(){try{return JSON.parse(localStorage.getItem(RKEY_MARK)||"null")}catch(_){return null}}
function writeMark(sha){localStorage.setItem(RKEY_MARK,JSON.stringify({v:2,target:repoTarget(),sha,digest:digest(localStorage.getItem(KEY)),at:now()}))}
function trustedLink(){const m=readMark();return !!m&&m.v===2&&m.target===repoTarget()&&typeof m.sha==="string"&&m.digest===digest(localStorage.getItem(KEY))}
const noLocalCopy=()=>localStorage.getItem(KEY)==null&&localStorage.getItem(OLD)==null;
const draftPrint=()=>JSON.stringify(D)+"|"+[...selected].sort().join(",");
const hasLocalWork=()=>dirty||selected.size>0||(D?.txs||[]).some(t=>t.pending);
const stateCounts=s=>`내역 ${(s.txs||[]).length}건 · 정산 기록 ${(s.ledger||[]).length}건 · 과거 회차 ${(s.cycles||[]).length}건 · 학습 분류 ${(s.learnedRules||[]).length}건`;
function remoteStatus(text){REMOTE.status=text;const n=$("#remote-status");if(n)n.textContent=text;const b=$("#save");if(b){b.disabled=!!REMOTE.busy;b.textContent=REMOTE.unknown?"서버 다시 확인":"저장"}const c=$("#remote");if(c)c.textContent=REMOTE.connected?"서버 연결됨":"서버 연결"}
function applyLock(){const ws=document.querySelector(".workspace");const on=!!(REMOTE.busy||REMOTE.unknown||REMOTE.connecting);if(ws){ws.inert=on;ws.toggleAttribute("inert",on);ws.setAttribute("aria-busy",String(on))}const b=$("#save");if(b)b.disabled=!!REMOTE.busy}
function setBusy(on){REMOTE.busy=on;applyLock()}
let lastDownload=null;
function download(name,obj){const text=JSON.stringify(obj,null,1);lastDownload={name,text};try{const url=URL.createObjectURL(new Blob([text],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(_){}}
const backupSaved=()=>download(`card-settle-saved-${now().slice(0,10)}.json`,{kind:"card-settle-saved-backup",exportedAt:now(),state:S});
const backupDraft=()=>download(`card-settle-draft-${now().slice(0,10)}.json`,{kind:"card-settle-draft-backup",exportedAt:now(),draft:D});
async function rememberToken(token,remember){if(remember)localStorage.setItem(RKEY_TOKEN,await RS.encryptToken(token,PASS,REMOTE.cfg));else localStorage.removeItem(RKEY_TOKEN)}
function adoptRemote(st,sha,explicit){S=normalizeState(st);D=draftOf(S);selected.clear();dirty=false;$("#dirty").textContent="";REMOTE.sha=sha;REMOTE.connected=true;REMOTE.offer=null;if(explicit){try{writeMark(sha)}catch(_){}}}
async function connectRemote(token,{remember=null,auto=false}={}){if(!REMOTE.cfg)throw new RS.RemoteError("config","서버 저장 설정이 없어요");if(!PASS)throw new RS.RemoteError("decrypt","입장 암호가 필요해요");
 if(REMOTE.busy||REMOTE.connecting)throw new RS.RemoteError("busy","이미 서버를 확인하는 중이에요");
 // Serialized: workspace locked; nothing in REMOTE changes unless every check succeeds; stale completions are ignored.
 const gen=++connectGen,fp=draftPrint();REMOTE.connecting=true;applyLock();
 try{const client=RS.makeClient({fetch:(u,o)=>fetch(u,o),cfg:REMOTE.cfg,token});await client.checkRepo();const cur=await client.read();
  const got=cur.exists?await RS.decryptState(cur.text,PASS):null;
  if(gen!==connectGen)return "stale";
  if(remember!==null)await rememberToken(token,remember);
  REMOTE.client=client;REMOTE.offer=null;
  if(!got){REMOTE.connected=false;REMOTE.sha=null;REMOTE.offer={type:"migrate"};return "migrate"}
  if(REMOTE.sha&&cur.sha===REMOTE.sha){REMOTE.connected=true;return "same"}
  const st=normalizeState(got.state),changedMeanwhile=draftPrint()!==fp;
  if(!changedMeanwhile&&!hasLocalWork()&&(noLocalCopy()||trustedLink()||JSON.stringify(S)===JSON.stringify(st))){adoptRemote(st,cur.sha,!auto&&!trustedLink());return "adopted"}
  REMOTE.connected=false;REMOTE.offer={type:"choose",state:st,sha:cur.sha};return "choose"}
 finally{if(gen===connectGen){REMOTE.connecting=false;applyLock()}}}
async function firstUpload(){if(REMOTE.busy||REMOTE.connecting||!REMOTE.client||REMOTE.offer?.type!=="migrate")return false;
 if(!confirm(`이 브라우저에 저장된 데이터를 서버에 처음 올릴까요?\n${stateCounts(S)}\n저장 안 된 변경은 올리지 않고 그대로 남아요.`))return false;
 const saveId=RS.newSaveId();setBusy(true);remoteStatus("서버 저장 중");let r;
 try{r=await RS.saveRemote({client:REMOTE.client,text:await RS.encryptState(S,PASS,saveId),saveId,baseSha:null})}catch(e){r={status:"failed",error:e}}
 return finishSave(r,{migrate:true,saveId,baseSha:null})}
async function doSave(){if(REMOTE.busy||REMOTE.connecting)return false;if(REMOTE.unknown)return resolveUnknown();
 if(!REMOTE.connected){remoteStatus("연결 필요");openRemote("서버에 연결해야 저장할 수 있어요. 작성 중인 내용은 그대로 남아 있어요.");return false}
 const next=buildNext(),saveId=RS.newSaveId(),baseSha=REMOTE.sha;setBusy(true);remoteStatus("서버 저장 중");let r;
 try{r=await RS.saveRemote({client:REMOTE.client,text:await RS.encryptState(next,PASS,saveId),saveId,baseSha})}catch(e){r={status:"failed",error:e}}
 return finishSave(r,{next,saveId,baseSha})}
async function resolveUnknown(){const u=REMOTE.unknown;if(!u||REMOTE.busy)return false;setBusy(true);remoteStatus("서버 확인 중");return finishSave(await RS.verify(REMOTE.client,u.saveId,u.baseSha,null),u)}
function finishSave(r,ctx){REMOTE.busy=false;
 if(r.status==="ok"){REMOTE.unknown=null;applyLock();if(ctx.migrate){REMOTE.sha=r.sha;REMOTE.connected=true;REMOTE.offer=null;try{writeMark(r.sha)}catch(_){alert("서버에는 올렸어요. 다만 이 브라우저 표시 저장에 실패했어요.")}closeRemote();remoteStatus("서버 저장됨");render();return true}
  S=ctx.next;D=draftOf(S);selected.clear();dirty=false;REMOTE.sha=r.sha;$("#dirty").textContent="";
  try{persist(S);writeMark(r.sha)}catch(e){alert("서버에는 저장됐어요. 다만 이 브라우저 보관본을 쓰지 못했어요. 다시 저장할 필요는 없어요.")}
  remoteStatus("서버 저장됨");render();return true}
 if(r.status==="unknown"){REMOTE.unknown=ctx;applyLock();remoteStatus("저장 확인 필요");alert("서버 저장 결과를 확인하지 못했어요. 편집은 잠시 잠가둘게요. 연결을 확인한 뒤 '서버 다시 확인'을 눌러주세요.");return false}
 REMOTE.unknown=null;applyLock();
 if(r.status==="conflict"){remoteStatus("저장 충돌");REMOTE.offer={type:"conflict"};openRemote("다른 곳에서 먼저 저장한 서버 저장본이 있어요. 작성 중인 내용과 정산·삭제 예정은 그대로 있어요. 작성 중 백업을 받은 뒤 서버 버전을 불러올 수 있어요.");return false}
 const k=r.error&&r.error.kind;if(["auth","forbidden","repoMissing","notFound","public"].includes(k))REMOTE.connected=false;
 remoteStatus(REMOTE.connected?"저장 실패":"연결 필요");alert(`서버에 저장하지 못했어요. 입력과 정산·삭제 예정은 그대로 남아 있어요.${r.error&&r.error.message?" ("+r.error.message+")":""}`);return false}
async function reloadFromServer(){if(REMOTE.busy||REMOTE.connecting||!REMOTE.client)return false;if(hasLocalWork()&&!confirm("작성 중인 변경, 선택, 정산·삭제 예정을 버리고 서버 최신 저장본을 불러올까요? 먼저 '작성 중 백업'을 받아두는 것을 권해요."))return false;
 const fp=draftPrint();setBusy(true);try{const cur=await REMOTE.client.read();if(!cur.exists)throw new RS.RemoteError("notFound","서버 저장본이 없어요");const got=await RS.decryptState(cur.text,PASS);if(draftPrint()!==fp)throw new RS.RemoteError("changed","불러오는 동안 화면이 바뀌어서 적용하지 않았어요. 다시 눌러주세요.");adoptRemote(got.state,cur.sha,true);closeRemote();remoteStatus("서버 연결됨");render();return true}
 catch(e){remoteStatus(REMOTE.connected?"서버 연결됨":"연결 필요");remoteMsg(String(e.message||e));return false}finally{setBusy(false)}}
async function useServerCopy(){const o=REMOTE.offer;if(!o||o.type!=="choose")return false;if(!confirm(`이 브라우저 저장본 대신 서버 데이터를 사용할까요?\n서버: ${stateCounts(o.state)}\n이 브라우저: ${stateCounts(S)}\n이 브라우저 보관본은 지우지 않아요.${hasLocalWork()?" 작성 중 변경·선택·정산/삭제 예정은 사라져요.":""}`))return false;adoptRemote(o.state,o.sha,true);closeRemote();remoteStatus("서버 연결됨");render();return true}
const remoteMsg=t=>{const m=$("#remote-msg");if(m)m.textContent=t};
function openRemote(msg){const dlg=$("#remote-dialog");if(!dlg)return;const o=REMOTE.offer,acts=$("#remote-actions");
 remoteMsg(msg||(o?.type==="migrate"?`서버에 저장본이 아직 없어요. 이 브라우저 저장본(${stateCounts(S)})을 확인하고 '저장본 백업'을 받은 뒤 처음 올려주세요.`:o?.type==="choose"?`서버 데이터와 이 브라우저 저장본이 달라요. 서버: ${stateCounts(o.state)} / 이 브라우저: ${stateCounts(S)}. 자동으로 덮어쓰지 않아요.`:REMOTE.connected?"서버에 연결돼 있어요.":REMOTE.error||"이 저장소 하나만 Contents 읽기/쓰기 권한이 있는 GitHub 토큰을 입력하세요."));
 acts.innerHTML=(o?.type==="migrate"?'<button type="button" id="remote-migrate" class="primary">서버로 처음 올리기</button>':o?.type==="choose"?'<button type="button" id="remote-use-server">서버 데이터 사용</button>':o?.type==="conflict"?'<button type="button" id="remote-reload">서버 버전 불러오기</button>':"")+(localStorage.getItem(RKEY_TOKEN)?'<button type="button" id="remote-forget" class="subtle">기억한 토큰 지우기</button>':"");
 const b=(id,f)=>{const n=document.getElementById(id);if(n)n.onclick=()=>{saveTask=f();return saveTask}};b("remote-migrate",firstUpload);b("remote-use-server",useServerCopy);b("remote-reload",reloadFromServer);b("remote-forget",()=>{localStorage.removeItem(RKEY_TOKEN);openRemote("기억한 토큰을 지웠어요.")});
 if(!dlg.open)dlg.showModal()}
function closeRemote(){const dlg=$("#remote-dialog");if(dlg?.open)dlg.close();const t=$("#remote-token");if(t)t.value=""}
async function connectFromForm(){const t=$("#remote-token"),token=String(t?.value||"").trim();if(!token){remoteMsg("토큰을 입력해 주세요.");return false}remoteMsg("확인 중…");
 try{const r=await connectRemote(token,{remember:!!$("#remote-remember")?.checked});if(t)t.value="";remoteStatus(REMOTE.connected?"서버 연결됨":"연결 필요");if(r==="adopted"||r==="same"){render();closeRemote();return true}openRemote();return false}
 catch(e){if(t)t.value="";remoteStatus(REMOTE.connected?"서버 연결됨":"연결 필요");remoteMsg(String(e&&e.message||e));return false}}
function bindRemoteUi(){const b=(s,f)=>{const n=$(s);if(n)n.onclick=f};b("#remote",()=>openRemote());b("#remote-connect",()=>{saveTask=connectFromForm();return saveTask});b("#remote-close",closeRemote);b("#remote-backup-saved",backupSaved);b("#remote-backup-draft",backupDraft)}
function classify(m,cid="",ref="",fallback=""){return U.resolveCategory(D,CFG.rules,m,cid,ref,fallback)}
const cardsOf=a=>CFG.cards.filter(c=>c.account===a).sort((x,y)=>x.sort-y.sort);
function calcIn(st,cid){const list=(st.txs||[]).filter(t=>t.card===cid);const os=list.reduce((a,t)=>a+SM.number(t.amount),0);
 const q=SM.cardTotals({used:st.cards[cid]?.used,openSum:os});
 return {...q,os,diff:q.deposit,done:list.filter(t=>t.pending==="settle").reduce((a,t)=>a+SM.number(t.amount),0)}}
function accountCalcIn(st,aid){const a=st.accounts[aid]||{};return SM.accountTotals({cards:cardsOf(aid).map(c=>calcIn(st,c.id)),balance:a.balance,safetyBuffer:a.safetyBuffer??SM.defaultBuffer(aid)})}
const calc=cid=>calcIn(D,cid);
const k=t=>t.approval_no?"a:"+t.approval_no:`d:${t.date}|${t.orig||t.merchant}|${t.amount}`;
function load(cid){const payload=U.importPayload(STG,cid),rows=payload.rows;if(payload.invalidUsed){alert("준비된 이용금액이 올바르지 않아 불러오지 않았어요.");return}if(!rows.length&&!payload.hasUsed){alert("이 카드의 준비된 내역이 없어요");return}
 if(rows.some(t=>!t||t.amount===null||t.amount===undefined||String(t.amount).trim()===""||U.parseMoney(t.amount)===null)){alert("준비된 내역의 금액을 확인해주세요.");return}
 const incoming=U.newRows(rows,[...D.txs,...D.ledger].filter(t=>t.card===cid));
 if(payload.hasUsed)D.cards[cid].used=payload.used;
 for(const t of incoming){const ref=U.safeCard(t.cardRef);D.txs.push({id:D.nextId++,card:cid,date:t.date,orig:t.merchant,label:t.label||shortName(t.merchant),amount:U.parseMoney(t.amount),sourceAmount:U.parseMoney(t.amount),amountEstimated:!!t.amountEstimated,approval_no:t.approval_no||null,
  cardRef:ref,sourceCardRef:ref,cardLabel:U.safeCard(t.cardLabel),datePrecision:t.datePrecision||null,needsReview:!!t.needsReview,classificationReason:t.classificationReason||"",
  category:classify(t.merchant,cid,ref,t.category),note:t.note||"",chk:false,virtual:false,loadedAt:now()})}
 touch();render();alert(`${incoming.length}건 불러옴 (이미 있거나 정산된 ${rows.length-incoming.length}건 제외)${payload.hasUsed?" · 이용금액 "+won(payload.used)+" 반영":" · 현재 이용금액은 유지"} — 저장을 눌러야 반영돼요`)}
const catOpts=v=>CU.orderedCategories(D.cats,D.txs).map((c,i)=>`<option value="${esc(c)}" ${c===v?"selected":""}>${CU.shortcutAt(i)} ${esc(c)}</option>`).join("");
function sortHeader(key,label){const active=settleSort.key===key;return `<th aria-sort="${active?(settleSort.dir===1?"ascending":"descending"):"none"}"><button type="button" data-sort="${key}" aria-label="${label} 정렬">${label}${active?(settleSort.dir===1?" ↑":" ↓"):""}</button></th>`}
function physicalOptions(t){const current=U.cardRef(t);return `<option value="">미지정</option>`+U.physicalCards(D,t.card).map(r=>`<option value="${esc(r.ref)}" ${r.ref===current?"selected":""}>${esc(r.label)}</option>`).join("")}
function openTable(list){const rows=U.sortRows(list,settleSort,D.cats,t=>U.cardLabel(t,D));return `<table data-settle-table><thead><tr>${[["date","날짜"],["physical","카드"],["orig","원본이름"],["label","내역"],["amount","금액"],["category","분류"],["note","메모"]].map(([key,label])=>sortHeader(key,label)).join("")}<th>선택</th><th></th></tr></thead><tbody>`+
 rows.map(t=>`<tr data-row="${t.id}" data-color-category="${esc(t.category||"미분류")}" class="${t.pending==="settle"?"done pending-settle":t.pending==="delete"?"pending-delete":""} ${t.virtual?"virtual":""}"><td>${SE.rowDateHtml(t,esc)}</td><td><select class="physical-card" data-physical="${t.id}" aria-label="개별 카드 표시" title="${esc(U.cardLabel(t,D))}">${physicalOptions(t)}</select></td><td class="k">${esc(t.orig)}${t.needsReview?'<span class="review-badge" title="날짜 또는 분류를 확인해주세요">확인</span>':""}</td>
 <td><input class="m" data-id="${t.id}" data-f="label" value="${esc(t.label)}"></td>
 <td class="n"><input data-id="${t.id}" data-f="amount" class="money-input" type="text" inputmode="decimal" value="${U.money(t.amount)}" title="${t.amountEstimated?"환율 환산 추정액 · 실제 원화 금액으로 수정할 수 있어요":"원화 금액"}" style="width:100px">${t.amountEstimated?`<small class="review-badge estimate-note" data-estimate="${t.id}">환산 추정</small>`:""}</td>
 <td><button type="button" class="category-picker" data-cat-picker="${t.id}">${esc(t.category)}</button></td><td><input data-id="${t.id}" data-f="note" value="${esc(t.note)}"></td>
 <td><input type="checkbox" data-chk="${t.id}" aria-label="선택" ${selected.has(t.id)?"checked":""}>${t.pending?`<small class="pending-badge">${t.pending==="settle"?"정산 예정":"삭제 예정"}</small>`:""}</td><td>${t.pending?`<button type="button" data-undo="${t.id}" class="subtle" title="예정 취소">취소</button>`:`<button type="button" data-del="${t.id}" aria-label="삭제 예정으로 표시">✕</button>`}</td></tr>`).join("")+"</tbody></table>"}
/** Update settle summary + mini cards without rebuilding the open-tx table (keeps focus for Tab). */
function refreshSettleMeta(){
 if(view!=="settle"||!D||!CFG)return;
 refreshCategorySidebar();
 const a=D.acct;const c=CFG.cards.find(x=>x.id===D.cur);if(!c)return;const r=calc(c.id),ar=accountCalcIn(D,a);
 const setTxt=(sel,txt)=>{const el=$(sel);if(el)el.textContent=txt};
 const paint=(sel,bad)=>{const el=$(sel);if(el)el.className="v "+(bad?"warn":"good")};
 setTxt("#account-used",won(ar.used));setTxt("#account-deposit",won(ar.deposit));
 setTxt("#account-need",won(ar.need));paint("#account-need",!!ar.need);
 setTxt("#sum-os",won(r.os));
 setTxt("#sum-diff",won(r.deposit));
 setTxt("#sum-done",won(r.done));
 document.querySelectorAll(".mini[data-card]").forEach(el=>{
  const q=calc(el.dataset.card);const usedEl=el.querySelector("[data-mini-used]");
  if(usedEl)usedEl.textContent="이용 "+won(q.used);
  const depositEl=el.querySelector("[data-mini-deposit]");if(depositEl)depositEl.textContent="입금 "+won(q.deposit);
  el.classList.toggle("ok",!!(q.used&&q.diff===0));
  el.classList.toggle("on",el.dataset.card===c.id);
 });
}
function settleView(){const a=D.acct;const cs=cardsOf(a);if(!cs.find(c=>c.id===D.cur))D.cur=cs[0].id;const c=CFG.cards.find(x=>x.id===D.cur);const r=calc(c.id),ar=accountCalcIn(D,a);
 const last=[...D.cycles].reverse().find(y=>y.card===c.id);
 return `<div class="account-choice"><div class="tabs">${CFG.accounts.map(x=>`<button data-acct="${x.id}" class="${x.id===a?"on":""}">${x.id==="other"?"기타":x.id}</button>`).join("")}</div><div class="cutoff"><span>최근 정리 <b id="cutoff-label">${U.cutoffLabel(D.lastReconciledAt)}</b></span><button type="button" id="cutoff-edit" class="subtle">일자 설정</button></div></div>
 <div class="card account-card"><div class="row"><b>${esc(D.accounts[a].name)}</b><button id="account-settings" class="subtle settings-button" type="button">계좌 설정</button><span class="k">총 이용금액</span><span id="account-used" class="v">${won(ar.used)}</span><span class="k">계좌 입금금액</span><span id="account-deposit" class="v">${won(ar.deposit)}</span></div>
 <div class="row"><label class="k" for="bal">현재잔고</label><input id="bal" class="money-input" type="text" inputmode="decimal" value="${U.money(ar.balance)}" style="width:120px"><span class="k">계좌 입금필요</span><span id="account-need" class="v ${ar.need?"warn":"good"}">${won(ar.need)}</span></div>
 <details class="formula-hint"><summary>계산 기준</summary><span>계좌 입금금액 = 카드별 입금금액 합 + 안전여유금 · 입금필요 = 계좌 입금금액 − 현재잔고</span></details></div>
 <div class="minis">${cs.map(x=>{const q=calc(x.id);return `<button type="button" class="mini ${x.id===c.id?"on":""} ${q.used&&q.diff===0?"ok":""}" data-card="${x.id}"><b>${x.name}</b><br><span class="k" data-mini-used>이용 ${won(q.used)}</span><br><span data-mini-deposit>입금 ${won(q.deposit)}</span></button>`}).join("")}</div>
 <div class="card"><h2 style="margin:0 0 6px">${c.name}카드 <span class="k" style="font-size:13px">결제일 ${c.payDay}일${last?` · 지난 회차 ${won(last.used)} (${last.closedAt.slice(0,10)})`:""}</span> <button type="button" id="card-settings" class="subtle settings-button">카드 설정</button></h2>
 <div class="row"><span class="k">이용금액</span><input id="used" class="money-input" type="text" inputmode="decimal" value="${U.money(r.used)}" placeholder="청구 이용금액"><span class="k">값을 바꿔 저장하면 이전 회차는 과거로 보관돼요</span></div>
 <div class="row"><span class="k">카드 입금금액</span><span id="sum-diff" class="v">${won(r.deposit)}</span><span class="k">= 이용금액 − 남겨둔 내역합 </span><span id="sum-os" class="k">${won(r.os)}</span><span class="k">· 정산 예정 </span><span id="sum-done" class="k">${won(r.done)}</span></div>
 <button class="big primary" id="load">카드내역 불러오기</button>
 <div class="row settle-toolbar"><button id="addv">+ 수기 입력</button><span class="toolbar-actions"><button type="button" id="chkall">전체</button><button type="button" id="settle-selected">정산</button><button type="button" id="delete-selected">삭제</button></span></div>
 <div class="table-scroll">${openTable(D.txs.filter(t=>t.card===c.id))}</div></div>`}
function ledgerView(){const L=[...S.ledger].sort((x,y)=>String(y.date).localeCompare(String(x.date)));const by=Object.create(null);L.forEach(t=>by[t.category]=(by[t.category]||0)+t.amount);
 return `<div class="card row"><span class="k">저장된 정산 ${L.length}건</span>${Object.entries(by).map(([k,v])=>`<span class="k">${esc(k)}</span><span class="v">${won(v)}</span>`).join(" ")}</div>
 <div class="card row"><button id="exp">JSON 내보내기</button><button id="csv">CSV 내보내기</button></div>
 <div class="card"><table><tr><th>날짜</th><th>카드</th><th>원본이름</th><th>내역</th><th>금액</th><th>분류</th><th>메모</th><th>정산일</th></tr>${L.map(t=>`<tr data-color-category="${esc(t.category||"미분류")}"><td>${esc(t.date).slice(0,16)}</td><td>${esc(t.cardName)}${t.cardLabel&&t.cardLabel!=="—"?`<br><span class="k">${esc(t.cardLabel)}</span>`:""}</td><td class="k">${esc(t.orig)}</td><td>${esc(t.label)}</td><td class="n">${won(t.amount)}</td><td>${esc(t.category)}</td><td>${esc(t.note)}</td><td class="k">${esc(t.settledAt).slice(0,10)}</td></tr>`).join("")}</table></div>`}
function historyView(){const cur=CFG.cards.map(c=>`<tr><td>${c.name}</td><td>현재</td><td class="n">${won(S.cards[c.id]?.used)}</td><td class="k">${esc(S.cards[c.id]?.cycleStart||"").slice(0,10)}~</td><td></td><td>${S.txs.filter(t=>t.card===c.id).length}</td></tr>`).join("");
 return `<div class="card"><h2>정리일 변경 기록</h2><p>현재 ${esc(U.cutoffLabel(D.lastReconciledAt))}</p>${(D.cutoffHistory||[]).slice().reverse().map(h=>`<p class="k">${esc(U.cutoffLabel(h.previous))} → ${esc(U.cutoffLabel(h.current))}</p>`).join("")}</div><div class="card"><table><tr><th>카드</th><th>회차</th><th>이용금액</th><th>기간</th><th>마감 계산값</th><th>남은 열린건</th></tr>${cur}
 ${[...S.cycles].reverse().map(y=>`<tr><td>${esc(y.cardName)}</td><td>과거</td><td class="n">${won(y.used)}</td><td class="k">${esc(y.start||"").slice(0,10)}~${esc(y.closedAt).slice(0,10)}</td><td class="n">${y.formulaVersion===3?`카드 입금 ${won(y.cardDeposit)}<br><span class="k">${esc(y.accountId)} 계좌 필요 ${won(y.accountNeed)}</span>`:`${won(y.need)}<br><span class="k">이전 방식 카드 필요액</span>`}</td><td>${y.openLeft}</td></tr>`).join("")}</table></div>`}
function rulesView(){return `<div class="card"><div class="section-heading"><h2>분류 설정</h2><span class="k">색상 · 표시 순서 · 단축키</span></div><p class="k">위에서부터 1–9, a–z로 선택해요. 변경 후 상단 저장을 눌러주세요.</p>
 <div class="row"><input id="cn" placeholder="새 분류 이름" aria-label="새 분류 이름"><button id="cadd">분류 추가</button></div>
 <div class="table-scroll"><table class="category-settings"><thead><tr><th>단축키</th><th>색상</th><th>분류 이름</th><th>순서</th><th></th></tr></thead><tbody>${D.cats.map((c,i)=>`<tr><td><kbd>${CU.shortcutAt(i)||"—"}</kbd></td><td><input type="color" data-color="${i}" value="${CU.colorFor(c,D.catColors)}" aria-label="${esc(c)} 색상"></td><td><input data-cat="${i}" value="${esc(c)}" aria-label="분류 이름"></td><td class="order-controls"><button type="button" data-move="${i}" data-step="-1" aria-label="${esc(c)} 위로" ${i===0?"disabled":""}>↑</button><button type="button" data-move="${i}" data-step="1" aria-label="${esc(c)} 아래로" ${i===D.cats.length-1?"disabled":""}>↓</button></td><td><button type="button" class="subtle" data-cdel="${i}" aria-label="${esc(c)} 삭제">삭제</button></td></tr>`).join("")}</tbody></table></div></div>
 <div class="card"><h2>자동분류 규칙</h2><div class="row"><input id="rm" placeholder="가맹점에 포함된 문자"><select id="rc" aria-label="자동분류 규칙의 분류">${catOpts()}</select><button id="radd">추가</button><button id="rapply" class="subtle">열린 내역에 재적용</button></div>
 <table>${D.rules.map((r,i)=>`<tr><td>${esc(r.match)}</td><td>${esc(r.category)}</td><td><button data-rdel="${i}" class="subtle">삭제</button></td></tr>`).join("")}</table></div>${WF.learnedPanel(D,esc,catOpts)}`}
let sidebarIssuer="";
function refreshCategorySidebar(){const el=$("#category-sidebar");if(!el||!D)return;if(sidebarIssuer&&!CFG.cards.some(c=>c.id===sidebarIssuer))sidebarIssuer="";const wasOpen=el.querySelector("details")?.open??true,hadFocus=document.activeElement?.id==="sidebar-issuer",txs=sidebarIssuer?D.txs.filter(t=>t.card===sidebarIssuer):D.txs,rows=CU.categoryTotals(D.cats,txs),total=rows.reduce((n,r)=>n+r.amount,0);
 el.innerHTML=`<details ${wasOpen?"open":""}><summary><span class="eyebrow">${sidebarIssuer?esc(CFG.cards.find(c=>c.id===sidebarIssuer).name):"모든 카드"}</span><h2>분류별 정산 예정</h2></summary><label class="sidebar-filter"><span class="sr-only">카드사 필터</span><select id="sidebar-issuer" aria-label="카드사 필터"><option value="">모든 카드</option>${CFG.cards.map(c=>`<option value="${esc(c.id)}" ${c.id===sidebarIssuer?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label><div class="sidebar-total" data-sidebar-total>${won(total)}</div><div class="category-totals">${rows.map(r=>`<div class="category-total ${r.amount===0?"is-zero":""}" style="--cat-color:${CU.colorFor(r.category,D.catColors)}"><span><i class="color-dot" aria-hidden="true"></i>${esc(r.category)}</span><strong>${won(r.amount)}</strong></div>`).join("")}</div><p class="sidebar-note">남겨둔 내역 합계예요.<br>정산·삭제 예정 내역도 저장 전에는 포함돼요.</p><button type="button" id="category-settings" class="subtle">분류 설정</button></details>`;
 const sel=el.querySelector("#sidebar-issuer");sel.onchange=()=>{sidebarIssuer=sel.value;refreshCategorySidebar()};if(hadFocus)sel.focus();
 const btn=$("#category-settings");if(btn)btn.onclick=()=>{view="rules";document.querySelectorAll("nav button[data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===view));render()}}
function closeAccountSettings(){const dialog=$("#account-dialog");if(dialog?.close)dialog.close();else dialog?.removeAttribute("open");if(accountDialogTrigger?.isConnected)accountDialogTrigger.focus()}
function openAccountSettings(){const dialog=$("#account-dialog");if(!dialog)return;accountDialogTrigger=$("#account-settings");dialog.dataset.account=D.acct;$("#account-dialog-title").textContent=D.accounts[D.acct].name+" 설정";$("#buffer").value=U.money(D.accounts[D.acct].safetyBuffer??SM.defaultBuffer(D.acct));if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","")}
function render(){categoryPickers.forEach(p=>p.destroy());categoryPickers=[];$("#app").innerHTML={settle:settleView,ledger:ledgerView,history:historyView,rules:rulesView}[view]();const on=(s,f,e="onclick")=>{const el=$(s);if(el)el[e]=f};const all=(s,f)=>document.querySelectorAll(s).forEach(f);
 const T=id=>D.txs.find(x=>x.id==id);
 refreshCategorySidebar();
 all("[data-color-category]",el=>CU.paintTransactionRow(el,el.dataset.colorCategory,D.catColors));
 all("[data-cat-picker]",el=>{const t=T(el.dataset.catPicker);if(!t)return;categoryPickers.push(CU.mountCategoryPicker(el,{getOptions:()=>CU.orderedCategories(D.cats,D.txs),getValue:()=>t.category,getColors:()=>D.catColors,onCommit:category=>{if(t.category!==category&&!t.virtual)t.categoryEdited=true;t.category=category;const row=el.closest("tr");row.dataset.colorCategory=category;CU.paintTransactionRow(row,category,D.catColors);touch();refreshCategorySidebar()}}))});
 // Inline field edits: update model (+ summary if needed) without destroying the table DOM so Tab/Shift+Tab stay natural.
 all("[data-f]",el=>el.onchange=()=>{const t=T(el.dataset.id);if(!t)return;const f=el.dataset.f;const value=f==="amount"?WF.moneyValue(el,t.amount):el.value;if(value===null)return;SE.applyField(t,f,value);if(f==="amount"){t.amountEstimated=false;$('[data-estimate="'+t.id+'"]')?.remove();el.title="수정한 원화 금액"}touch();if(SE.fieldAffectsSummary(f))refreshSettleMeta()});
 all("[data-chk]",el=>el.onchange=()=>{const t=T(el.dataset.chk);if(!t)return;if(el.checked)selected.add(t.id);else selected.delete(t.id)});
 all("[data-del]",b=>b.onclick=()=>{const t=T(b.dataset.del);if(t&&confirm("이 내역을 삭제 예정으로 표시할까요? 위의 저장을 눌러야 실제로 삭제돼요.")){t.pending="delete";selected.delete(t.id);touch();render()}});
 all("[data-undo]",b=>b.onclick=()=>{const t=T(b.dataset.undo);if(t){delete t.pending;touch();render()}});
 all("[data-acct]",b=>b.onclick=()=>{D.acct=b.dataset.acct;render()});
 all("[data-card]",b=>b.onclick=()=>{D.cur=b.dataset.card;render()});
 on("#bal",e=>{const n=WF.moneyValue(e.target,D.accounts[D.acct].balance);if(n===null)return;D.accounts[D.acct].balance=n;touch();refreshSettleMeta()},"onchange");
 on("#account-settings",openAccountSettings);
 on("#account-cancel",closeAccountSettings);
 on("#account-form",e=>{e.preventDefault();const value=U.parseMoney($("#buffer").value);if(!$("#buffer").value.trim()||value===null){alert("안전여유금을 숫자로 입력해주세요.");return}const id=$("#account-dialog").dataset.account;if(!D.accounts[id])return;D.accounts[id].safetyBuffer=value;touch();refreshSettleMeta();closeAccountSettings()},"onsubmit");
 const dialog=$("#account-dialog");if(dialog)dialog.oncancel=e=>{e.preventDefault();closeAccountSettings()};
 on("#used",e=>{const n=WF.moneyValue(e.target,D.cards[D.cur].used);if(n===null)return;D.cards[D.cur].used=n;touch();refreshSettleMeta()},"onchange");
 on("#load",()=>load(D.cur));
 const curRows=()=>D.txs.filter(t=>t.card===D.cur),picked=()=>curRows().filter(t=>selected.has(t.id));
 on("#chkall",()=>{const rows=curRows(),allOn=rows.length&&rows.every(t=>selected.has(t.id));rows.forEach(t=>allOn?selected.delete(t.id):selected.add(t.id));all("[data-chk]",el=>{el.checked=selected.has(T(el.dataset.chk)?.id)})});
 on("#settle-selected",()=>{const rows=picked();if(!rows.length){alert("정산할 내역을 먼저 선택해주세요.");return}rows.forEach(t=>{t.pending="settle";selected.delete(t.id)});touch();render()});
 on("#delete-selected",()=>{const rows=picked();if(!rows.length){alert("삭제할 내역을 먼저 선택해주세요.");return}if(!confirm(`선택한 ${rows.length}건을 삭제 예정으로 표시할까요? 위의 저장을 눌러야 실제로 삭제되고 정산 내역에는 남지 않아요.`))return;rows.forEach(t=>{t.pending="delete";selected.delete(t.id)});touch();render()});
 on("#addv",()=>{const d=calc(D.cur).diff;D.txs.push({id:D.nextId++,card:D.cur,date:new Date().toISOString().slice(0,10),orig:"수기입력",label:"개인차액",amount:d,category:"개인",note:"",chk:false,virtual:true,loadedAt:now()});touch();render()});
 const dl=(txt,name,type)=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([txt],{type}));a.download=name;a.click()};
 on("#exp",()=>dl(JSON.stringify(S,null,1),"card-settle.json","application/json"));
 on("#csv",()=>{const f=["date","cardName","cardLabel","cardRef","orig","label","amount","sourceAmount","amountEstimated","category","note","approval_no","cycleStart","cycleUsed","settledAt"];
  dl("\ufeff"+[f.join(","),...S.ledger.map(r=>f.map(x=>`"${String(r[x]??"").replace(/"/g,'""')}"`).join(","))].join("\n"),"ledger.csv","text/csv")});
 on("#cadd",()=>{const n=$("#cn").value.trim();if(n&&!D.cats.includes(n)){D.cats.push(n);D.catColors=CU.normalizeColors(D.catColors,D.cats);touch();render()}});
 all("[data-cat]",el=>el.onchange=()=>{const i=+el.dataset.cat,o=D.cats[i],n=el.value.trim();if(!n||(n!==o&&(D.cats.some((c,j)=>j!==i&&c===n)||D.txs.some(t=>CU.categoryName(t.category)===n)||D.rules.some(r=>CU.categoryName(r.category)===n)||D.learnedRules.some(r=>r.category===n)||D.learningConflicts.some(r=>r.categories.includes(n))))){el.value=o;alert("비어 있거나 중복된 분류 이름은 사용할 수 없어요.");return}if(n===o)return;D.cats[i]=n;
  D.catColors={...D.catColors,[n]:CU.colorFor(o,D.catColors)};D.txs.forEach(t=>{if(t.category===o)t.category=n});D.rules.forEach(r=>{if(r.category===o)r.category=n});D.learnedRules.forEach(r=>{if(r.category===o)r.category=n});D.learningConflicts.forEach(r=>{r.categories=r.categories.map(c=>c===o?n:c);if(r.category===o)r.category=n});touch();refreshCategorySidebar();const rc=$("#rc");if(rc)rc.innerHTML=catOpts()});
 all("[data-color]",el=>el.oninput=()=>{const c=D.cats[+el.dataset.color];if(CU.validColor(el.value)){D.catColors={...D.catColors,[c]:el.value};touch();refreshCategorySidebar()}});
 all("[data-move]",b=>b.onclick=()=>{const from=+b.dataset.move,to=from+Number(b.dataset.step);if(to<0||to>=D.cats.length)return;[D.cats[from],D.cats[to]]=[D.cats[to],D.cats[from]];touch();render();const focus=$(`[data-move="${to}"][data-step="${b.dataset.step}"]:not(:disabled)`)||$(`[data-cat="${to}"]`);focus?.focus()});
 all("[data-cdel]",b=>b.onclick=()=>{const i=+b.dataset.cdel,c=D.cats[i];if(D.cats.length<2||D.txs.some(t=>t.category===c)||D.rules.some(r=>r.category===c)||D.learnedRules.some(r=>r.category===c)||D.learningConflicts.some(r=>r.categories.includes(c))){alert("사용 중이거나 마지막 분류는 삭제할 수 없어요. 내역과 규칙의 분류를 먼저 바꿔주세요.");return}D.cats.splice(i,1);touch();render()});
 on("#radd",()=>{const m=$("#rm").value.trim();if(m){D.rules.unshift({match:m,category:$("#rc").value,source:"manual"});touch();render()}});
 on("#rapply",()=>{D.txs.filter(t=>!t.virtual).forEach(t=>t.category=classify(t.orig,t.card,U.cardRef(t)));touch();render()});
 all("[data-rdel]",b=>b.onclick=()=>{D.rules.splice(b.dataset.rdel,1);touch();render()});WF.bind({state:D,cfg:CFG,esc,touch,render,refresh:refreshSettleMeta,onSort:key=>{settleSort=settleSort.key===key?{key,dir:-settleSort.dir}:{key,dir:1}}})}
