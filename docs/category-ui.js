/** Category presentation and accessible keyboard picker. No persistence or settlement math. */
(function(root){
 "use strict";
 const palette={개인:"#e8c96a",데이트:"#f0a0a8",부동산:"#9dcea0",크림:"#8ec0e8",섬김비:"#b7a8e0",연체:"#a0a6b0",취미:"#d4a090"};
 const validColor=v=>typeof v==="string"&&/^#[0-9a-f]{6}$/i.test(v);
 const categoryName=v=>v===undefined||v===null||v===""?"미분류":String(v);
 const colorFor=(name,colors)=>validColor(colors?.[name])?colors[name]:validColor(palette[name])?palette[name]:"#94a3b8";
 const shortcutAt=i=>i>=0&&i<9?String(i+1):i>=9&&i<35?String.fromCharCode(97+i-9):"";
 const shortcutIndex=key=>/^[1-9]$/.test(key)?Number(key)-1:/^[a-z]$/i.test(key)?key.toLowerCase().charCodeAt(0)-97+9:null;
 function orderedCategories(cats=[],txs=[]){return [...new Set([...cats.map(categoryName),...txs.map(t=>categoryName(t.category))])]}
 function normalizeColors(saved,cats=[]){const values=new Map(Object.entries(saved||{}));for(const name of cats)values.set(name,colorFor(name,saved));return Object.fromEntries(values)}
 function categoryTotals(cats,txs){const sums=new Map(orderedCategories(cats,txs).map(c=>[c,0]));for(const t of txs){const c=categoryName(t.category),n=Number(t.amount);sums.set(c,sums.get(c)+(Number.isFinite(n)?n:0))}return [...sums].map(([category,amount])=>({category,amount}))}
 function paintTransactionRow(row,category,colors){if(!row)return;const color=colorFor(category,colors);row.style.setProperty("--cat-color",color);row.style.setProperty("--cat-wash",color+"18");row.classList.add("category-row")}
 let serial=0,closeActive=null;
 function mountCategoryPicker(button,{getOptions,getValue,getColors=()=>({}),onCommit}){
  const doc=button.ownerDocument,win=doc.defaultView;let menu=null,active=0,options=[],items=[];
  const id="category-list-"+(++serial);
  button.type="button";button.setAttribute("role","combobox");button.setAttribute("aria-haspopup","listbox");button.setAttribute("aria-expanded","false");button.setAttribute("aria-controls",id);button.setAttribute("aria-label","분류 선택");
  function refresh(){const value=categoryName(getValue()),color=colorFor(value,getColors());button.textContent=value;button.style.setProperty("--cat-color",color);button.setAttribute("aria-label","분류: "+value+". Alt+아래 화살표로 목록 열기")}
  function close(){if(!menu)return;menu.remove();menu=null;items=[];button.setAttribute("aria-expanded","false");button.removeAttribute("aria-activedescendant");doc.removeEventListener("pointerdown",outside,true);win.removeEventListener("resize",close);win.removeEventListener("scroll",scrollClose,true);if(closeActive===close)closeActive=null}
  function scrollClose(e){if(menu&&!menu.contains(e.target))close()}
  function outside(e){if(menu&&!menu.contains(e.target)&&!button.contains(e.target))close()}
  function activate(index){active=Math.max(0,Math.min(options.length-1,index));items.forEach((el,i)=>{el.classList.toggle("active",i===active);el.setAttribute("aria-selected",String(options[i]===categoryName(getValue())))});if(items[active]){button.setAttribute("aria-activedescendant",items[active].id);items[active].scrollIntoView?.({block:"nearest"})}}
  function commit(index){if(index<0||index>=options.length)return;const value=options[index];close();onCommit(value);refresh();button.focus({preventScroll:true})}
  function open(){if(menu)return;if(closeActive)closeActive();options=getOptions().map(categoryName);if(!options.length)return;
   menu=doc.createElement("div");menu.id=id;menu.className="category-menu";menu.setAttribute("role","listbox");menu.setAttribute("aria-label","분류 선택");
   const hint=doc.createElement("div");hint.className="category-menu-hint";hint.textContent="번호·문자로 선택 · Esc 닫기";hint.setAttribute("aria-hidden","true");menu.append(hint);
   items=options.map((name,i)=>{const el=doc.createElement("div");el.id=id+"-"+i;el.className="category-option";el.setAttribute("role","option");el.style.setProperty("--cat-color",colorFor(name,getColors()));const key=doc.createElement("kbd");key.textContent=shortcutAt(i);const text=doc.createElement("span");text.textContent=name;el.append(key,text);el.addEventListener("pointerdown",e=>e.preventDefault());el.addEventListener("click",()=>commit(i));menu.append(el);return el});
   doc.body.append(menu);const rect=button.getBoundingClientRect(),height=Math.min(320,win.innerHeight-24),width=Math.min(248,win.innerWidth-24);
   menu.style.width=width+"px";menu.style.maxHeight=height+"px";menu.style.left=Math.max(12,Math.min(rect.left,win.innerWidth-width-12))+"px";menu.style.top=Math.max(12,Math.min(rect.bottom+6,win.innerHeight-height-12))+"px";
   button.setAttribute("aria-expanded","true");closeActive=close;doc.addEventListener("pointerdown",outside,true);win.addEventListener("resize",close);win.addEventListener("scroll",scrollClose,true);activate(Math.max(0,options.indexOf(categoryName(getValue()))));
  }
  function click(){if(menu)close();else open()}
  function keydown(e){if(e.isComposing||e.ctrlKey||e.metaKey)return;
   if(e.key==="Tab"){close();return}
   if(!menu){if((e.altKey&&e.key==="ArrowDown")||e.key==="Enter"||e.key===" "){e.preventDefault();open()}return}
   if(e.key==="Escape"||(e.altKey&&e.key==="ArrowUp")){e.preventDefault();close();return}
   if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();activate(active+(e.key==="ArrowDown"?1:-1));return}
   if(e.key==="Home"||e.key==="End"){e.preventDefault();activate(e.key==="Home"?0:options.length-1);return}
   if(e.key==="Enter"||e.key===" "){e.preventDefault();commit(active);return}
   if(!e.altKey){const index=shortcutIndex(e.key);if(index!==null&&index<options.length){e.preventDefault();commit(index)}}
  }
  button.addEventListener("click",click);button.addEventListener("keydown",keydown);button.addEventListener("blur",close);refresh();
  return{refresh,destroy(){close();button.removeEventListener("click",click);button.removeEventListener("keydown",keydown);button.removeEventListener("blur",close)}};
 }
 const api={validColor,categoryName,colorFor,shortcutAt,shortcutIndex,orderedCategories,normalizeColors,categoryTotals,paintTransactionRow,mountCategoryPicker};root.CategoryUI=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
