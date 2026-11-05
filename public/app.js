const COLOR = {
  개인: "#e8c96a",
  데이트: "#f0a0a8",
  부동산: "#9dcea0",
  크림: "#8ec0e8",
  섬김비: "#b7a8e0",
  연체: "#a0a6b0",
  취미: "#d4a090",
};

let state = null;
let view = "settle";
let txs = [];

const won = (n) => (Number(n) || 0).toLocaleString("ko-KR");
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

async function loadState() {
  state = await api("/api/state");
  fillCatSelects();
  render();
}

function focusCard() {
  return state.cards.find((c) => c.id === state.focusCard) || state.cards[0];
}

function cardsInAccount(accId) {
  return state.cards.filter((c) => c.account === accId);
}

function accountOf(card) {
  return state.accounts.find((a) => a.id === card.account);
}

function setView(v) {
  view = v;
  document.querySelectorAll(".navbtn").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  ["settle", "ledger", "rules"].forEach((name) => {
    $(`view-${name}`).classList.toggle("hidden", name !== v);
  });
  render();
}

document.querySelectorAll(".navbtn").forEach((b) => (b.onclick = () => setView(b.dataset.view)));

function fillCatSelects() {
  const opts = state.categories.map((c) => `<option value="${c}">${c}</option>`).join("");
  const keep = (el, extra) => {
    const cur = el.value || "all";
    el.innerHTML = extra + opts;
    el.value = cur;
  };
  keep($("catFilter"), `<option value="all">전체</option>`);
  keep($("ledgerCat"), `<option value="all">전체</option>`);
  $("ruleCat").innerHTML = opts;
}

function renderAccountTabs() {
  const accounts = ["352", "302", "other"].filter((id) => state.accounts.some((a) => a.id === id));
  $("accountTabs").innerHTML = accounts
    .map((id) => {
      const label = id === "other" ? "기타" : `${id}`;
      return `<button class="tab ${state.focusAccount === id ? "on" : ""}" data-a="${id}">${label}</button>`;
    })
    .join("");
  $("accountTabs").querySelectorAll(".tab").forEach((b) => {
    b.onclick = async () => {
      const cards = cardsInAccount(b.dataset.a);
      await api("/api/focus", {
        method: "POST",
        body: JSON.stringify({ account: b.dataset.a, card: cards[0]?.id }),
      });
      await loadState();
    };
  });
  const acc = state.accounts.find((a) => a.id === state.focusAccount);
  $("accountHint").textContent = acc ? `${acc.name} · 잔고 ${won(acc.balance)}원` : "";
}

function renderCardSide() {
  const list = cardsInAccount(state.focusAccount);
  $("cardSide").innerHTML = list
    .map((c) => {
      const on = c.id === state.focusCard;
      const needCls = c.need === 0 ? "ok" : "bad";
      const stg = c.stagingCount ? ` · 대기 ${c.stagingCount}` : "";
      return `<button class="sidecard ${on ? "on" : ""}" data-c="${c.id}">
        <div class="nm">${c.name}</div>
        <div class="need ${needCls}">필요 ${won(c.need)}</div>
        <div class="muted" style="font-size:11px">${c.txCount}건${stg}</div>
      </button>`;
    })
    .join("");
  $("cardSide").querySelectorAll(".sidecard").forEach((b) => {
    b.onclick = async () => {
      await api("/api/focus", { method: "POST", body: JSON.stringify({ card: b.dataset.c }) });
      await loadState();
    };
  });
}

function updateStagingPreview() {
  const c = focusCard();
  if (!c) return;
  const n = c.stagingCount || 0;
  const s = c.stagingSum || 0;
  $("stagingPreview").textContent = `대기 ${n}건 · 합계 ${won(s)}원`;
  $("btnLoadStaging").disabled = n === 0;
}

function renderSummary() {
  const c = focusCard();
  if (!c) return;
  const acc = accountOf(c);
  const n = c.need;
  const o = c.openSum;
  const d = o - n;
  const bal = acc?.balance || 0;
  $("summary").innerHTML = `
    <div class="scard"><h2>입금완료 (계좌잔고)</h2><div class="big">${won(bal)}</div><div class="muted" style="margin-top:4px">${c.account} 공유</div></div>
    <div class="scard"><h2>이용금액 · ${c.name}</h2><div class="big">${won(c.used)}</div></div>
    <div class="scard"><h2>입금필요</h2><div class="big ${n === 0 ? "zero-ok" : ""}">${won(n)}</div></div>`;
  $("openSum").textContent = won(o) + "원";
  $("needShow").textContent = won(n) + "원";
  $("doneShow").textContent = won(bal) + "원";
  $("needInline").textContent = `입금필요 ${won(n)}원`;
  const diffEl = $("diffShow");
  diffEl.textContent = (d >= 0 ? "+" : "") + won(d) + "원";
  diffEl.className = Math.abs(d) < 1 ? "zero-ok" : "zero-bad";
  $("diffHint").textContent =
    Math.abs(d) < 1
      ? "맞춰짐"
      : d > 0
        ? `목록이 ${won(d)}원 더 큼`
        : `목록이 ${won(-d)}원 부족 · 개인차액 가능`;
  $("inpUsed").value = c.used || 0;
  $("inpBalance").value = bal;
  $("inpMemo").value = c.memo || "";
  $("balLabel").firstChild.textContent = `${c.account} 계좌잔고`;
  updateStagingPreview();
}

