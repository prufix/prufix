#!/usr/bin/env node
// app/web/tools/gen-rules.mjs — [D2] static generator for /rules/<id> (contract §9.19, §9.21, §9.25)
//
// Reads app/formatter/rules/rules.yaml (the dictionary, owned by [B]) and
// app/web/content/rules/*.md (the prose, owned by [D2], see
// app/web/content/README.md for the file shape), and writes one
// app/web/public/rules/<ID>.html per rule plus an index page.
//
// - Fails the build loudly if the dictionary and the content directory
//   don't describe exactly the same set of rule IDs (contract §9.19): that
//   mismatch check is the mechanical guarantee that "30 stays 30".
// - Renders through app/web/src/layout.js's page() export, owned by [D1]
//   (contract §9.21). This file never creates or edits layout.js. Callers
//   that need to run this generator before layout.js exists (or want to
//   test it without depending on [D1]'s implementation) can pass a stub
//   via generate({ layoutPage }) — see app/web/tools/README.md.
// - The dictionary is read through [B]'s public export,
//   `dictionary.loadRules(path)` (app/formatter/src/dictionary.js), not by
//   parsing rules.yaml ourselves or reaching into [B]'s node_modules —
//   contract §9.25 relaxes §9.18's "no direct dictionary.js access" ban
//   specifically for this build-time tool (the ban still holds for [D1]'s
//   server runtime path). Loaded via createRequire since dictionary.js is
//   CommonJS and this file is ESM.
// - Front matter in app/web/content/rules/*.md is NOT YAML (contract
//   §9.25): it's a flat `key: value` format [D2] defined and parses itself
//   in ~20 lines below — see app/web/content/README.md. Net effect:
//   app/web/ has zero YAML dependency.
// - No npm dependencies. The Markdown body is rendered with a small
//   hand-written renderer instead of pulling in a Markdown library — see
//   app/web/content/README.md for the exact (intentionally small) subset
//   of Markdown it supports.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Public export only (contract §9.25) — never app/formatter's node_modules.
const { loadRules } = require('../../formatter/src/dictionary.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_YAML = path.join(__dirname, '../../formatter/rules/rules.yaml');
const CONTENT_DIR = path.join(__dirname, '../content/rules');
const OUT_DIR = path.join(__dirname, '../public/rules');
const LAYOUT_PATH = path.join(__dirname, '../src/layout.js');

// Same variable src/validate.js reads, so report.json's docUrl and the
// canonical tag on the page it points at can never disagree. It used to be a
// hardcoded 'https://example.dev/rules' placeholder from the time the domain
// was undecided (contract §8, since closed), and because web/public/ is
// generated and untracked, nothing ever looked at the output again: every one
// of the 30 pages shipped telling crawlers that the canonical version lived on
// a domain we do not own, which is an instruction not to index ours.
// Unset means unset: no canonical tag, no sitemap, no robots.txt. A missing
// canonical is harmless (a crawler self-canonicalises), a wrong one is an
// instruction to index someone else's URL instead of ours -- so the default
// has to be absence, not a guess. This is the same fail-safe direction as the
// waitlist sink in contract 9.23, and it matters here because the image runs
// this at build time, where a RUN step inherits nothing from the host.
const DOC_BASE = process.env.EINVOICE_DOC_BASE || null;
// Origin of DOC_BASE -- robots.txt and sitemap.xml sit at the site root, not
// under /rules, and deriving it here keeps one variable authoritative.
const SITE_ORIGIN = DOC_BASE ? new URL(DOC_BASE).origin : null;
const EXPECTED_RULE_COUNT = 30; // hard cap, not a target: the dictionary is
                                // deliberately fixed at 30 rules

// ---------------------------------------------------------------------------
// Minimal Markdown -> HTML (see app/web/content/README.md for the supported
// subset: ##/### headings, "- " lists with wrapped continuation lines,
// fenced code blocks, `inline code`, **bold**, [text](url) links. Nothing
// else — the content is ours, so it stays inside this subset by convention.)
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, href) => `<a href="${href}">${t}</a>`);
  return out;
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      html += `<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>\n`;
      continue;
    }

    if (line.startsWith('### ')) {
      html += `<h3>${renderInline(line.slice(4).trim())}</h3>\n`;
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      html += `<h2>${renderInline(line.slice(3).trim())}</h2>\n`;
      i++;
      continue;
    }

    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('- ')) {
          items.push(l.slice(2).trim());
          i++;
        } else if (l.trim() !== '' && items.length > 0) {
          // wrapped continuation line of the current list item
          items[items.length - 1] += ` ${l.trim()}`;
          i++;
        } else {
          break;
        }
      }
      html += `<ul>\n${items.map((it) => `<li>${renderInline(it)}</li>`).join('\n')}\n</ul>\n`;
      continue;
    }

    // paragraph: gather wrapped lines until a blank line or the next block
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('- ')
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    html += `<p>${renderInline(paraLines.join(' '))}</p>\n`;
  }

  return html;
}

