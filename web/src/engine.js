'use strict';

/**
 * Boundary 1 (contract §3): invoke /app/engine/validate.sh as a child
 * process, same as [C]'s app/action/src/runner.js does.
 *
 * EINVOICE_ENGINE overrides the command for local tests (space-separated;
 * paths with spaces are not supported in the override) -- same convention
 * [C] uses, so a fake engine script written for one works for the other.
 */

const { spawnSync } = require('node:child_process');

const DEFAULT_ENGINE = ['/app/engine/validate.sh'];

function cmdFromEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback.slice();
  return v.split(/\s+/).filter(Boolean);
}

// Forward slashes work everywhere this runs (Linux container in production,
// Git Bash + Windows Node in local tests); backslashes only work on Windows.
const slash = (p) => p.replace(/\\/g, '/');

/**
 * @param {string} inputPath  file already written to disk
 * @param {string} profile
 * @param {string} svrlPath   where the engine should write its SVRL output
 * @param {string} sourcePath where the engine should write the XML it
 *   actually validated (contract §3.1/§9.28: a copy for XML input, the
 *   extracted embedded XML for a PDF). Always passed, unconditionally --
 *   the caller must read this file for the formatter's --source, never the
 *   original upload.
 * @returns {{ status: number|null, stderr: string }}
 *   `stderr` is captured only so the caller can classify a failure
 *   (contract §9.24) -- it must never be logged or returned to the client
 *   verbatim, since xmllint/KoSIT error text can quote fragments of the
 *   input document.
 */
function runEngine(inputPath, profile, svrlPath, sourcePath) {
  const cmd = cmdFromEnv('EINVOICE_ENGINE', DEFAULT_ENGINE);
  const args = [
    ...cmd.slice(1),
    '--profile', profile,
    '--input', slash(inputPath),
    '--out-svrl', slash(svrlPath),
    '--out-source', slash(sourcePath),
  ];
  const res = spawnSync(cmd[0], args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    return { status: null, stderr: res.error.message || String(res.error) };
  }
  return { status: res.status, stderr: res.stderr || '' };
}

module.exports = { runEngine };
