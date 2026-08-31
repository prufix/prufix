'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');
const FIX = (f) => path.join(__dirname, 'fixtures', f);

function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      ...opts,
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function runJson(svrl, source, extra = []) {
  const res = run([
    '--svrl', FIX(svrl), '--source', FIX(source),
    '--profile', 'peppol-bis-3.0.21', '--format', 'json', ...extra,
  ]);
  assert.equal(res.code, 0, `expected exit 0, stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('enriched BR-CO-13 (UBL): exact decimal values, schema v1 shape', () => {
  const report = runJson('ubl-brco13.svrl', 'ubl-brco13.xml', ['--doc-base', 'https://example.dev/rules']);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.tool.name, 'prufix');
  assert.equal(report.profile, 'peppol-bis-3.0.21');
  assert.deepEqual(report.summary, { files: 1, errors: 1, warnings: 0, passed: false });

  const file = report.files[0];
  assert.equal(file.documentType, 'ubl-invoice');
  const f = file.findings[0];
  assert.equal(f.id, 'BR-CO-13');
  assert.equal(f.severity, 'error');
  assert.equal(f.title, 'Total amount does not match the line items');
  assert.equal(f.enriched, true);
  assert.match(f.originalText, /^\[BR-CO-13\]-Invoice total amount without VAT/);
  assert.match(f.location, /TaxExclusiveAmount/);
  assert.equal(f.docUrl, 'https://example.dev/rules/BR-CO-13');
  // decimal arithmetic: 1240.00 - (-60.00) + 0.00 = 1300.00, no float artifacts
  assert.deepEqual(f.values, {
    stated: '1180.00',
    lines: '1240.00',
    lineCount: '3',
    allowance: '-60.00',
    charge: '0.00',
    expected: '1300.00',
    diff: '120.00',
  });
  assert.equal(f.hints.length, 1);
  assert.match(f.hints[0], /BT-92 is negative/);
});

test('text format matches the mvp-design 3.2 shape', () => {
  const res = run([
    '--svrl', FIX('ubl-brco13.svrl'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'peppol-bis-3.0.21', '--format', 'text',
  ]);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /x BR-CO-13 {2}Total amount does not match the line items/);
  assert.match(res.stdout, /BT-109 \(TaxExclusiveAmount\) states\s+1,180\.00/);
  assert.match(res.stdout, /Invoice lines\s+1,240\.00\s+\(3 lines\)/);
  assert.match(res.stdout, /Document allowance\s+-60\.00/);
  assert.match(res.stdout, /Expected\s+1,300\.00/);
  assert.match(res.stdout, /Hint: BT-92 is negative/);
  assert.match(res.stdout, /Location: /);
  assert.ok(!res.stdout.includes('undefined'));
  assert.ok(!res.stdout.includes('NaN'));
});

test('markdown format renders summary table and explain block', () => {
  const res = run([
    '--svrl', FIX('ubl-brco13.svrl'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'peppol-bis-3.0.21', '--format', 'markdown',
  ]);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /\| Rule \| Severity \| Problem \|/);
  assert.match(res.stdout, /`BR-CO-13`/);
  assert.match(res.stdout, /```text/);
  assert.ok(!res.stdout.includes('undefined'));
  // per-file fragment for [C]: no top-level headers, no overall summary line
  assert.ok(!/^#{1,3} /m.test(res.stdout), 'must not contain h1-h3 headings');
  assert.ok(!res.stdout.includes(FIX('ubl-brco13.xml').replace(/\\/g, '/')), 'must not repeat the file path');
});

test('unknown rules pass through untouched; severities follow contract 4.3', () => {
  const report = runJson('ubl-mixed.svrl', 'ubl-brco13.xml');
  const [a, b, c, d] = report.files[0].findings;

  // rule id recovered from "[XR-DE-27]-..." text; not in dictionary
  assert.equal(a.id, 'XR-DE-27');
  assert.equal(a.enriched, false);
  assert.equal(a.severity, 'error');
  assert.equal(a.title, 'The invoice must contain a Leitweg-ID in "Buyer reference" (BT-10).');
  assert.equal(a.explain, undefined);
  assert.equal(a.values, undefined);

  // successful-report is a warning even with flag="fatal" (contract §4.3)
  assert.equal(b.id, 'UBL-SR-49');
  assert.equal(b.severity, 'warning');
  assert.equal(b.enriched, false);

  // failed-assert flag="warning"
  assert.equal(c.id, 'PEPPOL-COMMON-R042');
  assert.equal(c.severity, 'warning');

  // rule id recovered from @see URL; hits the dictionary
  assert.equal(d.id, 'PEPPOL-EN16931-R010');
  assert.equal(d.enriched, true);
  assert.match(d.explain, /Buyer electronic address/);

  assert.deepEqual(report.summary, { files: 1, errors: 2, warnings: 2, passed: false });
});

test('missing probes drop explain lines, never print undefined', () => {
  const report = runJson('ubl-brco13.svrl', 'ubl-brco13-noexcl.xml');
  const f = report.files[0].findings[0];
  assert.equal(f.enriched, true);
  assert.ok(!Object.hasOwn(f.values, 'stated'));
  assert.ok(!Object.hasOwn(f.values, 'diff')); // derive depends on stated
  assert.equal(f.values.lines, '1240.00');
  // lines mentioning {stated} are gone; the breakdown block survives
  assert.ok(!f.explain.includes('states'));
  assert.match(f.explain, /Invoice lines\s+1,240\.00/);
  assert.ok(!f.explain.includes('undefined'));
  assert.ok(!f.explain.includes('NaN'));
  // hint not depending on stated still fires
  assert.match(f.hints[0], /BT-92 is negative/);
});

