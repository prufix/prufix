#!/usr/bin/env node
/*
 * prufix action driver.
 *
 * Reads the file list prepared by entrypoint.sh, runs the validation engine
 * and the report formatter for each file, merges the per-file reports into
 * one (contract section 4.1: multi-file merging is the action's job), writes
 * step outputs, the job summary and the PR comment, and decides the exit
 * code from `fail-on` -- the ONLY place a pass/fail decision is made.
 */
'use strict';

const fs = require('fs');
const { runAll, ToolFailure } = require('./runner');
const { mergeReports, aggregateRules } = require('./report');
const { buildMarkdown } = require('./markdown');
const {
  writeOutputs,
  appendStepSummary,
  upsertPrComment,
  logError,
  logWarning,
} = require('./github');

const PROFILES = ['en16931', 'peppol-bis-3.0.21', 'xrechnung-3.0.2', 'facturx', 'auto'];
const FAIL_ON_VALUES = ['error', 'warning', 'never'];

// GitHub caps a single step output at 1 MiB; stay under it with headroom.
const MAX_OUTPUT_BYTES = 950 * 1024;
const SUMMARY_MAX_BYTES = 700 * 1024; // GITHUB_STEP_SUMMARY is capped at 1 MiB
const SUMMARY_MAX_FINDINGS = 200;
const COMMENT_MAX_BYTES = 55 * 1024; // PR comment bodies are capped at 65536 chars
const COMMENT_MAX_FINDINGS = 30;

function getInput(name, fallback) {
  // Docker actions receive inputs as INPUT_<UPPERCASED NAME>; dashes are
  // kept as-is (INPUT_FAIL-ON), which is why this is read in Node, not bash.
  const raw = process.env['INPUT_' + name.toUpperCase()];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim();
}

function runUrl() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

async function main() {
  const profile = getInput('profile', 'auto');
  const failOn = getInput('fail-on', 'error');
  const comment = getInput('comment', 'true') === 'true';

  if (!PROFILES.includes(profile)) {
    logError(`Unknown profile '${profile}'. Valid values: ${PROFILES.join(', ')}.`);
    process.exit(1);
  }
  if (!FAIL_ON_VALUES.includes(failOn)) {
    logError(`Unknown fail-on value '${failOn}'. Valid values: ${FAIL_ON_VALUES.join(', ')}.`);
    process.exit(1);
  }

  const listFile = process.env.EINVOICE_FILE_LIST;
  if (!listFile || !fs.existsSync(listFile)) {
    logError('Internal error: the matched-file list is missing. entrypoint.sh should have created it.');
    process.exit(1);
  }
  const files = fs
    .readFileSync(listFile, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (files.length === 0) {
    logError('No files to validate.');
    process.exit(1);
  }

  console.log(`prufix: validating ${files.length} file(s) against profile '${profile}'`);

  let entries;
  let detailByPath;
  let toolMeta;
  try {
    ({ entries, detailByPath, toolMeta } = runAll(files, profile));
  } catch (err) {
    if (err instanceof ToolFailure) {
      logError(err.message);
      logError(
        'This is a tool failure, not a validation result. The run fails regardless of fail-on so a broken toolchain can never look like a green build.'
      );
      process.exit(1);
    }
    throw err;
  }

  const merged = mergeReports(entries, profile, toolMeta);
  const rules = aggregateRules(entries);
  const { errors, warnings } = merged.summary;

  // Log rule ids and counts only -- never invoice contents.
  console.log(`prufix: ${errors} error(s), ${warnings} warning(s) in ${entries.length} file(s)`);
  for (const r of rules) {
    console.log(`  ${r.severity.padEnd(7)} ${r.id}  x${r.count}`);
  }

  // ---- step outputs ----
  let reportJson = JSON.stringify(merged);
  if (Buffer.byteLength(reportJson) > MAX_OUTPUT_BYTES) {
    logWarning(
      "The merged report exceeds GitHub's 1 MiB step-output limit; per-finding detail was dropped from the 'report' output (file list and counts are preserved)."
    );
    const slim = { ...merged, files: merged.files.map((f) => ({ ...f, findings: [] })) };
    reportJson = JSON.stringify(slim);
  }
  writeOutputs({
    report: reportJson,
    errors: String(errors),
    warnings: String(warnings),
    'files-checked': String(entries.length),
    passed: String(merged.summary.passed),
  });

  // ---- job summary ----
  appendStepSummary(
    buildMarkdown(merged, rules, detailByPath, {
      heading: '## e-invoice validation',
      maxBytes: SUMMARY_MAX_BYTES,
      maxFindings: SUMMARY_MAX_FINDINGS,
    })
  );

  // ---- PR comment ----
  if (comment) {
    const url = runUrl();
    await upsertPrComment(
      buildMarkdown(merged, rules, detailByPath, {
        heading: '## e-invoice validation',
        maxBytes: COMMENT_MAX_BYTES,
        maxFindings: COMMENT_MAX_FINDINGS,
        footer: url ? `<sub>Full details: [job summary](${url})</sub>` : undefined,
      })
    );
  }

  // ---- exit code ----
  let exitCode = 0;
  if (failOn === 'error' && errors > 0) exitCode = 1;
  if (failOn === 'warning' && errors + warnings > 0) exitCode = 1;
  if (exitCode !== 0) {
    logError(`Found ${errors} error(s) and ${warnings} warning(s) (fail-on: ${failOn}).`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  logError(`Unexpected failure in the prufix action: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
