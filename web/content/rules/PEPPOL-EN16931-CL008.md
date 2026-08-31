---
id: PEPPOL-EN16931-CL008
title: Electronic address scheme is not a valid Peppol code
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Electronic address identifier scheme must be from the codelist "Electronic Address Identifier Scheme".
bt: BT-34, BT-49
syntaxes: ubl
verified: true
verifiedNote: Rule text confirmed via WebFetch against docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/. The codelist name ("Electronic Address Scheme", commonly abbreviated EAS) and the example entries below came from a WebFetch of docs.peppol.eu/poacc/billing/3.0/codelist/eas/ (an automated summary, not a byte-for-byte diff) — check the live codelist for the current, complete set of codes rather than relying on the short list shown here.
---

## Definition

`PEPPOL-EN16931-R010` and `-R020` check that the buyer's (BT-49) and
seller's (BT-34) electronic addresses are *present*. This rule checks the
*scheme* of that address — the `schemeID` attribute on `cbc:EndpointID` —
against the Peppol Electronic Address Scheme (EAS) code list. An electronic
address with a made-up or wrong scheme identifier is meaningless: the Peppol
network uses the scheme to know *how* to interpret the identifier value
that follows it (a Norwegian org number is not looked up the same way as a
German VAT id).

This is a Peppol BIS Billing 3.0 addition (UBL-only); there is no CII
binding for this rule.

## Common causes

- **Using a random/internal scheme convention instead of the Peppol EAS
  code.** Some systems have their own internal enum for "what kind of ID is
  this" that predates the Peppol integration; that internal code gets
  written directly into `schemeID` instead of being mapped to the matching
  EAS code.
- **Right identifier, wrong scheme code** — e.g. a German VAT number
  written with `schemeID="0192"` (which is the Norwegian organisation
  number scheme) instead of `9930` (Germany VAT number). The identifier
  value itself may be well-formed and even correct for the company, but the
  scheme code tells the receiver how to parse and validate it, so a
  mismatched scheme still fails.
- **Scheme code as a bare number without the leading context Peppol
  expects**, or a scheme from a different (non-Peppol) identifier registry
  that happens to look similar.

A few commonly used EAS codes: `0088` (GLN, Global Location Number), `0192`
(Norwegian organisation number), `9930` (Germany VAT number) — the full,
current list is published at the codelist URL, and it is large and
country-specific, so look up the correct code for the party's actual
jurisdiction rather than guessing from a short list.

## How to fix it

Set `schemeID` on `cbc:EndpointID` to the Peppol EAS code that matches the
*type* of identifier actually used as the value, for the correct
registering jurisdiction.

## Example

### Wrong

```xml
<cac:AccountingSupplierParty>
  <cac:Party>
    <cbc:EndpointID schemeID="0192">DE123456789</cbc:EndpointID>  <!-- 0192 is Norwegian org number, value is a German VAT id -->
  </cac:Party>
</cac:AccountingSupplierParty>
```

### Correct

```xml
<cac:AccountingSupplierParty>
  <cac:Party>
    <cbc:EndpointID schemeID="9930">DE123456789</cbc:EndpointID>
  </cac:Party>
</cac:AccountingSupplierParty>
```

## Verification note

The rule text was confirmed directly against
`docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/`. The codelist name and
example scheme codes came through an automated fetch-and-summarize of
`docs.peppol.eu/poacc/billing/3.0/codelist/eas/` rather than a direct
byte-for-byte comparison; verify a specific scheme code against the live
codelist before relying on it, especially for jurisdictions not listed
above.
