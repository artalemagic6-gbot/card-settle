"use strict";
// Synthetic in-memory stand-in for the documented GitHub Contents API (no network, no real tokens).
const REMOTE_CFG={owner:"example-owner",repo:"example-data",branch:"main",path:"state.enc"};
const PASS="synthetic-unlock-pass",TOKEN="synthetic-token-not-real";
function resp(status,body){return {ok:status>=200&&status<300,status,json:async()=>typeof body==="string"?JSON.parse(body):body,text:async()=>typeof body==="string"?body:JSON.stringify(body)}}
function makeFakeGitHub(cfg=REMOTE_CFG){
 const gh={file:null,n:0,tokens:new Set([TOKEN]),repoPrivate:true,repoExists:true,forbidden:false,failQueue:[],log:[],puts:0};
 const repoPath=`/repos/${cfg.owner}/${cfg.repo}`,filePath=`${repoPath}/contents/${cfg.path}`;
 gh.fetch=async(url,opts={})=>{const u=new URL(url),method=opts.method||"GET",h=opts.headers||{},auth=h.Authorization||"";
  gh.log.push({method,path:u.pathname,cache:opts.cache,auth:!!auth});
  const i=gh.failQueue.findIndex(f=>f.method===method);const f=i>=0?gh.failQueue.splice(i,1)[0]:null;
  if(f&&f.type==="network")throw new TypeError("Failed to fetch");
  if(f&&f.status)return resp(f.status,{message:"synthetic"});
  if(!gh.tokens.has(auth.replace(/^Bearer /,"")))return resp(401,{message:"Bad credentials"});
  if(gh.forbidden)return resp(403,{message:"Resource not accessible"});
  if(!gh.repoExists)return resp(404,{message:"Not Found"});
  if(u.pathname===repoPath&&method==="GET")return resp(200,{full_name:`${cfg.owner}/${cfg.repo}`,private:gh.repoPrivate});
  if(u.pathname!==filePath)return resp(404,{message:"Not Found"});
  if(method==="GET"){if(!gh.file)return resp(404,{message:"Not Found"});if(String(h.Accept).includes("raw"))return resp(200,gh.file.text);
   const b64=Buffer.from(gh.file.text).toString("base64").replace(/(.{60})/g,"$1\n");return resp(200,gh.big?{sha:gh.file.sha,encoding:"none",content:""}:{sha:gh.file.sha,encoding:"base64",content:b64})}
  if(method==="PUT"){const body=JSON.parse(opts.body);if(gh.file&&body.sha!==gh.file.sha)return resp(gh.file&&!body.sha?422:409,{message:"sha mismatch"});if(!gh.file&&body.sha)return resp(409,{message:"sha mismatch"});
   gh.puts++;gh.file={sha:"sha"+(++gh.n),text:Buffer.from(body.content,"base64").toString()};
   if(f&&f.type==="lost")throw new TypeError("Failed to fetch");return resp(gh.n===1?201:200,{content:{sha:gh.file.sha}})}
  return resp(405,{})};
 return gh}
function routeFetch(w,{config,gh,remote=REMOTE_CFG}){w.fetch=async(url,opts)=>{const s=String(url);if(s.startsWith("https://api.github.com/"))return gh.fetch(s,opts);if(s.includes("remote.json"))return resp(200,remote);return resp(200,config)}}
/** Connect via the real dialog + first upload of the saved browser state. */
async function connectAndMigrate(run,el,{remember=false}={}){el("#remote-token").value=TOKEN;el("#remote-remember").checked=remember;el("#remote-connect").click();const r=await run("saveTask");if(r===true)return "adopted";const m=el("#remote-migrate");if(!m)throw new Error("expected migrate offer: "+el("#remote-msg").textContent);m.click();if(!(await run("saveTask")))throw new Error("migrate failed");return "migrated"}
module.exports={REMOTE_CFG,PASS,TOKEN,makeFakeGitHub,routeFetch,connectAndMigrate,resp};
