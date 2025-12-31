#!/bin/bash
# Interactive session scraper - scrapes current active session, waits for you to switch
set -e

cd /home/sim/Obsi/Prods/01-pwf

echo "=================================================="
echo "🔍 Interactive Session Scraper"
echo "=================================================="
echo ""
echo "This script will:"
echo "1. Scrape the currently active session"
echo "2. Wait for you to manually switch sessions in Antigravity"
echo "3. Repeat until you're done"
echo ""
echo "Press Ctrl+C to exit at any time."
echo ""

# Check API key
if [ -z "$GEMINI_API_KEY" ]; then
    echo "⚠️  GEMINI_API_KEY not set. Token counting disabled."
    echo "   Set with: export GEMINI_API_KEY='your-key'"
    echo ""
fi

count=0
while true; do
    count=$((count + 1))
    
    echo "═══════════════════════════════════════════════════"
    echo "📋 Session #$count"
    echo "═══════════════════════════════════════════════════"
    echo ""
    read -p "Press ENTER to scrape the current session (or Ctrl+C to exit)..."
    
    # Run scraper
    if [ -n "$GEMINI_API_KEY" ]; then
        ./agents/angrav/scrape_local.sh --fresh --tokens
    else
        ./agents/angrav/scrape_local.sh --fresh
    fi
    
    echo ""
    echo "✅ Session scraped!"
    echo ""
    echo "👉 Now switch to the next session in Antigravity..."
    echo "   (Use the session dropdown in the Agent panel)"
    echo ""
done
