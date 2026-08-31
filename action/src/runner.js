'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

/** Thrown when the toolchain itself breaks (engine exit 3, formatter crash). */
class ToolFailure extends Error {}

const DEFAULT_ENGINE = ['/app/engine/validate.sh'];
const DEFAULT_FORMATTER = ['node', '/app/formatter/src/cli.js'];

// EINVOICE_ENGINE / EINVOICE_FORMATTER override the commands for local tests
// (space-separated; paths with spaces are not supported in the override).
function cmdFromEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback.slice();
  return v.split(/\s+/).filter(Boolean);
}

// Forward slashes work everywhere this runs (Linux container in production,
// Git Bash + Windows Node in local tests); backslashes only work on Windows.
const slash = (p) => p.replace(/\\/g, '/');

function runEngine(file, profile, svrlPath, sourcePath) {
  const cmd = cmdFromEnv('EINVOICE_ENGINE', DEFAULT_ENGINE);
  const args = [
    ...cmd.slice(1),
    '--profile', profile,
    '--input', slash(file),
    '--out-svrl', slash(svrlPath),
    // Contract section 3.1 / 9.28: engine always writes the XML it actually
    // validated here (a copy for XML input, the extracted part for facturx
    // PDF input). This flag is passed unconditionally -- no profile branch --
    // because 9.28 deliberately made the engine always write it so callers
    // never need one.
    '--out-source', slash(sourcePath),
  ];
  // stderr streams into the action log (engine progress/warnings live there,
  // contract section 3.4); stdout is contractually empty and is discarded.
  const res = spawnSync(cmd[0], args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (res.error) {
    throw new ToolFailure(`Could not start the validation engine (${cmd[0]}): ${res.error.message}`);
  }
  return res.status;
}

// `sourcePath` is the engine's --out-source output (the XML it actually
// validated), never the original `file` -- contract section 3.1 is explicit
// that the caller must not hand the original --input to the formatter (for
// facturx that original is a PDF, which the formatter cannot parse as XML).
// `file` is also passed as --path (contract section 9.31): --source is an
// internal temp path, so any caller using one MUST pass --path, or that temp
// path leaks into files[].path and from there into the PR comment/summary.
function runFormatter(svrlPath, sourcePath, file, profile, format) {
  const cmd = cmdFromEnv('EINVOICE_FORMATTER', DEFAULT_FORMATTER);
  const args = [
    ...cmd.slice(1),
    '--svrl', slash(svrlPath),
    '--source', slash(sourcePath),
    '--profile', profile,
    '--format', format,
    '--path', slash(file),
  ];
  const res = spawnSync(cmd[0], args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new ToolFailure(`Could not start the report formatter (${cmd[0]}): ${res.error.message}`);
  }
  if (res.status !== 0) {
    // Contract section 4.4: the formatter exits non-zero only on its own
    // failure. That is a toolchain problem, never a validation verdict.
    throw new ToolFailure(`The report formatter exited with code ${res.status} for '${file}'.`);
  }
  return res.stdout;
}

/**
 * A file the engine could not parse at all (exit 2) still shows up in the
 * report -- as an error-severity finding against that file. Skipping it
 * silently would let a garbage file produce a green build.
 */
function invalidInputEntry(file, profile) {
  const what = profile === 'facturx' ? 'XML (or extract XML from the PDF)' : 'XML';
  return {
    path: file,
    documentType: 'unknown',
    errors: 1,
    warnings: 0,
    findings: [
      {
        id: 'INPUT-INVALID',
        severity: 'error',
        title: 'File could not be read as an invoice document',
        location: '/',
        originalText: `The validation engine could not parse this file as ${what}. See the step log for the parser's message.`,
        enriched: false,
      },
    ],
  };
}

function runAll(files, profile) {
  const tmpBase = process.env.EINVOICE_TMPDIR || os.tmpdir();
  const workDir = fs.mkdtempSync(path.join(tmpBase, 'prufix-'));
  const entries = [];
  const detailByPath = new Map();
  let toolMeta = null;
  try {
    for (const file of files) {
      const svrlPath = path.join(workDir, crypto.randomBytes(6).toString('hex') + '.svrl.xml');
      const sourcePath = path.join(workDir, crypto.randomBytes(6).toString('hex') + '.source');
      try {
        const status = runEngine(file, profile, svrlPath, sourcePath);

        if (status === 2) {
          // Broken input: report it, keep validating the remaining files.
          console.log(`::warning file=${file}::Not readable as an invoice document; recorded as an error-severity finding.`);
          entries.push(invalidInputEntry(file, profile));
          continue;
        }
        if (status !== 0) {
          // Exit 3 -- or anything undocumented -- means the toolchain itself
          // failed. Abort loudly; a partial run must never look complete.
          const code = status === null ? 'killed' : status;
          throw new ToolFailure(`The validation engine failed on '${file}' (exit code ${code}). See the engine's message in the log above.`);
        }

        const jsonOut = runFormatter(svrlPath, sourcePath, file, profile, 'json');
        let report;
        try {
          report = JSON.parse(jsonOut);
        } catch (e) {
          throw new ToolFailure(`The report formatter returned invalid JSON for '${file}': ${e.message}`);
        }
        const entry = report && Array.isArray(report.files) ? report.files[0] : undefined;
        if (!entry) {
          throw new ToolFailure(`The report formatter returned no file entry for '${file}'.`);
        }
        // entry.path is the real input path here, not the temp --out-source
        // file, because we passed --path (contract section 9.31) -- the
        // formatter writes files[].path from --path, not from --source.
        if (!entry.path) entry.path = file;
        if (!toolMeta && report.tool) toolMeta = report.tool;
        entries.push(entry);

        if ((entry.findings || []).length > 0) {
          detailByPath.set(entry.path, runFormatter(svrlPath, sourcePath, file, profile, 'markdown'));
        }
      } finally {
        // Clean up per file, not just at the end of the loop -- with many
        // files these would otherwise all pile up in workDir until runAll
        // returns. `force: true` also makes this safe when the engine threw
        // or failed before writing one of these (or wrote neither).
        fs.rmSync(svrlPath, { force: true });
        fs.rmSync(sourcePath, { force: true });
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return { entries, detailByPath, toolMeta };
}

module.exports = { runAll, ToolFailure };
