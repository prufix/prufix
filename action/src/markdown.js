'use strict';

function fileList(files, max = 3) {
  const shown = files.slice(0, max).map((f) => `\`${f}\``).join(', ');
  return files.length > max ? `${shown} +${files.length - max} more` : shown;
}

// Used when the formatter produced no markdown for a file (e.g. the
// synthetic INPUT-INVALID finding for unparseable files).
function fallbackDetail(entry) {
  const lines = [];
  for (const f of entry.findings || []) {
    lines.push(`- **${f.id}** (${f.severity}): ${f.title}`);
    if (f.location) lines.push(`  - Location: \`${f.location}\``);
  }
  return lines.join('\n');
}

/**
 * Render the merged report as markdown for the job summary or PR comment.
 * Same structure for both; only the caps differ. Per-file detail is always
 * collapsed behind <details> so 200 findings stay scrollable, and both the
 * finding count and the byte size are capped -- whatever is cut is counted
 * and announced instead of silently dropped.
 */
function buildMarkdown(merged, rules, detailByPath, opts) {
  const { heading, maxBytes, maxFindings, footer } = opts;
  const { errors, warnings, files } = merged.summary;
  const out = [];

  out.push(heading);
  out.push('');
  out.push(
    `**Profile:** \`${merged.profile}\` · **Files checked:** ${files} · **Errors:** ${errors} · **Warnings:** ${warnings}`
  );
  out.push('');

  if (errors + warnings === 0) {
    out.push(`No findings. All ${files} file(s) were validated without a single failed rule.`);
  } else {
    out.push('| Rule | Severity | Count | Files |');
    out.push('|---|---|---|---|');
    for (const r of rules) {
      out.push(`| ${r.id} | ${r.severity} | ${r.count} | ${fileList(r.files)} |`);
    }
    out.push('');

    let inlined = 0;
    let omittedFindings = 0;
    let omittedFiles = 0;
    let size = out.join('\n').length;
    const sections = [];
    for (const entry of merged.files) {
      const n = (entry.findings || []).length;
      if (n === 0) continue;
      if (inlined >= maxFindings || size > maxBytes) {
        omittedFindings += n;
        omittedFiles += 1;
        continue;
      }
      const body = (detailByPath.get(entry.path) || fallbackDetail(entry)).trim();
      const section = [
        '<details>',
        `<summary><code>${entry.path}</code> — ${entry.errors || 0} error(s), ${entry.warnings || 0} warning(s)</summary>`,
        '',
        body,
        '',
        '</details>',
      ].join('\n');
      if (size + section.length > maxBytes) {
        omittedFindings += n;
        omittedFiles += 1;
        continue;
      }
      sections.push(section);
      size += section.length;
      inlined += n;
    }

    if (sections.length > 0) {
      out.push('### Findings');
      out.push('');
      out.push(sections.join('\n\n'));
    }
    if (omittedFindings > 0) {
      out.push('');
      out.push(
        `_${omittedFindings} finding(s) in ${omittedFiles} file(s) not shown here. The complete report is in this step's \`report\` output._`
      );
    }
  }

  if (footer) {
    out.push('');
    out.push(footer);
  }
  out.push('');
  return out.join('\n');
}

module.exports = { buildMarkdown };
