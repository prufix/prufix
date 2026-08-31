'use strict';

// Fallback identity when no per-file report supplied one (e.g. every input
// file failed to parse, so the formatter never ran).
const TOOL_FALLBACK = { name: 'prufix', version: '0.1.0' };

/**
 * Merge per-file reports into a single schema-v1 report: concatenate
 * `files[]`, recompute `summary`. Contract section 4.1 puts this on the
 * action, not the formatter.
 */
function mergeReports(entries, profile, toolMeta) {
  let errors = 0;
  let warnings = 0;
  for (const e of entries) {
    errors += e.errors || 0;
    warnings += e.warnings || 0;
  }
  return {
    schemaVersion: 1,
    tool: toolMeta || TOOL_FALLBACK,
    profile,
    // `passed` means "no error-severity findings"; warnings alone don't flip
    // it. Whether the step fails is a separate question answered by fail-on.
    summary: { files: entries.length, errors, warnings, passed: errors === 0 },
    files: entries,
  };
}

/** Aggregate findings across files into per-rule rows for the summary table. */
function aggregateRules(entries) {
  const byId = new Map();
  for (const e of entries) {
    for (const f of e.findings || []) {
      let row = byId.get(f.id);
      if (!row) {
        row = { id: f.id, severity: f.severity, count: 0, files: new Set() };
        byId.set(f.id, row);
      }
      row.count += 1;
      row.files.add(e.path);
      if (f.severity === 'error') row.severity = 'error';
    }
  }
  return [...byId.values()]
    .map((r) => ({ ...r, files: [...r.files] }))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return b.count - a.count || a.id.localeCompare(b.id);
    });
}

module.exports = { mergeReports, aggregateRules };
