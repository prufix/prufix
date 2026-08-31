#!/usr/bin/env bash
# prufix action entrypoint.
#
# Responsibilities kept deliberately small:
#   1. expand the `path` input (bash-style globs, one pattern per line)
#   2. hand the matched file list to the Node driver (src/main.js)
#
# Everything else -- engine/formatter calls, merging, outputs, PR comment,
# exit code -- lives in src/main.js.
set -euo pipefail

cd "${GITHUB_WORKSPACE:-$PWD}"

# The input name has no dash, but read it via printenv anyway for symmetry
# with INPUT_FAIL-ON (which is not a valid shell identifier).
input_path="$(printenv INPUT_PATH || true)"
if [ -z "$(printf '%s' "$input_path" | tr -d '[:space:]')" ]; then
  echo "::error::Input 'path' is required. Give one or more glob patterns (one per line), e.g. 'invoices/**/*.xml'."
  exit 1
fi

# globstar: `**` matches directories recursively.
# nullglob: a pattern that matches nothing expands to nothing (instead of
#           itself), so we can detect the zero-match case cleanly.
shopt -s globstar nullglob

tmpdir="${EINVOICE_TMPDIR:-${TMPDIR:-/tmp}}"
list_file="$tmpdir/prufix-files-$$.txt"
: > "$list_file"

while IFS= read -r pattern; do
  # Trim surrounding whitespace (also strips stray \r from CRLF input).
  pattern="$(printf '%s' "$pattern" | tr -d '\r')"
  pattern="${pattern#"${pattern%%[![:space:]]*}"}"
  pattern="${pattern%"${pattern##*[![:space:]]}"}"
  [ -z "$pattern" ] && continue
  # Intentionally unquoted: this is where the glob expands.
  for f in $pattern; do
    [ -f "$f" ] && printf '%s\n' "$f" >> "$list_file"
  done
done <<< "$input_path"

sort -u "$list_file" -o "$list_file"

if [ ! -s "$list_file" ]; then
  patterns_oneline="$(printf '%s' "$input_path" | tr '\n' ' ')"
  echo "::error::No files matched the 'path' input. Patterns tried (relative to ${GITHUB_WORKSPACE:-$PWD}): ${patterns_oneline}. Check that the files are checked out and the glob is quoted in your workflow YAML."
  exit 1
fi

export EINVOICE_FILE_LIST="$list_file"
exec node "${EINVOICE_ACTION_MAIN:-/app/action/src/main.js}"
