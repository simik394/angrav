#!/bin/bash
# Antigravity Browser Container Startup Script
# Starts all services via supervisord

set -e

# Clean up stale X lock
rm -f /tmp/.X99-lock

echo "Starting Antigravity Browser Container..."
echo "  VNC: port 5900"
echo "  CDP: port 9223 (proxied)"

# Start supervisord (runs as root to manage services)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
