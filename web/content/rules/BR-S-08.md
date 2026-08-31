---
id: BR-S-08
title: Standard-rated taxable amount does not match the standard-rated lines
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: For each different value of VAT category rate (BT-119) where the VAT category code (BT-118) is "Standard rated", the VAT category taxable amount (BT-116) in a VAT breakdown (BG-23) shall equal the sum of Invoice line net amounts (BT-131) plus the sum of document level charge amounts (BT-99) minus the sum of document level allowance amounts (BT-92) where the VAT category code (BT-151, BT-102, BT-95) is "Standard rated" and the VAT rate (BT-152, BT-103, BT-96) equals the VAT category rate (BT-119).
bt: BT-116, BT-118, BT-119, BT-131, BT-151, BT-152, BT-92, BT-95, BT-99, BT-102
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

For every distinct standard-rate value used on the invoice (there can be
more than one — e.g. 19% and a separate 7% run of standard-rated lines in
jurisdictions where that's modeled as `S`), the taxable amount (BT-116) in
that rate's VAT breakdown group must equal the sum of everything actually
taxed at that rate and category: invoice line net amounts, plus document-level
charges, minus document-level allowances — but **only the lines and
document-level charges/allowances that are themselves tagged category `S`
at that same rate.** Items at a different rate, or a different category
entirely, must not be folded into this group's taxable amount.

This differs from `BR-CO-13`/`BR-CO-10`, which sum *all* lines regardless of
category — this rule sums only the subset belonging to one specific
category+rate combination, and there is one such check per VAT breakdown
group on the invoice.

## Common causes

- **A single VAT breakdown group used for a mixed-rate invoice.** An
  invoice with some lines at 19% and others at 7% (both category `S`) needs
  **two** separate `BG-23` groups, one per rate — folding all standard-rated
  lines into one group with only one of the two rates produces a taxable
  amount that doesn't match what was actually taxed at that rate.
- **Lines in a different category counted into the `S` group's taxable
  amount.** A reduced-rate line mistakenly categorized as `S` (see
  `BR-S-05`) inflates the standard-rate taxable amount even though the line
  itself is arithmetically consistent on its own.
- **Document-level charges/allowances applied to the wrong category's
  group.** A document-level charge itself carries a VAT category/rate
  (BT-102/BT-103); if that charge is tagged category `S` at 19% but gets
  added into a 7% group's taxable amount (or omitted from the 19% one), the
  totals won't reconcile.

## How to fix it

Group invoice lines, document-level charges, and document-level allowances
by their own VAT category + rate, then compute each group's taxable amount
as `Σ line net amounts + Σ charges − Σ allowances`, restricted to that
group's category and rate — one `TaxSubtotal`/`ApplicableTradeTax` group per
distinct combination actually used.

## Example

### UBL — wrong

```xml
<!-- lines: 1000.00 @ S/19%, 500.00 @ S/7% -->
<cac:TaxTotal>
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">1500.00</cbc:TaxableAmount>  <!-- both rates merged -->
    <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
    <cac:TaxCategory>
      <cbc:ID>S</cbc:ID>
      <cbc:Percent>19</cbc:Percent>
    </cac:TaxCategory>
  </cac:TaxSubtotal>
</cac:TaxTotal>
```

### UBL — correct

```xml
<cac:TaxTotal>
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">1000.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">190.00</cbc:TaxAmount>
    <cac:TaxCategory>
      <cbc:ID>S</cbc:ID>
      <cbc:Percent>19</cbc:Percent>
    </cac:TaxCategory>
  </cac:TaxSubtotal>
  <cac:TaxSubtotal>
    <cbc:TaxableAmount currencyID="EUR">500.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="EUR">35.00</cbc:TaxAmount>
    <cac:TaxCategory>
      <cbc:ID>S</cbc:ID>
      <cbc:Percent>7</cbc:Percent>
    </cac:TaxCategory>
  </cac:TaxSubtotal>
</cac:TaxTotal>
```

### CII — correct

```xml
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>190.00</ram:CalculatedAmount>
  <ram:BasisAmount>1000.00</ram:BasisAmount>
  <ram:CategoryCode>S</ram:CategoryCode>
  <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
<ram:ApplicableTradeTax>
  <ram:CalculatedAmount>35.00</ram:CalculatedAmount>
  <ram:BasisAmount>500.00</ram:BasisAmount>
  <ram:CategoryCode>S</ram:CategoryCode>
  <ram:RateApplicablePercent>7</ram:RateApplicablePercent>
</ram:ApplicableTradeTax>
```
