---
id: BR-CO-11
title: Allowance total does not match the document-level allowances
severity: error
source: TC434
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/
ruleText: Sum of allowances on document level (BT-107) = Σ Document level allowance amount (BT-92).
bt: BT-107, BT-92
syntaxes: ubl, cii
verified: true
verifiedNote: 
---

## Definition

BT-107 is the header-level sum of every **document-level allowance** (a
discount applied to the whole invoice, not to a single line). It must equal
the sum of the individual BT-92 amounts on each document-level
`AllowanceCharge` where the charge indicator marks it as an allowance (not a
charge).

## Common causes

- **BT-107 present with no allowances, or missing when allowances exist.**
  When there is at least one document-level allowance, BT-107 is mandatory
  and must equal their sum; some implementations only ever emit BT-107 when
  it's non-zero and skip it in the zero case, which is fine, but then forget
  to add it back in once an allowance is introduced.
- **Wrong sign.** BT-92 must be entered as a **positive** number — the total
  formulas ( here and in `BR-CO-13`) subtract it. A negative BT-92 makes
  BT-107 negative too, which is the opposite of what downstream totals
  expect.
- **Mixing allowances and charges in one sum.** The allowance total must only
  include `AllowanceCharge` elements where `ChargeIndicator` is `false`.
  Summing all `AllowanceCharge/Amount` regardless of the indicator pulls
  charges into the allowance total.

## How to fix it

Sum only the document-level allowance amounts (charge indicator false) and
put the (positive) result in BT-107.

- **UBL**: `cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount` = sum of
  `cac:AllowanceCharge[cbc:ChargeIndicator = 'false']/cbc:Amount` at document
  level (not inside `cac:InvoiceLine`).
- **CII**: `ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:AllowanceTotalAmount`
  = sum of `ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = 'false']/ram:ActualAmount`
  under `ram:ApplicableHeaderTradeSettlement`.

## Example

### UBL — wrong

```xml
<cac:AllowanceCharge>
  <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
  <cbc:Amount currencyID="EUR">-60.00</cbc:Amount>  <!-- should be positive -->
</cac:AllowanceCharge>
<cac:LegalMonetaryTotal>
  <cbc:AllowanceTotalAmount currencyID="EUR">-60.00</cbc:AllowanceTotalAmount>
  ...
</cac:LegalMonetaryTotal>
```

### UBL — correct

```xml
<cac:AllowanceCharge>
  <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
  <cbc:Amount currencyID="EUR">60.00</cbc:Amount>
</cac:AllowanceCharge>
<cac:LegalMonetaryTotal>
  <cbc:AllowanceTotalAmount currencyID="EUR">60.00</cbc:AllowanceTotalAmount>
  ...
</cac:LegalMonetaryTotal>
```

### CII — correct

```xml
<ram:SpecifiedTradeAllowanceCharge>
  <ram:ChargeIndicator>
    <udt:Indicator>false</udt:Indicator>
  </ram:ChargeIndicator>
  <ram:ActualAmount>60.00</ram:ActualAmount>
</ram:SpecifiedTradeAllowanceCharge>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  <ram:AllowanceTotalAmount>60.00</ram:AllowanceTotalAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
```
