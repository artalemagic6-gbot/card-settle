/** v3 category identity. Pure in-memory migration: no storage, network, clocks or random IDs.
 * cats is the ordered list of IDs; catNames and catColors are keyed by ID.
 * catAliases keeps original import/config names attached to the same ID after renaming.
 * Keep the v2 localStorage key unchanged: remote link trust fingerprints the ORIGINAL bytes.
 */
(function(root){
 "use strict";
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const name=v=>v===undefined||v===null||v===""?"미분류":String(v);
 // Full UTF-16 encoding, not a hash: distinct legacy names cannot collide.
 const legacyId=n=>"cat-"+Array.from({length:n.length},(_,i)=>n.charCodeAt(i).toString(16).padStart(4,"0")).join("");
 function label(s,id){return own(s.catNames,id)?s.catNames[id]:name(id)}
 function findName(s,n){return (s.cats||[]).find(id=>label(s,id)===n)}
 function add(s,n){n=name(n);const old=findName(s,n);if(old)return old;const base=legacyId(n);let id=base,i=2;while(own(s.catNames,id))id=base+"-"+i++;s.cats.push(id);s.catNames=Object.fromEntries([...Object.entries(s.catNames),[id,n]]);s.catColors=Object.fromEntries([...Object.entries(s.catColors||{}),[id,root.CategoryUI.colorFor(n,{})]]);if(!own(s.catAliases,n))s.catAliases=Object.fromEntries([...Object.entries(s.catAliases),[n,id]]);return id}
 function sourceId(s,n,create=false){if(n===undefined||n===null||n==="")return "";n=String(n);if(own(s.catAliases,n)&&s.cats.includes(s.catAliases[n]))return s.catAliases[n];const id=findName(s,n);return id||(create?add(s,n):"")}
 function migrate(s){
  const version=Number(s.v||0);
  if(version>3)throw new Error("더 새로운 저장 형식이에요. 모든 기기와 탭을 새로고침해주세요.");
  if(version===3&&(!s.catNames||typeof s.catNames!=="object"||Array.isArray(s.catNames)))throw new Error("분류 ID의 이름 정보가 없어 저장본을 변경하지 않았어요.");
  const modern=version===3;
  const oldCats=s.cats||[],oldNames=s.catNames||{},oldColors=s.catColors||{},oldAliases=s.catAliases||{};
  s.cats=[];s.catNames={};s.catColors={};s.catAliases={};
  const refs=new Map();
  function ensure(value){const raw=name(value);if(refs.has(raw))return refs.get(raw);
   if(modern&&own(oldNames,raw)){if(!s.cats.includes(raw)){s.cats.push(raw);s.catNames=Object.fromEntries([...Object.entries(s.catNames),[raw,String(oldNames[raw])]]);s.catColors=Object.fromEntries([...Object.entries(s.catColors),[raw,root.CategoryUI.validColor(oldColors[raw])?oldColors[raw]:root.CategoryUI.colorFor(String(oldNames[raw]),{})]]);}refs.set(raw,raw);return raw}
   const id=add(s,raw);refs.set(raw,id);if(root.CategoryUI.validColor(oldColors[raw]))s.catColors[id]=oldColors[raw];return id}
  for(const c of oldCats)ensure(c);
  // Preserve identity even if an ordered entry was missing in a v3 backup.
  if(modern)for(const c of Object.keys(oldNames))ensure(c);
  for(const list of [s.txs,s.ledger,s.rules,s.learnedRules,s.learningConflicts])for(const r of list||[]){if(own(r,"category")||list===s.txs||list===s.ledger)r.category=ensure(r.category);if(Array.isArray(r.categories))r.categories=r.categories.map(ensure)}
  // Orphan custom colors are also preserved as categories rather than discarded.
  for(const c of Object.keys(oldColors))ensure(c);
  if(modern)s.catAliases=Object.fromEntries(Object.entries(oldAliases).filter(([,id])=>s.cats.includes(id)));
  for(const id of s.cats){const n=label(s,id);if(!own(s.catAliases,n))s.catAliases=Object.fromEntries([...Object.entries(s.catAliases),[n,id]])}
  s.v=3;return s;
 }
 function used(s,id){return [s.txs,s.ledger,s.rules,s.learnedRules,s.learningConflicts].some(list=>(list||[]).some(r=>r.category===id||r.categories?.includes(id)))}
 function remove(s,id){if(s.cats.length<2||used(s,id))return false;s.cats=s.cats.filter(c=>c!==id);delete s.catNames[id];delete s.catColors[id];s.catAliases=Object.fromEntries(Object.entries(s.catAliases).filter(([,v])=>v!==id));return true}
 const api={migrate,label,findName,sourceId,add,used,remove,legacyId};root.CategoryState=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
