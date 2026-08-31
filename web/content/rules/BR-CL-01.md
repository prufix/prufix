---
id: BR-CL-01
title: Invoice type code is not from the allowed code list
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: The document type code MUST be coded by the invoice and credit note related code lists of UNTDID 1001.
bt: BT-3
syntaxes: ubl, cii
verified: true
verifiedNote: Rule text and BT-3 binding confirmed via WebFetch against docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/. The full list of Peppol-permitted codes below was fetched from docs.peppol.eu/poacc/billing/3.0/codelist/UNCL1001-inv/ via WebFetch (an automated content extraction, not a byte-for-byte diff against the published codelist) — treat the exact code set as a good-faith summary, and check the current list at that URL before relying on an edge case.
---

## Definition

BT-3, the invoice type code, must be a value from the UN/CEFACT UNTDID 1001
code list, restricted to the subset Peppol BIS Billing 3.0 permits for
invoices and credit notes. This is a **code list** rule: the element can be
present and non-empty and still fail, if its value isn't in the permitted
set — unlike a missing-field rule (`BR-01`–`BR-06`), the fix here is
choosing the *right* code, not just supplying *a* code.

## Common causes

- **A code from a different UNTDID 1001 subset** (e.g. one valid for
  waybills or a different document family) copied from an unrelated
  integration or a stale reference table that wasn't restricted to the
  invoice/credit-note subset.
- **An invoice using a credit-note-only code, or the reverse** — the
  permitted set differs by document type: `380` (commercial invoice) is not
  valid on a `cac:CreditNote`, and `381` (credit note) is not valid on a
  `cac:Invoice`. Reusing one generation path for both document types without
  branching the type code is a common source.
- **A numeric-looking but invalid code** typed by hand, or an off-by-one
  copy of a neighboring valid code (e.g. `382` instead of `380`).

Some of the more common codes actually seen on Peppol invoices: `380`
(commercial invoice), `384` (corrected invoice), `389` (self-billed
invoice), `381` (credit note, used on `cac:CreditNote` documents).

## How to fix it

Set the type code to a value from the Peppol-restricted UNTDID 1001
invoice/credit-note subset, matching the document element used
(`cac:Invoice` vs. `cac:CreditNote`, or the CII document type code).

- **UBL**: `cbc:InvoiceTypeCode` on `Invoice`, `cbc:CreditNoteTypeCode` on
  `CreditNote`.
- **CII**: `ram:TypeCode` under `rsm:ExchangedDocument` (CII has a single
  document type, distinguished by the code value rather than by a different
  root element).

## Example

### UBL — wrong

```xml
<Invoice ...>
  <cbc:InvoiceTypeCode>381</cbc:InvoiceTypeCode>  <!-- 381 = credit note, not valid on Invoice -->
  ...
</Invoice>
```

### UBL — correct

```xml
<Invoice ...>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ...
</Invoice>
```

### CII — correct

```xml
<rsm:ExchangedDocument>
  <ram:ID>INV-2026-0001</ram:ID>
  <ram:TypeCode>380</ram:TypeCode>
</rsm:ExchangedDocument>
```

## Verification note

The exact rule text and BT-3 binding were confirmed directly against
`docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/`. The list of permitted
codes above came back through an automated fetch-and-summarize of the
Peppol codelist page rather than a direct byte comparison; treat it as
indicative and check the live codelist at
`docs.peppol.eu/poacc/billing/3.0/codelist/UNCL1001-inv/` for the
authoritative, current set before relying on a code not shown here.
