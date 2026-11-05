const KEY="card-settle-pages-v1";const $=s=>document.querySelector(s);const won=n=>Math.round(n||0).toLocaleString("ko-KR")+"원";
let CFG,S,view="settle";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function save(){localStorage.setItem(KEY,JSON.stringify(S))}
function classify(m){m=String(m||"").toLowerCase();for(const r of S.rules)if(r.match&&m.includes(r.match.toLowerCase()))return r.category;return "데이트"}
async function init(){CFG=await (await fetch("./data/config.json",{cache:"no-store"})).json();
 S=JSON.parse(localStorage.getItem(KEY)||"null")||{acct:"352",cur:"shinhan",nextId:1,txs:[],
  accounts:Object.fromEntries(CFG.accounts.map(a=>[a.id,{name:a.name,balance:a.balance}])),
  cards:Object.fromEntries(CFG.cards.map(c=>[c.id,{used:0}])),rules:CFG.rules.map(r=>({...r}))};
 document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));render()});render()}
const cardsOf=a=>CFG.cards.filter(c=>c.account===a).sort((x,y)=>x.sort-y.sort);
const open=c=>S.txs.filter(t=>t.card===c&&!t.settled);
function calc(cid){const c=CFG.cards.find(x=>x.id===cid);const sib=cardsOf(c.account);let bal=S.accounts[c.account].balance;
 // shared balance consumed in order by earlier cards
 for(const s of sib){const used=S.cards[s.id].used||0;const need=Math.max(0,used-bal);if(s.id===cid){const os=open(cid).reduce((a,t)=>a+t.amount,0);return{used,bal,need,os,diff:used-os}}bal=Math.max(0,bal-used)}}
let STG=null;
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function staging(){if(STG)return STG;
 const meta=await (await fetch("./data/staging/meta.json",{cache:"no-store"})).json();
 const enc=await (await fetch("./data/staging/"+meta.file,{cache:"no-store"})).text();
 for(let tries=0;tries<3;tries++){
  let pass=sessionStorage.getItem("cs_pass");
  if(!pass){pass=prompt("카드내역 암호를 입력하세요");if(!pass)return null}
  try{const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
   const key=await crypto.subtle.deriveKey({name:"PBKDF2",hash:meta.kdf.hash,iterations:meta.kdf.iterations,salt:b64(meta.kdf.salt)},km,{name:"AES-GCM",length:256},false,["decrypt"]);
   const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(meta.cipher.iv)},key,b64(enc.trim()));
   STG=JSON.parse(new TextDecoder().decode(pt));sessionStorage.setItem("cs_pass",pass);return STG}
  catch(e){sessionStorage.removeItem("cs_pass");alert("암호가 틀렸어요. 다시 입력해 주세요.")}}
 return null}
async function load(cid){const st=await staging();if(!st)return;const rows=st.cards[cid];if(!rows||!rows.length){alert("이 카드의 준비된 내역이 없어요");return}
 const k=t=>t.approval_no?"a:"+t.approval_no:`d:${t.date}|${t.merchant}|${t.amount}`;
 const have=new Set(S.txs.filter(t=>t.card===cid).map(k));let n=0;
 for(const t of rows){if(have.has(k(t)))continue;S.txs.push({id:S.nextId++,card:cid,...t,category:t.category||classify(t.merchant),settled:false,virtual:false});n++}
 save();render();alert(`${n}건 불러옴 (중복 ${rows.length-n}건 제외)`)}
function txTable(list,editable=true){return `<table><tr><th>날짜</th><th>내역</th><th>금액</th><th>분류</th><th>메모</th>${editable?"<th></th>":""}</tr>`+
 list.map(t=>`<tr class="${t.virtual?"virtual":""} ${t.settled?"settled":""}"><td>${esc(t.date).slice(0,16)}</td>
 <td><input class="m" data-id="${t.id}" data-f="merchant" value="${esc(t.merchant)}"></td>
 <td class="n">${t.virtual?`<input data-id="${t.id}" data-f="amount" type="number" value="${t.amount}" style="width:90px">`:won(t.amount)}</td>
 <td><select data-id="${t.id}" data-f="category">${CFG.cats.map(c=>`<option ${c===t.category?"selected":""}>${c}</option>`).join("")}</select></td>
 <td><input data-id="${t.id}" data-f="note" value="${esc(t.note)}"></td>${editable?`<td><button data-del="${t.id}">✕</button></td>`:""}</tr>`).join("")+"</table>"}
function bindTx(){document.querySelectorAll("[data-f]").forEach(el=>el.onchange=()=>{const t=S.txs.find(x=>x.id==el.dataset.id);t[el.dataset.f]=el.dataset.f==="amount"?Number(el.value):el.value;save();render()});
 document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{if(confirm("삭제?")){S.txs=S.txs.filter(t=>t.id!=b.dataset.del);save();render()}})}
