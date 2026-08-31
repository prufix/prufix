# `app/web/content/`

Source content for the static `/rules/<id>` pages. This directory is prose. It is **not** read at
validation time — only `app/web/tools/gen-rules.mjs` reads it, at build time,
to produce `app/web/public/rules/*.html`.

## `rules/<RULE-ID>.md`

One file per rule in `app/formatter/rules/rules.yaml`. The generator fails the
build if the two sets (dictionary keys vs. content filenames) don't match
exactly — see contract §9.19. There must be exactly 30.

Each file is front matter (`---` delimited) followed by a Markdown body.
**The front matter is deliberately not YAML** (contract §9.25 — a generator
reaching for a YAML dependency just to parse a format it invented itself was
ruled unnecessary fragility). It's a flat `key: value` list, one field per
line, parsed by ~20 lines of code in `gen-rules.mjs` (`parseFrontMatter`):
split each line on the first `:`, trim; `bt` and `syntaxes` are split again
on `,`; `verified` is the literal string `true`/`false`. No quoting, no
nesting, no multi-line values — keep every value on one line. The body is
rendered by the generator's own minimal Markdown subset (see below) — no
Markdown dependency either.

### Front matter fields

```
---
id: BR-CO-13
title: Total amount does not match the line items
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: The exact published rule text, quoted, as it appears at sourceUrl, on one line.
bt: BT-109, BT-131, BT-107, BT-108
syntaxes: ubl, cii
verified: true
verifiedNote:
---
```

| Field | Meaning |
|---|---|
| `id` | Must equal the filename (without `.md`) and the `rules.yaml` key. |
| `title` | Should match `rules.yaml`'s title for this rule. |
| `severity` | Informational only, per contract §5/§9.9 — real severity comes from the SVRL `@flag`. |
| `source` | `TC434` or `PEPPOL` — which rule table this ID is published in. |
| `sourceUrl` | The page it was verified against. |
| `ruleText` | The exact published rule text, quoted, on a single line (colons inside it — e.g. a URN — are fine; only the *first* colon in the line is the key/value separator). |
| `bt` | Comma-separated BT/BG numbers this rule touches, for cross-linking / search. |
| `syntaxes` | Comma-separated; which syntaxes this rule applies to. Peppol-only rules: `ubl`. |
| `verified` | `true`/`false` — was `ruleText` independently confirmed against `sourceUrl` via WebFetch this session? |
| `verifiedNote` | Required (non-empty) when `verified` is `false`: what couldn't be confirmed, and how the page body hedges it. Leave the line present but empty (`verifiedNote:`) when `verified` is `true`. |

`verified: false` is not a build error — it is an honest flag. When it is
false, the page body must say so in its own words rather than asserting the
rule text with unearned confidence (per the task brief: "if you cannot verify
something, say so on the page").

### Body structure

Fixed section order, identical across all 30 files:

```markdown
## Definition

One or two paragraphs: what the rule checks, in plain language, referencing
the BT/BG numbers involved.

## Common causes

- A bulleted list of *specific* implementation mistakes that actually produce
  this finding (a rounding step, a sign convention, a wrong element, a moved
  code list) — not generic advice.

## How to fix it

Concrete, actionable steps. Syntax-specific where UBL and CII differ.

## Example

### Wrong

A minimal, realistic XML fragment (real element/namespace names) that
triggers the rule.

### Correct

The same fragment, fixed.

(When UBL and CII differ meaningfully for this rule, the Wrong/Correct pair
appears twice, under `### UBL — wrong` / `### UBL — correct` /
`### CII — wrong` / `### CII — correct` instead.)
```

A trailing `## Verification note` section appears only on pages where
`verified: false`, spelling out what is uncertain.

### Supported Markdown subset (by design, not a missing feature)

The generator's renderer supports only what these files use: `##`/`###`
headings, paragraphs, `-` bullet lists, fenced code blocks (` ``` `, with an
optional language tag — `xml` gets no client-side highlighting, just a
`<pre><code>` block), `` `inline code` ``, `**bold**`, and `[text](url)`
links. Nothing else (no tables, no nested lists, no HTML passthrough). Keep
new files inside this subset.

## Placeholders (contract §8)

Product name and domain are undecided. Content and generator both use
`prufix` and `example.dev` — never a real name, org, or domain.