async function loadTxs() {
  const c = focusCard();
  if (!c) return;
  const showSettled = $("showSettled").checked;
  const cat = $("catFilter").value;
  const q = $("q").value.trim();
  const params = new URLSearchParams({ card: c.id });
  if (!showSettled) params.set("settled", "0");
  if (cat && cat !== "all") params.set("category", cat);
  if (q) params.set("q", q);
  const data = await api(`/api/txs?${params}`);
  txs = data.rows;
  if (data.openSum != null) {
    c.openSum = data.openSum;
    c.need = data.need;
  }
  renderTable();
  renderSummary();
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderTable() {
  const tb = $("tbody");
  if (!txs.length) {
    tb.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:18px">내역 없음 · 카드내역 불러오기</td></tr>`;
    return;
  }
  tb.innerHTML = txs
    .map(
      (t) => `<tr style="opacity:${t.settled ? 0.45 : 1}">
      <td><input type="checkbox" class="pick" data-id="${t.id}" /></td>
      <td>${esc(t.date)}${t.virtual ? ' <span class="muted">가상</span>' : ""}</td>
      <td><input class="cell-edit merchant" data-id="${t.id}" value="${esc(t.merchant)}" /></td>
      <td class="r">${won(t.amount)}</td>
      <td><select class="cat" data-id="${t.id}" style="background:${COLOR[t.category] || "#888"}33">${
        state.categories
          .map((c) => `<option value="${c}" ${c === t.category ? "selected" : ""}>${c}</option>`)
          .join("")
      }</select></td>
      <td><input class="cell-edit memo" data-id="${t.id}" value="${esc(t.note)}" placeholder="메모" /></td>
      <td class="muted">${t.settled ? "완료" : "미정산"}</td>
    </tr>`
    )
    .join("");

  tb.querySelectorAll("select.cat").forEach((s) => {
    s.onchange = async () => {
      await api(`/api/txs/${s.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ category: s.value }),
      });
      await loadState();
      await loadTxs();
    };
  });

  const bindBlur = (sel, field) => {
    tb.querySelectorAll(sel).forEach((inp) => {
      const save = async () => {
        const body = {};
        body[field] = inp.value;
        await api(`/api/txs/${inp.dataset.id}`, { method: "PATCH", body: JSON.stringify(body) });
        const row = txs.find((x) => String(x.id) === String(inp.dataset.id));
        if (row) {
          if (field === "merchant") row.merchant = inp.value;
          if (field === "note") row.note = inp.value;
        }
      };
      inp.onblur = save;
      inp.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inp.blur();
        }
      };
    });
  };
  bindBlur("input.merchant", "merchant");
  bindBlur("input.memo", "note");
}

async function renderLedger() {
  const summary = await api("/api/ledger/summary");
  $("ledgerCats").innerHTML = state.categories
    .map(
      (c) => `<div class="scard">
      <div class="pill" style="background:${COLOR[c]}22;color:${COLOR[c]}"><span class="dot" style="background:${COLOR[c]}"></span>${c}</div>
      <div class="big" style="font-size:18px;margin-top:6px">${won(summary.categories[c] || 0)}</div>
    </div>`
    )
    .join("");
  const cat = $("ledgerCat").value;
  const params = new URLSearchParams();
  if (cat && cat !== "all") params.set("category", cat);
  const data = await api(`/api/txs?${params}`);
  const name = (id) => state.cards.find((c) => c.id === id)?.name || id;
  $("ledgerBody").innerHTML =
    data.rows
      .map(
        (t) => `<tr>
      <td>${name(t.card)}</td><td>${esc(t.date)}</td><td>${esc(t.merchant)}</td>
      <td class="r">${won(t.amount)}</td>
      <td><span class="pill" style="background:${COLOR[t.category]}22;color:${COLOR[t.category]}"><span class="dot" style="background:${COLOR[t.category]}"></span>${t.category}</span></td>
      <td class="muted">${esc(t.note)}</td>
      <td class="muted">${t.settled ? "완료" : "미정산"}</td>
    </tr>`
      )
      .join("") || `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">없음</td></tr>`;
}

function renderRules() {
  $("rulesList").innerHTML = state.rules
    .map(
      (r) => `<div class="rule">
      <div><b>${esc(r.match_text)}</b></div>
      <span class="pill" style="background:${COLOR[r.category]}22;color:${COLOR[r.category]}"><span class="dot" style="background:${COLOR[r.category]}"></span>${r.category}</span>
      <button class="btn danger" data-id="${r.id}">삭제</button>
    </div>`
    )
    .join("");
  $("rulesList").querySelectorAll(".danger").forEach((b) => {
    b.onclick = async () => {
      await api(`/api/rules/${b.dataset.id}`, { method: "DELETE" });
      await loadState();
    };
  });
}

async function render() {
  if (!state) return;
  if (view === "settle") {
    renderAccountTabs();
    renderCardSide();
    renderSummary();
    await loadTxs();
  } else if (view === "ledger") {
    await renderLedger();
  } else if (view === "rules") {
    renderRules();
  }
}

$("btnSaveMeta").onclick = async () => {
  const c = focusCard();
  await api(`/api/card/${c.id}`, {
    method: "PATCH",
    body: JSON.stringify({ used: Number($("inpUsed").value) || 0, memo: $("inpMemo").value || "" }),
  });
  await api(`/api/account/${c.account}`, {
    method: "PATCH",
    body: JSON.stringify({ balance: Number($("inpBalance").value) || 0 }),
  });
  await loadState();
};

$("btnLoadStaging").onclick = async () => {
  const c = focusCard();
  $("loadMsg").textContent = "불러오는 중…";
  try {
    const data = await api(`/api/cards/${c.id}/load`, { method: "POST", body: "{}" });
    $("loadMsg").textContent = `+${data.inserted}건 (이미있음 ${data.skipped}) · 미정산합 ${won(data.openSum)}`;
    await loadState();
  } catch (err) {
    $("loadMsg").textContent = "실패: " + err.message;
  }
};

$("btnAdd").onclick = async () => {
  const amount = Number($("addAmt").value) || 0;
  const merchant = $("addMerchant").value.trim();
  if (!amount || !merchant) return alert("금액과 내용 입력");
  const date = $("addDate").value.trim() || new Date().toISOString().slice(0, 10);
  await api("/api/txs", {
    method: "POST",
    body: JSON.stringify({ card: state.focusCard, amount, merchant, date }),
  });
  $("addAmt").value = "";
  $("addMerchant").value = "";
  await loadState();
};

$("btnAdj").onclick = async () => {
  const c = focusCard();
  const d = c.openSum - c.need;
  if (Math.abs(d) < 1) return alert("이미 맞춰짐");
  if (d >= 0) return alert("목록이 더 큼 · 분류/중복 확인");
  await api("/api/txs", {
    method: "POST",
    body: JSON.stringify({
      card: c.id,
      amount: Math.abs(d),
      merchant: "개인차액",
      category: "개인",
      virtual: true,
      note: "가상내역으로 맞춤",
    }),
  });
  await loadState();
};

function selectedIds() {
  return [...document.querySelectorAll(".pick:checked")].map((x) => Number(x.dataset.id));
}

$("btnMarkSettled").onclick = async () => {
  const ids = selectedIds();
  if (!ids.length) return;
  await api("/api/txs/settle", { method: "POST", body: JSON.stringify({ ids, settled: true }) });
  await loadState();
};

$("btnMarkOpen").onclick = async () => {
  const ids = selectedIds();
  if (!ids.length) return;
  await api("/api/txs/settle", { method: "POST", body: JSON.stringify({ ids, settled: false }) });
  await loadState();
};

$("checkAll").onchange = () => {
  document.querySelectorAll(".pick").forEach((c) => (c.checked = $("checkAll").checked));
};

$("catFilter").onchange = () => loadTxs();
$("q").oninput = () => loadTxs();
$("showSettled").onchange = () => loadTxs();
$("ledgerCat").onchange = () => renderLedger();

$("btnAddRule").onclick = async () => {
  const match = $("ruleMatch").value.trim();
  const category = $("ruleCat").value;
  if (!match) return;
  await api("/api/rules", { method: "POST", body: JSON.stringify({ match, category }) });
  $("ruleMatch").value = "";
  await loadState();
};

$("fileUpload").onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  $("uploadMsg").textContent = "업로드 중…";
  try {
    const res = await fetch(`/api/upload?card=${encodeURIComponent(state.focusCard)}`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "fail");
    $("uploadMsg").textContent = `직접 +${data.inserted}건 (스킵 ${data.skipped})`;
    await loadState();
  } catch (err) {
    $("uploadMsg").textContent = "실패: " + err.message;
  }
  e.target.value = "";
};

$("btnSample").onclick = async () => {
  $("uploadMsg").textContent = "샘플→대기…";
  try {
    const data = await api("/api/import-sample", { method: "POST", body: "{}" });
    $("uploadMsg").textContent = `대기 +${data.inserted}건`;
    await loadState();
  } catch (err) {
    $("uploadMsg").textContent = "실패: " + err.message;
  }
};

loadState().catch((e) => alert("로드 실패: " + e.message));
