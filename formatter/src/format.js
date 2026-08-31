'use strict';

/**
 * Template substitution for `explain` and hint texts.
 *
 * Placeholder syntax: {key} or {key:spec} where spec is
 *   ','    thousands grouping (numeric values only)
 *   '>N'   right-align in N columns
 * e.g. {stated:,>12}  ->  "    1,180.00"
 *
 * Contract §5: a line whose placeholders are not all present is dropped —
 * `undefined`/`NaN` must never reach the user.
 */

const { Decimal } = require('./decimal');

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)(?::([,>0-9]*))?\}/g;

function group(numStr) {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(numStr);
  if (!m) return numStr;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] || '');
}

function formatValue(value, spec) {
  let out = String(value);
  if (!spec) return out;
  if (spec.includes(',') && Decimal.isNumeric(out)) out = group(out);
  const width = />(\d+)/.exec(spec);
  if (width) out = out.padStart(Number(width[1]), ' ');
  return out;
}

/** Substitute one line; returns null when any referenced key is missing. */
function substituteLine(line, values) {
  let missing = false;
  const out = line.replace(PLACEHOLDER_RE, (m, key, spec) => {
    if (!Object.hasOwn(values, key) || values[key] == null) {
      missing = true;
      return m;
    }
    return formatValue(values[key], spec);
  });
  return missing ? null : out;
}

/** Substitute a whole template, dropping lines with missing keys. Returns null if nothing survives. */
function substituteTemplate(template, values) {
  const lines = template.replace(/\s+$/, '').split('\n');
  const kept = lines.map((l) => substituteLine(l, values)).filter((l) => l !== null);
  // collapse runs of blank lines left behind by dropped neighbours
  const out = [];
  for (const l of kept) {
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue;
    out.push(l.replace(/\s+$/, ''));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? out.join('\n') : null;
}

module.exports = { substituteLine, substituteTemplate, formatValue, group };
