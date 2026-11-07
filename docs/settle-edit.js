/** Shared helpers for in-place settle table edits (date + Tab-safe updates). */
(function (root) {
  const INLINE_FIELDS = ["date", "label", "amount", "category", "note"];

  function dateInputValue(date) {
    return String(date || "").slice(0, 10);
  }

  function rowDateHtml(t, esc) {
    if (t.virtual) {
      return `<input data-id="${t.id}" data-f="date" type="date" value="${esc(dateInputValue(t.date))}">`;
    }
    return esc(String(t.date || "").slice(0, 16));
  }

  /** DOM tab order of editable controls in a settle row (left → right). */
  function fieldTabOrder(isVirtual) {
    return isVirtual
      ? ["date", "physical", "label", "amount", "category", "note", "chk", "del"]
      : ["physical", "label", "category", "note", "chk", "del"];
  }

  function applyField(tx, field, raw) {
    if (!tx || !INLINE_FIELDS.includes(field)) return false;
    if (field === "amount") tx.amount = Number(raw);
    else tx[field] = raw;
    return true;
  }

  /** Whether changing this field can change summary numbers (need/os/diff/done). */
  function fieldAffectsSummary(field) {
    return field === "amount";
  }

  /**
   * Given current active element descriptors and row field order, next/prev target field.
   * Used by tests; browser Tab uses native order when DOM is stable.
   */
  function nextField(order, current, shift) {
    const i = order.indexOf(current);
    if (i < 0) return null;
    const j = shift ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return null;
    return order[j];
  }

  root.SettleEdit = {
    INLINE_FIELDS,
    dateInputValue,
    rowDateHtml,
    fieldTabOrder,
    applyField,
    fieldAffectsSummary,
    nextField,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