// ---------------------------------------------------------------------------
// Front matter — NOT YAML (contract §9.25). Flat `key: value` lines, one per
// field; `bt` and `syntaxes` are comma-separated lists, `verified` is the
// literal string "true"/"false". See app/web/content/README.md.
// ---------------------------------------------------------------------------

const FRONT_MATTER_LIST_FIELDS = new Set(['bt', 'syntaxes']);

function parseFrontMatter(raw, filename) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${filename}: missing front matter (expected a leading "---" block)`);
  }
  const frontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const i = line.indexOf(':');
    if (i === -1) {
      throw new Error(`${filename}: malformed front matter line (expected "key: value"): ${line}`);
    }
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (FRONT_MATTER_LIST_FIELDS.has(key)) {
      frontMatter[key] = value === '' ? [] : value.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (key === 'verified') {
      frontMatter[key] = value === 'true';
    } else {
      frontMatter[key] = value;
    }
  }
  return { frontMatter, body: match[2] };
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

function renderRulePage({ id, frontMatter, bodyHtml }) {
  const bt = Array.isArray(frontMatter.bt) ? frontMatter.bt.map(escapeHtml).join(', ') : '';
  const syntaxes = Array.isArray(frontMatter.syntaxes) ? frontMatter.syntaxes.join(', ') : 'ubl, cii';
  const sourceLabel =
    frontMatter.source === 'PEPPOL' ? 'Peppol BIS Billing 3.0' : 'EN 16931 (CEN/TC 434)';
  const sourceUrl = frontMatter.sourceUrl || '';
  const ruleText = frontMatter.ruleText ? String(frontMatter.ruleText).trim() : '';

  const verifiedNotice =
    frontMatter.verified === false
      ? `<p class="rule-unverified"><strong>Not independently re-verified.</strong> ${escapeHtml(
          frontMatter.verifiedNote || 'Some detail on this page could not be confirmed against the source.'
        )}</p>\n`
      : '';

  return [
    '<article class="rule">',
    '  <header class="rule-header">',
    `    <p class="rule-id"><code>${escapeHtml(id)}</code></p>`,
    `    <h1>${escapeHtml(frontMatter.title || id)}</h1>`,
    '    <dl class="rule-meta">',
    `      <dt>Source</dt><dd>${escapeHtml(sourceLabel)}${
      sourceUrl ? ` — <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a>` : ''
    }</dd>`,
    `      <dt>Applies to</dt><dd>${escapeHtml(syntaxes)}</dd>`,
    `      <dt>Business terms</dt><dd>${bt || '—'}</dd>`,
    '    </dl>',
    ruleText ? `    <blockquote class="rule-text">${renderInline(ruleText)}</blockquote>` : '',
    '  </header>',
    verifiedNotice,
    bodyHtml,
    `  <p class="rule-footer"><a href="./index.html">&larr; All rules</a></p>`,
    '</article>',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderIndexPage(pages) {
  const rows = pages
    .map(
      (p) =>
        `      <tr><td><a href="./${escapeHtml(p.id)}.html"><code>${escapeHtml(p.id)}</code></a></td>` +
        `<td>${escapeHtml(p.title)}</td><td>${escapeHtml(p.severity || '')}</td></tr>`
    )
    .join('\n');

  return [
    '<article>',
    '  <h1>Rule reference</h1>',
    `  <p>${pages.length} validation rules from EN 16931 and Peppol BIS Billing 3.0 — what each one checks, ` +
      'the implementation mistakes that usually cause it, and how to fix it.</p>',
    '  <table class="rule-index">',
    '    <thead><tr><th>Rule</th><th>What it checks</th><th>Severity</th></tr></thead>',
    '    <tbody>',
    rows,
    '    </tbody>',
    '  </table>',
    '</article>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function generate({
  layoutPage,
  quiet = false,
  rulesYamlPath = RULES_YAML,
  contentDir = CONTENT_DIR,
  outDir = OUT_DIR,
} = {}) {
  if (!layoutPage) {
    const layoutUrl = pathToFileURL(LAYOUT_PATH).href;
    let layoutModule;
    try {
      layoutModule = await import(layoutUrl);
    } catch (err) {
      throw new Error(
        `gen-rules: could not import app/web/src/layout.js (${err.code || err.message}). ` +
          'That module is owned by [D1] (contract §9.21) — if it does not exist yet, pass a ' +
          'stub via generate({ layoutPage }) instead of running this file directly.'
      );
    }
    layoutPage = layoutModule.page;
  }
  if (typeof layoutPage !== 'function') {
    throw new Error('gen-rules: layout.page is not a function (check app/web/src/layout.js exports { page })');
  }

  const dict = loadRules(rulesYamlPath);
  const dictIds = Object.keys(dict).sort();

  let contentFiles;
  try {
    contentFiles = (await readdir(contentDir)).filter((f) => f.endsWith('.md'));
  } catch (err) {
    throw new Error(`gen-rules: could not read ${contentDir} (${err.code || err.message})`);
  }
  const contentIds = contentFiles.map((f) => f.replace(/\.md$/, '')).sort();

  // contract §9.19: the dictionary and the content directory must describe
  // exactly the same set of rule IDs. Fail loudly, not silently, on either
  // direction of mismatch.
  const missingContent = dictIds.filter((id) => !contentIds.includes(id));
  const orphanContent = contentIds.filter((id) => !dictIds.includes(id));
  if (missingContent.length > 0 || orphanContent.length > 0) {
    const lines = ['gen-rules: rules.yaml and app/web/content/rules/ do not match.'];
    if (missingContent.length > 0) {
      lines.push(`  Rules in rules.yaml with no content file: ${missingContent.join(', ')}`);
    }
    if (orphanContent.length > 0) {
      lines.push(`  Content files with no matching rule in rules.yaml: ${orphanContent.join(', ')}`);
    }
    throw new Error(lines.join('\n'));
  }

  if (dictIds.length !== EXPECTED_RULE_COUNT) {
    throw new Error(
      `gen-rules: expected exactly ${EXPECTED_RULE_COUNT} rules, ` +
        `found ${dictIds.length}: ${dictIds.join(', ')}`
    );
  }

  await mkdir(outDir, { recursive: true });

  const pages = [];
  for (const id of dictIds) {
    const filePath = path.join(contentDir, `${id}.md`);
    const raw = await readFile(filePath, 'utf8');
    const { frontMatter, body } = parseFrontMatter(raw, `${id}.md`);

    if (frontMatter.id !== id) {
      throw new Error(
        `gen-rules: ${id}.md front matter has id "${frontMatter.id}", expected "${id}" (must match the filename)`
      );
    }

    const bodyHtml = renderMarkdown(body);
    const title = frontMatter.title || dict[id]?.title || id;
    const severity = frontMatter.severity || dict[id]?.severity || '';

    const html = layoutPage({
      title: `${id} — ${title}`,
      description: `What ${id} checks, why it fires, and how to fix it, with example XML. prufix rule reference.`,
      canonical: DOC_BASE ? `${DOC_BASE}/${id}` : null,
      body: renderRulePage({ id, frontMatter, bodyHtml }),
      nav: 'rules',
    });

    await writeFile(path.join(outDir, `${id}.html`), html, 'utf8');
    pages.push({ id, title, severity });
  }

  const indexHtml = layoutPage({
    title: 'Rule reference',
    description: 'Reference pages for every EN 16931 / Peppol BIS rule prufix explains.',
    canonical: DOC_BASE ? `${DOC_BASE}/` : null,
    body: renderIndexPage(pages),
    nav: 'rules',
  });
  await writeFile(path.join(outDir, 'index.html'), indexHtml, 'utf8');

  // A page with no inbound link and no sitemap entry may simply never be
  // crawled: being reachable over HTTP is not the same as being findable.
  // These two files are the only part of that we can supply ourselves.
  const siteDir = path.join(outDir, '..');
  if (!DOC_BASE) {
    if (!quiet) {
      console.log(`gen-rules: wrote ${pages.length} rule pages + index.html to ${outDir}`);
      console.log('gen-rules: EINVOICE_DOC_BASE is unset -- no canonical tags, no sitemap.xml, no robots.txt');
    }
    return { count: pages.length, ids: dictIds, outDir };
  }
  const urls = [
    `${SITE_ORIGIN}/`,
    `${DOC_BASE}/`,
    ...pages.map((pg) => `${DOC_BASE}/${pg.id}`),
  ];
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  await writeFile(path.join(siteDir, 'sitemap.xml'), sitemap, 'utf8');

  // /waitlist is excluded: it is a form, it has nothing to rank for, and a
  // crawler following it adds nothing. Everything else is allowed.
  const robots = [
    'User-agent: *',
    'Disallow: /waitlist',
    'Allow: /',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
  await writeFile(path.join(siteDir, 'robots.txt'), robots, 'utf8');

  if (!quiet) {
    console.log(`gen-rules: wrote ${pages.length} rule pages + index.html to ${outDir}`);
    console.log(`gen-rules: wrote sitemap.xml (${urls.length} urls) + robots.txt, canonical base ${DOC_BASE}`);
  }

  return { count: pages.length, ids: dictIds, outDir };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  generate().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}
