#!/usr/bin/env python3
"""
mitmproxy addon to capture Antigravity gRPC session data.

Usage:
    mitmdump -s grpc_capture.py --mode reverse:http://localhost:43405 -p 43406

Then configure Antigravity to use proxy or redirect traffic:
    iptables -t nat -A OUTPUT -p tcp --dport 43405 -j REDIRECT --to-port 43406
"""

import json
import os
from datetime import datetime
from pathlib import Path
from mitmproxy import http, ctx

OUTPUT_DIR = Path("/workspace/grpc_captures")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

class GrpcCapture:
    def __init__(self):
        self.capture_count = 0
        ctx.log.info("🎯 gRPC Capture addon loaded")
    
    def request(self, flow: http.HTTPFlow):
        """Log incoming requests"""
        if "StreamCascade" in flow.request.path or "Cascade" in flow.request.path:
            ctx.log.info(f"📥 Request: {flow.request.method} {flow.request.path}")
    
    def response(self, flow: http.HTTPFlow):
        """Capture gRPC responses"""
        path = flow.request.path
        
        # Filter for session-related endpoints
        if any(ep in path for ep in ["StreamCascadeReactiveUpdates", "GetCascade", "HandleAsync"]):
            self.capture_count += 1
            
            # Get response body
            body = flow.response.content
            
            if body and len(body) > 0:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"capture_{timestamp}_{self.capture_count}.bin"
                filepath = OUTPUT_DIR / filename
                
                # Save raw binary
                filepath.write_bytes(body)
                
                # Also save metadata
                meta = {
                    "timestamp": datetime.now().isoformat(),
                    "path": path,
                    "method": flow.request.method,
                    "status": flow.response.status_code,
                    "content_type": flow.response.headers.get("content-type", "unknown"),
                    "size_bytes": len(body),
                    "filename": filename
                }
                
                meta_path = OUTPUT_DIR / f"capture_{timestamp}_{self.capture_count}.json"
                meta_path.write_text(json.dumps(meta, indent=2))
                
                ctx.log.info(f"💾 Captured: {filename} ({len(body):,} bytes)")
                
                # Try to extract readable strings
                try:
                    strings = self._extract_strings(body)
                    if strings:
                        strings_path = OUTPUT_DIR / f"capture_{timestamp}_{self.capture_count}.txt"
                        strings_path.write_text("\n".join(strings))
                        ctx.log.info(f"   📝 Extracted {len(strings)} strings")
                except Exception as e:
                    ctx.log.warn(f"   ⚠️ String extraction failed: {e}")
    
    def _extract_strings(self, data: bytes, min_length: int = 10) -> list:
        """Extract printable strings from binary data"""
        strings = []
        current = ""
        
        for byte in data:
            if 32 <= byte < 127:
                current += chr(byte)
            else:
                if len(current) >= min_length:
                    strings.append(current)
                current = ""
        
        if len(current) >= min_length:
            strings.append(current)
        
        return strings

addons = [GrpcCapture()]
