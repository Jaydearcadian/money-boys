#!/usr/bin/env python3
"""Qwen 3.8-max ping via encrypted token (memory-only decrypt)."""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENC = ROOT / ".secrets" / "qwen38.enc"
KEY = ROOT / ".secrets" / "qwen38.key"

def load_token() -> str:
    for name in ("BITGET_QWEN_API_KEY", "BITGET_QWEN_TOKEN"):
        v = os.environ.get(name)
        if v and v.strip():
            return v.strip()
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return sys.argv[1].strip()
    if not ENC.exists():
        raise FileNotFoundError(f"missing {ENC}")
    if not KEY.exists():
        raise FileNotFoundError(f"missing {KEY}")
    out = subprocess.run(
        ["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
         "-in", str(ENC), "-pass", f"file:{KEY}"],
        check=True, capture_output=True, text=True,
    )
    return out.stdout.strip()

def main() -> None:
    from openai import OpenAI
    token = load_token()
    try:
        client = OpenAI(api_key=token, base_url="https://hackathon.bitgetops.com/v1")
        t0 = time.time()
        r = client.chat.completions.create(
            model="qwen3.8-max",
            messages=[{"role": "user", "content": "Hello from Bitget Hackathon!"}],
            temperature=0.1,
            timeout=30,
        )
        print(f"OK in {time.time()-t0:.2f}s: {r.choices[0].message.content}")
    finally:
        token = ""  # drop from memory

if __name__ == "__main__":
    main()
