#!/bin/bash
set -e

# Port for CDP
CDP_PORT=9222
CDP_URL="http://localhost:$CDP_PORT"

echo "=================================================="
echo "🔍 Angrav Local Session Scraper"
echo "=================================================="

# Show usage if --help
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --incremental, -i   Only scrape new items since last run"
    echo "  --fresh, -f         Force full fresh scrape (default)"
    echo "  --tokens, -t        Count tokens using Gemini API"
    echo "  --limit <px>        Limit scrape depth in pixels (for testing)"
    echo "  --all               Dump all sessions"
    echo "  --help, -h          Show this help message"
    echo ""
    echo "Environment:"
    echo "  GEMINI_API_KEY      Required for --tokens option"
    exit 0
fi

# 1. Check if Antigravity is reachable
echo "Checking for Antigravity on port $CDP_PORT..."
if ! curl -s "$CDP_URL/json/version" > /dev/null; then
    echo "❌ Antigravity is not reachable at $CDP_URL"
    echo ""
    echo "Possible reasons:"
    echo "1. Antigravity is not running."
    echo "2. It was not started with the remote debugging flag."
    echo ""
    echo "Please restart Antigravity with:"
    echo "   antigravity --remote-debugging-port=$CDP_PORT"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo "✅ Antigravity is connected!"

# 2. Run Dump (pass through all arguments)
echo "📋 extracting sessions..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BROWSER_CDP_ENDPOINT=$CDP_URL

npx tsx "$SCRIPT_DIR/scripts/dump_history.ts" "$@"

echo "=================================================="
echo "✅ Done."
echo "=================================================="
