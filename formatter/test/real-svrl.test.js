'use strict';

// Smoke regression against REAL validator output (contract "未解決: 実SVRLとの
// 突き合わせ"). Fixtures were produced by the prufix:dev engine over the
// official XRechnung 3.0.2 testsuite instance standard/01.01a-INVOICE_ubl.xml:
//   real-kosit-0101a.svrl   KoSIT validator v1.6.3 (Saxon), verbatim
//   real-peppol-0101a.svrl  SchXslt-compiled Peppol BIS 3.0.20 XSLT, trimmed
// Both real engines emit @location as Saxon EQNames (Q{uri}name[1]); the
// prefixed-name dialect never showed up in real output, so it is exercised here
// synthetically against the real document and the real SVRL prefix map.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { parseSvrl } = require('../src/svrl');
const { SourceDoc } = require('../src/xdoc');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');
const FIX = (f) => path.join(__dirname, 'fixtures', f);
const read = (f) => fs.readFileSync(FIX(f), 'utf8');

function runJson(svrl, profile) {
  const stdout = execFileSync(
    process.execPath,
    [CLI, '--svrl', FIX(svrl), '--source', FIX('real-0101a-invoice.xml'),
     '--profile', profile, '--format', 'json'],
    { encoding: 'utf8' }
  );
  return JSON.parse(stdout);
}

test('real KoSIT SVRL: ns3-prefixed SVRL, id from @id, information -> warning', () => {
  const report = runJson('real-kosit-0101a.svrl', 'xrechnung-3.0.2');
  // A valid instance must produce zero errors — flag="information" is the
  // exact input that the pre-§9.11 code escalated to error.
  assert.deepEqual(report.summary, { files: 1, errors: 0, warnings: 1, passed: true });
  const f = report.files[0].findings[0];
  assert.equal(f.id, 'BR-DE-TMP-32'); // straight from @id, no fallback needed
  assert.equal(f.severity, 'warning');
  assert.match(f.location, /^\/Q\{urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\}Invoice\[1\]$/);
});

test('real Peppol SVRL: ids from @id, fatal -> error, dictionary still enriches', () => {
  const report = runJson('real-peppol-0101a.svrl', 'peppol-bis-3.0.21');
  const findings = report.files[0].findings;
  assert.deepEqual(
    findings.map((f) => [f.id, f.severity]),
    [
      ['PEPPOL-EN16931-R004', 'error'],
      ['PEPPOL-EN16931-CL008', 'error'],
      ['PEPPOL-EN16931-CL008', 'error'],
    ]
  );
  // R004 is in rules.yaml: the real SVRL must still hit the dictionary
  const r004 = findings[0];
  assert.equal(r004.enriched, true);
  assert.equal(r004.values.stated, 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0');
});

test('real @location dialect: Saxon EQName paths resolve to the actual nodes', () => {
  const { nsMap, findings } = parseSvrl(read('real-peppol-0101a.svrl'));
  const doc = new SourceDoc(read('real-0101a-invoice.xml'), nsMap);
  const resolved = findings.map((f) => doc.resolveLocation(f.location));
  assert.equal(resolved[0].localName, 'Invoice');
  assert.equal(resolved[1].localName, 'EndpointID'); // 4-step deep EQName path
  assert.equal(resolved[2].localName, 'EndpointID');
  assert.notEqual(resolved[1], resolved[2], 'seller and buyer EndpointID are distinct nodes');
});

test('prefixed-name dialect of the same path resolves via the real SVRL prefix map', () => {
  const { nsMap } = parseSvrl(read('real-peppol-0101a.svrl'));
  assert.equal(nsMap.cac, 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
  const doc = new SourceDoc(read('real-0101a-invoice.xml'), nsMap);
  // Same node as the real EQName location, spelled in the prefixed dialect
  // (svrl:ns-prefix-in-attribute-values), which SchXslt/Saxon no longer emit
  // but older ISO-schematron XSLT builds do.
  const node = doc.resolveLocation(
    '/ubl:Invoice[1]/cac:AccountingSupplierParty[1]/cac:Party[1]/cbc:EndpointID[1]'
  );
  assert.ok(node, 'prefixed location must resolve');
  assert.equal(node.localName, 'EndpointID');
});
