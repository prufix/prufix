'use strict';

/**
 * rules.yaml loader (contract §5).
 *
 * Shape per rule:
 *   TITLE       title: string (required)
 *   severity:   informational; the SVRL flag decides the reported severity (§4.3)
 *   appliesTo:  [ubl-invoice, ubl-creditnote, cii]; omitted = all
 *   probe:      { key: xpath }        — evaluated against the source document
 *   probe.cii:  { key: xpath }        — per-key override when the source is CII
 *   locationOnly: [key, ...]         — keys that must NOT retry from the document
 *                                      root when empty at @location (§9.33)
 *   derive:     { key: expression }   — arithmetic over probed values (safe evaluator)
 *   explain:    template; a line is dropped when any {key} in it is missing
 *   hints:      [{ when?: expression, text: template }]
 */

const fs = require('node:fs');
const YAML = require('yaml');

function loadRules(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const data = YAML.parse(raw);
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`rules file ${path} must be a YAML mapping of rule id -> rule`);
  }
  const rules = {};
  for (const [id, rule] of Object.entries(data)) {
    if (rule == null || typeof rule !== 'object') {
      throw new Error(`rule ${id} must be a mapping`);
    }
    if (typeof rule.title !== 'string' || rule.title.trim() === '') {
      throw new Error(`rule ${id} is missing a title`);
    }
    const hints = (rule.hints || []).map((h, i) => {
      if (typeof h === 'string') return { when: null, text: h };
      if (h && typeof h.text === 'string') return { when: h.when || null, text: h.text };
      throw new Error(`rule ${id} hints[${i}] needs a text`);
    });
    rules[id] = {
      id,
      title: rule.title.trim(),
      severity: rule.severity || null,
      appliesTo: rule.appliesTo || null,
      probe: rule.probe || {},
      probeCii: rule['probe.cii'] || {},
      locationOnly: new Set(rule.locationOnly || []),
      derive: rule.derive || {},
      explain: rule.explain || null,
      hints,
    };
  }
  return rules;
}

/** Effective probe map for a document type ('cii' applies the probe.cii overrides). */
function probesFor(rule, documentType) {
  if (documentType === 'cii') return { ...rule.probe, ...rule.probeCii };
  return rule.probe;
}

module.exports = { loadRules, probesFor };
