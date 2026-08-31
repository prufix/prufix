#!/usr/bin/env bash
# Build-time dependency fetcher for the prufix engine image.
#
# Downloads every validation artifact at a pinned version, verifies its SHA256,
# compiles the Peppol Schematron sources to XSLT (SchXslt + Saxon-HE), and
# assembles the runtime layout under the target directory:
#
#   <target>/artifacts/kosit/{validator.jar,config/,overrides.xml}
#   <target>/artifacts/cen/{EN16931-UBL-validation.xslt,EN16931-CII-validation.xslt}
#   <target>/artifacts/peppol/{CEN,PEPPOL}-EN16931-{UBL,CII}.{sch,xslt}
#   <target>/tools/{Saxon-HE-12.8.jar,xmlresolver-5.3.3.jar}
#
# Runs at image build time only. The runtime image never touches the network.

set -euo pipefail

TARGET="${1:?usage: fetch-deps.sh <target-dir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- pinned artifacts ------------------------------------------------------
# name|url|sha256
#
# Peppol BIS Billing 3.0.21 ("2026 May release", mandatory from 2026-08-17):
# GitHub releases stop at v3.0.20, and docs.peppol.eu publishes only the UBL
# Schematron (at a mutable URL). The commit pinned below — 806866bd, head of
# branch 2026-Q2-QA2 in OpenPEPPOL/peppol-bis-invoice-3 — is byte-identical to
# the published docs.peppol.eu/poacc/billing/3.0/files/{PEPPOL,CEN}-EN16931-UBL.sch
# (verified 2026-08-31) and additionally carries the matching CII Schematrons,
# which self-identify as "2026 May release 3.0.21" / CEN 1.3.16.
ARTIFACTS='
kosit-validator.jar|https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar|799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9
kosit-config.zip|https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31.zip|6a5a5911a421b25fbc423f62f93f894df7b236f5d73ca4f84bb222a945082704
cen-ubl.zip|https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/validation-1.3.16/en16931-ubl-1.3.16.zip|bafada015efbc5248bf5e05ad2191e1d9833ef96e9dd5f4bce420a747342da85
cen-cii.zip|https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/validation-1.3.16/en16931-cii-1.3.16.zip|1cd53cb8a84d38aedc82c0caede217da983a7934dd663f793a092fd66443c561
peppol-CEN-EN16931-UBL.sch|https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/806866bd2bd91d7e9623b68f08164e8fbe9e67a0/rules/sch/CEN-EN16931-UBL.sch|268d4f7a2688676695e6c69cba6fba69a6802604fee12cb544a6b30ff09555a3
peppol-PEPPOL-EN16931-UBL.sch|https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/806866bd2bd91d7e9623b68f08164e8fbe9e67a0/rules/sch/PEPPOL-EN16931-UBL.sch|62e5b67892f12755352d78b06f63229a02cc2eccc748677c56efbc8dbcb336e3
peppol-CEN-EN16931-CII.sch|https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/806866bd2bd91d7e9623b68f08164e8fbe9e67a0/rules/sch/CEN-EN16931-CII.sch|54e0dc6d06cd7f17d268bb9696ff56f58d386ee28961c9bbef0a56718c400c89
peppol-PEPPOL-EN16931-CII.sch|https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/806866bd2bd91d7e9623b68f08164e8fbe9e67a0/rules/sch/PEPPOL-EN16931-CII.sch|7678c3cd4a219095ef5d4f2ece17e5d447eb92655e57a7d52290b35acfdc9dd8
schxslt.zip|https://codeberg.org/SchXslt/schxslt/releases/download/v1.10.1/schxslt-1.10.1-xslt-only.zip|e141fabd4804a0ea527945dc7253dd38f9ef8957d9b219b94e13d16859cff7f0
Saxon-HE-12.8.jar|https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/12.8/Saxon-HE-12.8.jar|58220adcb289dbebe0053e7a73ee70c97545c88f4886943d64241bf24701b72a
xmlresolver-5.3.3.jar|https://repo1.maven.org/maven2/org/xmlresolver/xmlresolver/5.3.3/xmlresolver-5.3.3.jar|1fe4d5b92f708dcdb82dbce12919e0171e6b5ca62c6dca6220483625098feb5f
'

echo "$ARTIFACTS" | while IFS='|' read -r name url sha; do
  [ -n "$name" ] || continue
  echo "fetch: $name" >&2
  # --retry-all-errors is required, not decorative: plain --retry only covers
  # transient *transport* errors, so a rate-limited raw.githubusercontent.com
  # answering HTTP 400 fails the whole image build on the first try. Observed
  # 2026-08-31 on CEN-EN16931-CII.sch, which succeeded on a manual retry.
  # The SHA256 check below is what makes retrying safe.
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o "$WORK/$name" "$url"
  echo "$sha  $WORK/$name" | sha256sum -c - >/dev/null \
    || { echo "SHA256 mismatch for $name ($url)" >&2; exit 1; }
done

mkdir -p "$TARGET/artifacts/kosit" "$TARGET/artifacts/cen" "$TARGET/artifacts/peppol" "$TARGET/tools"

# tools
cp "$WORK/Saxon-HE-12.8.jar" "$WORK/xmlresolver-5.3.3.jar" "$TARGET/tools/"
SAXON_CP="$TARGET/tools/Saxon-HE-12.8.jar:$TARGET/tools/xmlresolver-5.3.3.jar"

# KoSIT validator + configuration
cp "$WORK/kosit-validator.jar" "$TARGET/artifacts/kosit/validator.jar"
unzip -q "$WORK/kosit-config.zip" -d "$TARGET/artifacts/kosit/config"

# per-scenario severity overrides (customLevel) extracted as data
java -cp "$SAXON_CP" net.sf.saxon.Transform \
  -xsl:"$HERE/extract-overrides.xsl" \
  -s:"$TARGET/artifacts/kosit/config/scenarios.xml" \
  -o:"$TARGET/artifacts/kosit/overrides.xml"

# CEN EN16931 precompiled XSLT (official release artifacts)
unzip -q "$WORK/cen-ubl.zip" -d "$WORK/cen-ubl"
unzip -q "$WORK/cen-cii.zip" -d "$WORK/cen-cii"
cp "$WORK/cen-ubl/xslt/EN16931-UBL-validation.xslt" "$TARGET/artifacts/cen/"
cp "$WORK/cen-cii/xslt/EN16931-CII-validation.xslt" "$TARGET/artifacts/cen/"

# Peppol BIS Billing Schematron: compile .sch -> .xslt with SchXslt
unzip -q "$WORK/schxslt.zip" -d "$WORK/schxslt"
PIPELINE="$(find "$WORK/schxslt" -path '*/2.0/pipeline-for-svrl.xsl' | head -1)"
[ -n "$PIPELINE" ] || { echo "SchXslt pipeline-for-svrl.xsl not found" >&2; exit 1; }
for f in CEN-EN16931-UBL PEPPOL-EN16931-UBL CEN-EN16931-CII PEPPOL-EN16931-CII; do
  cp "$WORK/peppol-$f.sch" "$TARGET/artifacts/peppol/$f.sch"
  echo "compile: $f.sch -> $f.xslt" >&2
  java -cp "$SAXON_CP" net.sf.saxon.Transform \
    -xsl:"$PIPELINE" \
    -s:"$TARGET/artifacts/peppol/$f.sch" \
    -o:"$TARGET/artifacts/peppol/$f.xslt"
done

echo "fetch-deps: done -> $TARGET" >&2
