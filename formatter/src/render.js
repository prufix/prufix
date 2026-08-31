'use strict';

/**
 * report.json -> terminal text (mvp-design §3.2 shape) and GitHub-flavoured markdown.
 * Both renderers work from the report object only, so [C] could re-render if needed.
 */

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function indent(text, pad) {
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : pad + l))
    .join('\n');
}

function wrap(text, width, pad) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${pad}`);
}

function renderText(report) {
  const file = report.files[0];
  const out = [];
  out.push(
    `${report.tool.name} — profile ${report.profile}, ${file.documentType}: ` +
      `${plural(file.errors, 'error')}, ${plural(file.warnings, 'warning')}`
  );
  out.push(`  ${file.path}`);
  out.push('');

  if (file.findings.length === 0) {
    out.push('No issues found.');
    return out.join('\n') + '\n';
  }

  for (const f of file.findings) {
    const marker = f.severity === 'error' ? 'x' : '!';
    const sev = f.severity === 'warning' ? '  (warning)' : '';
    out.push(`${marker} ${f.id}  ${f.title}${sev}`);
    out.push('');
    if (f.enriched && f.explain) {
      out.push(indent(f.explain, '  '));
      out.push('');
    } else if (!f.enriched && f.originalText && f.originalText !== f.title) {
      out.push(`  ${wrap(f.originalText, 74, '  ')}`);
      out.push('');
    }
    for (const hint of f.hints || []) {
      out.push(`  Hint: ${wrap(hint, 68, '        ')}`);
      out.push('');
    }
    out.push(`  Location: ${f.location}`);
    if (f.docUrl) out.push(`  Docs: ${f.docUrl}`);
    out.push('');
  }
  return out.join('\n') + '\n';
}

function mdEscape(s) {
  return s.replace(/([\\`*_{}[\]<>|])/g, '\\$1');
}

// Per-file fragment only: [C] wraps this inside <details><summary>path — N
// errors, M warnings</summary> for the Job Summary / PR comment, and adds the
// overall header and totals itself. So: no headings above finding level, no
// overall summary line, no file path.
function renderMarkdown(report) {
  const file = report.files[0];
  const out = [];

  if (file.findings.length === 0) {
    out.push('No issues found.');
    return out.join('\n') + '\n';
  }

  out.push('| Rule | Severity | Problem |');
  out.push('|---|---|---|');
  for (const f of file.findings) {
    out.push(`| \`${f.id}\` | ${f.severity} | ${mdEscape(f.title)} |`);
  }
  out.push('');

  for (const f of file.findings) {
    const name = f.docUrl ? `[\`${f.id}\`](${f.docUrl})` : `\`${f.id}\``;
    out.push(`#### ${name} — ${mdEscape(f.title)} (${f.severity})`);
    out.push('');
    if (f.enriched && f.explain) {
      out.push('```text');
      out.push(f.explain);
      out.push('```');
      out.push('');
    } else if (!f.enriched && f.originalText && f.originalText !== f.title) {
      out.push(`> ${mdEscape(f.originalText)}`);
      out.push('');
    }
    for (const hint of f.hints || []) {
      out.push(`**Hint:** ${mdEscape(hint)}`);
      out.push('');
    }
    out.push(`Location: \`${f.location}\``);
    out.push('');
  }
  return out.join('\n') + '\n';
}

module.exports = { renderText, renderMarkdown };
