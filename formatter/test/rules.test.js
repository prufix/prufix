'use strict';

// Lint for rules.yaml: the dictionary is the product, so a typo in a probe
// key or an unparseable hint expression must fail CI, not silently produce
// findings with dropped lines.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRules, probesFor } = require('../src/dictionary');
const { parse } = require('../src/expr');
const { SourceDoc } = require('../src/xdoc');
const { buildReport } = require('../src/enrich');

const RULES = loadRules(path.join(__dirname, '..', 'rules', 'rules.yaml'));
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)(?::[,>0-9]*)?\}/g;
const DOC_TYPES = new Set(['ubl-invoice', 'ubl-creditnote', 'cii']);
const FIXTURES = path.join(__dirname, '..', '..', 'test', 'fixtures');

test('dictionary has at least 12 rules', () => {
  assert.ok(Object.keys(RULES).length >= 12, `only ${Object.keys(RULES).length} rules`);
});

test('INPUT-INVALID stays reserved for [C] (contract §9.1)', () => {
  assert.ok(!Object.hasOwn(RULES, 'INPUT-INVALID'), 'INPUT-INVALID must never be a dictionary rule');
});

test('every rule is internally consistent', () => {
  for (const [id, rule] of Object.entries(RULES)) {
    const keys = new Set([...Object.keys(rule.probe), ...Object.keys(rule.derive)]);
    if (Object.keys(rule.probeCii).length > 0) {
      for (const k of Object.keys(rule.probeCii)) {
        assert.ok(
          Object.hasOwn(rule.probe, k),
          `${id}: probe.cii key '${k}' has no UBL counterpart (would silently differ per syntax)`
        );
      }
    }
    for (const [k, exprSrc] of Object.entries(rule.derive)) {
      assert.doesNotThrow(() => parse(String(exprSrc)), `${id}: derive '${k}' does not parse`);
    }
    for (const [i, hint] of rule.hints.entries()) {
      if (hint.when != null) {
        assert.doesNotThrow(() => parse(String(hint.when)), `${id}: hints[${i}].when does not parse`);
      }
      for (const m of hint.text.matchAll(PLACEHOLDER_RE)) {
        assert.ok(keys.has(m[1]), `${id}: hints[${i}] references unknown key {${m[1]}}`);
      }
    }
    if (rule.explain) {
      for (const m of rule.explain.matchAll(PLACEHOLDER_RE)) {
        assert.ok(keys.has(m[1]), `${id}: explain references unknown key {${m[1]}}`);
      }
    }
    if (rule.appliesTo) {
      for (const t of rule.appliesTo) {
        assert.ok(DOC_TYPES.has(t), `${id}: unknown appliesTo '${t}'`);
      }
    }
    assert.ok(['error', 'warning', null].includes(rule.severity), `${id}: bad severity`);
  }
});

test('the priority families from mvp-design 3.4 are covered', () => {
  const ids = Object.keys(RULES);
  assert.ok(ids.some((i) => i.startsWith('BR-CO-')), 'no BR-CO-* arithmetic rules');
  assert.ok(ids.some((i) => /^BR-(S|AE|Z|E)-/.test(i)), 'no VAT category rules');
  assert.ok(ids.some((i) => /^BR-\d+$/.test(i)), 'no mandatory-field rules');
  assert.ok(ids.some((i) => i.startsWith('PEPPOL-EN16931-')), 'no Peppol-specific rules');
});

test('the dictionary is exactly 31 rules (contract §9.41 raised the §9.20 cap by one)', () => {
  assert.equal(Object.keys(RULES).length, 31);
  for (const id of ['BR-S-08', 'BR-S-09', 'BR-CL-01', 'BR-CL-04', 'PEPPOL-EN16931-CL008']) {
    assert.ok(Object.hasOwn(RULES, id), `missing rule ${id}`);
  }
});

test('every locationOnly key is a real probe key (contract §9.33)', () => {
  // A typo here is invisible at runtime: the flag simply never applies, the §5
  // root retry stays on, and a line-scoped aggregate silently picks up the
  // document-level element of the same name. Fail the build instead.
  for (const [id, rule] of Object.entries(RULES)) {
    for (const key of rule.locationOnly) {
      assert.ok(
        Object.hasOwn(rule.probe, key) || Object.hasOwn(rule.probeCii, key),
        `rule ${id}: locationOnly names '${key}', which is not a probe key`
      );
    }
  }
  // The rule that motivated the ruling must keep the flag.
  const r120 = RULES['PEPPOL-EN16931-R120'];
  assert.ok(r120.locationOnly.has('lineAllowance'));
  assert.ok(r120.locationOnly.has('lineCharge'));
});

// Everything above only checks that derive/when expressions and {key} references
// are internally consistent - it never actually runs a probe XPath. That leaves
// a hole: a probe XPath that is not valid XPath 1.0 (e.g. a function call used
// as a path step, which the `xpath` engine used here rejects even though the
// XPath 2.0 source Schematron accepts it) fails silently at runtime - probeOne's
// callers swallow the exception and the value just goes missing, dropping the
// explain/hint lines that depend on it. Guard every probe/probe.cii expression
// against a trivial synthetic document so a bad probe fails CI, not a customer's
// report.
test('every probe and probe.cii XPath is syntactically valid XPath 1.0', () => {
  const blank = new SourceDoc(
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
    {}
  );
  for (const [id, rule] of Object.entries(RULES)) {
    for (const docType of ['ubl-invoice', 'cii']) {
      for (const [key, exprSrc] of Object.entries(probesFor(rule, docType))) {
        assert.doesNotThrow(
          () => blank.probeOne(String(exprSrc), blank.root, false),
          `${id}: probe '${key}' (${docType}) is not valid XPath: ${exprSrc}`
        );
      }
    }
  }
});