test('decimal-exact sums: ten lines of 0.10 sum to 1.00, not 0.999…', () => {
  const report = runJson('ubl-brco10.svrl', 'ubl-brco10.xml');
  const f = report.files[0].findings[0];
  assert.equal(f.id, 'BR-CO-10');
  assert.equal(f.values.lines, '1.00');
  assert.equal(f.values.stated, '1.10');
  assert.equal(f.values.diff, '0.10');
  // 0.10 <= 10 * 0.01 -> the rounding-place hint fires
  assert.equal(f.hints.length, 1);
  assert.match(f.hints[0], /rounded to 2 decimals first/);
});

test('CII: probe.cii overrides, id from text, severity from role', () => {
  const report = runJson('cii-brco13.svrl', 'cii-brco13.xml');
  const file = report.files[0];
  assert.equal(file.documentType, 'cii');
  const f = file.findings[0];
  assert.equal(f.id, 'BR-CO-13');
  assert.equal(f.severity, 'error');
  assert.equal(f.enriched, true);
  assert.deepEqual(f.values, {
    stated: '1150.00',
    lines: '1200.00',
    lineCount: '2',
    allowance: '100.00',
    charge: '0.00',
    expected: '1100.00',
    diff: '50.00',
  });
  assert.equal(f.hints, undefined); // allowance is positive here: no hint
});

test('line-level rule resolves @location to the right line (BR-S-05)', () => {
  const report = runJson('ubl-brs05.svrl', 'ubl-brs05.xml');
  const f = report.files[0].findings[0];
  assert.equal(f.id, 'BR-S-05');
  assert.equal(f.enriched, true);
  assert.equal(f.values.lineId, '2');
  assert.equal(f.values.itemName, 'Training day');
  assert.equal(f.values.rate, '0');
  assert.equal(f.values.category, 'S');
  assert.match(f.hints[0], /category Z \(zero rated\)/);
});

test('R120: base quantity defaults to 1, expected computed per formula', () => {
  const report = runJson('ubl-r120.svrl', 'ubl-r120.xml');
  const f = report.files[0].findings[0];
  assert.equal(f.id, 'PEPPOL-EN16931-R120');
  assert.deepEqual(f.values, {
    lineId: '1',
    lineNet: '49.00',
    qty: '5',
    price: '10.00',
    baseQty: '1',
    lineAllowance: '0.00',
    lineCharge: '0.00',
    gross: '50.00',
    expected: '50.00',
    diff: '1.00',
  });
  // baseQty == 1 and no line allowance/charge: no hint applies
  assert.equal(f.hints, undefined);
});

test('BR-CO-16: forgotten prepaid is named, absent rounding reads as 0', () => {
  const report = runJson('ubl-brco16.svrl', 'ubl-brco16.xml');
  const f = report.files[0].findings[0];
  assert.equal(f.id, 'BR-CO-16');
  assert.equal(f.enriched, true);
  assert.deepEqual(f.values, {
    stated: '1404.20',
    grand: '1404.20',
    prepaid: '500.00',
    rounding: '0.00', // element absent; probed via sum() so arithmetic still derives
    expected: '904.20',
    diff: '500.00',
  });
  assert.equal(f.hints.length, 1);
  assert.match(f.hints[0], /prepaid amount \(BT-113\) was not subtracted/i);
});

test('R004: wrong CustomizationID is quoted and the fix is named', () => {
  // ubl-brco10.xml declares plain urn:cen.eu:en16931:2017
  const report = runJson('ubl-r004.svrl', 'ubl-brco10.xml');
  const f = report.files[0].findings[0];
  assert.equal(f.id, 'PEPPOL-EN16931-R004');
  assert.equal(f.enriched, true);
  assert.equal(f.values.stated, 'urn:cen.eu:en16931:2017');
  assert.match(f.explain, /"urn:cen\.eu:en16931:2017"/);
  assert.equal(f.hints.length, 1);
  assert.match(f.hints[0], /#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
});

test('malformed SVRL: exit 1 with a clean error, no report on stdout', () => {
  const res = run([
    '--svrl', FIX('malformed.svrl'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'en16931', '--format', 'json',
  ]);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /SVRL/);
});

test('a non-SVRL root is rejected as the formatter own failure', () => {
  const res = run([
    '--svrl', FIX('ubl-brco13.xml'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'en16931', '--format', 'json',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /schematron-output/);
});

test('unknown profile and unknown format are rejected', () => {
  const bad1 = run([
    '--svrl', FIX('ubl-brco13.svrl'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'peppol-bis-9.9', '--format', 'json',
  ]);
  assert.equal(bad1.code, 1);
  assert.match(bad1.stderr, /unknown profile/);

  const bad2 = run([
    '--svrl', FIX('ubl-brco13.svrl'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'en16931', '--format', 'xml',
  ]);
  assert.equal(bad2.code, 1);
  assert.match(bad2.stderr, /unknown format/);
});

test('clean SVRL (no findings) reports passed: true', () => {
  const res = run([
    '--svrl', FIX('empty.svrl'), '--source', FIX('ubl-brco13.xml'),
    '--profile', 'en16931', '--format', 'json',
  ]);
  assert.equal(res.code, 0);
  const report = JSON.parse(res.stdout);
  assert.deepEqual(report.summary, { files: 1, errors: 0, warnings: 0, passed: true });
  assert.equal(report.files[0].findings.length, 0);
});
