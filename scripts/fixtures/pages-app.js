"use strict";
// Synthetic-only DOM + encrypted in-memory server harness. Never uses the network.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{JSDOM}=require("jsdom");
const root=path.join(__dirname,"../.."),FG=require("./fake-github.js"),fixture=require("./ui-example.json"),KEY="card-settle-pages-v2";
let port=0;
async function boot({gh,local,pass=FG.PASS,storage={},config=fixture.config}){const dom=new JSDOM(fs.readFileSync(path.join(root,"docs/index.html"),"utf8"),{url:`https://remote-${++port}.example.test/`,runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window,d=w.document,alerts=[],ctx=dom.getInternalVMContext();
 Object.defineProperty(w,"crypto",{value:require("node:crypto").webcrypto,configurable:true});if(!w.TextEncoder)w.TextEncoder=TextEncoder;if(!w.TextDecoder)w.TextDecoder=TextDecoder;FG.routeFetch(w,{config,gh});w.alert=t=>alerts.push(t);w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open")};
 if(local)w.localStorage.setItem(KEY,JSON.stringify(local));for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,v);
 const writes=[];let failKey=false;const set=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(k,v){if(failKey&&k===KEY)throw new Error("synthetic quota");writes.push([k,v]);return set.call(this,k,v)};
 for(const m of fs.readFileSync(path.join(root,"docs/index.html"),"utf8").matchAll(/<script src="\.\/([^?]+)\?/g))vm.runInContext(fs.readFileSync(path.join(root,"docs",m[1]),"utf8"),ctx);
 const run=s=>vm.runInContext(s,ctx),el=s=>d.querySelector(s),json=s=>JSON.parse(JSON.stringify(run(s)));run(`PASS=${JSON.stringify(pass)}`);await run("start()");
 return {w,d,run,el,json,alerts,writes,dom,setFailKey:v=>{failKey=v},save:async()=>{el("#save").click();return run("saveTask")},connect:async(token=FG.TOKEN,remember=false)=>{el("#remote-token").value=token;el("#remote-remember").checked=remember;el("#remote-connect").click();return run("saveTask")}}}
module.exports={boot};
