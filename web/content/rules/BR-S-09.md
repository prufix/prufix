---
id: BR-S-09
title: Standard-rated VAT amount does not equal taxable amount times rate
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code (BT-118) is "Standard rated" shall equal the VAT category taxable amount (BT-116) multiplied by the VAT category rate (BT-119).
bt: BT-116, BT-117, BT-118, BT-119
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

This is the same arithmetic as `BR-CO-17` (`tax = taxable × rate / 100`,
rounded to 2 decimals) but stated as its own business rule specifically for
category `S` (standard rated) breakdown groups. In practice a validator
implementation runs one check or the other depending on which rule table it
draws from; `prufix` reports whichever the underlying Schematron
actually fires, and the fix is identical either way. It is listed
separately here because it fires as a distinct rule ID, and because it
travels with `BR-S-08` — a document that gets the standard-rated taxable
amount wrong (`BR-S-08`) very often gets this one wrong too, since both depend on correctly isolating the
standard-rated subset of the invoice.

## Common causes

See `BR-CO-17` for the general causes (percentage-vs-fraction rate, rounding
per line instead of per category, floating-point rounding). The
category-`S`-specific addition:

- **This rule fails while `BR-CO-17` on the same group looks like it should
  pass**, when the taxable amount itself is wrong (`BR-S-08`) — fixing the
  arithmetic here without first fixing which lines were grouped into this
  category's taxable amount just produces a different, still-wrong number.
  Fix `BR-S-08` first, then re-check this one.

## How to fix it

Once the group's taxable amount (BT-116) correctly reflects only the
standard-rated lines/charges/allowances at this rate (`BR-S-08`), compute
`round(BT-116 × BT-119 / 100, 2)` for BT-117, using decimal arithmetic and a
whole-number percentage.

## Example

### UBL — wrong

```xml
<cac:TaxSubtotal>
  <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
  <cbc:TaxAmount currencyID="EUR">180.00</cbc:TaxAmount>  <!-- should be 190.00 -->
  <cac:TaxCategory>
    <cbc:ID>S</cbc:ID>
    <cbc:Percent>19</cbc:Percent>
  </cac:TaxCategory>
</cac:TaxSubtotal>
```

### UBL — correct

```xml
<cac:TaxSubtotal>
  <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
  <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
  <cac:TaxCategory>
    <cbc:ID>S</cbc:ID>
    <cbc:Percent>19</cbc:Percent>
  </cac:TaxCategory>
</cac:TaxSubtotal>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>190.00</ram:CalculatedAmount>
  <ram:BasisAmount>1000.00</ram:BasisAmount>
  <ram:CategoryCode>S</ram:CategoryCode>
  <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
