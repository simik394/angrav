#!/bin/bash
set -e

echo "🚀 Starting Antigravity Standalone Container..."

# Create log directory
mkdir -p /var/log/supervisor
chown -R angrav:angrav /var/log/supervisor 2>/dev/null || true

# Ensure workspace directories exist
mkdir -p /workspace/tasks /workspace/output /workspace/project

# Wait for X11 to be ready function
wait_for_display() {
    echo "⏳ Waiting for X11 display..."
    for i in {1..30}; do
        if xdpyinfo -display :99 >/dev/null 2>&1; then
            echo "✅ X11 display ready"
            return 0
        fi
        sleep 1
    done
    echo "❌ X11 display not ready after 30s"
    return 1
}

# Auth token handling
if [ -n "$WINDSURF_TOKEN" ]; then
    echo "🔐 Auth token provided via environment"
    # Token will be used by worker to authenticate
fi

# Check if already authenticated
if [ -f "/home/angrav/.config/Windsurf/User/globalStorage/codeium.windsurf/session.json" ]; then
    echo "✅ Found existing auth session"
else
    echo "⚠️ No auth session found. Connect via VNC (port 5900) to authenticate."
    echo "   After logging in, the session will persist in the mounted volume."
fi

echo ""
echo "📋 Container Info:"
echo "   VNC:     localhost:5900 (no password)"
echo "   CDP:     localhost:9222"
echo "   Tasks:   /workspace/tasks/*.json"
echo "   Output:  /workspace/output/"
echo "   Project: /workspace/project/"
echo ""

# Start supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