function settleView(){const a=S.acct;let cs=cardsOf(a);if(!cs.find(c=>c.id===S.cur))S.cur=cs[0].id;const c=CFG.cards.find(x=>x.id===S.cur);const r=calc(c.id);
 return `<div class="tabs">${CFG.accounts.map(x=>`<button data-acct="${x.id}" class="${x.id===a?"on":""}">${x.id==="other"?"기타":x.id}</button>`).join("")}</div>
 <div class="card row"><span class="k">${esc(S.accounts[a].name)} 잔고${a==="352"?" (공유)":""}</span><input id="bal" type="number" value="${S.accounts[a].balance}"></div>
 <div class="minis">${cs.map(x=>{const q=calc(x.id);return `<div class="mini ${x.id===c.id?"on":""} ${q.used&&q.diff===0?"ok":""}" data-card="${x.id}"><b>${x.name}</b><br><span class="k">${won(q.used)}</span></div>`}).join("")}</div>
 <div class="card"><h2 style="margin:0 0 6px">${c.name}카드 <span class="k" style="font-size:13px">결제일 ${c.payDay}일</span></h2>
 <div class="row"><span class="k">이용금액</span><input id="used" type="number" value="${r.used||""}" placeholder="청구 이용금액"></div>
 <div class="row"><span class="k">입금필요</span><span class="v ${r.need?"warn":"good"}">${won(r.need)}</span><span class="k">· 열린 내역합 ${won(r.os)}</span><span class="k">· 차액</span><span class="v ${r.diff?"warn":"good"}">${won(r.diff)}</span></div>
 <button class="big primary" id="load">카드내역 불러오기</button>
 <div class="row"><button id="addv">+ 수기 입력(차액만큼 개인차액)</button><button id="settle">이 카드 정산완료</button></div>
 ${txTable(open(c.id))}</div>`}
function ledgerView(){const by={};S.txs.forEach(t=>by[t.category]=(by[t.category]||0)+t.amount);
 return `<div class="card row">${Object.entries(by).map(([k,v])=>`<span class="k">${k}</span><span class="v">${won(v)}</span>`).join(" ")}</div>
 <div class="card row"><button id="exp">JSON 내보내기</button><button id="reset" class="warn">전체 초기화</button></div><div class="card">${txTable([...S.txs].sort((x,y)=>y.date.localeCompare(x.date)))}</div>`}
function rulesView(){return `<div class="card"><div class="row"><input id="rm" placeholder="포함 문자"><select id="rc">${CFG.cats.map(c=>`<option>${c}</option>`)}</select><button id="radd">추가</button><button id="rapply">열린 내역에 재적용</button></div>
 <table>${S.rules.map((r,i)=>`<tr><td>${esc(r.match)}</td><td>${r.category}</td><td><button data-rdel="${i}">✕</button></td></tr>`).join("")}</table></div>`}
function render(){$("#app").innerHTML=view==="settle"?settleView():view==="ledger"?ledgerView():rulesView();bindTx();const on=(s,f,e="onclick")=>{const el=$(s);if(el)el[e]=f};
 document.querySelectorAll("[data-acct]").forEach(b=>b.onclick=()=>{S.acct=b.dataset.acct;save();render()});
 document.querySelectorAll("[data-card]").forEach(b=>b.onclick=()=>{S.cur=b.dataset.card;save();render()});
 on("#bal",e=>{S.accounts[S.acct].balance=Number(e.target.value)||0;save();render()},"onchange");
 on("#used",e=>{S.cards[S.cur].used=Number(e.target.value)||0;save();render()},"onchange");
 on("#load",()=>load(S.cur));
 on("#addv",()=>{const d=calc(S.cur).diff;S.txs.push({id:S.nextId++,card:S.cur,date:new Date().toISOString().slice(0,10),merchant:"개인차액",amount:d,category:"개인",note:"",settled:false,virtual:true});save();render()});
 on("#settle",()=>{if(!confirm("열린 내역을 정산완료로 표시할까요?"))return;open(S.cur).forEach(t=>t.settled=true);save();render()});
 on("#exp",()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,1)],{type:"application/json"}));a.download="card-settle.json";a.click()});
 on("#reset",()=>{if(confirm("전체 초기화?")){localStorage.removeItem(KEY);location.reload()}});
 on("#radd",()=>{const m=$("#rm").value.trim();if(m){S.rules.unshift({match:m,category:$("#rc").value});save();render()}});
 on("#rapply",()=>{S.txs.filter(t=>!t.settled&&!t.virtual).forEach(t=>t.category=classify(t.merchant));save();render()});
 document.querySelectorAll("[data-rdel]").forEach(b=>b.onclick=()=>{S.rules.splice(b.dataset.rdel,1);save();render()})}
init();
