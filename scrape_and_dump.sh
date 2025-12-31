#!/bin/bash
set -e

# Resolve absolute paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" # Assumes script is in agents/angrav
DOCKER_DIR="$SCRIPT_DIR/docker"
DUMP_DIR="$PROJECT_ROOT/history_dump"

# CDP Endpoint for Docker (mapped to 9223)
export BROWSER_CDP_ENDPOINT="http://localhost:9223"

echo "=================================================="
echo "🚀 Angrav Auto-Scraper"
echo "=================================================="

# 1. Start Container
echo "Starting Angrav Browser container..."
cd "$DOCKER_DIR"
docker compose up -d angrav-browser

# 2. Wait for Readiness
echo "⏳ Waiting for browser to be ready at $BROWSER_CDP_ENDPOINT..."
MAX_RETRIES=30
for ((i=1; i<=MAX_RETRIES; i++)); do
    if curl -s "$BROWSER_CDP_ENDPOINT/json/version" > /dev/null; then
        echo "✅ Browser is ready!"
        break
    fi
    if [ $i -eq $MAX_RETRIES ]; then
        echo "❌ Timeout waiting for browser."
        exit 1
    fi
    echo "   ...waiting ($i/$MAX_RETRIES)"
    sleep 2
done

# 3. Run Extraction
echo "📋 Running extraction script..."
cd "$PROJECT_ROOT"
# Use npx from the project root or the specific package
# Since dependencies are in agents/angrav, we might need to be there or reference ts-node correctly.
# My manual run worked from root: `npx ts-node agents/angrav/scripts/dump_history.ts`
# But dependencies like `commander` are in `agents/angrav/package.json`.
# If root doesn't have ts-node/typescript, this might fail.
# Better to run inside agents/angrav?
# But `dump_history.ts` uses relative paths like `../src/core`.
# Let's try running from `agents/angrav` but adjusting paths?
# Or just stick to what worked manually: execute from root.
# If `npm install` wasn't run in root, `npx` downloads ts-node but imports might fail if local modules aren't resolved.
# The `agents/angrav` has `node_modules`.
# I should run `npm install` inside `agents/angrav` just in case?
# User's previous command passed, so environment handles it.
# I'll stick to running from root as per previous success.

npx ts-node "$SCRIPT_DIR/scripts/dump_history.ts"

# 4. Stop Container
echo "🛑 Stopping container..."
cd "$DOCKER_DIR"
docker compose stop angrav-browser

echo "=================================================="
echo "✅ Scraping Completed."
echo "📂 Results Directory: $DUMP_DIR"
echo "=================================================="
