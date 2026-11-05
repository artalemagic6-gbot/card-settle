function classify(merchant, rules) {
  const m = String(merchant || "").toLowerCase();
  for (const r of rules) {
    const needle = String(r.match_text || r.match || "").toLowerCase();
    if (needle && m.includes(needle)) return r.category;
  }
  return "데이트";
}

module.exports = { classify };