test('BR-S-08/BR-S-09 (UBL) resolve real values from the br-s-08 fixture', () => {
  const sourceXml = fs.readFileSync(
    path.join(FIXTURES, 'invalid', 'br-s-08-taxable-mismatch.xml'),
    'utf8'
  );
  const INV = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
  const location = `/Q{${INV}}Invoice[1]/Q{${CAC}}TaxTotal[1]/Q{${CAC}}TaxSubtotal[1]/Q{${CAC}}TaxCategory[1]`;
  const svrlFor = (id) => `<?xml version="1.0"?>
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert id="${id}" flag="fatal" location="${location}">
    <svrl:text>[${id}] synthetic test finding</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>`;

  const s08 = buildReport({
    svrlXml: svrlFor('BR-S-08'),
    sourceXml,
    sourcePath: 'br-s-08-taxable-mismatch.xml',
    profile: 'en16931',
    rules: RULES,
    docBase: null,
    toolVersion: 'test',
  }).files[0].findings[0];
  // fixtures.json: source mutated cac:TaxSubtotal/cbc:TaxableAmount 314.86 -> 100.00
  assert.equal(s08.values.stated, '100.00');
  assert.equal(s08.values.lines, '314.86');
  assert.equal(s08.values.expected, '314.86');
  assert.equal(s08.values.diff, '214.86');

  const s09 = buildReport({
    svrlXml: svrlFor('BR-S-09'),
    sourceXml,
    sourcePath: 'br-s-08-taxable-mismatch.xml',
    profile: 'en16931',
    rules: RULES,
    docBase: null,
    toolVersion: 'test',
  }).files[0].findings[0];
  assert.equal(s09.values.taxable, '100.00');
  assert.equal(s09.values.tax, '22.04');
  assert.equal(s09.values.rate, '7');
});

test('BR-S-08/BR-S-09 (CII) resolve real values from the valid xrechnung fixture (zero diff)', () => {
  const sourceXml = fs.readFileSync(
    path.join(FIXTURES, 'valid', 'cii-invoice-xrechnung.xml'),
    'utf8'
  );
  const RSM = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
  const RAM = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
  const location =
    `/Q{${RSM}}CrossIndustryInvoice[1]/Q{${RSM}}SupplyChainTradeTransaction[1]` +
    `/Q{${RAM}}ApplicableHeaderTradeSettlement[1]/Q{${RAM}}ApplicableTradeTax[1]/Q{${RAM}}CategoryCode[1]`;
  const svrlFor = (id) => `<?xml version="1.0"?>
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert id="${id}" flag="fatal" location="${location}">
    <svrl:text>[${id}] synthetic test finding</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>`;

  for (const id of ['BR-S-08', 'BR-S-09']) {
    const finding = buildReport({
      svrlXml: svrlFor(id),
      sourceXml,
      sourcePath: 'cii-invoice-xrechnung.xml',
      profile: 'xrechnung-3.0.2',
      rules: RULES,
      docBase: null,
      toolVersion: 'test',
    }).files[0].findings[0];
    assert.equal(finding.enriched, true, `${id}: probe.cii produced no values on a real CII document`);
    assert.equal(finding.values.diff, '0.00', `${id}: a valid instance must diff to zero`);
  }
});

test('BR-CL-01, BR-CL-04, PEPPOL-EN16931-CL008 resolve the actual sent value and fire their targeted hints', () => {
  const INV = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
  const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
  const sourceXml = `<?xml version="1.0"?>
<ubl:Invoice xmlns:ubl="${INV}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}">
  <cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>eur</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="9999">seller@example.com</cbc:EndpointID>
    </cac:Party>
  </cac:AccountingSupplierParty>
</ubl:Invoice>`;

  const cases = {
    'BR-CL-01': `/Q{${INV}}Invoice[1]/Q{${CBC}}InvoiceTypeCode[1]`,
    'BR-CL-04': `/Q{${INV}}Invoice[1]/Q{${CBC}}DocumentCurrencyCode[1]`,
    'PEPPOL-EN16931-CL008':
      `/Q{${INV}}Invoice[1]/Q{${CAC}}AccountingSupplierParty[1]/Q{${CAC}}Party[1]/Q{${CBC}}EndpointID[1]`,
  };

  const findingFor = (id) => {
    const svrlXml = `<?xml version="1.0"?>
<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert id="${id}" flag="fatal" location="${cases[id]}">
    <svrl:text>[${id}] synthetic test finding</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>`;
    return buildReport({
      svrlXml,
      sourceXml,
      sourcePath: 'synthetic.xml',
      profile: 'en16931',
      rules: RULES,
      docBase: null,
      toolVersion: 'test',
    }).files[0].findings[0];
  };

  const cl01 = findingFor('BR-CL-01');
  assert.equal(cl01.values.stated, '381');
  assert.ok(
    cl01.hints.some((h) => h.includes('is only valid in cbc:CreditNoteTypeCode')),
    'BR-CL-01 should flag the Invoice/CreditNote code swap for a known code'
  );

  const cl04 = findingFor('BR-CL-04');
  assert.equal(cl04.values.stated, 'eur');
  assert.ok(cl04.hints.some((h) => h.includes('EUR, not eur')));

  const cl008 = findingFor('PEPPOL-EN16931-CL008');
  assert.equal(cl008.values.scheme, '9999');
  assert.equal(cl008.values.value, 'seller@example.com');
});
