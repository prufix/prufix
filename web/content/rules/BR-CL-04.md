---
id: BR-CL-04
title: Invoice currency code is not a valid ISO 4217 code
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Invoice currency code MUST be coded using ISO code list 4217 alpha-3.
bt: BT-5
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-5 (see `BR-05` for the "must be present" check) must additionally hold a
valid ISO 4217 **alpha-3** currency code — a three-letter code such as
`EUR`, `USD`, `GBP`. This rule fires when the element exists but its value
isn't a recognized alpha-3 code.

## Common causes

- **Numeric ISO 4217 code used instead of the alpha-3 one** — ISO 4217 also
  defines three-digit numeric codes (`978` for EUR); some systems store the
  numeric form internally and serialize it directly into the invoice instead
  of converting to `EUR`.
- **Lowercase or mixed-case code** (`eur`, `Eur`) — several strict
  validators treat the code list as case-sensitive uppercase-only, so a
  case mismatch reads as "not in the list" even though the three letters are
  right.
- **A symbol or locale-formatted string** (`€`, `EU`, `Euro`) written into
  the currency code field by code that formats a human-readable price
  string and reuses the wrong variable for the machine-readable code
  element.
- **A retired or non-ISO code** (e.g. a pre-euro national currency code kept
  around in a legacy lookup table and never fully retired).

## How to fix it

Set `cbc:DocumentCurrencyCode` (UBL) / `ram:InvoiceCurrencyCode` (CII) to
the current, uppercase, three-letter ISO 4217 alpha-3 code for the
invoice's currency.

## Example

### UBL — wrong

```xml
<cbc:DocumentCurrencyCode>978</cbc:DocumentCurrencyCode>  <!-- ISO 4217 numeric, not alpha-3 -->
```

### UBL — correct

```xml
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
```

### CII — wrong

```xml
<ram:InvoiceCurrencyCode>eur</ram:InvoiceCurrencyCode>  <!-- lowercase -->
```

### CII — correct

```xml
<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
```
