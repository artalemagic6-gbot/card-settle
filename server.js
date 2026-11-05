const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { openDb, CATS, getMeta, setMeta } = require("./lib/db");
const { classify } = require("./lib/classify");
const { parseWorkbook } = require("./lib/parsers");

const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || "0.0.0.0";
const SAMPLE_CANDIDATES = [
  path.join(__dirname, "sample-all-cards.xlsx"),
  path.join(__dirname, "..", "card-settle", "sample-all-cards.xlsx"),
  path.join(__dirname, "data", "sample-all-cards.xlsx"),
];

function findSample() {
  for (const p of SAMPLE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const db = openDb();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

function rulesList() {
  return db.prepare("SELECT id, match_text, category FROM rules ORDER BY id ASC").all();
}

function needForCard(cardId) {
  const card = db.prepare("SELECT used, account FROM cards WHERE id=?").get(cardId);
  if (!card) return 0;
  const acc = db.prepare("SELECT balance FROM accounts WHERE id=?").get(card.account);
  const bal = acc ? acc.balance : 0;
  return Math.max(0, (card.used || 0) - bal);
}

function openSum(cardId) {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount),0) AS s FROM txs WHERE card=? AND settled=0 AND cancelled=0")
    .get(cardId);
  return row ? row.s : 0;
}

function stagingPreview(cardId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS sum
       FROM staging_txs WHERE card=? AND cancelled=0`
    )
    .get(cardId);
  return { count: row?.count || 0, sum: row?.sum || 0 };
}

function findExistingTx(row) {
  if (row.approvalNo) {
    const ex = db
      .prepare("SELECT id FROM txs WHERE card=? AND approval_no=? LIMIT 1")
      .get(row.card, row.approvalNo);
    if (ex) return ex;
  }
  const ex2 = db
    .prepare(
      "SELECT id FROM txs WHERE card=? AND date=? AND merchant=? AND amount=? AND COALESCE(approval_no,'')=COALESCE(?, '') LIMIT 1"
    )
    .get(row.card, row.date || "", row.merchant || "", row.amount || 0, row.approvalNo || null);
  if (ex2) return ex2;
  if (!row.approvalNo) {
    const ex3 = db
      .prepare("SELECT id FROM txs WHERE card=? AND date=? AND merchant=? AND amount=? LIMIT 1")
      .get(row.card, row.date || "", row.merchant || "", row.amount || 0);
    if (ex3) return ex3;
  }
  return null;
}

function insertTx(row) {
  const ex = findExistingTx(row);
  if (ex) return { id: ex.id, inserted: false };

  const info = db
    .prepare(
      `INSERT INTO txs(card,date,merchant,amount,category,note,settled,virtual,cancelled,approval_no,raw_card_mask,source_batch)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      row.card,
      row.date || "",
      row.merchant || "",
      row.amount || 0,
      row.category || "데이트",
      row.note || row.memo || "",
      row.settled ? 1 : 0,
      row.virtual ? 1 : 0,
      row.cancelled ? 1 : 0,
      row.approvalNo || null,
      row.rawCardMask || null,
      row.sourceBatch || null
    );
  return { id: info.lastInsertRowid, inserted: true };
}

function findExistingStaging(row) {
  if (row.approvalNo) {
    const ex = db
      .prepare("SELECT id FROM staging_txs WHERE card=? AND approval_no=? LIMIT 1")
      .get(row.card, row.approvalNo);
    if (ex) return ex;
  }
  const ex2 = db
    .prepare(
      "SELECT id FROM staging_txs WHERE card=? AND date=? AND merchant=? AND amount=? AND COALESCE(approval_no,'')=COALESCE(?, '') LIMIT 1"
    )
    .get(row.card, row.date || "", row.merchant || "", row.amount || 0, row.approvalNo || null);
  if (ex2) return ex2;
  if (!row.approvalNo) {
    const ex3 = db
      .prepare("SELECT id FROM staging_txs WHERE card=? AND date=? AND merchant=? AND amount=? LIMIT 1")
      .get(row.card, row.date || "", row.merchant || "", row.amount || 0);
    if (ex3) return ex3;
  }
  return null;
}

