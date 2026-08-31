---
id: BR-CO-17
title: VAT amount does not equal taxable amount times rate
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: VAT category tax amount (BT-117) = VAT category taxable amount (BT-116) x (VAT category rate (BT-119) / 100), rounded to two decimals.
bt: BT-117, BT-116, BT-119
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

For every VAT breakdown group (BG-23), the VAT amount (BT-117) must equal
the taxable amount (BT-116) multiplied by the rate (BT-119, a percentage —
19 means 19%, not 0.19), rounded to two decimals. Unlike `BR-CO-14` (which
sums across groups), this rule checks each group's own arithmetic.

## Common causes

- **Rate stored as a fraction instead of a percentage.** BT-119 must be `19`
  for 19%, not `0.19`. A fraction produces a VAT amount roughly 100× too
  small and fails this rule immediately — this is one of the most common
  first-integration bugs, because the rate is a fraction internally in many
  systems and gets serialized without the ×100 conversion.
- **Per-line rounding instead of per-category rounding.** BT-117 must be
  computed once, on the full category taxable amount, and rounded once —
  not computed per line and summed. Summing individually-rounded per-line
  VAT amounts accumulates rounding error that grows with the number of
  lines in that category.
- **Off-by-a-cent from banker's/floating-point rounding.** `BT-116 × rate /
  100` must be rounded half-up (or per the accounting convention actually
  used) to exactly 2 decimals with decimal arithmetic. Doing the
  multiplication in binary floating point introduces representation error
  that occasionally rounds the wrong way at the boundary.

## How to fix it

Compute `round(taxable_amount × rate / 100, 2)` once per VAT category
breakdown group, using decimal (not binary floating-point) arithmetic, and
confirm the rate is stored as a whole-number percentage.

- **UBL**: `cac:TaxSubtotal/cbc:TaxAmount` vs.
  `cac:TaxSubtotal/cbc:TaxableAmount` × `cac:TaxCategory/cbc:Percent` / 100.
- **CII**: line-level `ram:ApplicableTradeTax` has no `BasisAmount`, so this
  check applies to the header-level VAT breakdown:
  `ram:ApplicableTradeTax[ram:BasisAmount]/ram:CalculatedAmount` vs.
  `ram:BasisAmount` × `ram:RateApplicablePercent` / 100.

## Example

### UBL — wrong

```xml
<cac:TaxSubtotal>
  <cbc:TaxableAmount currencyID="EUR">1200.00</cbc:TaxableAmount>
  <cbc:TaxAmount currencyID="EUR">2.28</cbc:TaxAmount>  <!-- rate applied as 0.19% -->
  <cac:TaxCategory>
    <cbc:ID>S</cbc:ID>
    <cbc:Percent>0.19</cbc:Percent>  <!-- should be 19 -->
  </cac:TaxCategory>
</cac:TaxSubtotal>
```

### UBL — correct

```xml
<cac:TaxSubtotal>
  <cbc:TaxableAmount currencyID="EUR">1200.00</cbc:TaxableAmount>
  <cbc:TaxAmount currencyID="EUR">228.00</cbc:TaxAmount>
  <cac:TaxCategory>
    <cbc:ID>S</cbc:ID>
    <cbc:Percent>19</cbc:Percent>
  </cac:TaxCategory>
</cac:TaxSubtotal>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>228.00</ram:CalculatedAmount>
  <ram:BasisAmount>1200.00</ram:BasisAmount>
  <ram:CategoryCode>S</ram:CategoryCode>
  <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
