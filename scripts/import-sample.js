#!/usr/bin/env node
/**
 * Put sample-all-cards.xlsx into staging via the running server (or local parse if SERVER_URL unset and we require libs).
 * Default: POST /api/import-sample on http://127.0.0.1:$PORT
 */
const PORT = Number(process.env.PORT) || 3847;
const BASE = process.env.SERVER_URL || `http://127.0.0.1:${PORT}`;

async function main() {
  const res = await fetch(`${BASE}/api/import-sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ into: "staging" }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    console.error("import-sample failed", res.status, data);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