function insertStaging(row) {
  const ex = findExistingStaging(row);
  if (ex) return { id: ex.id, inserted: false };

  const info = db
    .prepare(
      `INSERT INTO staging_txs(card,date,merchant,amount,category,note,virtual,cancelled,approval_no,raw_card_mask,source_batch)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      row.card,
      row.date || "",
      row.merchant || "",
      row.amount || 0,
      row.category || "데이트",
      row.note || row.memo || "",
      row.virtual ? 1 : 0,
      row.cancelled ? 1 : 0,
      row.approvalNo || null,
      row.rawCardMask || null,
      row.sourceBatch || null
    );
  return { id: info.lastInsertRowid, inserted: true };
}

function normalizeJsonRows(body) {
  // Accept { rows: [...] } or { cards: { shinhan: [...] } } or raw array
  if (Array.isArray(body)) return body.map((r) => ({ ...r }));
  if (Array.isArray(body.rows)) return body.rows.map((r) => ({ ...r }));
  if (body.cards && typeof body.cards === "object") {
    const out = [];
    for (const [card, rows] of Object.entries(body.cards)) {
      for (const r of rows || []) out.push({ ...r, card: r.card || card });
    }
    return out;
  }
  return [];
}

function groupParsedToBlocks(parsedList) {
  return parsedList;
}

function importParsedToStaging(parsedList, { skipCancelled = true, replaceCards = true, sourceBatch = null } = {}) {
  const rules = rulesList();
  let inserted = 0;
  let skipped = 0;
  let cancelled = 0;
  const byCard = {};
  const batch = sourceBatch || `batch-${Date.now()}`;

  const cardsTouched = new Set(parsedList.map((b) => b.card).filter(Boolean));

  const run = db.transaction((list) => {
    if (replaceCards) {
      for (const card of cardsTouched) {
        db.prepare("DELETE FROM staging_txs WHERE card=?").run(card);
      }
    }
    for (const block of list) {
      byCard[block.card] = byCard[block.card] || { inserted: 0, skipped: 0, cancelled: 0, total: 0 };
      for (const r of block.rows) {
        byCard[block.card].total++;
        if (r.cancelled) {
          cancelled++;
          byCard[block.card].cancelled++;
          if (skipCancelled) {
            skipped++;
            byCard[block.card].skipped++;
            continue;
          }
        }
        const category = r.category || classify(r.merchant, rules);
        const result = insertStaging({
          card: block.card,
          date: r.date,
          merchant: r.merchant,
          amount: r.amount,
          category,
          note: r.note || r.memo || "봇 대기·자동분류",
          cancelled: !!r.cancelled,
          approvalNo: r.approvalNo,
          rawCardMask: r.rawCardMask,
          sourceBatch: batch,
          virtual: !!r.virtual,
        });
        if (result.inserted) {
          inserted++;
          byCard[block.card].inserted++;
        } else {
          skipped++;
          byCard[block.card].skipped++;
        }
      }
    }
  });
  run(parsedList);
  return { inserted, skipped, cancelled, byCard, sourceBatch: batch };
}

function importParsedToTxs(parsedList, { skipCancelled = true } = {}) {
  const rules = rulesList();
  let inserted = 0;
  let skipped = 0;
  let cancelled = 0;
  const byCard = {};

  const run = db.transaction((list) => {
    for (const block of list) {
      byCard[block.card] = byCard[block.card] || { inserted: 0, skipped: 0, cancelled: 0, total: 0 };
      for (const r of block.rows) {
        byCard[block.card].total++;
        if (r.cancelled) {
          cancelled++;
          byCard[block.card].cancelled++;
          if (skipCancelled) {
            skipped++;
            byCard[block.card].skipped++;
            continue;
          }
        }
        const category = classify(r.merchant, rules);
        const result = insertTx({
          card: block.card,
          date: r.date,
          merchant: r.merchant,
          amount: r.amount,
          category,
          note: r.note || "엑셀 직접업로드·자동분류",
          cancelled: !!r.cancelled,
          approvalNo: r.approvalNo,
          rawCardMask: r.rawCardMask,
        });
        if (result.inserted) {
          inserted++;
          byCard[block.card].inserted++;
        } else {
          skipped++;
          byCard[block.card].skipped++;
        }
      }
    }
  });
  run(parsedList);
  return { inserted, skipped, cancelled, byCard };
}

function rowsToParsedBlocks(rows) {
  const byCard = {};
  for (const r of rows) {
    const card = r.card;
    if (!card) continue;
    if (!byCard[card]) byCard[card] = { card, sheet: "json", rows: [] };
    byCard[card].rows.push({
      date: r.date || "",
      merchant: r.merchant || "",
      amount: Number(r.amount) || 0,
      cancelled: !!r.cancelled,
      approvalNo: r.approvalNo || r.approval_no || null,
      rawCardMask: r.rawCardMask || r.raw_card_mask || null,
      note: r.note || r.memo || "",
      category: r.category,
      virtual: !!r.virtual,
    });
  }
  return Object.values(byCard);
}

function loadStagingToCard(cardId) {
  const card = db.prepare("SELECT * FROM cards WHERE id=?").get(cardId);
  if (!card) return null;

  const staged = db
    .prepare("SELECT * FROM staging_txs WHERE card=? AND cancelled=0 ORDER BY date ASC, id ASC")
    .all(cardId);

  let inserted = 0;
  let skipped = 0;

  const run = db.transaction((list) => {
    for (const s of list) {
      const result = insertTx({
        card: s.card,
        date: s.date,
        merchant: s.merchant,
        amount: s.amount,
        category: s.category,
        note: s.note || "카드내역 불러오기",
        virtual: !!s.virtual,
        cancelled: 0,
        approvalNo: s.approval_no,
        rawCardMask: s.raw_card_mask,
        sourceBatch: s.source_batch,
      });
      if (result.inserted) inserted++;
      else skipped++;
    }
  });
  run(staged);

  return {
    card: cardId,
    staging: staged.length,
    inserted,
    skipped,
    openSum: openSum(cardId),
    need: needForCard(cardId),
    preview: stagingPreview(cardId),
  };
}

function maybeSeedStagingFromSample() {
  const stagingCount = db.prepare("SELECT COUNT(*) AS c FROM staging_txs").get().c;
  const txCount = db.prepare("SELECT COUNT(*) AS c FROM txs").get().c;
  // Only auto-seed staging when both empty (fresh DB)
  if (stagingCount > 0 || txCount > 0) return null;
  const sample = findSample();
  if (!sample) return { error: "sample missing", tried: SAMPLE_CANDIDATES };
  const parsed = parseWorkbook(sample);
  return importParsedToStaging(parsed, { skipCancelled: true, replaceCards: true, sourceBatch: "sample-seed" });
}

const seedResult = maybeSeedStagingFromSample();
if (seedResult) {
  console.log("[seed] staging sample:", JSON.stringify(seedResult));
}

// ---------- API ----------

app.get("/api/state", (req, res) => {
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY id").all();
  const cards = db
    .prepare("SELECT * FROM cards ORDER BY sort_order, id")
    .all()
    .map((c) => {
      const bal = accounts.find((a) => a.id === c.account)?.balance || 0;
      const need = Math.max(0, (c.used || 0) - bal);
      const open = openSum(c.id);
      const txCount = db.prepare("SELECT COUNT(*) AS c FROM txs WHERE card=? AND cancelled=0").get(c.id).c;
      const staging = stagingPreview(c.id);
      return {
        ...c,
        balance: bal,
        need,
        openSum: open,
        diff: open - need,
        txCount,
        stagingCount: staging.count,
        stagingSum: staging.sum,
      };
    });
  res.json({
    categories: CATS,
    accounts,
    cards,
    rules: rulesList(),
    focusAccount: getMeta(db, "focus_account", "352"),
    focusCard: getMeta(db, "focus_card", "shinhan"),
  });
});

app.patch("/api/account/:id", (req, res) => {
  const id = req.params.id;
  const acc = db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  if (!acc) return res.status(404).json({ error: "account not found" });
  const balance = req.body.balance != null ? Number(req.body.balance) : acc.balance;
  const memo = req.body.memo != null ? String(req.body.memo) : acc.memo;
  db.prepare("UPDATE accounts SET balance=?, memo=? WHERE id=?").run(balance, memo, id);
  res.json(db.prepare("SELECT * FROM accounts WHERE id=?").get(id));
});

app.patch("/api/card/:id", (req, res) => {
  const id = req.params.id;
  const card = db.prepare("SELECT * FROM cards WHERE id=?").get(id);
  if (!card) return res.status(404).json({ error: "card not found" });
  const used = req.body.used != null ? Number(req.body.used) : card.used;
  const memo = req.body.memo != null ? String(req.body.memo) : card.memo;
  db.prepare("UPDATE cards SET used=?, memo=? WHERE id=?").run(used, memo, id);
  if (req.body.focus) {
    setMeta(db, "focus_card", id);
    setMeta(db, "focus_account", card.account);
  }
  if (req.body.focusAccount) setMeta(db, "focus_account", String(req.body.focusAccount));
  const updated = db.prepare("SELECT * FROM cards WHERE id=?").get(id);
  const staging = stagingPreview(id);
  res.json({
    ...updated,
    need: needForCard(id),
    openSum: openSum(id),
    stagingCount: staging.count,
    stagingSum: staging.sum,
  });
});

app.post("/api/focus", (req, res) => {
  if (req.body.account) setMeta(db, "focus_account", String(req.body.account));
  if (req.body.card) {
    setMeta(db, "focus_card", String(req.body.card));
    const c = db.prepare("SELECT account FROM cards WHERE id=?").get(req.body.card);
    if (c) setMeta(db, "focus_account", c.account);
  }
  res.json({
    focusAccount: getMeta(db, "focus_account"),
    focusCard: getMeta(db, "focus_card"),
  });
});

app.get("/api/txs", (req, res) => {
  const { card, settled, category, q, cancelled } = req.query;
  let sql = "SELECT * FROM txs WHERE 1=1";
  const params = [];
  if (card) {
    sql += " AND card=?";
    params.push(card);
  }
  if (settled === "0" || settled === "1") {
    sql += " AND settled=?";
    params.push(Number(settled));
  }
  if (category && category !== "all") {
    sql += " AND category=?";
    params.push(category);
  }
  if (cancelled !== "1") {
    sql += " AND cancelled=0";
  }
  if (q) {
    sql += " AND (merchant LIKE ? OR note LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY date DESC, id DESC";
  const rows = db.prepare(sql).all(...params);
  res.json({ rows, openSum: card ? openSum(card) : null, need: card ? needForCard(card) : null });
});

app.patch("/api/txs/:id", (req, res) => {
  const id = Number(req.params.id);
  const tx = db.prepare("SELECT * FROM txs WHERE id=?").get(id);
  if (!tx) return res.status(404).json({ error: "tx not found" });
  const category = req.body.category != null ? String(req.body.category) : tx.category;
  const settled = req.body.settled != null ? (req.body.settled ? 1 : 0) : tx.settled;
  const merchant = req.body.merchant != null ? String(req.body.merchant) : tx.merchant;
  const amount = req.body.amount != null ? Number(req.body.amount) : tx.amount;
  const note =
    req.body.note != null
      ? String(req.body.note)
      : req.body.memo != null
        ? String(req.body.memo)
        : tx.note;
  const date = req.body.date != null ? String(req.body.date) : tx.date;
  db.prepare(
    "UPDATE txs SET category=?, settled=?, merchant=?, amount=?, note=?, date=? WHERE id=?"
  ).run(category, settled, merchant, amount, note, date, id);
  res.json(db.prepare("SELECT * FROM txs WHERE id=?").get(id));
});

app.post("/api/txs", (req, res) => {
  const card = String(req.body.card || getMeta(db, "focus_card", "shinhan"));
  const merchant = String(req.body.merchant || "").trim();
  const amount = Number(req.body.amount) || 0;
  if (!merchant || !amount) return res.status(400).json({ error: "merchant and amount required" });
  const rules = rulesList();
  const category = req.body.category || classify(merchant, rules);
  const date = String(req.body.date || new Date().toISOString().slice(0, 10));
  const virtual = !!req.body.virtual;
  const result = insertTx({
    card,
    date,
    merchant,
    amount,
    category,
    note: req.body.note || req.body.memo || (virtual ? "가상내역" : "수동 추가"),
    virtual,
    approvalNo: req.body.approvalNo || null,
  });
  res.json({ ...db.prepare("SELECT * FROM txs WHERE id=?").get(result.id), inserted: result.inserted });
});

app.post("/api/txs/settle", (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const settled = req.body.settled === false || req.body.settled === 0 ? 0 : 1;
  if (!ids.length) return res.status(400).json({ error: "ids required" });
  const stmt = db.prepare("UPDATE txs SET settled=? WHERE id=?");
  const run = db.transaction((list) => {
    for (const id of list) stmt.run(settled, id);
  });
  run(ids);
  res.json({ updated: ids.length, settled: !!settled });
});

app.post("/api/rules", (req, res) => {
  const match = String(req.body.match || req.body.match_text || "").trim();
  const category = String(req.body.category || "데이트");
  if (!match) return res.status(400).json({ error: "match required" });
  if (!CATS.includes(category)) return res.status(400).json({ error: "bad category" });
  const info = db.prepare("INSERT INTO rules(match_text, category) VALUES(?,?)").run(match, category);
  res.json(db.prepare("SELECT id, match_text, category FROM rules WHERE id=?").get(info.lastInsertRowid));
});

app.delete("/api/rules/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM rules WHERE id=?").run(id);
  res.json({ ok: true });
});

app.get("/api/ledger/summary", (req, res) => {
  const byCat = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
       FROM txs WHERE cancelled=0 GROUP BY category ORDER BY total DESC`
    )
    .all();
  const byCard = db
    .prepare(
      `SELECT card, COALESCE(SUM(amount),0) AS total, COUNT(*) AS count,
              SUM(CASE WHEN settled=0 THEN amount ELSE 0 END) AS open_total
       FROM txs WHERE cancelled=0 GROUP BY card`
    )
    .all();
  const totals = Object.fromEntries(CATS.map((c) => [c, 0]));
  for (const r of byCat) totals[r.category] = r.total;
  res.json({ categories: totals, byCat, byCard });
});

