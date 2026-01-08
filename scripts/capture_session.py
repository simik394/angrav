#!/usr/bin/env python3
"""
Capture Antigravity session data by intercepting the local gRPC server.

The language_server on 127.0.0.1:43405 serves decrypted session data.
This script captures the StreamCascadeReactiveUpdates response.

Usage:
    1. Start capture: python capture_session.py start
    2. Switch sessions in Antigravity UI
    3. Stop capture: python capture_session.py stop
    4. Decode: python capture_session.py decode session_capture.bin
"""

import sys
import os
import subprocess
import struct
from pathlib import Path

CAPTURE_DIR = Path(__file__).parent.parent / "history_dump" / "grpc_captures"
CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

def start_capture():
    """Start mitmproxy to intercept gRPC traffic."""
    print("🔌 Starting gRPC capture proxy...")
    print("   Listening on port 8080")
    print("   Forwarding to 127.0.0.1:43405")
    print()
    print("⚠️  You need to redirect Antigravity's gRPC traffic to this proxy.")
    print("   Option 1: Set HTTPS_PROXY=http://localhost:8080 before starting Antigravity")
    print("   Option 2: Use iptables to redirect 43405 -> 8080")
    print()
    
    capture_file = CAPTURE_DIR / f"session_{int(__import__('time').time())}.flow"
    
    cmd = [
        "mitmproxy",
        "--mode", "upstream:https://127.0.0.1:43405",
        "--ssl-insecure",
        "-w", str(capture_file),
        "--set", "flow_filter=~u StreamCascade"
    ]
    
    print(f"📁 Saving to: {capture_file}")
    print(f"🚀 Running: {' '.join(cmd)}")
    print()
    print("Press Ctrl+C to stop capture")
    
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print("\n✅ Capture stopped")
        print(f"📁 Saved to: {capture_file}")

def decode_protobuf(filepath: str):
    """Decode protobuf without schema using protoscope."""
    import base64
    
    print(f"📖 Decoding: {filepath}")
    
    # Try protoscope first
    try:
        result = subprocess.run(
            ["protoscope", "-I", filepath],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            output_file = Path(filepath).with_suffix('.decoded.txt')
            output_file.write_text(result.stdout)
            print(f"✅ Decoded with protoscope: {output_file}")
            return
    except FileNotFoundError:
        print("⚠️  protoscope not found. Install with: go install github.com/protocolbuffers/protoscope/cmd/protoscope@latest")
    
    # Fallback: raw hex dump with string extraction
    print("🔍 Extracting strings from binary...")
    with open(filepath, 'rb') as f:
        data = f.read()
    
    # Extract printable strings (length >= 5)
    strings = []
    current = ""
    for byte in data:
        if 32 <= byte < 127:
            current += chr(byte)
        else:
            if len(current) >= 5:
                strings.append(current)
            current = ""
    
    if len(current) >= 5:
        strings.append(current)
    
    output_file = Path(filepath).with_suffix('.strings.txt')
    output_file.write_text("\n".join(strings))
    print(f"✅ Extracted {len(strings)} strings: {output_file}")

def list_captures():
    """List existing captures."""
    captures = list(CAPTURE_DIR.glob("*.flow")) + list(CAPTURE_DIR.glob("*.bin"))
    if not captures:
        print("📭 No captures found")
        return
    
    print(f"📁 Captures in {CAPTURE_DIR}:")
    for c in sorted(captures):
        size = c.stat().st_size
        print(f"   {c.name} ({size:,} bytes)")

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nCommands:")
        print("  start   - Start capture proxy")
        print("  decode  - Decode captured protobuf")
        print("  list    - List captures")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "start":
        start_capture()
    elif cmd == "decode":
        if len(sys.argv) < 3:
            print("Usage: capture_session.py decode <file>")
            sys.exit(1)
        decode_protobuf(sys.argv[2])
    elif cmd == "list":
        list_captures()
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

if __name__ == "__main__":
    main()
