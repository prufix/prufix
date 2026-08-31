# Test fixtures

Layout per interface contract §9.4:

```
valid/         files that must validate clean (zero error-severity findings)
invalid/       files that must fail, each with specific expected rule IDs
fixtures.json  machine-readable manifest: profile, expectErrors, source
```

All fixtures come from official test suites, either verbatim or with one
deliberate single-point mutation (documented per file in `fixtures.json`).
None are hand-written from scratch.

Sources:

- **KoSIT XRechnung test suite** `itplr-kosit/xrechnung-testsuite` v2026-01-31
- **OpenPeppol BIS Billing 3** `OpenPEPPOL/peppol-bis-invoice-3` v3.0.20
- **ZUGFeRD/Factur-X corpus** `ZUGFeRD/corpus` (Apache-2.0)

Semantics of `fixtures.json`:

- `expectErrors`: rule IDs that MUST appear as error-severity findings for the
  file under the given `profile`. This is a **subset** assertion — arithmetic
  cascades can legitimately fire extra IDs (candidates listed in
  `mayAlsoFire`). `expectErrors: []` means zero error-severity findings.
- Valid XRechnung files carry one information-level note (BR-DE-TMP-32,
  "should state a delivery date"). It is `flag="information"` in the SVRL, not
  an error, and must not fail a `valid/` assertion.
- `invalid/peppol-r020-missing-endpoint.xml` is Peppol-only by design: the
  same file passes plain `en16931` (verified) — useful as a profile-layering
  test.

Every expectation in `fixtures.json` was verified by running
`/app/engine/validate.sh` inside the built image with `--network none`. The
larger validation evidence (the official 86-instance KoSIT suite, the
mutation pass and the 30-rule acceptance pass) is kept outside this
repository.
