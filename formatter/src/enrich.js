'use strict';

/**
 * The enrichment pipeline: SVRL findings + original document + dictionary
 * -> report.json (contract §4.2, schema v1).
 */

const { parseSvrl } = require('./svrl');
const { SourceDoc } = require('./xdoc');
const { probesFor } = require('./dictionary');
const { evaluate, MissingValue } = require('./expr');
const { substituteTemplate } = require('./format');
const { Decimal } = require('./decimal');

/** Title for a rule we do not know: first sentence of the SVRL text, sans "[BR-XX-YY]-" prefix. */
function fallbackTitle(id, text) {
  let t = (text || '').trim();
  if (id) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\[${esc}\\]\\s*[-–:]?\\s*`), '');
  }
  const m = /^(.*?[.!?])(\s|$)/.exec(t);
  let s = m ? m[1] : t;
  if (s.length > 140) s = `${s.slice(0, 137).trimEnd()}...`;
  return s || (id ? `Rule ${id} failed` : 'Validation rule failed');
}

function warn(msg) {
  process.stderr.write(`prufix formatter: ${msg}\n`);
}

function enrichFinding(finding, rule, doc, documentType, docBase) {
  const base = {
    id: finding.id || 'UNKNOWN',
    severity: finding.severity,
    title: fallbackTitle(finding.id, finding.text),
    location: finding.location || '/',
    originalText: finding.text,
    enriched: false,
  };

  // No dictionary entry, or the entry does not apply to this syntax:
  // pass the validator's own message through untouched (contract §4.2 — never degrade).
  if (!rule) return base;
  if (rule.appliesTo && !rule.appliesTo.includes(documentType)) return base;

  const locationNode = doc.resolveLocation(finding.location);
  const values = {};

  for (const [key, expr] of Object.entries(probesFor(rule, documentType))) {
    try {
      const v = doc.probe(String(expr), locationNode, rule.locationOnly.has(key));
      if (v !== null) values[key] = v;
    } catch (e) {
      warn(`rule ${rule.id}: probe '${key}' failed (${e.message})`);
    }
  }

  for (const [key, expr] of Object.entries(rule.derive)) {
    try {
      const v = evaluate(String(expr), values);
      if (v instanceof Decimal) values[key] = v.toString();
      else if (typeof v === 'string') values[key] = v;
      // booleans are not values; ignore
    } catch (e) {
      if (!(e instanceof MissingValue)) warn(`rule ${rule.id}: derive '${key}' failed (${e.message})`);
      // missing input -> key stays absent -> dependent explain lines drop
    }
  }

  const hints = [];
  for (const hint of rule.hints) {
    try {
      if (hint.when != null && evaluate(String(hint.when), values) !== true) continue;
      const text = substituteTemplate(hint.text, values);
      if (text !== null) hints.push(text.replace(/\s*\n\s*/g, ' '));
    } catch (e) {
      if (!(e instanceof MissingValue)) warn(`rule ${rule.id}: hint condition failed (${e.message})`);
    }
  }

  const out = { ...base, title: rule.title, enriched: true };
  const explain = rule.explain ? substituteTemplate(rule.explain, values) : null;
  if (explain !== null) out.explain = explain;
  if (Object.keys(values).length > 0) out.values = values;
  if (hints.length > 0) out.hints = hints;
  if (docBase) out.docUrl = `${docBase.replace(/\/+$/, '')}/${encodeURIComponent(out.id)}`;
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.svrlXml
 * @param {string} opts.sourceXml
 * @param {string} opts.sourcePath  path as given on the CLI (goes into files[].path)
 * @param {string} opts.profile
 * @param {object} opts.rules       loadRules() output
 * @param {string|null} opts.docBase
 * @param {string} opts.toolVersion
 */
function buildReport(opts) {
  const { nsMap, findings } = parseSvrl(opts.svrlXml);
  const doc = new SourceDoc(opts.sourceXml, nsMap);
  const documentType = doc.documentType();

  const outFindings = findings.map((f) =>
    enrichFinding(f, f.id ? opts.rules[f.id] : null, doc, documentType, opts.docBase)
  );

  const errors = outFindings.filter((f) => f.severity === 'error').length;
  const warnings = outFindings.filter((f) => f.severity === 'warning').length;

  return {
    schemaVersion: 1,
    tool: { name: 'prufix', version: opts.toolVersion },
    profile: opts.profile,
    summary: { files: 1, errors, warnings, passed: errors === 0 },
    files: [
      {
        path: opts.sourcePath,
        documentType,
        errors,
        warnings,
        findings: outFindings,
      },
    ],
  };
}

module.exports = { buildReport, fallbackTitle };
