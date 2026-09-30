#!/usr/bin/env bash
# Money Boys — Bitget credential leak guard.
#
# Scans TRACKED + STAGED content only. The local, gitignored `.env` is never
# enumerated (via `git ls-files --cached --others --exclude-standard`), so real
# credentials sitting on disk are never read, printed, or reported.
#
# Rules:
#   BG_APIKEY      Bitget API-key-shaped value (bg_ + >=16 alnum)
#   BG_SECRET      BITGET_SECRET_KEY assignment with a non-placeholder value
#   BG_PASSPHRASE  BITGET_PASSPHRASE assignment with a non-placeholder value
#
# Invariants:
#   - never prints a matched value (emits "file:line RULE_ID" only)
#   - fails closed (exit 1) on any suspected real secret
#   - allows .env.example placeholders
#
# Usage: bash scripts/secret-scan.sh [--self-test]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Single source of truth for the rules. Shared by the live scan and the
# self-test fixtures so they can never drift apart.
RULES_AWK='
function is_placeholder(v,   u) {
  gsub(/^[ \t"'"'"']+|[ \t"'"'"']+$/, "", v)
  if (v == "") return 1
  u = toupper(v)
  if (u ~ /^<[^>]*>$/) return 1
  if (u ~ /^(YOUR|YOUR_|CHANGE|REPLACE|INSERT|EXAMPLE|DUMMY|MOCK|PLACEHOLDER|REDACTED|REMOVED|TODO|NONE|NULL|UNSET|X{3,}|\*{3,}|\.{3})/) return 1
  if (v ~ /^[A-Z_][A-Z0-9_]*$/) return 1    # bare UPPER_SNAKE env-var references
  if (v ~ /^\$\{?[A-Za-z_]/) return 1       # ${VAR} interpolation
  if (v ~ /^process\.env/) return 1         # process.env["X"] indirection
  if (v ~ /^%[sd]$/) return 1               # printf substitution in test fixtures
  return 0
}
function check_assignment(line, name,   re, v) {
  re = name "[ \t]*[=:][ \t]*[^[:space:],]*"
  if (match(line, re)) {
    v = substr(line, RSTART, RLENGTH)
    sub("^" name "[ \t]*[=:][ \t]*", "", v)
    if (!is_placeholder(v)) return 1
  }
  return 0
}
{
  line = $0
  if (line ~ /bg_[A-Za-z0-9]{16,}/) { print MBFILE ":" FNR " BG_APIKEY"; n++ }
  if (check_assignment(line, "BITGET_SECRET_KEY"))   { print MBFILE ":" FNR " BG_SECRET"; n++ }
  if (check_assignment(line, "BITGET_PASSPHRASE")) { print MBFILE ":" FNR " BG_PASSPHRASE"; n++ }
}
END { exit (n > 0) ? 1 : 0 }
'

# $1 = label used in findings. Reads content on stdin.
# Prints "label:line RULE_ID" to stderr (never a value) and the finding count
# to stdout. Runs the rule engine exactly once, so a hit is reported once.
count_findings() {
  local label="$1" out
  out="$(awk -v MBFILE="$label" "$RULES_AWK" 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    printf '%s\n' "$out" >&2
    printf '%s\n' "$out" | wc -l | tr -d ' '
  else
    echo 0
  fi
}

scan_live() {
  local findings=0 n f
  while IFS= read -r f; do
    [[ -z "$f" || ! -f "$f" ]] && continue
    n="$(grep -v '^Binary file' -- "$f" 2>/dev/null | count_findings "$f")"
    [[ "${n:-0}" -gt 0 ]] && findings=$((findings + n))
  done <<< "$(git ls-files --cached --others --exclude-standard 2>/dev/null)"

  # Staged-only material (index content that differs from the worktree).
  n="$(git diff --cached --no-color 2>/dev/null | grep '^+' | count_findings "(staged diff)")"
  [[ "${n:-0}" -gt 0 ]] && findings=$((findings + n))

  echo "$findings"
}

self_test() {
  local rc=0 flagged tmp

  # Fixture material, assembled from fragments so this tracked file never holds
  # a literal matching its own rules. Not a real credential.
  local N_API="BITGET_API""_KEY"
  local N_SECRET="BITGET_SECRET""_KEY"
  local N_PASS="BITGET_PASSP""HRASE"

  local P_A="AAAABBBB" P_B="CCCCDDDD" P_C="EEEEFFFF" P_D="GGGGHHHH"
  local P_E="0123456789abcdef" P_F="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"
  local P_G="Passw0rdFixture"

  # Assembled from fragments so this tracked file does not itself contain a
  # literal matching the scanner rules.
  local FAKE_KEY="bg_${P_A}${P_B}${P_C}${P_D}"
  local FAKE_SEC="${P_E}${P_F}"
  local FAKE_PASS="${P_G}"

  # 1. Real-shaped values MUST be flagged.
  for probe in \
    "$N_API=$FAKE_KEY|BG_APIKEY" \
    "$N_SECRET=$FAKE_SEC|BG_SECRET" \
    "$N_PASS=$FAKE_PASS|BG_PASSPHRASE" \
    "const k = \"$FAKE_KEY\";|BG_APIKEY" ; do
    local line="${probe%|*}" want="${probe#*|}"
    flagged="$(printf '%s\n' "$line" | awk -v MBFILE=fixture "$RULES_AWK" || true)"
    if [[ "$flagged" != *"$want"* ]]; then
      echo "self-test FAIL: expected $want for fixture line" ; rc=1
    fi
  done

  # 2. Placeholders MUST NOT be flagged (mirrors real .env.example shape).
  while IFS= read -r placeholder; do
    flagged="$(printf '%s=%s\n%s=%s\n%s=%s\n' \
      "$N_API" "$placeholder" "$N_SECRET" "$placeholder" "$N_PASS" "$placeholder" \
      | awk -v MBFILE=.env.example "$RULES_AWK" || true)"
    if [[ -n "$flagged" ]]; then
      echo "self-test FAIL: placeholder value was wrongly flagged"
      rc=1
    fi
  done <<'PLACEHOLDERS'

<your-key>
your_api_key
YOUR_KEY_HERE
changeme
REPLACE_ME
REDACTED
***
${BITGET_API_KEY}
PLACEHOLDER
PLACEHOLDERS

  # 3. Tracked .env.example must stay clean under the live scanner.
  if [[ -f .env.example ]]; then
    flagged="$(grep -v '^Binary file' .env.example | awk -v MBFILE=.env.example "$RULES_AWK" || true)"
    if [[ -n "$flagged" ]]; then
      echo "self-test FAIL: tracked .env.example produced findings"
      rc=1
    fi
  fi

  # 4. The ignored local .env must never be enumerated by the live scan.
  if git ls-files --cached --others --exclude-standard 2>/dev/null | grep -qx '\.env'; then
    echo "self-test FAIL: ignored .env appears in scan enumeration"
    rc=1
  fi

  # 5. Findings output must never contain the secret value itself.
  tmp="$(printf '%s=%s\n' "$N_SECRET" "$FAKE_SEC" \
    | awk -v MBFILE=leakcheck "$RULES_AWK" || true)"
  if [[ "$tmp" == *"$FAKE_SEC"* ]]; then
    echo "self-test FAIL: scanner leaked the matched value"
    rc=1
  fi

  # 6. Live repository must be clean.
  local live
  live="$(scan_live)"
  if [[ "${live:-0}" -ne 0 ]]; then
    echo "self-test FAIL: live scan found ${live} finding(s)"
    rc=1
  fi

  [[ $rc -eq 0 ]] && echo "secret-scan self-test OK"
  return $rc
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit $?
fi

COUNT="$(scan_live)"
if [[ "${COUNT:-0}" -eq 0 ]]; then
  echo "PASS: secret scan (tracked+staged; Bitget key/secret/passphrase rules)"
  exit 0
fi
echo "FAIL: possible Bitget credential material committed (${COUNT} finding(s)) — rule ids above"
exit 1
