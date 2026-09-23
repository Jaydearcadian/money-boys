#!/usr/bin/env bash
# Qwen 3.8-max ping via hackathon.bitgetops.com (encrypted token store).
# Storage: .secrets/qwen38.enc (openssl aes-256-cbc pbkdf2) + .secrets/qwen38.key (0600)
# Usage:
#   bash scripts/test-qwen38.sh                                         # decrypts from .secrets (memory only)
#   BITGET_QWEN_API_KEY=<token> bash scripts/test-qwen38.sh             # override, no decrypt
#   BITGET_QWEN_TOKEN=<token> bash scripts/test-qwen38.sh               # legacy alias override
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENC="$ROOT/.secrets/qwen38.enc"
KEY="$ROOT/.secrets/qwen38.key"

TOKEN="${BITGET_QWEN_API_KEY:-${BITGET_QWEN_TOKEN:-${1:-}}}"
if [ -z "$TOKEN" ]; then
  [ -f "$ENC" ] || { echo "missing $ENC" >&2; exit 1; }
  [ -f "$KEY" ] || { echo "missing $KEY (0600 machine-local key)" >&2; exit 1; }
  TOKEN="$(openssl enc -d -aes-256-cbc -pbkdf2 -in "$ENC" -pass "file:$KEY")"
fi

RESP="$(curl -sS -m 30 -w '\n%{http_code}' https://hackathon.bitgetops.com/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"model":"qwen3.8-max","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"Ping test: respond with OK."}],"temperature":0.1}')"
unset TOKEN
BODY="$(printf '%s' "$RESP" | head -n -1)"
CODE="$(printf '%s' "$RESP" | tail -n 1)"
printf '%s\nHTTP_CODE:%s\n' "$BODY" "$CODE"
