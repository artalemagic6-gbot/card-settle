const KEY="card-settle-pages-v2",OLD="card-settle-pages-v1";const $=s=>document.querySelector(s);const won=n=>Math.round(n||0).toLocaleString("ko-KR")+"원";
let CFG,S,D,STG=null,view="settle",dirty=false;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));const now=()=>new Date().toISOString();
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const SE=globalThis.SettleEdit,SM=globalThis.SettleMath;
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
function blank(){return{v:2,acct:"352",cur:"shinhan",nextId:1,txs:[],ledger:[],cycles:[],cats:[...CFG.cats],
 accounts:SM.normalizeAccounts({},CFG.accounts),
 cards:Object.fromEntries(CFG.cards.map(c=>[c.id,{used:0,cycleStart:now()}])),rules:CFG.rules.map(r=>({...r}))}}
function migrate(o){const s=blank();Object.assign(s,{acct:o.acct||s.acct,cur:o.cur||s.cur,nextId:o.nextId||1,rules:o.rules||s.rules,accounts:o.accounts||s.accounts});
 for(const c in o.cards||{})s.cards[c]={used:o.cards[c].used||0,cycleStart:now()};
 for(const t of o.txs||[]){const x={...t,orig:t.orig||t.merchant,label:t.label||shortName(t.merchant)};if(t.settled)s.ledger.push(rec(x,s));else s.txs.push({...x,chk:false})}return s}
function rec(t,s){const c=CFG.cards.find(x=>x.id===t.card)||{};return{lid:"L"+(s.ledger.length+1)+"-"+Date.now().toString(36)+"-"+t.id,date:t.date,orig:t.orig,label:t.label,amount:t.amount,
 category:t.category,note:t.note||"",card:t.card,cardName:c.name,account:c.account,approval_no:t.approval_no||null,virtual:!!t.virtual,
 cycleStart:s.cards[t.card]?.cycleStart||null,cycleUsed:s.cards[t.card]?.used||0,loadedAt:t.loadedAt||null,settledAt:now()}}
