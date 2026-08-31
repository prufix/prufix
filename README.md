# Prufix

**An e-invoice linter for CI.**

Your code generates e-invoices. Every free validator can tell you *that* rule
BR-CO-13 failed — this action reads your document, pulls out the actual
values, and shows you the arithmetic that went wrong, on every pull request.

It validates EN 16931, Peppol BIS Billing 3.0, XRechnung and Factur-X
documents using the official, unmodified rulesets from the standards bodies,
then translates each failed rule into an explanation with your numbers in it.

## The difference, in one error

What a typical validator prints:

```
[ERROR] BR-CO-13
  Invoice total amount without VAT (BT-109) = sum of Invoice line net amount (BT-131)
  - sum of Document level allowance amount (BT-92) + sum of Document level charge amount (BT-99)
  location: /ubl:Invoice[1]/cac:LegalMonetaryTotal[1]
```

That is the rule's definition, quoted back at you. It does not say which of
*your* values is wrong.

What this action prints for the same document:

```
x BR-CO-13  Total amount does not match the line items

  BT-109 (TaxExclusiveAmount) states  1,180.00
  but the line items sum to           1,240.00
  difference                             60.00

  Invoice lines      1,240.00   (3 lines)
  Document allowance   -60.00   (BT-92)
  Document charge        0.00   (BT-99)
  ---------------------------
  Expected           1,180.00   <- this matches

  Hint: BT-92 is negative. Allowances must be entered as a positive
        number; the formula subtracts them. A negative value is
        subtracted twice.

  Location: /ubl:Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount
```

The verdicts come from the official Schematron rules; the explanation layer
is ours. Rules we have not yet written an explanation for are shown with the
original message — never less than what the standard validators give you.

## Quickstart

```yaml
name: validate-invoices
on: pull_request

permissions:
  contents: read
  pull-requests: write   # only needed for `comment: true`

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: prufix/prufix@v1
        with:
          path: 'test/fixtures/**/*.xml'
          profile: 'peppol-bis-3.0.21'
          fail-on: 'error'
          comment: true
```

Every run writes a job summary with a per-rule table and per-file detail.
With `comment: true`, the findings also land as a single PR comment that is
updated in place on each push — no comment spam.

## Inputs

| Input | Default | Description |
|---|---|---|
| `path` | *(required)* | Glob pattern(s) selecting files to validate, one per line, relative to the workspace. Supports `**`. |
| `profile` | `auto` | `en16931`, `peppol-bis-3.0.21`, `xrechnung-3.0.2`, `facturx`, or `auto` (detect from the root element and namespace). |
| `fail-on` | `error` | `error` fails the step on any error-severity finding; `warning` fails on any finding at all; `never` reports without failing. A broken toolchain fails the step regardless — a tool crash never reports green. |
| `comment` | `true` | Post/update the PR comment. Skipped silently outside pull-request events. |
| `token` | `github.token` | Token used for the PR comment. You rarely need to set this. |

## Outputs

| Output | Description |
|---|---|
| `report` | Merged validation report for all files, as JSON (schema v1): per-file findings with rule id, severity, location, original rule text, and — where we have an explanation template — the extracted values and hints. |
| `errors` | Total error-severity findings. |
| `warnings` | Total warning-severity findings. |
| `files-checked` | Number of files validated. |
| `passed` | `true` if there were no error-severity findings. Independent of `fail-on`. |

Using the report downstream:

```yaml
      - uses: prufix/prufix@v1
        id: invoices
        with:
          path: 'out/**/*.xml'
          fail-on: 'never'
      - name: Count Peppol-specific findings
        run: |
          echo '${{ steps.invoices.outputs.report }}' \
            | jq '[.files[].findings[] | select(.id | startswith("PEPPOL"))] | length'
```

## Profiles

