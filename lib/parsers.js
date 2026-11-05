const XLSX = require("xlsx");

const SHEET_TO_CARD = {
  신한: "shinhan",
  "삼성(국내)": "samsung",
  "삼성(해외)": "samsung",
  하나: "hana",
  농협: "nh",
  우리: "woori",
  IBK: "ibk",
  현대: "hyundai",
  국민: "kb",
  롯데: "lotte",
  BC: "bc",
};

function excelSerialToDate(serial) {
  if (typeof serial === "string" && /^\d{4}[./-]/.test(serial)) {
    return normalizeDateStr(serial);
  }
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000) return String(serial || "");
  // Excel serial (1900 date system) → JS Date (UTC)
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  // fractional day → time
  const frac = n - Math.floor(n);
  if (frac > 0.00001) {
    const totalSec = Math.round(frac * 86400);
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }
  return `${y}-${m}-${day}`;
}

function excelTimeToStr(t) {
  if (t == null || t === "") return "";
  if (typeof t === "string") {
    if (/^\d{1,2}:\d{2}/.test(t)) return t.slice(0, 8);
    return t;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return "";
  // fraction of day
  const totalSec = Math.round((n % 1) * 86400);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizeDateStr(s) {
  if (s == null || s === "") return "";
  if (typeof s === "number") return excelSerialToDate(s);
  let str = String(s).replace(/\r?\n/g, " ").trim();
  // 2026.11.05 22:17 or 2026.11.05
  str = str.replace(/\./g, "-");
  const m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (m[4]) return `${d} ${m[4].padStart(2, "0")}:${m[5]}`;
    return d;
  }
  // 11.02 22:58:30 (no year) — assume 2026
  const m2 = str.match(/^(\d{1,2})[./-](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m2) {
    return `2026-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")} ${m2[3].padStart(2, "0")}:${m2[4]}`;
  }
  return str;
}

function toNum(v) {
  if (v == null || v === "" || v === "-") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").replace(/원/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cleanHeader(h) {
  return String(h || "")
    .replace(/\r?\n/g, "")
    .replace(/\t/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function rowsFromSheet(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
}

function findHeaderIndex(rows, mustInclude = []) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const joined = rows[i].map(cleanHeader).join("|");
    if (mustInclude.every((k) => joined.includes(cleanHeader(k)))) return i;
  }
  return 0;
}

function headerMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = cleanHeader(h);
    if (key && map[key] == null) map[key] = i;
  });
  return map;
}

function col(map, row, ...names) {
  for (const n of names) {
    const k = cleanHeader(n);
    if (map[k] != null) return row[map[k]];
  }
  return "";
}

function isCancelledText(v) {
  const s = String(v || "").trim();
  if (!s || s === "-" || s === "N" || s === "정상" || s === "승인" || s === "결제확정") return false;
  if (/취소|cancel/i.test(s)) return true;
  if (s === "Y") return true; // 취소여부 Y
  return false;
}

