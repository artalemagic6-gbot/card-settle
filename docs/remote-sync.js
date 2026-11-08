/** Encrypted whole-state storage in a private GitHub repo via the documented Contents REST API. No credentials live here. */
(function(root){
 "use strict";
 const FORMAT="card-settle-state",VERSION=1,ITERATIONS=310000,API="https://api.github.com",enc=new TextEncoder(),dec=new TextDecoder();
 const C=()=>root.crypto&&root.crypto.subtle?root.crypto:globalThis.crypto;
 const toB64=u=>{let s="";for(const b of u)s+=String.fromCharCode(b);return btoa(s)},fromB64=s=>Uint8Array.from(atob(String(s||"")),c=>c.charCodeAt(0));
 const rand=n=>C().getRandomValues(new Uint8Array(n));
 const newSaveId=()=>toB64(rand(12)).replace(/[^A-Za-z0-9]/g,"").slice(0,16)+Date.now().toString(36);
 class RemoteError extends Error{constructor(kind,message,status){super(message||kind);this.kind=kind;this.status=status||0}}
 async function deriveKey(pass,salt,iterations,usage){const km=await C().subtle.importKey("raw",enc.encode(String(pass||"")),"PBKDF2",false,["deriveKey"]);return C().subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",iterations,salt},km,{name:"AES-GCM",length:256},false,usage)}
 async function seal(obj,pass,aad,iterations=ITERATIONS){const salt=rand(16),iv=rand(12),key=await deriveKey(pass,salt,iterations,["encrypt"]);const ct=new Uint8Array(await C().subtle.encrypt({name:"AES-GCM",iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(obj))));return {kdf:{name:"PBKDF2",hash:"SHA-256",iterations,salt:toB64(salt)},iv:toB64(iv),ct:toB64(ct)}}
 async function open(box,pass,aad){if(!box||!box.kdf||box.kdf.name!=="PBKDF2"||box.kdf.hash!=="SHA-256")throw new RemoteError("schema","암호화 형식을 알 수 없어요");const iterations=Number(box.kdf.iterations);if(!(iterations>=100000&&iterations<=5000000))throw new RemoteError("schema","암호화 설정이 올바르지 않아요");
  let pt;try{const key=await deriveKey(pass,fromB64(box.kdf.salt),iterations,["decrypt"]);pt=await C().subtle.decrypt({name:"AES-GCM",iv:fromB64(box.iv),additionalData:enc.encode(aad)},key,fromB64(box.ct))}catch(e){throw new RemoteError("decrypt","서버 데이터를 이 암호로 열 수 없어요")}
  try{return JSON.parse(dec.decode(pt))}catch(e){throw new RemoteError("schema","서버 데이터 형식이 올바르지 않아요")}}
 const stateAad=saveId=>`${FORMAT}/v${VERSION}/${saveId}`;
 function validState(s){return !!s&&typeof s==="object"&&!Array.isArray(s)&&Array.isArray(s.txs)&&Array.isArray(s.ledger)&&s.cards&&typeof s.cards==="object"}
 async function encryptState(state,pass,saveId,iterations){if(!validState(state))throw new RemoteError("schema","저장할 데이터 형식이 올바르지 않아요");const box=await seal({state,saveId},pass,stateAad(saveId),iterations);return JSON.stringify({format:FORMAT,v:VERSION,saveId,savedAt:new Date().toISOString(),...box})}
 function parseEnvelope(text){let e;try{e=JSON.parse(text)}catch(_){throw new RemoteError("schema","서버 파일 형식이 올바르지 않아요")}if(!e||e.format!==FORMAT||e.v!==VERSION||typeof e.saveId!=="string")throw new RemoteError("schema","서버 파일 형식이 올바르지 않아요");return e}
 const peekSaveId=text=>{try{return parseEnvelope(text).saveId}catch(_){return null}};
 async function decryptState(text,pass){const e=parseEnvelope(text),inner=await open(e,pass,stateAad(e.saveId));if(!inner||inner.saveId!==e.saveId||!validState(inner.state))throw new RemoteError("schema","서버 데이터 형식이 올바르지 않아요");return {state:inner.state,saveId:e.saveId,savedAt:e.savedAt}}
 const tokenAad=cfg=>`card-settle-token/v1/${cfg.owner}/${cfg.repo}`;
 async function encryptToken(token,pass,cfg){return JSON.stringify({v:1,...await seal({token},pass,tokenAad(cfg))})}
 async function decryptToken(text,pass,cfg){const o=await open(JSON.parse(text),pass,tokenAad(cfg));if(!o||typeof o.token!=="string"||!o.token)throw new RemoteError("schema");return o.token}
 function validConfig(c){const ok=v=>typeof v==="string"&&/^[A-Za-z0-9._-]{1,100}$/.test(v);return !!c&&ok(c.owner)&&ok(c.repo)&&ok(c.branch)&&typeof c.path==="string"&&/^[A-Za-z0-9._/-]{1,200}$/.test(c.path)&&!c.path.includes("..")&&Object.keys(c).every(k=>["owner","repo","branch","path"].includes(k))}
 const kindFor=s=>s===401?"auth":s===403?"forbidden":s===404?"notFound":s===409||s===422?"conflict":s>=500?"server":"http";
 function makeClient({fetch,cfg,token}){if(!validConfig(cfg))throw new RemoteError("config","서버 저장 설정이 올바르지 않아요");if(!token)throw new RemoteError("auth","토큰이 필요해요");
  const repoUrl=`${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,fileUrl=`${repoUrl}/contents/${cfg.path.split("/").map(encodeURIComponent).join("/")}`;
  const headers=(accept="application/vnd.github+json")=>({Accept:accept,Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28"});
  async function call(url,opts){let r;try{r=await fetch(url,{cache:"no-store",...opts})}catch(e){throw new RemoteError("network","서버에 연결하지 못했어요")}return r}
  async function checkRepo(){const r=await call(repoUrl,{headers:headers()});if(r.status===404)throw new RemoteError("repoMissing","데이터 저장소가 없거나 토큰에 접근 권한이 없어요",404);if(!r.ok)throw new RemoteError(kindFor(r.status),r.status===401?"토큰이 만료됐거나 올바르지 않아요":"저장소 접근 권한이 없어요",r.status);const j=await r.json();if(j.private!==true)throw new RemoteError("public","데이터 저장소가 비공개가 아니어서 사용하지 않아요");return true}
  async function read(){const r=await call(`${fileUrl}?ref=${encodeURIComponent(cfg.branch)}`,{headers:headers()});if(r.status===404)return {exists:false,sha:null,text:null};if(!r.ok)throw new RemoteError(kindFor(r.status),r.status===401?"토큰이 만료됐거나 올바르지 않아요":"서버 파일을 읽지 못했어요",r.status);const j=await r.json();
   if(j.encoding==="base64"&&j.content)return {exists:true,sha:j.sha,text:dec.decode(fromB64(String(j.content).replace(/\s/g,"")))};
   const raw=await call(`${fileUrl}?ref=${encodeURIComponent(cfg.branch)}`,{headers:headers("application/vnd.github.raw+json")});if(!raw.ok)throw new RemoteError(kindFor(raw.status),"서버 파일을 읽지 못했어요",raw.status);return {exists:true,sha:j.sha,text:await raw.text()}}
  async function write(text,sha){const body={message:"Update encrypted state",content:toB64(enc.encode(text)),branch:cfg.branch};if(sha)body.sha=sha;const r=await call(fileUrl,{method:"PUT",headers:{...headers(),"Content-Type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new RemoteError(kindFor(r.status),r.status===401?"토큰이 만료됐거나 올바르지 않아요":r.status===403?"저장 권한이 없어요":"서버 저장이 거절됐어요",r.status);const j=await r.json();return {sha:j.content&&j.content.sha}}
  return {checkRepo,read,write}}
 /** One save attempt against baseSha. Never retries automatically on a different sha. */
 async function verify(client,saveId,baseSha,error){let cur;try{cur=await client.read()}catch(e){return {status:"unknown",error}}if(cur.exists&&peekSaveId(cur.text)===saveId)return {status:"ok",sha:cur.sha,recovered:true};if((cur.exists?cur.sha:null)===(baseSha||null))return {status:"failed",notApplied:true,error};return {status:"conflict",remoteSha:cur.sha,error}}
 async function saveRemote({client,text,saveId,baseSha}){try{const r=await client.write(text,baseSha||null);return {status:"ok",sha:r.sha}}catch(e){if(["auth","forbidden","notFound","repoMissing","public","http"].includes(e.kind))return {status:"failed",error:e};return verify(client,saveId,baseSha,e)}}
 const api={FORMAT,ITERATIONS,RemoteError,newSaveId,validState,validConfig,encryptState,decryptState,peekSaveId,encryptToken,decryptToken,makeClient,saveRemote,verify};
 root.RemoteSync=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
