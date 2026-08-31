---
id: BR-CO-14
title: Invoice VAT total does not match the VAT breakdown
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Invoice total VAT amount (BT-110) = Σ VAT category tax amount (BT-117).
bt: BT-110, BT-117
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-110, the invoice's **total VAT amount**, must equal the sum of BT-117
across every VAT category breakdown group (BG-23) — one group per distinct
combination of VAT category code and rate used on the invoice.

## Common causes

- **Recomputing VAT from the grand total instead of summing the breakdown.**
  BT-110 must be the sum of the already-rounded per-category BT-117 values,
  not `TaxExclusiveAmount × rate` computed once over the whole invoice — the
  two differ whenever more than one VAT rate is present, or whenever
  per-category rounding (see `BR-CO-17`) doesn't line up with a single
  blended rate.
- **A missing VAT breakdown group.** An invoice with items at both 19% and 0%
  needs two `TaxSubtotal`/`BG-23` groups; if the 0% group is omitted, BT-110
  is computed from only the 19% group but the invoice total still reflects
  both.
- **Currency mismatch on `cac:TaxTotal`.** UBL allows a `cac:TaxTotal`
  without `cac:TaxSubtotal` children for a tax-accounting-currency total; the
  probe for this rule only looks at the `TaxTotal` that actually carries
  `TaxSubtotal` groups — pointing BT-110 at the wrong `TaxTotal` element
  produces a value that has nothing to do with the breakdown at all.

## How to fix it

Sum the (already 2-decimal-rounded) tax amount from every VAT category
breakdown group and put that sum in BT-110 — don't derive it independently.

- **UBL**: the `cac:TaxTotal` that contains `cac:TaxSubtotal` children has
  `cbc:TaxAmount` = sum of `cac:TaxSubtotal/cbc:TaxAmount` across all of its
  subtotals.
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount`
  = sum of `ram:ApplicableTradeTax/ram:CalculatedAmount` across all VAT
  breakdown groups under `ram:ApplicableHeaderTradeSettlement`.

## Example

### UBL — wrong

```xml
<cac:TaxTotal>
  <cbc:TaxAmount currencyID="EUR">228.00</cbc:TaxAmount>  <!-- only the 19% group -->
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">1200.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">228.00</cbc:TaxAmount>
    <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:TaxCategory>
  </cac:TaxSubtotal>
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">40.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
    <cac:TaxCategory><cbc:ID>Z</cbc:ID><cbc:Percent>0</cbc:Percent></cac:TaxCategory>
  </cac:TaxSubtotal>
</cac:TaxTotal>
```

### UBL — correct

```xml
<cac:TaxTotal>
  <cbc:TaxAmount currencyID="EUR">228.00</cbc:TaxAmount>  <!-- 228.00 + 0.00 -->
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">1200.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">228.00</cbc:TaxAmount>
    <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:TaxCategory>
  </cac:TaxSubtotal>
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">40.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
    <cac:TaxCategory><cbc:ID>Z</cbc:ID><cbc:Percent>0</cbc:Percent></cac:TaxCategory>
  </cac:TaxSubtotal>
</cac:TaxTotal>
```

The value doesn't change here because the wrong example already happened to
sum correctly by coincidence — the real bug this rule catches is a BT-110
computed as `1200 * 0.19` (a single blended calculation) instead of the sum
of the two `TaxAmount` values actually present. Always derive BT-110 by
addition over the breakdown, never by re-multiplying.

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>228.00</ram:CalculatedAmount>
  <ram:BasisAmount>1200.00</ram:BasisAmount>
  <ram:CategoryCode>S</ram:CategoryCode>
  <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>0.00</ram:CalculatedAmount>
  <ram:BasisAmount>40.00</ram:BasisAmount>
  <ram:CategoryCode>Z</ram:CategoryCode>
  <ram:RateApplicablePercent>0</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:TaxTotalAmount>228.00</ram:TaxTotalAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
