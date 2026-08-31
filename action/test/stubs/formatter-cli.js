#!/usr/bin/env node
// Stub formatter for local action tests. Honours the CLI + report.json
// contract (contract section 4) only -- the real formatter lives in
// /app/formatter and is built by another agent. SVRL parsing here is a
// naive regex over the stub engine's known output; good enough for tests.
'use strict';

const fs = require('fs');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const svrlPath = arg('--svrl');
const source = arg('--source');
const displayPath = arg('--path') || source; // contract 9.31: --path defaults to --source
const profile = arg('--profile');
const format = arg('--format') || 'json';

// Test-only instrumentation: when set, record every --source/--path pair
// this stub is invoked with. This is how test/run-tests.sh proves the
// runner hands over the engine's --out-source file as --source (contract
// 3.1/9.28) while also passing the real input path as --path (contract
// 9.31) -- from outside the process, the only observable is what actually
// lands in argv, not what an unused variable would have held.
if (process.env.EINVOICE_TEST_SOURCE_LOG) {
  fs.appendFileSync(process.env.EINVOICE_TEST_SOURCE_LOG, `source=${source} path=${displayPath}\n`);
}

let svrl;
try {
  svrl = fs.readFileSync(svrlPath, 'utf8');
} catch (e) {
  console.error(`stub-formatter: cannot read SVRL: ${e.message}`);
  process.exit(1);
}

const findings = [];
const assertRe = /<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g;
let m;
while ((m = assertRe.exec(svrl))) {
  const attrs = m[1];
  const attr = (name) => {
    const mm = attrs.match(new RegExp(`${name}="([^"]*)"`));
    return mm ? mm[1] : undefined;
  };
  const text = ((m[2].match(/<svrl:text>([\s\S]*?)<\/svrl:text>/) || [])[1] || '').trim();
  findings.push({
    id: attr('id') || 'UNKNOWN',
    severity: attr('flag') === 'warning' ? 'warning' : 'error',
    title: text.split('\n')[0].slice(0, 120),
    location: attr('location') || '/',
    originalText: text,
    enriched: false,
  });
}

const errors = findings.filter((f) => f.severity === 'error').length;
const warnings = findings.filter((f) => f.severity === 'warning').length;

if (format === 'json') {
  const report = {
    schemaVersion: 1,
    tool: { name: 'prufix', version: '0.0.0-stub' },
    profile,
    summary: { files: 1, errors, warnings, passed: errors === 0 },
    files: [{ path: displayPath, documentType: 'ubl-invoice', errors, warnings, findings }],
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else if (format === 'markdown') {
  const lines = findings.map(
    (f) => `- **${f.id}** (${f.severity}) ${f.title}\n  - Location: \`${f.location}\``
  );
  process.stdout.write((lines.join('\n') || 'No findings.') + '\n');
} else if (format === 'text') {
  const lines = findings.map((f) => `${f.severity === 'error' ? 'x' : '!'} ${f.id}  ${f.title}`);
  process.stdout.write((lines.join('\n') || 'OK') + '\n');
} else {
  console.error(`stub-formatter: unknown format: ${format}`);
  process.exit(1);
}