async function start(){CFG=await (await fetch("./data/config.json",{cache:"no-store"})).json();
 const raw=localStorage.getItem(KEY);if(raw)S=JSON.parse(raw);else{const o=localStorage.getItem(OLD);S=o?migrate(JSON.parse(o)):blank()}
 S.accounts=SM.normalizeAccounts(S.accounts,CFG.accounts);S.cats=S.cats||[...CFG.cats];
 S.cards=S.cards||{};for(const c of CFG.cards)if(!S.cards[c.id])S.cards[c.id]={used:0,cycleStart:now()};
 S.txs=S.txs||[];S.ledger=S.ledger||[];S.cycles=S.cycles||[];D=clone(S);
 document.querySelectorAll("nav button[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll("nav button[data-view]").forEach(x=>x.classList.toggle("on",x===b));render()});
 $("#save").onclick=doSave;window.onbeforeunload=e=>{if(dirty){e.preventDefault();e.returnValue=""}};render()}
function persist(){localStorage.setItem(KEY,JSON.stringify(S))}
function touch(){dirty=true;$("#dirty").textContent="저장 안 됨"}
function doSave(){// archive cycles whose 이용금액 changed
 for(const c of CFG.cards){const o=S.cards[c.id]||{},n=D.cards[c.id];if(o.used&&n.used!==o.used){
  D.cycles.push({card:c.id,cardName:c.name,used:o.used,start:o.cycleStart,closedAt:now(),formulaVersion:3,accountId:c.account,cardDeposit:calcIn(S,c.id).deposit,accountNeed:accountCalcIn(S,c.account).need,safetyBuffer:accountCalcIn(S,c.account).safetyBuffer,openLeft:S.txs.filter(t=>t.card===c.id).length,balance:S.accounts[c.account].balance});n.cycleStart=now()}}
 const keep=[];for(const t of D.txs){if(t.chk)D.ledger.push(rec(t,D));else keep.push(t)}D.txs=keep;
 S=clone(D);persist();dirty=false;$("#dirty").textContent="저장됨";render()}
function classify(m){m=String(m||"").toLowerCase();for(const r of D.rules)if(r.match&&m.includes(r.match.toLowerCase()))return r.category;return "데이트"}
const cardsOf=a=>CFG.cards.filter(c=>c.account===a).sort((x,y)=>x.sort-y.sort);
function calcIn(st,cid){const list=(st.txs||[]).filter(t=>t.card===cid);const os=list.reduce((a,t)=>a+SM.number(t.amount),0);
 const q=SM.cardTotals({used:st.cards[cid]?.used,openSum:os});
 return {...q,os,diff:q.deposit,done:list.filter(t=>t.chk).reduce((a,t)=>a+SM.number(t.amount),0)}}
function accountCalcIn(st,aid){const a=st.accounts[aid]||{};return SM.accountTotals({cards:cardsOf(aid).map(c=>calcIn(st,c.id)),balance:a.balance,safetyBuffer:a.safetyBuffer??SM.defaultBuffer(aid)})}
const calc=cid=>calcIn(D,cid);
const k=t=>t.approval_no?"a:"+t.approval_no:`d:${t.date}|${t.orig||t.merchant}|${t.amount}`;
function load(cid){const rows=STG?.cards?.[cid];if(!rows||!rows.length){alert("이 카드의 준비된 내역이 없어요");return}
 const have=new Set([...D.txs,...D.ledger].filter(t=>t.card===cid).map(k));let n=0;
 for(const t of rows){if(have.has(k(t)))continue;D.txs.push({id:D.nextId++,card:cid,date:t.date,orig:t.merchant,label:shortName(t.merchant),amount:t.amount,approval_no:t.approval_no||null,
  category:t.category||classify(t.merchant),note:"",chk:false,virtual:false,loadedAt:now()});n++}
 touch();render();alert(`${n}건 불러옴 (이미 있거나 정산된 ${rows.length-n}건 제외) — 저장을 눌러야 반영돼요`)}
const catOpts=v=>D.cats.map(c=>`<option ${c===v?"selected":""}>${esc(c)}</option>`).join("");
function openTable(list){return `<table data-settle-table><tr><th>날짜</th><th>원본이름</th><th>내역</th><th>금액</th><th>분류</th><th>메모</th><th>정산</th><th></th></tr>`+
 list.map(t=>`<tr data-row="${t.id}" class="${t.chk?"done":""} ${t.virtual?"virtual":""}"><td>${SE.rowDateHtml(t,esc)}</td><td class="k">${esc(t.orig)}</td>
 <td><input class="m" data-id="${t.id}" data-f="label" value="${esc(t.label)}"></td>
 <td class="n">${t.virtual?`<input data-id="${t.id}" data-f="amount" type="number" value="${t.amount}" style="width:90px">`:won(t.amount)}</td>
 <td><select data-id="${t.id}" data-f="category">${catOpts(t.category)}</select></td><td><input data-id="${t.id}" data-f="note" value="${esc(t.note)}"></td>
 <td><input type="checkbox" data-chk="${t.id}" ${t.chk?"checked":""}></td><td><button type="button" data-del="${t.id}">✕</button></td></tr>`).join("")+"</table>"}
/** Update settle summary + mini cards without rebuilding the open-tx table (keeps focus for Tab). */
function refreshSettleMeta(){
 if(view!=="settle"||!D||!CFG)return;
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
 return `<div class="tabs">${CFG.accounts.map(x=>`<button data-acct="${x.id}" class="${x.id===a?"on":""}">${x.id==="other"?"기타":x.id}</button>`).join("")}</div>
 <div class="card"><div class="row"><b>${esc(D.accounts[a].name)}</b><span class="k">총 이용금액</span><span id="account-used" class="v">${won(ar.used)}</span><span class="k">계좌 입금금액</span><span id="account-deposit" class="v">${won(ar.deposit)}</span></div>
 <div class="row"><label class="k" for="buffer">안전여유금</label><input id="buffer" type="number" value="${ar.safetyBuffer}" style="width:120px"><label class="k" for="bal">현재잔고</label><input id="bal" type="number" value="${ar.balance}" style="width:120px"><span class="k">계좌 입금필요</span><span id="account-need" class="v ${ar.need?"warn":"good"}">${won(ar.need)}</span></div>
 <div class="k" style="font-size:12px">계좌 입금금액 = 카드별 입금금액 합 + 안전여유금 · 입금필요 = 계좌 입금금액 − 현재잔고</div></div>
 <div class="minis">${cs.map(x=>{const q=calc(x.id);return `<div class="mini ${x.id===c.id?"on":""} ${q.used&&q.diff===0?"ok":""}" data-card="${x.id}"><b>${x.name}</b><br><span class="k" data-mini-used>이용 ${won(q.used)}</span><br><span data-mini-deposit>입금 ${won(q.deposit)}</span></div>`}).join("")}</div>
 <div class="card"><h2 style="margin:0 0 6px">${c.name}카드 <span class="k" style="font-size:13px">결제일 ${c.payDay}일${last?` · 지난 회차 ${won(last.used)} (${last.closedAt.slice(0,10)})`:""}</span></h2>
 <div class="row"><span class="k">이용금액</span><input id="used" type="number" value="${r.used||""}" placeholder="청구 이용금액"><span class="k">값을 바꿔 저장하면 이전 회차는 과거로 보관돼요</span></div>
 <div class="row"><span class="k">카드 입금금액</span><span id="sum-diff" class="v">${won(r.deposit)}</span><span class="k">= 이용금액 − 남겨둔 내역합 </span><span id="sum-os" class="k">${won(r.os)}</span><span class="k">· 체크 </span><span id="sum-done" class="k">${won(r.done)}</span></div>
 <button class="big primary" id="load">카드내역 불러오기</button>
 <div class="row"><button id="addv">+ 수기 입력(차액만큼 개인차액)</button><button id="chkall">전체 체크</button></div>
 ${openTable(D.txs.filter(t=>t.card===c.id))}</div>`}
function ledgerView(){const L=[...S.ledger].sort((x,y)=>String(y.date).localeCompare(String(x.date)));const by={};L.forEach(t=>by[t.category]=(by[t.category]||0)+t.amount);
 return `<div class="card row"><span class="k">저장된 정산 ${L.length}건</span>${Object.entries(by).map(([k,v])=>`<span class="k">${esc(k)}</span><span class="v">${won(v)}</span>`).join(" ")}</div>
 <div class="card row"><button id="exp">JSON 내보내기</button><button id="csv">CSV 내보내기</button></div>
 <div class="card"><table><tr><th>날짜</th><th>카드</th><th>원본이름</th><th>내역</th><th>금액</th><th>분류</th><th>메모</th><th>정산일</th></tr>${L.map(t=>`<tr><td>${esc(t.date).slice(0,16)}</td><td>${esc(t.cardName)}</td><td class="k">${esc(t.orig)}</td><td>${esc(t.label)}</td><td class="n">${won(t.amount)}</td><td>${esc(t.category)}</td><td>${esc(t.note)}</td><td class="k">${esc(t.settledAt).slice(0,10)}</td></tr>`).join("")}</table></div>`}
function historyView(){const cur=CFG.cards.map(c=>`<tr><td>${c.name}</td><td>현재</td><td class="n">${won(S.cards[c.id]?.used)}</td><td class="k">${esc(S.cards[c.id]?.cycleStart||"").slice(0,10)}~</td><td></td><td>${S.txs.filter(t=>t.card===c.id).length}</td></tr>`).join("");
 return `<div class="card"><table><tr><th>카드</th><th>회차</th><th>이용금액</th><th>기간</th><th>마감 계산값</th><th>남은 열린건</th></tr>${cur}
 ${[...S.cycles].reverse().map(y=>`<tr><td>${esc(y.cardName)}</td><td>과거</td><td class="n">${won(y.used)}</td><td class="k">${esc(y.start||"").slice(0,10)}~${esc(y.closedAt).slice(0,10)}</td><td class="n">${y.formulaVersion===3?`카드 입금 ${won(y.cardDeposit)}<br><span class="k">${esc(y.accountId)} 계좌 필요 ${won(y.accountNeed)}</span>`:`${won(y.need)}<br><span class="k">이전 방식 카드 필요액</span>`}</td><td>${y.openLeft}</td></tr>`).join("")}</table></div>`}
function rulesView(){return `<div class="card"><h3>카테고리</h3><div class="row"><input id="cn" placeholder="새 카테고리"><button id="cadd">추가</button></div>
 <table>${D.cats.map((c,i)=>`<tr><td><input data-cat="${i}" value="${esc(c)}"></td><td><button data-cdel="${i}">✕</button></td></tr>`).join("")}</table></div>
 <div class="card"><h3>자동분류 규칙</h3><div class="row"><input id="rm" placeholder="포함 문자"><select id="rc">${catOpts()}</select><button id="radd">추가</button><button id="rapply">열린 내역에 재적용</button></div>
 <table>${D.rules.map((r,i)=>`<tr><td>${esc(r.match)}</td><td>${esc(r.category)}</td><td><button data-rdel="${i}">✕</button></td></tr>`).join("")}</table></div>`}
function render(){$("#app").innerHTML={settle:settleView,ledger:ledgerView,history:historyView,rules:rulesView}[view]();const on=(s,f,e="onclick")=>{const el=$(s);if(el)el[e]=f};const all=(s,f)=>document.querySelectorAll(s).forEach(f);
 const T=id=>D.txs.find(x=>x.id==id);
 // Inline field edits: update model (+ summary if needed) without destroying the table DOM so Tab/Shift+Tab stay natural.
 all("[data-f]",el=>el.onchange=()=>{const t=T(el.dataset.id);if(!t)return;const f=el.dataset.f;SE.applyField(t,f,el.value);touch();if(SE.fieldAffectsSummary(f))refreshSettleMeta()});
 all("[data-chk]",el=>el.onchange=()=>{const t=T(el.dataset.chk);if(!t)return;t.chk=el.checked;el.closest("tr")?.classList.toggle("done",el.checked);touch();refreshSettleMeta()});
 all("[data-del]",b=>b.onclick=()=>{if(confirm("이 열린 내역 삭제?")){D.txs=D.txs.filter(t=>t.id!=b.dataset.del);touch();render()}});
 all("[data-acct]",b=>b.onclick=()=>{D.acct=b.dataset.acct;render()});
 all("[data-card]",b=>b.onclick=()=>{D.cur=b.dataset.card;render()});
 on("#bal",e=>{D.accounts[D.acct].balance=SM.number(e.target.value);touch();refreshSettleMeta()},"onchange");
 on("#buffer",e=>{D.accounts[D.acct].safetyBuffer=SM.number(e.target.value);touch();refreshSettleMeta()},"onchange");
 on("#used",e=>{D.cards[D.cur].used=Number(e.target.value)||0;touch();refreshSettleMeta()},"onchange");
 on("#load",()=>load(D.cur));
 on("#chkall",()=>{D.txs.filter(t=>t.card===D.cur).forEach(t=>t.chk=true);touch();render()});
 on("#addv",()=>{const d=calc(D.cur).diff;D.txs.push({id:D.nextId++,card:D.cur,date:new Date().toISOString().slice(0,10),orig:"수기입력",label:"개인차액",amount:d,category:"개인",note:"",chk:false,virtual:true,loadedAt:now()});touch();render()});
 const dl=(txt,name,type)=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([txt],{type}));a.download=name;a.click()};
 on("#exp",()=>dl(JSON.stringify(S,null,1),"card-settle.json","application/json"));
 on("#csv",()=>{const f=["date","cardName","orig","label","amount","category","note","approval_no","cycleStart","cycleUsed","settledAt"];
  dl("\ufeff"+[f.join(","),...S.ledger.map(r=>f.map(x=>`"${String(r[x]??"").replace(/"/g,'""')}"`).join(","))].join("\n"),"ledger.csv","text/csv")});
 on("#cadd",()=>{const n=$("#cn").value.trim();if(n&&!D.cats.includes(n)){D.cats.push(n);touch();render()}});
 all("[data-cat]",el=>el.onchange=()=>{const i=+el.dataset.cat,o=D.cats[i],n=el.value.trim();if(!n)return;D.cats[i]=n;
  D.txs.forEach(t=>{if(t.category===o)t.category=n});D.rules.forEach(r=>{if(r.category===o)r.category=n});touch();render()});
 all("[data-cdel]",b=>b.onclick=()=>{D.cats.splice(+b.dataset.cdel,1);touch();render()});
 on("#radd",()=>{const m=$("#rm").value.trim();if(m){D.rules.unshift({match:m,category:$("#rc").value});touch();render()}});
 on("#rapply",()=>{D.txs.filter(t=>!t.virtual).forEach(t=>t.category=classify(t.orig));touch();render()});
 all("[data-rdel]",b=>b.onclick=()=>{D.rules.splice(b.dataset.rdel,1);touch();render()})}
