'use strict';

const fs = require('fs');
const crypto = require('crypto');

// Hidden marker identifying the action's own PR comment, so re-runs update
// it in place instead of stacking new comments.
const MARKER = '<!-- prufix:report -->';

function logError(msg) {
  console.log(`::error::${msg}`);
}

function logWarning(msg) {
  console.log(`::warning::${msg}`);
}

/**
 * Append step outputs to GITHUB_OUTPUT. Values may contain newlines, which
 * the plain `key=value` form cannot carry, so everything is written in the
 * heredoc form with a random delimiter.
 */
function writeOutputs(map) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    logWarning('GITHUB_OUTPUT is not set; step outputs were not written.');
    return;
  }
  let buf = '';
  for (const [key, value] of Object.entries(map)) {
    const delim = `EINVOICE_EOF_${crypto.randomBytes(8).toString('hex')}`;
    buf += `${key}<<${delim}\n${String(value)}\n${delim}\n`;
  }
  fs.appendFileSync(file, buf);
}

function appendStepSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  fs.appendFileSync(file, markdown + '\n');
}

function prContext() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== 'pull_request' && event !== 'pull_request_target') return null;
  const evPath = process.env.GITHUB_EVENT_PATH;
  if (!evPath || !fs.existsSync(evPath)) return null;
  try {
    const ev = JSON.parse(fs.readFileSync(evPath, 'utf8'));
    const number = ev && ev.pull_request && ev.pull_request.number;
    return number ? { number } : null;
  } catch {
    return null;
  }
}

/**
 * Create or update the PR comment. Every failure mode here degrades to a
 * warning: a missing or read-only token (typical for fork PRs) must never
 * fail the build over a cosmetic comment.
 */
async function upsertPrComment(markdown) {
  const ctx = prContext();
  if (!ctx) {
    console.log('prufix: not a pull request event; skipping the PR comment.');
    return;
  }
  const token = process.env.INPUT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    logWarning(
      "comment: true, but no token is available. The action's `token` input defaults to github.token, so this usually means it was explicitly emptied. The job summary still has the full report; the build itself is unaffected."
    );
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    logWarning('GITHUB_REPOSITORY is not set; skipping the PR comment.');
    return;
  }
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'prufix-action',
    'content-type': 'application/json',
  };
  const body = `${MARKER}\n${markdown}`;

  try {
    let existing = null;
    for (let page = 1; page <= 3 && !existing; page++) {
      const res = await fetch(
        `${api}/repos/${repo}/issues/${ctx.number}/comments?per_page=100&page=${page}`,
        { headers }
      );
      if (res.status === 401 || res.status === 403) {
        logWarning(
          'The token cannot read PR comments (typical for fork PRs, where GITHUB_TOKEN is read-only). Skipping the PR comment; the job summary still has the full report.'
        );
        return;
      }
      if (!res.ok) {
        logWarning(`Could not list PR comments (HTTP ${res.status}). Skipping the PR comment.`);
        return;
      }
      const comments = await res.json();
      existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(MARKER)) || null;
      if (comments.length < 100) break;
    }

    if (existing) {
      const res = await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        logWarning(`Could not update the existing PR comment (HTTP ${res.status}).`);
        return;
      }
      console.log(`prufix: updated the existing PR comment (id ${existing.id}).`);
    } else {
      const res = await fetch(`${api}/repos/${repo}/issues/${ctx.number}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body }),
      });
      if (res.status === 401 || res.status === 403) {
        logWarning(
          'The token cannot create PR comments (typical for fork PRs, where GITHUB_TOKEN is read-only). Skipping the PR comment; the job summary still has the full report.'
        );
        return;
      }
      if (!res.ok) {
        logWarning(`Could not create the PR comment (HTTP ${res.status}).`);
        return;
      }
      console.log('prufix: created a PR comment.');
    }
  } catch (err) {
    logWarning(`PR comment failed (${err.message}). The build itself is unaffected.`);
  }
}

module.exports = { writeOutputs, appendStepSummary, upsertPrComment, logError, logWarning, MARKER };
