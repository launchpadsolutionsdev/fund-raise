/**
 * Donor Display Name helper
 *
 * Ask Fund-Raise tools return lots of row shapes that include donor
 * identifiers. Without intervention, a row with null/blank first_name +
 * last_name gets rendered by the LLM as "Anonymous" or "Unknown" — even
 * though the constituent_id is present and the team could still look the
 * donor up in the CRM.
 *
 * This module provides:
 *
 *   buildDisplayName(row)      — returns a non-empty label for a single row
 *   decorateDonorRows(value)   — walks an object/array tree and adds a
 *                                `display_name` field to every object that
 *                                looks like a donor row (has constituent_id
 *                                or recipient_id) and doesn't already have
 *                                one. Mutates in place.
 *
 * Priority order for the label:
 *   1. donor_name / constituent_name / recipient_name   (trimmed)
 *   2. first_name + last_name                            (trimmed, joined)
 *   3. "Constituent #<id>"                               (fallback)
 *
 * Why server-side: the system prompt already tells the LLM to fall back to
 * constituent_id, but the model doesn't always comply with prompt-level
 * rules — especially across long tool-chained conversations. Shaping the
 * raw tool result is a deterministic fix the prompt can't regress.
 */

/** @returns {string} — never empty, never "Anonymous" */
function buildDisplayName(row) {
  if (!row || typeof row !== 'object') return '';

  // Already computed upstream.
  if (typeof row.display_name === 'string' && row.display_name.trim()) {
    return row.display_name.trim();
  }

  // Prefer a pre-assembled name string if present.
  const named = row.donor_name
    ?? row.constituent_name
    ?? row.recipient_name
    ?? row.fundraiser_name
    ?? null;
  if (typeof named === 'string') {
    const trimmed = named.trim();
    if (trimmed && !/^(anonymous|unknown|n\/?a)$/i.test(trimmed)) return trimmed;
  }

  const first = (row.first_name ?? row.fundraiser_first_name ?? row.recipient_first_name ?? '') + '';
  const last  = (row.last_name  ?? row.fundraiser_last_name  ?? row.recipient_last_name  ?? '') + '';
  const combined = `${first.trim()} ${last.trim()}`.trim();
  if (combined) return combined;

  // Fallback to constituent id when we have one.
  const id = row.constituent_id
    ?? row.recipient_id
    ?? row.constituentId
    ?? null;
  if (id != null && String(id).trim()) {
    return `Constituent #${String(id).trim()}`;
  }

  return '';
}

/**
 * Heuristic: does this row look like a donor/recipient record we should
 * decorate? We only touch rows that expose a constituent_id (or recipient_id)
 * so we don't accidentally stamp unrelated rows.
 */
function isDonorShapedRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  return (
    row.constituent_id != null
    || row.constituentId != null
    || row.recipient_id != null
  );
}

/**
 * Walk a tree of tool-result data (arbitrary nesting of arrays/objects)
 * and stamp a `display_name` on every donor-shaped row. Mutates in place.
 * Safe on null / primitives / circular refs (tracks visited objects).
 */
function decorateDonorRows(value, _seen) {
  const seen = _seen || new WeakSet();
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) decorateDonorRows(item, seen);
    return value;
  }

  if (isDonorShapedRow(value) && !value.display_name) {
    const label = buildDisplayName(value);
    if (label) value.display_name = label;
  }

  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child && typeof child === 'object') decorateDonorRows(child, seen);
  }
  return value;
}

module.exports = { buildDisplayName, decorateDonorRows, isDonorShapedRow };
