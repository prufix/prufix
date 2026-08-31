---
id: BR-CO-12
title: Charge total does not match the document-level charges
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Sum of charges on document level (BT-108) = Σ Document level charge amount (BT-99).
bt: BT-108, BT-99
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-108 is the mirror image of BT-107 (`BR-CO-11`): the header-level sum of
every **document-level charge** — a fee applied to the whole invoice, such as
packaging or freight, rather than to a single line. It must equal the sum of
the BT-99 amounts on each document-level `AllowanceCharge` where the charge
indicator marks it as a charge.

## Common causes

- **BT-108 missing while charges exist.** Once any document-level charge is
  present, BT-108 becomes mandatory and must equal their sum — implementations
  that only populate the totals block for allowances and forget charges leave
  BT-108 empty even though `AllowanceCharge` elements with `ChargeIndicator
  = true` exist.
- **Indicator confusion.** The same `AllowanceCharge` structure carries both
  allowances and charges, distinguished only by `ChargeIndicator`. Summing
  `Amount` without filtering on the indicator (or filtering on the wrong
  value) mixes the two totals.
- **Negative charge amounts.** BT-99 must be positive; the totals formula in
  `BR-CO-13` adds it. A negative charge is really an allowance and belongs in
  BT-92 instead.

## How to fix it

Sum only the document-level charge amounts (charge indicator true) into
BT-108.

- **UBL**: `cac:LegalMonetaryTotal/cbc:ChargeTotalAmount` = sum of
  `cac:AllowanceCharge[cbc:ChargeIndicator = 'true']/cbc:Amount` at document
  level.
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:ChargeTotalAmount`
  = sum of `ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = 'true']/ram:ActualAmount`.

## Example

### UBL — wrong

```xml
<cac:AllowanceCharge>
  <cbc:ChargeIndicator>true</cbc:ChargeIndicator>
  <cbc:ChargeReason>Freight</cbc:ChargeReason>
  <cbc:Amount currencyID="EUR">25.00</cbc:Amount>
</cac:AllowanceCharge>
<cac:LegalMonetaryTotal>
  <!-- ChargeTotalAmount omitted even though a charge exists -->
  <cbc:TaxExclusiveAmount currencyID="EUR">1240.00</cbc:TaxExclusiveAmount>
</cac:LegalMonetaryTotal>
```

### UBL — correct

```xml
<cac:LegalMonetaryTotal>
  <cbc:ChargeTotalAmount currencyID="EUR">25.00</cbc:ChargeTotalAmount>
  <cbc:TaxExclusiveAmount currencyID="EUR">1265.00</cbc:TaxExclusiveAmount>
</cac:LegalMonetaryTotal>
```

### CII — correct

```xml
<ram:SpecifiedTradeAllowanceCharge>
  <ram:ChargeIndicator>
    <udt:Indicator>true</udt:Indicator>
  </ram:ChargeIndicator>
  <ram:ActualAmount>25.00</ram:ActualAmount>
</ram:SpecifiedTradeAllowanceCharge>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:ChargeTotalAmount>25.00</ram:ChargeTotalAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
