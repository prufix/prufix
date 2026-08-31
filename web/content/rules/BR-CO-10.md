---
id: BR-CO-10
title: Sum of line amounts does not match the invoice lines
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
bt: BT-106, BT-131
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-106, the **sum of invoice line net amounts**, is a header-level total. It
must equal the sum of every individual line's net amount (BT-131), no more
and no less. This is the first of the arithmetic checks — every later total
(BT-109, BT-112, BT-115...) is built on top of BT-106 being right, so an
error here tends to cascade into `BR-CO-13` and downstream findings on the
same document.

## Common causes

- **Rounding at the wrong step.** BT-131 on each line must already be rounded
  to 2 decimals. Summing full-precision line values and rounding only the
  header total gives a header that doesn't match the sum of the (rounded)
  lines printed elsewhere on the invoice.
- **A stale total after editing lines.** BT-106 is computed once at
  generation time and then a line gets added, removed, or its quantity
  changed downstream (e.g. a discount applied after totals were computed)
  without recomputing the header sum.
- **Summing the wrong amount.** Confusing BT-131 (line net amount, after
  line-level allowances/charges) with the raw quantity × price before
  line-level adjustments are applied.
- **Credit notes:** using `cac:InvoiceLine` amounts on an Invoice but
  forgetting the credit note line element name is `cac:CreditNoteLine`, or
  vice versa, so the sum silently covers zero lines.

## How to fix it

Recompute BT-106 as the literal sum of the already-rounded BT-131 values on
every line in the document, and do this last — after any line has been
added, removed, or edited, not before.

- **UBL**: `cac:LegalMonetaryTotal/cbc:LineExtensionAmount` must equal the
  sum of every `cac:InvoiceLine/cbc:LineExtensionAmount` (or
  `cac:CreditNoteLine/cbc:LineExtensionAmount` on a credit note).
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount`
  must equal the sum of every
  `ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount`.

## Example

### UBL — wrong

```xml
<cac:InvoiceLine>
  <cbc:ID>1</cbc:ID>
  <cbc:LineExtensionAmount currencyID="EUR">500.00</cbc:LineExtensionAmount>
</cac:InvoiceLine>
<cac:InvoiceLine>
  <cbc:ID>2</cbc:ID>
  <cbc:LineExtensionAmount currencyID="EUR">740.00</cbc:LineExtensionAmount>
</cac:InvoiceLine>
<cac:LegalMonetaryTotal>
  <!-- stale: line 2 was added after this was computed -->
  <cbc:LineExtensionAmount currencyID="EUR">500.00</cbc:LineExtensionAmount>
  ...
</cac:LegalMonetaryTotal>
```

### UBL — correct

```xml
<cac:LegalMonetaryTotal>
  <cbc:LineExtensionAmount currencyID="EUR">1240.00</cbc:LineExtensionAmount>
  ...
</cac:LegalMonetaryTotal>
```

### CII — wrong

```xml
<ram:IncludedSupplyChainTradeLineItem>
  <ram:SpecifiedLineTradeSettlement>
    <ram:SpecifiedTradeSettlementLineMonetarySummation>
      <ram:LineTotalAmount>500.00</ram:LineTotalAmount>
    </ram:SpecifiedTradeSettlementLineMonetarySummation>
  </ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>
<!-- a second line item with LineTotalAmount 740.00 exists but was not added in -->
<ram:ApplicableHeaderTradeSettlement>
  <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    <ram:LineTotalAmount>500.00</ram:LineTotalAmount>
  </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement>
```

### CII — correct

```xml
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:LineTotalAmount>1240.00</ram:LineTotalAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
