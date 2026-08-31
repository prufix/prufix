'use strict';

/**
 * HTML fragments passed into layout.page({ body: ... }) for [D1]'s own
 * routes. Kept separate from server.js so the routing/HTTP logic stays
 * readable.
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

const PROFILE_OPTIONS = [
  ['auto', 'Auto-detect'],
  ['en16931', 'EN 16931 core'],
  ['peppol-bis-3.0.21', 'Peppol BIS Billing 3.0.21'],
  ['xrechnung-3.0.2', 'XRechnung 3.0.2'],
  ['facturx', 'Factur-X / ZUGFeRD (PDF)'],
];

function homeBody() {
  const options = PROFILE_OPTIONS.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('\n      ');

  return `
<section class="hero">
  <h1>See what's actually wrong with your e-invoice</h1>
  <p class="lede">Drop a UBL, CII, or Factur-X PDF invoice below. It is validated against the official EN&nbsp;16931, Peppol&nbsp;BIS, XRechnung, or Factur-X rules, and every failed rule is shown with <em>your</em> actual values pulled out of the document &mdash; not just a rule ID and a definition.</p>
</section>

<section class="validator" aria-label="Validate an e-invoice">
  <label for="ec-profile">Profile</label>
  <select id="ec-profile">
      ${options}
  </select>

  <div id="ec-dropzone" class="ec-dropzone" tabindex="0" role="button" aria-label="Choose or drop an invoice file to validate">
    <p class="ec-dropzone-text">Drop an XML or PDF invoice here, or <span class="ec-link-like">choose a file</span></p>
    <p id="ec-file-label" class="ec-file-label" aria-live="polite"></p>
    <input id="ec-file-input" type="file" accept=".xml,.pdf,application/xml,application/pdf" hidden>
  </div>

  <p class="ec-validator-actions">
    <button id="ec-run-btn" type="button" disabled>Validate again</button>
  </p>

  <noscript><p class="ec-form-error">This page needs JavaScript to upload and validate a file. You can also validate from the command line &mdash; see below.</p></noscript>

  <div id="ec-results" class="ec-results" aria-live="polite"></div>
</section>

<section class="ec-how">
  <h2>What you get that a bare validator does not</h2>
  <div class="ec-compare">
    <div>
      <h3>A typical validator</h3>
      <pre>[ERROR] BR-CO-13
  Invoice total amount without VAT (BT-109) =
  sum of Invoice line net amount (BT-131) - ...
  location: /ubl:Invoice[1]/cac:LegalMonetaryTotal[1]</pre>
    </div>
    <div>
      <h3>Prufix</h3>
      <pre>x BR-CO-13  Total amount does not match the line items

  BT-109 (TaxExclusiveAmount) states  1,180.00
  but the line items sum to           1,240.00
  ...</pre>
    </div>
  </div>
  <p class="muted">The verdicts come from the official Schematron/KoSIT rules; the explanation layer is ours. Uploaded documents are validated and discarded &mdash; nothing is written to a database, and the file itself is deleted immediately after the report is produced.</p>
</section>

<section class="ec-cli">
  <h2>Prefer the command line?</h2>
  <p>The endpoint takes the raw document as the request body &mdash; no multipart, no SDK.</p>
  <pre id="ec-curl-example"></pre>
  <p class="muted">Send <code>Accept: text/plain</code> for a terminal-formatted report instead of JSON. The same checks also run as a GitHub Action on every pull request.</p>
</section>

<script>
(function () {
  "use strict";
  var profileSelect = document.getElementById("ec-profile");
  var dropzone = document.getElementById("ec-dropzone");
  var fileInput = document.getElementById("ec-file-input");
  var fileLabel = document.getElementById("ec-file-label");
  var runBtn = document.getElementById("ec-run-btn");
  var results = document.getElementById("ec-results");
  var curlBox = document.getElementById("ec-curl-example");
  var currentFile = null;

  function humanSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  function updateCurl() {
    curlBox.textContent =
      "curl --data-binary @invoice.xml \\\\\\n  \\"" +
      window.location.origin +
      "/api/validate?profile=" +
      profileSelect.value +
      "\\"";
  }
  profileSelect.addEventListener("change", function () {
    updateCurl();
    if (currentFile) validate(currentFile);
  });
  updateCurl();

  function setFile(f) {
    currentFile = f;
    fileLabel.textContent = f.name + " (" + humanSize(f.size) + ")";
    dropzone.classList.add("has-file");
    runBtn.disabled = false;
    validate(f);
  }

  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("dragover"); });
  });
  dropzone.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setFile(f);
  });
  runBtn.addEventListener("click", function () { if (currentFile) validate(currentFile); });

  function validate(file) {
    results.innerHTML = "";
    var p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Validating\\u2026";
    results.appendChild(p);

    fetch("/api/validate?profile=" + encodeURIComponent(profileSelect.value), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Accept: "application/json" },
      body: file,
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
          if (!res.ok) {
            var msg = (data && data.error) || text || (res.status + " " + res.statusText);
            renderError(res.status, msg);
            return;
          }
          renderReport(data);
        });
      })
      .catch(function (e) {
        renderError(0, "Could not reach the validator: " + e.message);
      });
  }

  function renderError(status, msg) {
    results.innerHTML = "";
    var box = document.createElement("div");
    box.className = "ec-finding error";
    var head = document.createElement("div");
    head.className = "ec-finding-head";
    var badge = document.createElement("span");
    badge.className = "ec-badge ec-badge-error";
    badge.textContent = status || "error";
    var title = document.createElement("span");
    title.className = "ec-finding-title";
    title.textContent = msg;
    head.appendChild(badge);
    head.appendChild(title);
    box.appendChild(head);
    results.appendChild(box);
  }

  function renderReport(report) {
    results.innerHTML = "";
    var file = report.files[0];
    var passed = report.summary.passed;

    var summary = document.createElement("p");
    summary.className = "ec-result-summary " + (passed ? "ok" : "bad");
    var parts = [];
    parts.push(passed ? "No errors found" : (file.errors + " error" + (file.errors === 1 ? "" : "s")));
    if (file.warnings) parts.push(file.warnings + " warning" + (file.warnings === 1 ? "" : "s"));
    summary.textContent = parts.join(", ") + " \\u2014 profile " + report.profile + ", document type " + file.documentType;
    results.appendChild(summary);

    if (file.findings.length === 0) {
      var okp = document.createElement("p");
      okp.className = "muted";
      okp.textContent = "No issues found.";
      results.appendChild(okp);
      return;
    }

    file.findings.forEach(function (f) { results.appendChild(renderFinding(f)); });
  }

  function renderFinding(f) {
    var div = document.createElement("div");
    div.className = "ec-finding " + f.severity;

    var head = document.createElement("div");
    head.className = "ec-finding-head";
    var badge = document.createElement("span");
    badge.className = "ec-badge ec-badge-" + f.severity;
    badge.textContent = f.severity;
    var id = document.createElement("code");
    id.textContent = f.id;
    var title = document.createElement("span");
    title.className = "ec-finding-title";
    title.textContent = f.title;
    head.appendChild(badge);
    head.appendChild(id);
    head.appendChild(title);
    div.appendChild(head);

    if (f.enriched && f.explain) {
      var pre = document.createElement("pre");
      pre.className = "ec-finding-explain";
      pre.textContent = f.explain;
      div.appendChild(pre);
    } else if (f.originalText && f.originalText !== f.title) {
      var op = document.createElement("p");
      op.className = "muted small";
      op.textContent = f.originalText;
      div.appendChild(op);
    }
    if (!f.enriched) {
      var note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "We do not have a plain-English explanation for this rule yet \\u2014 this is the validator's own message.";
      div.appendChild(note);
    }
    (f.hints || []).forEach(function (h) {
      var hint = document.createElement("p");
      hint.className = "ec-finding-hint small";
      hint.textContent = "Hint: " + h;
      div.appendChild(hint);
    });

    var meta = document.createElement("p");
    meta.className = "ec-finding-meta small muted";
    meta.appendChild(document.createTextNode("Location: " + f.location));
    if (f.docUrl) {
      meta.appendChild(document.createTextNode(" \\u00b7 "));
      var a = document.createElement("a");
      a.href = f.docUrl;
      a.textContent = "What does " + f.id + " mean?";
      meta.appendChild(a);
    }
    div.appendChild(meta);
    return div;
  }
})();
</script>
`;
}

function waitlistBody(opts) {
  const { error, email, profile } = opts || {};
  const options = PROFILE_OPTIONS.filter(([v]) => v !== 'auto')
    .concat([['auto', 'Not sure / several']])
    .map(([v, label]) => `<option value="${v}"${profile === v ? ' selected' : ''}>${esc(label)}</option>`)
    .join('\n      ');

  return `
<section class="hero">
  <h1>Join the waitlist</h1>
  <p class="lede">The next thing we are building on top of this validator: it re-checks your invoices against every new validator version, and tells you which ones stop validating &mdash; before the version becomes mandatory. Tell us which profile gives you the most trouble and we will follow up.</p>
</section>

<form class="ec-waitlist-form" method="post" action="/waitlist">
  <label for="ec-email">Email</label>
  <input id="ec-email" name="email" type="email" required maxlength="254" placeholder="you@example.com" value="${esc(email || '')}">

  <label for="ec-wl-profile">Which profile are you struggling with?</label>
  <select id="ec-wl-profile" name="profile">
      ${options}
  </select>

  ${error ? `<p class="ec-form-error" role="alert">${esc(error)}</p>` : ''}

  <p class="ec-validator-actions"><button type="submit">Join the waitlist</button></p>
</form>
`;
}

function waitlistThanksBody() {
  return `
<section class="hero">
  <h1>You're on the list</h1>
  <p class="lede">Thanks &mdash; we'll reach out when the version checks are ready. In the meantime, the <a href="/">validator</a> is free to use for as many documents as you like.</p>
</section>
`;
}

function notFoundBody() {
  return `
<section class="hero">
  <h1>Page not found</h1>
  <p class="lede">That page does not exist. Back to the <a href="/">validator</a>.</p>
</section>
`;
}

module.exports = { homeBody, waitlistBody, waitlistThanksBody, notFoundBody };