function parseShinhan(rows) {
  const hi = findHeaderIndex(rows, ["거래일", "가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "금액"));
    if (!merchant && !amount) continue;
    const cancel = col(map, r, "취소상태");
    const buy = String(col(map, r, "매입구분") || "");
    const cancelled = isCancelledText(cancel) || /취소/.test(buy);
    out.push({
      date: normalizeDateStr(col(map, r, "거래일")),
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled,
      cardIssuer: "shinhan",
      rawCardMask: String(col(map, r, "이용카드") || "").trim() || null,
    });
  }
  return out;
}

function parseSamsungDomestic(rows) {
  const hi = findHeaderIndex(rows, ["승인일자", "가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "승인금액(원)", "승인금액"));
    if (!merchant && !amount) continue;
    const d = normalizeDateStr(col(map, r, "승인일자"));
    const t = excelTimeToStr(col(map, r, "승인시각"));
    const date = t ? `${d} ${t}` : d;
    const cancel = col(map, r, "취소여부");
    out.push({
      date,
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: isCancelledText(cancel),
      cardIssuer: "samsung",
      rawCardMask: String(col(map, r, "카드번호") || "").trim() || null,
    });
  }
  return out;
}

function parseSamsungOverseas(rows) {
  const hi = findHeaderIndex(rows, ["승인일자", "가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "가맹점명") || "").trim();
    // Prefer 현지이용금액 when it's already KRW-like large; sample has VND 8837280
    // Spec: store amount in KRW if possible from 현지이용금액 — for VND we keep local amount as-is note
    const currency = String(col(map, r, "현지거래통화") || "").toUpperCase();
    const localAmt = toNum(col(map, r, "현지이용금액"));
    const usdAmt = toNum(col(map, r, "승인금액(USD)", "승인금액"));
    // Only treat as KRW when currency is KRW/empty; otherwise amount=0 and note local (avoid VND/USD as 원)
    let amount = 0;
    let note = "해외";
    if (!currency || currency === "KRW" || currency === "원") {
      amount = localAmt || usdAmt;
      note = "해외·KRW";
    } else {
      amount = 0;
      note = `해외·${currency} ${localAmt || usdAmt} (원화 미환산·수동입력)`;
    }
    if (!merchant && !localAmt && !usdAmt) continue;
    const d = normalizeDateStr(col(map, r, "승인일자"));
    const t = excelTimeToStr(col(map, r, "승인시각"));
    const cancel = col(map, r, "취소구분");
    out.push({
      date: t ? `${d} ${t}` : d,
      merchant: currency && currency !== "KRW" ? `${merchant.trim()} [${currency}]` : merchant.trim(),
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: isCancelledText(cancel),
      cardIssuer: "samsung",
      rawCardMask: String(col(map, r, "카드번호") || "").trim() || null,
      note,
    });
  }
  return out;
}

function parseHana(rows) {
  const hi = findHeaderIndex(rows, ["이용일", "가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "승인금액"));
    if (!merchant && !amount) continue;
    const d = normalizeDateStr(col(map, r, "이용일"));
    const t = excelTimeToStr(col(map, r, "이용시간"));
    const status = col(map, r, "상태");
    out.push({
      date: t ? `${d} ${t}` : d,
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: isCancelledText(status),
      cardIssuer: "hana",
      rawCardMask: String(col(map, r, "이용카드") || "").trim() || null,
    });
  }
  return out;
}

function parseNh(rows) {
  // Messy merged headers — first row has split cells
  const hi = 0;
  const header = (rows[hi] || []).map((h) => cleanHeader(h));
  // Build map manually from known positions in sample
  // 사용일자=0, 이용카드=3, 승인번호=4, 가맹점명=6, 이용금액=9, 취소여부=last
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    // Find non-empty cells flexibly
    const dateRaw = r[0];
    let merchant = "";
    let amount = 0;
    let approval = "";
    let cancel = "";
    let cardMask = "";
    // Prefer header map if keys present
    const map = {};
    header.forEach((h, idx) => {
      if (h) map[h] = idx;
    });
    if (Object.keys(map).length > 3) {
      merchant = String(col(map, r, "가맹점명") || "").trim();
      amount = toNum(col(map, r, "이용금액"));
      approval = String(col(map, r, "승인번호") || "").trim();
      cancel = col(map, r, "취소여부");
      cardMask = String(col(map, r, "이용카드") || "").trim();
    }
    if (!merchant) {
      // fallback positional
      merchant = String(r[6] || r[5] || "").trim();
      amount = toNum(r[9] != null && r[9] !== "" ? r[9] : r[8]);
      approval = String(r[4] || "").trim();
      cancel = r[r.length - 1];
      cardMask = String(r[3] || "").trim();
    }
    if (!merchant && !amount) continue;
    out.push({
      date: excelSerialToDate(dateRaw),
      merchant,
      amount,
      approvalNo: approval || null,
      cancelled: String(cancel).toUpperCase() === "Y" || isCancelledText(cancel),
      cardIssuer: "nh",
      rawCardMask: cardMask || null,
    });
  }
  return out;
}

function parseWoori(rows) {
  const hi = findHeaderIndex(rows, ["이용일", "이용가맹점"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "이용가맹점(은행)명", "이용가맹점") || "").trim();
    const amount = toNum(col(map, r, "이용금액(원)", "이용금액"));
    const cancelAmt = toNum(col(map, r, "취소금액(원)", "취소금액"));
    const pay = String(col(map, r, "결제예정일") || "");
    if (!merchant && !amount) continue;
    const cancelled = cancelAmt > 0 || /취소/.test(pay);
    out.push({
      date: normalizeDateStr(col(map, r, "이용일")),
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled,
      cardIssuer: "woori",
      rawCardMask: String(col(map, r, "이용카드") || "").trim() || null,
    });
  }
  return out;
}

function parseIbk(rows) {
  const hi = findHeaderIndex(rows, ["승인일시", "이용가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "이용가맹점명", "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "승인금액"));
    if (!merchant && !amount) continue;
    const cancelAmt = toNum(col(map, r, "취소금액"));
    out.push({
      date: excelSerialToDate(col(map, r, "승인일시")),
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: cancelAmt > 0,
      cardIssuer: "ibk",
      rawCardMask: String(col(map, r, "카드번호") || "").trim() || null,
    });
  }
  return out;
}

function parseHyundai(rows) {
  const hi = findHeaderIndex(rows, ["승인일", "가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "승인금액"));
    if (!merchant && !amount) continue;
    const d = excelSerialToDate(col(map, r, "승인일"));
    const t = excelTimeToStr(col(map, r, "승인시각"));
    const kind = col(map, r, "승인구분");
    out.push({
      date: t ? `${d.split(" ")[0]} ${t}` : d,
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: isCancelledText(kind) || !!col(map, r, "취소일"),
      cardIssuer: "hyundai",
      rawCardMask: String(col(map, r, "카드종류") || "").trim() || null,
    });
  }
  return out;
}

function parseKb(rows) {
  const hi = findHeaderIndex(rows, ["이용일", "이용하신곳"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "이용하신곳", "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "국내이용금액(원)", "국내이용금액"));
    if (!merchant && !amount) continue;
    const d = excelSerialToDate(col(map, r, "이용일"));
    const t = excelTimeToStr(col(map, r, "이용시간"));
    const status = col(map, r, "상태");
    out.push({
      date: t ? `${String(d).split(" ")[0]} ${t}` : d,
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: isCancelledText(status),
      cardIssuer: "kb",
      rawCardMask: String(col(map, r, "이용카드명") || "").trim() || null,
    });
  }
  return out;
}

function parseLotte(rows) {
  const hi = findHeaderIndex(rows, ["이용일자", "이용가맹점"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "이용가맹점", "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "이용금액"));
    if (!merchant && !amount) continue;
    const d = normalizeDateStr(col(map, r, "이용일자"));
    const t = excelTimeToStr(col(map, r, "이용시간"));
    const cancel = col(map, r, "취소여부");
    out.push({
      date: t ? `${d} ${t}` : d,
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: String(cancel).toUpperCase() === "Y" || isCancelledText(cancel),
      cardIssuer: "lotte",
      rawCardMask: String(col(map, r, "이용카드") || "").trim() || null,
    });
  }
  return out;
}

function parseBc(rows) {
  const hi = findHeaderIndex(rows, ["가맹점명"]);
  const map = headerMap(rows[hi] || []);
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const merchant = String(col(map, r, "가맹점명") || "").trim();
    const amount = toNum(col(map, r, "승인금액"));
    if (!merchant && !amount) continue;
    const rawDate = String(col(map, r, "승인일시") || "").replace(/\r?\n/g, " ");
    const cancel = col(map, r, "취소일자취소금액", "취소일자");
    out.push({
      date: normalizeDateStr(rawDate),
      merchant,
      amount,
      approvalNo: String(col(map, r, "승인번호") || "").trim() || null,
      cancelled: isCancelledText(cancel) && String(cancel).trim() !== "-",
      cardIssuer: "bc",
      rawCardMask: String(col(map, r, "이용카드", "승인카드") || "").replace(/\t/g, "").trim() || null,
    });
  }
  return out;
}

const PARSERS = {
  shinhan: parseShinhan,
  "samsung-domestic": parseSamsungDomestic,
  "samsung-overseas": parseSamsungOverseas,
  hana: parseHana,
  nh: parseNh,
  woori: parseWoori,
  ibk: parseIbk,
  hyundai: parseHyundai,
  kb: parseKb,
  lotte: parseLotte,
  bc: parseBc,
};

function parseSheet(sheetName, ws) {
  const rows = rowsFromSheet(ws);
  const name = String(sheetName || "").trim();
  if (name === "신한") return { card: "shinhan", rows: parseShinhan(rows) };
  if (name === "삼성(국내)" || name.includes("삼성") && name.includes("국내"))
    return { card: "samsung", rows: parseSamsungDomestic(rows) };
  if (name === "삼성(해외)" || name.includes("삼성") && name.includes("해외"))
    return { card: "samsung", rows: parseSamsungOverseas(rows) };
  if (name === "하나") return { card: "hana", rows: parseHana(rows) };
  if (name === "농협") return { card: "nh", rows: parseNh(rows) };
  if (name === "우리") return { card: "woori", rows: parseWoori(rows) };
  if (name === "IBK" || name.toUpperCase() === "IBK") return { card: "ibk", rows: parseIbk(rows) };
  if (name === "현대") return { card: "hyundai", rows: parseHyundai(rows) };
  if (name === "국민") return { card: "kb", rows: parseKb(rows) };
  if (name === "롯데") return { card: "lotte", rows: parseLotte(rows) };
  if (name === "BC" || name.toUpperCase() === "BC") return { card: "bc", rows: parseBc(rows) };
  return null;
}

function parseWorkbook(bufOrPath, forcedCard) {
  const wb =
    typeof bufOrPath === "string"
      ? XLSX.readFile(bufOrPath)
      : XLSX.read(bufOrPath, { type: "buffer" });

  const results = [];
  if (forcedCard && wb.SheetNames.length === 1) {
    const name = wb.SheetNames[0];
    const ws = wb.Sheets[name];
    const rows = rowsFromSheet(ws);
    const parser =
      forcedCard === "shinhan"
        ? parseShinhan
        : forcedCard === "samsung"
          ? parseSamsungDomestic
          : forcedCard === "hana"
            ? parseHana
            : forcedCard === "nh"
              ? parseNh
              : forcedCard === "woori"
                ? parseWoori
                : forcedCard === "ibk"
                  ? parseIbk
                  : forcedCard === "hyundai"
                    ? parseHyundai
                    : forcedCard === "kb"
                      ? parseKb
                      : forcedCard === "lotte"
                        ? parseLotte
                        : forcedCard === "bc"
                          ? parseBc
                          : null;
    if (parser) {
      results.push({ card: forcedCard, sheet: name, rows: parser(rows) });
      return results;
    }
  }

  for (const name of wb.SheetNames) {
    const parsed = parseSheet(name, wb.Sheets[name]);
    if (parsed) results.push({ card: parsed.card, sheet: name, rows: parsed.rows });
  }

  // If forced card and multi-sheet didn't match, try forced on first sheet
  if (forcedCard && !results.length) {
    const name = wb.SheetNames[0];
    const rows = rowsFromSheet(wb.Sheets[name]);
    const fallback = {
      shinhan: parseShinhan,
      samsung: parseSamsungDomestic,
      hana: parseHana,
      nh: parseNh,
      woori: parseWoori,
      ibk: parseIbk,
      hyundai: parseHyundai,
      kb: parseKb,
      lotte: parseLotte,
      bc: parseBc,
    }[forcedCard];
    if (fallback) results.push({ card: forcedCard, sheet: name, rows: fallback(rows) });
  }

  return results;
}

module.exports = {
  SHEET_TO_CARD,
  parseWorkbook,
  parseSheet,
  PARSERS,
  normalizeDateStr,
  excelSerialToDate,
};
