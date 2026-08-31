'use strict';

// Regression tests for contract §4.3 / §9.11: the flag/role -> severity matrix.
// The 2026-08 bug dropped flag="information" into the default error branch,
// which turned 39 of the 86 official XRechnung instances all-red.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSvrl } = require('../src/svrl');

const FIX = path.join(__dirname, 'fixtures', 'severity-matrix.svrl');

const EXPECTED = {
  'BR-DE-TMP-32': 'warning', // flag="information" — the §9.11 bug
  'FUTURE-ADVISORY-R1': 'warning', // unknown flag: degrade down, never up
  'BR-52': 'error', // no flag
  'BR-CL-25': 'warning', // no flag, role="warning"
  'UBL-SR-13': 'warning', // successful-report, even flag="fatal"
  'BR-01': 'error', // flag="fatal"
  'BR-02': 'error', // flag="error"
  'BR-03': 'warning', // flag="warn"
  'BR-04': 'warning', // flag="informational"
  'BR-05': 'warning', // no flag, role="info"
  'BR-06': 'error', // no flag, role="fatal": roles never downgrade unless warn/info
  'BR-07': 'warning', // flag="WARNING": comparison is case-insensitive
};

test('contract §4.3: every cell of the flag/role severity matrix', () => {
  const { findings } = parseSvrl(fs.readFileSync(FIX, 'utf8'));
  assert.equal(findings.length, Object.keys(EXPECTED).length);
  for (const f of findings) {
    assert.equal(
      f.severity,
      EXPECTED[f.id],
      `${f.id} (kind=${f.kind}) must be ${EXPECTED[f.id]}, got ${f.severity}`
    );
  }
});

test('§9.11: no unknown flag value can ever become an error', () => {
  // Property check across arbitrary invented flags: anything non-empty that is
  // not fatal/error must land on warning. Escalating would flag valid invoices.
  for (const flag of ['advisory', 'notice', 'hint', 'INFORMATION', 'severe', 'critical']) {
    const svrl = `<?xml version="1.0"?>
      <svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
        <svrl:failed-assert flag="${flag}" id="X-1" test="t" location="/">
          <svrl:text>x</svrl:text>
        </svrl:failed-assert>
      </svrl:schematron-output>`;
    const { findings } = parseSvrl(svrl);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'warning', `flag="${flag}" must not escalate to error`);
  }
});
