#!/usr/bin/env node
'use strict';

/**
 * prufix formatter CLI (contract §4.1).
 *
 *   node cli.js --svrl <path> --source <path> --profile <id>
 *               --format json|text|markdown
 *               [--rules <path>] [--doc-base <url>] [--path <display path>]
 *
 * --source is WHERE TO READ THE XML. --path is WHAT TO CALL IT in the report
 * (files[].path). They used to be the same string, so one argument served both;
 * since contract §9.28 the caller hands us the engine's --out-source artifact,
 * which is an internal temp path that must never reach a PR comment or a web
 * page. --path defaults to --source only to keep single-file CLI use terse:
 * any caller whose --source is a temp file MUST pass --path (contract §9.31).
 *
 * Exit codes (contract §4.4): always 0 — findings are not failures here;
 * 1 only for the formatter's own failure (bad arguments, unreadable input,
 * malformed SVRL/source, broken rules file).
 *
 * Privacy: nothing from the invoice is written anywhere except the probed
 * values that appear in the report itself. Diagnostics on stderr name rule
 * ids and probe keys only.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadRules } = require('./dictionary');
const { buildReport } = require('./enrich');
const { renderText, renderMarkdown } = require('./render');

const PROFILES = ['en16931', 'peppol-bis-3.0.21', 'xrechnung-3.0.2', 'facturx', 'auto'];
const FORMATS = ['json', 'text', 'markdown'];

function fail(msg) {
  process.stderr.write(`prufix formatter: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { rules: path.join(__dirname, '..', 'rules', 'rules.yaml'), docBase: null };
  const flags = {
    '--svrl': 'svrl',
    '--source': 'source',
    '--profile': 'profile',
    '--format': 'format',
    '--rules': 'rules',
    '--doc-base': 'docBase',
    '--path': 'displayPath',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = flags[argv[i]];
    if (!key) fail(`unknown argument: ${argv[i]}`);
    if (i + 1 >= argv.length) fail(`${argv[i]} needs a value`);
    args[key] = argv[i + 1];
    i += 1;
  }
  for (const req of ['svrl', 'source', 'profile', 'format']) {
    if (!args[req]) fail(`--${req === 'docBase' ? 'doc-base' : req} is required`);
  }
  if (!PROFILES.includes(args.profile)) {
    fail(`unknown profile '${args.profile}' (expected one of: ${PROFILES.join(', ')})`);
  }
  if (!FORMATS.includes(args.format)) {
    fail(`unknown format '${args.format}' (expected one of: ${FORMATS.join(', ')})`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let svrlXml;
  let sourceXml;
  let rules;
  try {
    svrlXml = fs.readFileSync(args.svrl, 'utf8');
  } catch (e) {
    return fail(`cannot read SVRL file: ${e.message}`);
  }
  try {
    sourceXml = fs.readFileSync(args.source, 'utf8');
  } catch (e) {
    return fail(`cannot read source file: ${e.message}`);
  }
  try {
    rules = loadRules(args.rules);
  } catch (e) {
    return fail(`cannot load rules dictionary: ${e.message}`);
  }

  const toolVersion = require('../package.json').version;

  let report;
  try {
    report = buildReport({
      svrlXml,
      sourceXml,
      sourcePath: (args.displayPath || args.source).replace(/\\/g, '/'),
      profile: args.profile,
      rules,
      docBase: args.docBase,
      toolVersion,
    });
  } catch (e) {
    return fail(e.message);
  }

  if (args.format === 'json') process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else if (args.format === 'text') process.stdout.write(renderText(report));
  else process.stdout.write(renderMarkdown(report));
  process.exit(0);
}

main();