/** Bot/script: put excel or JSON rows into staging (replace per affected card). */
app.post("/api/staging/import", upload.single("file"), (req, res) => {
  try {
    const replaceCards = req.query.replace !== "0" && req.body?.replace !== false;
    const sourceBatch = req.body?.sourceBatch || req.body?.source_batch || null;
    let parsed;

    if (req.file) {
      const forced = req.query.card || req.body?.card || null;
      parsed = parseWorkbook(req.file.buffer, forced);
    } else if (req.body && (Array.isArray(req.body) || req.body.rows || req.body.cards)) {
      parsed = rowsToParsedBlocks(normalizeJsonRows(req.body));
    } else {
      return res.status(400).json({ error: "file or JSON rows required" });
    }

    if (!parsed.length) return res.status(400).json({ error: "no recognizable sheets/rows" });
    const result = importParsedToStaging(parsed, {
      skipCancelled: true,
      replaceCards,
      sourceBatch,
    });
    const previews = {};
    for (const card of Object.keys(result.byCard)) {
      previews[card] = stagingPreview(card);
    }
    res.json({
      ok: true,
      sheets: parsed.map((p) => ({ card: p.card, sheet: p.sheet, rows: p.rows.length })),
      previews,
      ...result,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/staging/:id", (req, res) => {
  const id = req.params.id;
  const card = db.prepare("SELECT * FROM cards WHERE id=?").get(id);
  if (!card) return res.status(404).json({ error: "card not found" });
  const preview = stagingPreview(id);
  const rows = db
    .prepare("SELECT * FROM staging_txs WHERE card=? AND cancelled=0 ORDER BY date DESC, id DESC")
    .all(id);
  res.json({ card: id, ...preview, rows });
});

app.get("/api/staging", (req, res) => {
  const cards = db.prepare("SELECT id FROM cards").all();
  const byCard = {};
  for (const c of cards) byCard[c.id] = stagingPreview(c.id);
  const total = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS s FROM staging_txs WHERE cancelled=0").get();
  res.json({ byCard, totalCount: total.c, totalSum: total.s });
});

/** Primary UI action: copy this card's staging into active txs (dedupe, never wipe). */
app.post("/api/cards/:id/load", (req, res) => {
  const result = loadStagingToCard(req.params.id);
  if (!result) return res.status(404).json({ error: "card not found" });
  res.json({ ok: true, ...result });
});

/** Secondary: direct upload into txs (legacy). */
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });
  const forced = req.query.card || req.body.card || null;
  try {
    const parsed = parseWorkbook(req.file.buffer, forced);
    if (!parsed.length) return res.status(400).json({ error: "no recognizable sheets" });
    const result = importParsedToTxs(parsed, { skipCancelled: true });
    res.json({
      ok: true,
      sheets: parsed.map((p) => ({ card: p.card, sheet: p.sheet, rows: p.rows.length })),
      ...result,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/import-sample", (req, res) => {
  const sample = findSample();
  if (!sample) return res.status(404).json({ error: "sample not found", tried: SAMPLE_CANDIDATES });
  const into = String(req.query.into || req.body?.into || "staging");
  const parsed = parseWorkbook(sample);
  if (into === "txs") {
    const result = importParsedToTxs(parsed, { skipCancelled: true });
    return res.json({ ok: true, into: "txs", path: sample, ...result });
  }
  const result = importParsedToStaging(parsed, {
    skipCancelled: true,
    replaceCards: true,
    sourceBatch: "sample-import",
  });
  res.json({ ok: true, into: "staging", path: sample, ...result });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    txs: db.prepare("SELECT COUNT(*) AS c FROM txs").get().c,
    staging: db.prepare("SELECT COUNT(*) AS c FROM staging_txs").get().c,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`card-settle-server listening on http://${HOST}:${PORT}`);
  console.log(`DB: ${path.join(__dirname, "data", "settle.db")}`);
});
