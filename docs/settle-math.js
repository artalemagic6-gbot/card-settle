/** Original spreadsheet formulas. No DOM, storage writes, or balance allocation. */
(function(root){
 "use strict";
 const number=value=>{const n=Number(value);return Number.isFinite(n)?n:0};
 const defaultBuffer=id=>id==="352"?500000:id==="302"?100000:0;
 function normalizeAccounts(old,configs){const out={};for(const [id,a] of Object.entries(old||{}))out[id]={...a,safetyBuffer:a.safetyBuffer??defaultBuffer(id)};
  for(const a of configs||[]){const prior=out[a.id]||{};out[a.id]={name:a.name,balance:a.balance??0,...prior,safetyBuffer:prior.safetyBuffer??a.safetyBuffer??defaultBuffer(a.id)}}return out}
 function cardTotals({used,openSum}){used=number(used);openSum=number(openSum);return{used,openSum,deposit:used-openSum}}
 function accountTotals({cards=[],balance,safetyBuffer}){const used=cards.reduce((s,c)=>s+number(c.used),0),cardDeposit=cards.reduce((s,c)=>s+number(c.deposit),0);
  balance=number(balance);safetyBuffer=number(safetyBuffer);const deposit=cardDeposit+safetyBuffer;return{used,cardDeposit,safetyBuffer,deposit,balance,need:deposit-balance}}
 const api={number,defaultBuffer,normalizeAccounts,cardTotals,accountTotals};
 root.SettleMath=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
