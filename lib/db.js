const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "settle.db");

const CATS = ["개인", "데이트", "부동산", "크림", "섬김비", "연체", "취미"];

const CARDS = [
  { id: "shinhan", name: "신한", account: "352", payDay: 14, sort: 1 },
  { id: "samsung", name: "삼성", account: "352", payDay: 13, sort: 2 },
  { id: "hana", name: "하나", account: "352", payDay: 13, sort: 3 },
  { id: "nh", name: "농협", account: "302", payDay: 14, sort: 10 },
  { id: "woori", name: "우리", account: "other", payDay: 14, sort: 20 },
  { id: "ibk", name: "IBK", account: "other", payDay: 14, sort: 21 },
  { id: "hyundai", name: "현대", account: "other", payDay: 14, sort: 22 },
  { id: "kb", name: "국민", account: "other", payDay: 14, sort: 23 },
  { id: "lotte", name: "롯데", account: "other", payDay: 14, sort: 24 },
  { id: "bc", name: "BC", account: "other", payDay: 14, sort: 25 },
];

const ACCOUNTS = [
  { id: "352", name: "352계좌", balance: 558423, memo: "" },
  { id: "302", name: "302계좌", balance: 100000, memo: "" },
  { id: "other", name: "기타", balance: 0, memo: "우리·IBK·현대·국민·롯데·BC" },
];

const DEFAULT_RULES = [
  { match: "구글", category: "개인" },
  { match: "위즈덤", category: "섬김비" },
  { match: "위즈돔", category: "섬김비" },
  { match: "밀키", category: "섬김비" },
  { match: "현대그린푸드", category: "섬김비" },
  { match: "배스킨라빈스 분당", category: "섬김비" },
  { match: "페이타랩", category: "데이트" },
  { match: "쿠팡", category: "데이트" },
  { match: "쏘카", category: "데이트" },
  { match: "올리브영", category: "데이트" },
  { match: "식자재", category: "데이트" },
  { match: "도시곳간", category: "데이트" },
  { match: "카카오T", category: "데이트" },
  { match: "택시", category: "데이트" },
  { match: "본죽", category: "데이트" },
  { match: "네이버페이", category: "데이트" },
  { match: "크림", category: "크림" },
  { match: "KREAM", category: "크림" },
  { match: "신의주", category: "데이트" },
  { match: "타이스트리트", category: "데이트" },
  { match: "GS25", category: "데이트" },
  { match: "지에스25", category: "데이트" },
  { match: "씨유", category: "데이트" },
  { match: "CU", category: "데이트" },
  { match: "스타벅스", category: "데이트" },
  { match: "다이소", category: "데이트" },
];

const DEFAULT_USED = {
  shinhan: 392926,
  samsung: 3560900,
  hana: 172090,
  nh: 1296100,
};

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account TEXT NOT NULL,
      pay_day INTEGER NOT NULL DEFAULT 14,
      used REAL NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(account) REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_text TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS txs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      merchant TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '데이트',
      note TEXT NOT NULL DEFAULT '',
      settled INTEGER NOT NULL DEFAULT 0,
      virtual INTEGER NOT NULL DEFAULT 0,
      cancelled INTEGER NOT NULL DEFAULT 0,
      approval_no TEXT,
      raw_card_mask TEXT,
      source_batch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(card) REFERENCES cards(id)
    );
    CREATE TABLE IF NOT EXISTS staging_txs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      merchant TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '데이트',
      note TEXT NOT NULL DEFAULT '',
      virtual INTEGER NOT NULL DEFAULT 0,
      cancelled INTEGER NOT NULL DEFAULT 0,
      approval_no TEXT,
      raw_card_mask TEXT,
      source_batch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY(card) REFERENCES cards(id)
    );
    CREATE INDEX IF NOT EXISTS idx_txs_card ON txs(card);
    CREATE INDEX IF NOT EXISTS idx_txs_settled ON txs(settled);
    CREATE INDEX IF NOT EXISTS idx_txs_approval ON txs(card, approval_no);
    CREATE INDEX IF NOT EXISTS idx_txs_dedupe ON txs(card, date, merchant, amount);
    CREATE INDEX IF NOT EXISTS idx_staging_card ON staging_txs(card);
    CREATE INDEX IF NOT EXISTS idx_staging_approval ON staging_txs(card, approval_no);
    CREATE INDEX IF NOT EXISTS idx_staging_dedupe ON staging_txs(card, date, merchant, amount);
  `);

  // Older DBs may lack source_batch on txs
  const cols = db.prepare("PRAGMA table_info(txs)").all().map((c) => c.name);
  if (!cols.includes("source_batch")) {
    db.exec("ALTER TABLE txs ADD COLUMN source_batch TEXT");
  }

  const seeded = db.prepare("SELECT value FROM meta WHERE key='seeded'").get();
  if (!seeded) {
    seed(db);
    db.prepare("INSERT INTO meta(key,value) VALUES('seeded','1')").run();
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('focus_account','352')").run();
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('focus_card','shinhan')").run();
  }
}

function seed(db) {
  const insAcc = db.prepare(
    "INSERT OR IGNORE INTO accounts(id,name,balance,memo) VALUES(?,?,?,?)"
  );
  for (const a of ACCOUNTS) insAcc.run(a.id, a.name, a.balance, a.memo);

  const insCard = db.prepare(
    "INSERT OR IGNORE INTO cards(id,name,account,pay_day,used,memo,sort_order) VALUES(?,?,?,?,?,?,?)"
  );
  for (const c of CARDS) {
    insCard.run(c.id, c.name, c.account, c.payDay, DEFAULT_USED[c.id] || 0, "", c.sort);
  }

  const insRule = db.prepare("INSERT INTO rules(match_text, category) VALUES(?,?)");
  for (const r of DEFAULT_RULES) insRule.run(r.match, r.category);
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
  return row ? row.value : fallback;
}

function setMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)").run(key, String(value));
}

module.exports = {
  openDb,
  DB_PATH,
  DATA_DIR,
  CATS,
  CARDS,
  ACCOUNTS,
  DEFAULT_RULES,
  getMeta,
  setMeta,
};
