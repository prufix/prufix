'use strict';

/**
 * Shared page shell for the whole web surface (contract §9.21).
 *
 * Owner: [D1]. Consumed by [D1]'s own routes (/, /waitlist) and by [D2]'s
 * static generator for the 30 /rules/<id> pages. The signature is frozen by
 * the internal design contract — do not change it unilaterally.
 *
 * Self-contained: <style> is inline, no external CSS file, no external
 * fonts, no JS injected here (pages that need JS write their own <script>
 * in `body`). English only.
 *
 * @param {{ title:string, description:string, canonical?:string|null,
 *           body:string, nav:'validator'|'rules'|'waitlist'|null }} o
 * @returns {string} one complete HTML5 document.
 */
function page(o) {
  const title = o && o.title != null ? String(o.title) : '';
  const description = o && o.description != null ? String(o.description) : '';
  const canonical = o && o.canonical ? String(o.canonical) : null;
  const body = o && o.body != null ? String(o.body) : '';
  const nav = o && o.nav ? String(o.nav) : null;

  // Search Console verifies a URL-prefix property by looking for this tag in
  // the <head> of the property's homepage. It is a property of the deployment,
  // not of any one page, so it is read here rather than added to the signature
  // above, which contract 9.21 freezes. Read per call, not once at require()
  // time: that makes setting it a Cloud Run env update instead of an image
  // rebuild, which matters because the static /rules pages are baked at build
  // time while `/` -- the only page verification looks at -- is not.
  const verification = process.env.EINVOICE_SITE_VERIFICATION || '';

  const navLink = (href, label, key) =>
    `<a href="${href}"${nav === key ? ' class="current" aria-current="page"' : ''}>${esc(label)}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} — Prufix</title>
<meta name="description" content="${esc(description)}">
${verification ? `<meta name="google-site-verification" content="${esc(verification)}">\n` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ''}<style>
${CSS}
</style>
</head>
<body>
<div class="ec-shell">
<header class="ec-header">
  <a class="ec-brand" href="/">
    <span class="ec-brand-mark" aria-hidden="true">P</span>Prufix
  </a>
  <nav class="ec-nav" aria-label="Primary">
    ${navLink('/', 'Validator', 'validator')}
    ${navLink('/rules/', 'Rules', 'rules')}
    ${navLink('/waitlist', 'Waitlist', 'waitlist')}
  </nav>
</header>
<main class="ec-main">
${body}
</main>
<footer class="ec-footer">
  <p>Prufix validates against the official EN&nbsp;16931, Peppol&nbsp;BIS, XRechnung and Factur-X rulesets and does not store the documents you validate. Passing a check means the document was validated and no issues were found — it is not a guarantee of acceptance by any receiving platform.</p>
</footer>
</div>
</body>
</html>
`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

const CSS = `
:root {
  --ec-bg: #ffffff;
  --ec-bg-alt: #f5f6f8;
  --ec-bg-raised: #ffffff;
  --ec-text: #14161b;
  --ec-text-muted: #5b6270;
  --ec-border: #e0e3e9;
  --ec-accent: #1a56db;
  --ec-accent-contrast: #ffffff;
  --ec-error: #b3261e;
  --ec-error-bg: #fdecea;
  --ec-error-border: #f2c6c2;
  --ec-warning: #7a5b06;
  --ec-warning-bg: #fdf3d9;
  --ec-warning-border: #efd68a;
  --ec-ok: #146c43;
  --ec-ok-bg: #e8f6ee;
  --ec-code-bg: #12141a;
  --ec-code-text: #e8eaf0;
  --ec-radius: 10px;
  --ec-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --ec-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-ec-theme="light"]) {
    --ec-bg: #0c0e13;
    --ec-bg-alt: #12151c;
    --ec-bg-raised: #171a22;
    --ec-text: #e7e9ee;
    --ec-text-muted: #9aa1b1;
    --ec-border: #262b36;
    --ec-accent: #6d97ff;
    --ec-accent-contrast: #0c0e13;
    --ec-error: #ff8478;
    --ec-error-bg: #2a1512;
    --ec-error-border: #5a2822;
    --ec-warning: #f0c04d;
    --ec-warning-bg: #2a2210;
    --ec-warning-border: #574a1c;
    --ec-ok: #6bd39a;
    --ec-ok-bg: #102a1c;
    --ec-code-bg: #08090c;
    --ec-code-text: #e7e9ee;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--ec-bg);
  color: var(--ec-text);
  font-family: var(--ec-sans);
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--ec-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.ec-shell { display: flex; flex-direction: column; min-height: 100vh; }
.ec-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--ec-border);
  flex-wrap: wrap;
}
.ec-brand {
  display: flex; align-items: center; gap: 0.5rem;
  font-weight: 700; font-size: 1.05rem; color: var(--ec-text);
}
.ec-brand:hover { text-decoration: none; }
.ec-brand-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.6rem; height: 1.6rem; border-radius: 6px;
  background: var(--ec-accent); color: var(--ec-accent-contrast);
  font-family: var(--ec-mono); font-weight: 700; font-size: 0.95rem;
}
.ec-nav { display: flex; gap: 1.25rem; align-items: center; }
.ec-nav a {
  color: var(--ec-text-muted); font-size: 0.95rem; font-weight: 500;
}
.ec-nav a.current, .ec-nav a[aria-current="page"] { color: var(--ec-text); }
.ec-main {
  flex: 1; width: 100%; max-width: 860px; margin: 0 auto;
  padding: 2.5rem 1.5rem 3rem;
}
.ec-footer {
  border-top: 1px solid var(--ec-border); padding: 1.5rem;
  color: var(--ec-text-muted); font-size: 0.85rem;
}
.ec-footer p { max-width: 860px; margin: 0 auto; }

h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.6rem; letter-spacing: -0.02em; }
h2 { font-size: 1.35rem; margin: 2.25rem 0 0.75rem; letter-spacing: -0.01em; }
h3 { font-size: 1.05rem; margin: 1.25rem 0 0.5rem; }
p { margin: 0 0 1rem; }
.lede { font-size: 1.1rem; color: var(--ec-text-muted); max-width: 62ch; }
.muted { color: var(--ec-text-muted); }
.small { font-size: 0.85rem; }
code {
  font-family: var(--ec-mono); font-size: 0.9em;
  background: var(--ec-bg-alt); padding: 0.1em 0.35em; border-radius: 4px;
}
pre {
  font-family: var(--ec-mono); font-size: 0.85rem; line-height: 1.5;
  background: var(--ec-code-bg); color: var(--ec-code-text);
  padding: 1rem 1.1rem; border-radius: var(--ec-radius);
  overflow-x: auto; white-space: pre; margin: 0.75rem 0;
}
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
th, td { text-align: left; padding: 0.5rem 0.7rem; border-bottom: 1px solid var(--ec-border); }
th { color: var(--ec-text-muted); font-weight: 600; }
hr { border: none; border-top: 1px solid var(--ec-border); margin: 2rem 0; }
ul, ol { padding-left: 1.3rem; }
blockquote {
  margin: 1rem 0; padding: 0.6rem 1rem; border-left: 3px solid var(--ec-accent);
  background: var(--ec-bg-alt); border-radius: 0 6px 6px 0; color: var(--ec-text-muted);
}

/* Buttons and form controls, shared by the validator and the waitlist form */
button, select, input[type="email"], input[type="text"] {
  font: inherit; color: inherit;
}
button {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--ec-accent); color: var(--ec-accent-contrast);
  border: none; border-radius: 8px; padding: 0.6rem 1.1rem;
  font-weight: 600; cursor: pointer;
}
button:hover { filter: brightness(1.08); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
select, input[type="email"], input[type="text"] {
  background: var(--ec-bg-raised); border: 1px solid var(--ec-border);
  border-radius: 8px; padding: 0.55rem 0.7rem; width: 100%;
}
label { display: block; font-weight: 600; font-size: 0.9rem; margin: 1rem 0 0.35rem; }
label:first-of-type { margin-top: 0; }

/* Badges for finding severity */
.ec-badge {
  display: inline-block; font-family: var(--ec-mono); font-size: 0.72rem;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem; border-radius: 5px; margin-right: 0.5rem;
}
.ec-badge-error { background: var(--ec-error-bg); color: var(--ec-error); border: 1px solid var(--ec-error-border); }
.ec-badge-warning { background: var(--ec-warning-bg); color: var(--ec-warning); border: 1px solid var(--ec-warning-border); }

@media (max-width: 640px) {
  .ec-header { padding: 0.85rem 1rem; }
  .ec-main { padding: 1.75rem 1rem 2.5rem; }
  h1 { font-size: 1.6rem; }
}
`;

module.exports = { page };