| `profile` | What runs | Validation artifacts by |
|---|---|---|
| `en16931` | EN 16931 core Schematron; UBL or CII detected from the root element | ConnectingEurope ([eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931)) |
| `peppol-bis-3.0.21` | Peppol BIS Billing 3.0.21 rules (which include EN 16931) | [OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/) |
| `xrechnung-3.0.2` | KoSIT validator with the XRechnung 3.0.2 configuration | KoSIT ([validator](https://github.com/itplr-kosit/validator), [configuration](https://github.com/itplr-kosit/validator-configuration-xrechnung)) |
| `facturx` | XML extracted from the PDF/A-3, then EN 16931 CII Schematron | [Mustangproject](https://github.com/ZUGFeRD/mustangproject) (extraction) + ConnectingEurope |
| `auto` | Picks one of the above per file from the root element and namespace; errors when it cannot decide | — |

All ruleset versions are pinned inside the Docker image at build time, and
nothing is downloaded at run time — the action works in network-restricted
runners, and a ruleset can't change underneath you between runs.

### Per-profile examples

```yaml
# XRechnung (German public sector)
      - uses: prufix/prufix@v1
        with:
          path: 'invoices/**/*.xml'
          profile: 'xrechnung-3.0.2'
```

```yaml
# Factur-X / ZUGFeRD: point `path` at the PDFs
      - uses: prufix/prufix@v1
        with:
          path: 'invoices/**/*.pdf'
          profile: 'facturx'
```

```yaml
# Mixed fixtures: let each file pick its own profile
      - uses: prufix/prufix@v1
        with:
          path: |
            fixtures/peppol/**/*.xml
            fixtures/xrechnung/**/*.xml
          profile: 'auto'
```

## How failures are decided

- A **failed rule** becomes a finding (`error` or `warning`, as the ruleset
  flags it). `fail-on` decides whether findings fail the step.
- A **file that cannot be parsed** as XML (or as a PDF with embedded XML, for
  `facturx`) is reported as an error-severity finding (`INPUT-INVALID`)
  against that file, and the remaining files are still validated.
- A **toolchain failure** (unknown profile, missing dependency, validator
  crash) aborts the run with a non-zero exit regardless of `fail-on`. A
  broken validator that silently reports "all green" is the worst possible
  outcome, so it is structurally impossible here.
- **Zero matched files** is a hard failure with an explicit message, for the
  same reason.

## PR comments

The action maintains **one** comment per pull request, identified by a hidden
marker, and edits it in place on re-runs. Notes:

- Needs `pull-requests: write` in the workflow's `permissions` block.
- On pull requests from forks, `GITHUB_TOKEN` is read-only; the action logs
  a warning and skips the comment instead of failing the build. The job
  summary always has the full report.
- Outside pull-request events the comment step is skipped silently.
- Two action steps with `comment: true` in the same workflow will fight over
  the same comment; give at most one step `comment: true`.

Long reports are truncated in the comment (GitHub caps comment size); the
job summary holds more, and the `report` output always has everything.

## What this action does not do

- **Generate or convert invoices.** Excellent free libraries already do this:
  [Mustangproject](https://github.com/ZUGFeRD/mustangproject) (Java, also a
  REST server), [horstoeko/zugferd](https://github.com/horstoeko/zugferd)
  (PHP), [akretion/factur-x](https://github.com/akretion/factur-x) (Python).
  If you generate invoices with one of them, this action is the CI check for
  what they produce — they build it, we check it.
- **Send invoices.** Peppol Access Points and the French PDP/PA ecosystem are
  a different, regulated job.
- **Store your invoices.** Validation runs inside the container on your
  runner; documents are read, validated, and discarded. Nothing is uploaded
  anywhere.
- **Give legal or tax advice.** The action reports "rule X failed and here is
  why, arithmetically." Whether an invoice is legally sufficient in a given
  jurisdiction is a question for a professional.
- **Guarantee anything.** Passing this check means your documents were
  validated against the named rulesets and no issues were found — no more,
  no less. Acceptance ultimately depends on the receiving platform.

## Credits

The validation rules and tools this action runs are built and maintained by
[KoSIT](https://github.com/itplr-kosit) (XRechnung),
[OpenPeppol](https://peppol.org) (Peppol BIS),
ConnectingEurope / the EU's eInvoicing work (EN 16931 Schematron), and
[Mustangproject](https://github.com/ZUGFeRD/mustangproject) (Factur-X
extraction). This action packages them unmodified and adds the explanation
layer on top.

## License

[MIT](LICENSE).
