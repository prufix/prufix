---
id: PEPPOL-EN16931-R008
title: Document contains an empty element
severity: error
source: PEPPOL
sourceUrl: https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/
ruleText: Document MUST not contain empty elements.
bt: []
syntaxes: ubl
verified: true
verifiedNote: 
---

## Definition

Peppol BIS Billing 3.0 rejects any element that has neither a child element
nor text. The rule is written as a Schematron pattern whose context is the
offending node itself:

```
<rule context="//*[not(*) and not(normalize-space())]">
  <assert id="PEPPOL-EN16931-R008" test="false()" flag="fatal">
    Document MUST not contain empty elements.
  </assert>
</rule>
```

`test="false()"` means the assertion fails wherever the context matches, so
one error is reported per empty element, and the reported location points at
that element rather than at its parent.

Attributes do not save an element. `<cbc:Note/>`, `<cbc:Note></cbc:Note>` and
`<cbc:InvoicedQuantity unitCode="C62"/>` are all empty by this test — the
condition looks only for a child element or non-whitespace text.

Whitespace does not save it either: `normalize-space()` strips it, so an
element containing only a newline and indentation is empty.

This rule is Peppol-only and UBL-only. EN 16931 has no rule against empty
elements, and the Peppol CII ruleset does not carry R008.

## Common causes

- **A generator wrote a tag for a value that was null or an empty string.**
  This is the usual case, and it is not a data error — the field simply is
  not being used. Serializers that map every field in a model to an element
  produce this whenever an optional field is left unset.
- **A template with a placeholder that resolved to nothing.** The element
  survives the substitution; the value does not.
- **An element kept for its attributes.** Something like
  `<cbc:InvoicedQuantity unitCode="C62"/>` looks like it carries information,
  and it does — but not the kind this rule counts.
- **A field cleared rather than removed** when editing a document by hand or
  in a UI that blanks the value instead of dropping the element.

## How to fix it

Omit the element instead of writing it empty.

Every element this rule can reach is optional in the first place: if it were
required, the corresponding EN 16931 rule (`BR-*`) would have fired for the
missing value instead, and that is a different error with a different fix.
So there is never a case where the correct response is to keep the empty
element — either give it a value, or leave it out.

If the document comes out of a library, the fix usually belongs in the
serialisation layer rather than in the invoice: skip elements whose value is
null or empty rather than emitting them.

## Why it passes one validator and fails another

EN 16931 contains no rule against empty elements. A document with an empty
`cbc:Note` is valid EN 16931 and invalid Peppol BIS, from the same file, with
no contradiction between the two rulesets — Peppol simply adds a rule that
the base standard does not have.

This is worth knowing before assuming the two validators disagree about
something substantive. They do not; one of them is checking something the
other never checks.

## Example

### Wrong

```xml
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
<cbc:Note></cbc:Note>
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
```

### Correct

```xml
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
```

Or, if the note was meant to carry something:

```xml
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
<cbc:Note>Delivery in two parts.</cbc:Note>
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
```
