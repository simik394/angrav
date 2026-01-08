
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { getStructuredHistory, listSessions, switchSession } from '../src/session';
import { getAgentFrame } from '../src/core';
import { GoogleGenerativeAI } from '@google/generative-ai';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Token counting with Gemini
async function countTokensWithGemini(text: string): Promise<number | null> {
    if (!GEMINI_API_KEY) {
        console.log('  ⚠️ GEMINI_API_KEY not set, skipping token count');
        return null;
    }
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.countTokens(text);
        return result.totalTokens;
    } catch (error) {
        console.log(`  ⚠️ Token count failed: ${error}`);
        return null;
    }
}

// State tracking for incremental scrapes
interface ScrapeState {
    sessionId: string;
    lastItemCount: number;
    lastItemKey: string;
    lastTimestamp: string;
}

function getStateDir(): string {
    const stateDir = path.resolve(process.cwd(), 'history_dump', '.scrape_state');
    if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
    }
    return stateDir;
}

function getStateFilePath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return path.join(getStateDir(), `${safeId}.json`);
}

function loadState(sessionId: string): ScrapeState | null {
    const filePath = getStateFilePath(sessionId);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
            return null;
        }
    }
    return null;
}

function saveState(state: ScrapeState): void {
    const filePath = getStateFilePath(state.sessionId);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

// Deduplicate items by key
function deduplicateItems(items: Array<{ type: string; content: string; key?: string }>): Array<{ type: string; content: string; key?: string }> {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = item.key || `${item.type}:${item.content.substring(0, 50)}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// Archive old files (older than 7 days)
function archiveOldFiles(dumpDir: string): number {
    const archiveDir = path.join(dumpDir, 'archive');
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }

    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const files = fs.readdirSync(dumpDir).filter(f => f.endsWith('.md'));
    let archived = 0;

    for (const file of files) {
        const filePath = path.join(dumpDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < sevenDaysAgo) {
            fs.renameSync(filePath, path.join(archiveDir, file));
            archived++;
        }
    }

    return archived;
}

// Generate better filename: YYYY-MM-DD_HH-mm_title.md
function generateFilename(title: string, suffix: string = ''): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timePart = now.toTimeString().slice(0, 5).replace(':', '-'); // HH-mm

    // Clean and truncate title
    let safeName = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'session';
    if (safeName.length > 40) safeName = safeName.substring(0, 40);

    return `${datePart}_${timePart}_${safeName}${suffix}.md`;
}

// Session export metadata for index generation
interface SessionExport {
    filename: string;
    title: string;
    itemCount: number;
    exportedAt: string;
    sessionId?: string;
}

// Generate beautiful HTML index page
function generateHtmlIndex(sessions: SessionExport[], outputDir: string): void {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🚀 Antigravity Session Archive</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
            min-height: 100vh;
            color: #e0e0e0;
            padding: 2rem;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        header {
            text-align: center;
            margin-bottom: 3rem;
            padding: 2rem;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        h1 {
            font-size: 2.5rem;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        .stats {
            color: #888;
            font-size: 0.95rem;
        }
        .search-box {
            margin: 2rem 0;
            position: relative;
        }
        .search-box input {
            width: 100%;
            padding: 1rem 1rem 1rem 3rem;
            font-size: 1rem;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 12px;
            color: #fff;
            outline: none;
            transition: all 0.3s ease;
        }
        .search-box input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
        }
        .search-box::before {
            content: '🔍';
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            font-size: 1.2rem;
        }
        .sessions {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 1.5rem;
        }
        .session-card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 1.5rem;
            transition: all 0.3s ease;
            text-decoration: none;
            color: inherit;
            display: block;
        }
        .session-card:hover {
            transform: translateY(-4px);
            background: rgba(255,255,255,0.08);
            border-color: #667eea;
            box-shadow: 0 12px 40px rgba(0,0,0,0.3);
        }
        .session-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #fff;
            margin-bottom: 0.75rem;
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .session-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.85rem;
            color: #888;
        }
        .session-meta span {
            display: flex;
            align-items: center;
            gap: 0.3rem;
        }
        .badge {
            display: inline-block;
            padding: 0.25rem 0.6rem;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px;
            font-size: 0.75rem;
            color: #fff;
            margin-top: 0.75rem;
        }
        .hidden { display: none !important; }
        footer {
            text-align: center;
            margin-top: 3rem;
            color: #666;
            font-size: 0.85rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 Antigravity Session Archive</h1>
            <p class="stats">
                ${sessions.length} sessions • ${sessions.reduce((a, s) => a + s.itemCount, 0).toLocaleString()} total items • 
                Generated ${new Date().toLocaleString()}
            </p>
        </header>
        
        <div class="search-box">
            <input type="text" id="search" placeholder="Search sessions..." autocomplete="off">
        </div>
        
        <div class="sessions">
            ${sessions.map(s => `
            <a href="${s.filename}" class="session-card" data-title="${s.title.toLowerCase()}">
                <div class="session-title">${escapeHtml(s.title)}</div>
                <div class="session-meta">
                    <span>📄 ${s.itemCount} items</span>
                    <span>🕐 ${new Date(s.exportedAt).toLocaleDateString()}</span>
                </div>
                ${s.sessionId ? `<span class="badge">${s.sessionId.slice(0, 8)}</span>` : ''}
            </a>
            `).join('')}
        </div>
        
        <footer>
            <p>Exported with 🤖 Angrav • <a href="https://github.com/simik394/osobni_wf" style="color: #667eea;">View on GitHub</a></p>
        </footer>
    </div>
    
    <script>
        const searchInput = document.getElementById('search');
        const cards = document.querySelectorAll('.session-card');
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            cards.forEach(card => {
                const title = card.dataset.title;
                if (title.includes(query)) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        });
    </script>
</body>
</html>`;

    const indexPath = path.join(outputDir, 'index.html');
    fs.writeFileSync(indexPath, html);
    console.log(`📄 Generated HTML index: ${indexPath}`);
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function main() {
    const args = process.argv.slice(2);


    // Parse flags
    const dumpAll = args.includes('--all');
    const incremental = args.includes('--incremental') || args.includes('-i');
    const fresh = args.includes('--fresh') || args.includes('-f');
    const showTokens = args.includes('--tokens') || args.includes('-t');
    const generateIndex = args.includes('--html-index') || args.includes('--index');

    // Parse output directory
    const outputDirIdx = args.indexOf('--output-dir');
    let outputDir: string | null = null;
    if (outputDirIdx !== -1 && args[outputDirIdx + 1]) {
        outputDir = args[outputDirIdx + 1];
    }

    // Parse limit
    const limitArgIndex = args.indexOf('--limit');
    let limitPx: number | undefined;
    if (limitArgIndex !== -1 && args[limitArgIndex + 1]) {
        limitPx = parseInt(args[limitArgIndex + 1], 10);
    }

    console.log('DEBUG DUMP: raw args:', args);
    console.log('DEBUG DUMP: parsed limitPx:', limitPx);

    // Parse session name (ignore flags and limit value)
    const sessionName = args.find((a, i) => {
        if (a.startsWith('-')) return false;
        // Ignore the value after --limit
        if (i > 0 && args[i - 1] === '--limit') return false;
        return true;
    });

    console.log('🚀 Starting Angrav Session History Dump...');
    if (incremental && !fresh) {
        console.log('   Mode: INCREMENTAL (new items only)');
    } else {
        console.log('   Mode: FRESH (full history)');
    }
    if (dumpAll) {
        console.log('   Scope: ALL sessions');
    } else if (sessionName) {
        console.log(`   Scope: Session "${sessionName}"`);
    } else {
        console.log('   Scope: ACTIVE session only');
    }

    const dumpDir = outputDir ? path.resolve(outputDir) : path.resolve(process.cwd(), 'history_dump');
    if (!fs.existsSync(dumpDir)) {
        fs.mkdirSync(dumpDir, { recursive: true });
    }

    // Track exported sessions for HTML index
    const exportedSessions: SessionExport[] = [];

    let browser;
    try {
        console.log(`🔌 Connecting to Browser at: ${CDP_ENDPOINT}`);
        browser = await chromium.connectOverCDP(CDP_ENDPOINT);
        const context = browser.contexts()[0];

        if (!context) {
            console.error('❌ Connected but no default context found.');
            return;
        }

        const pages = context.pages();
        console.log(`🔍 Found ${pages.length} pages.`);

        // Find the Editor window (not Launchpad)
        let editorPage = pages.find(p => {
            const url = p.url();
            return url.includes('workbench.html') && !url.includes('workbench-jetski-agent');
        });

        if (!editorPage) {
            editorPage = pages.find(p => !p.url().includes('devtools://'));
        }

        if (!editorPage) {
            console.error('❌ No Editor page found.');
            return;
        }

        const pageTitle = await editorPage.title();
        console.log(`✅ Using Editor Page: "${pageTitle}"`);

        // Find the Agent Panel frame
        let agentFrame;
        try {
            agentFrame = await getAgentFrame(editorPage);
            console.log('✅ Found Agent Panel frame.');
        } catch (e) {
            console.error('❌ Could not find Agent Panel frame. Is the Agent view open?');
            return;
        }

        // Determine which sessions to dump
        let sessionsToProcess: { name: string; id?: string }[] = [];

        if (dumpAll) {
            // Need to find the Agent Manager to list sessions
            const managerPage = pages.find(p => p.url().includes('workbench-jetski-agent'));
            if (managerPage) {
                const sessions = await listSessions(managerPage.mainFrame());
                sessionsToProcess = sessions;
                console.log(`📋 Found ${sessions.length} sessions to dump.`);
            } else {
                console.warn('⚠️ Agent Manager not open. Cannot list all sessions.');
                console.log('   Falling back to active session only.');
            }
        } else if (sessionName) {
            sessionsToProcess = [{ name: sessionName, id: '' }];
        }

        // If no sessions specified, just dump the current one
        if (sessionsToProcess.length === 0) {
            console.log('📜 Extracting ACTIVE session...');

            const { items } = await getStructuredHistory(agentFrame, limitPx);
            console.log(`  ✅ Extracted ${items.length} total items.`);

            if (items.length > 0) {
                // Truncate name to avoid ENAMETOOLONG 
                let safeName = pageTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'active';
                if (safeName.length > 80) safeName = safeName.substring(0, 80);

                // Handle incremental mode
                let itemsToSave = items;
                let suffix = '';

                if (incremental && !fresh) {
                    const prevState = loadState(safeName);
                    if (prevState) {
                        console.log(`  📊 Previous state: ${prevState.lastItemCount} items from ${prevState.lastTimestamp}`);

                        // Find items after the last known key
                        const lastKeyIndex = items.findIndex((item: any) => item.key === prevState.lastItemKey);
                        if (lastKeyIndex >= 0) {
                            itemsToSave = items.slice(lastKeyIndex + 1);
                            console.log(`  🔍 Found ${itemsToSave.length} new items since last scrape.`);
                        } else {
                            // Key not found - maybe session changed, do full
                            console.log(`  ⚠️ Previous key not found, including all items.`);
                        }
                        suffix = '_incr';
                    } else {
                        console.log(`  📊 No previous state found, will save full history.`);
                    }
                }

                // Save new state
                const lastItem = items[items.length - 1] as any;
                saveState({
                    sessionId: safeName,
                    lastItemCount: items.length,
                    lastItemKey: lastItem?.key || '',
                    lastTimestamp: new Date().toISOString()
                });

                if (itemsToSave.length > 0) {
                    // Deduplicate items before saving
                    const dedupedItems = deduplicateItems(itemsToSave);
                    console.log(`  🧹 Deduplicated: ${itemsToSave.length} → ${dedupedItems.length} items`);

                    // Archive old files before saving new
                    const archivedCount = archiveOldFiles(dumpDir);
                    if (archivedCount > 0) {
                        console.log(`  📁 Archived ${archivedCount} old files`);
                    }

                    // Use better filename format
                    const fileName = generateFilename(pageTitle, suffix);
                    const fileContent = formatOutput(dedupedItems, pageTitle);
                    const filePath = path.join(dumpDir, fileName);
                    fs.writeFileSync(filePath, fileContent);
                    console.log(`  💾 Saved ${dedupedItems.length} items to: ${filePath}`);

                    // Track for HTML index
                    exportedSessions.push({
                        filename: fileName,
                        title: pageTitle,
                        itemCount: dedupedItems.length,
                        exportedAt: new Date().toISOString(),
                    });

                    // Token counting
                    if (showTokens) {
                        console.log(`  🔢 Counting tokens with Gemini...`);
                        const incrementTokens = await countTokensWithGemini(fileContent);
                        if (incrementTokens !== null) {
                            console.log(`  📊 Increment tokens: ${incrementTokens.toLocaleString()} tokens`);
                        }

                        // In incremental mode, also count total session
                        if (incremental && !fresh && itemsToSave !== items) {
                            const fullContent = formatOutput(items);
                            const totalTokens = await countTokensWithGemini(fullContent);
                            if (totalTokens !== null) {
                                console.log(`  📊 Total session tokens: ${totalTokens.toLocaleString()} tokens`);
                            }
                        }
                    }
                } else {
                    console.log(`  ℹ️ No new items to save.`);
                }
            } else {
                console.warn('  ⚠️ No content found.');
            }
        } else {
            // Process each session
            for (const session of sessionsToProcess) {
                console.log(`\n📂 Processing session: "${session.name}"...`);

                // Switch to session if we have manager access
                if (dumpAll) {
                    const managerPage = pages.find(p => p.url().includes('workbench-jetski-agent'));
                    if (managerPage) {
                        const switched = await switchSession(managerPage.mainFrame(), session.name);
                        if (!switched) {
                            console.error(`  ❌ Failed to switch to session "${session.name}"`);
                            continue;
                        }
                        // Wait for content to load
                        await editorPage.waitForTimeout(2000);
                        // Re-get agent frame (may have changed)
                        try {
                            agentFrame = await getAgentFrame(editorPage);
                        } catch (e) {
                            console.error(`  ❌ Agent frame not found after switch.`);
                            continue;
                        }
                    }
                }

                // Extract history
                const { items } = await getStructuredHistory(agentFrame, limitPx);
                console.log(`  ✅ Extracted ${items.length} items.`);

                if (items.length > 0) {
                    const safeName = session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const fileName = `${safeName}_${Date.now()}.md`;
                    const fileContent = formatOutput(items, session.name);
                    const filePath = path.join(dumpDir, fileName);
                    fs.writeFileSync(filePath, fileContent);
                    console.log(`  💾 Saved to: ${filePath}`);

                    // Track for HTML index
                    exportedSessions.push({
                        filename: fileName,
                        title: session.name,
                        itemCount: items.length,
                        exportedAt: new Date().toISOString(),
                        sessionId: session.id,
                    });
                }
            }
        }

        // Generate HTML index if requested
        if (generateIndex && exportedSessions.length > 0) {
            generateHtmlIndex(exportedSessions, dumpDir);
        }

        console.log('\n✅ Dump complete.');

    } catch (error) {
        console.error('🔥 Fatal error:', error);
    } finally {
        if (browser) await browser.close();
    }
}

function formatOutput(items: any[], sessionName?: string) {
    let output = '';

    if (sessionName) {
        output += `# 🤖 Angrav Session Export: ${sessionName}\n`;
        output += `**Date:** ${new Date().toISOString()}\n`;
        output += `**Items:** ${items.length}\n`;
        output += `---\n\n`;
    }

    for (const item of items) {
        // Skip items with empty content
        if (!item.content || item.content.trim().length === 0) continue;

        let content = item.content.trim();

        switch (item.type) {
            case 'user':
                output += `## 👤 User\n${content}\n\n`;
                break;
            case 'agent':
                output += `## 🤖 Agent\n${content}\n\n`;
                break;
            case 'thought':
                output += `> [!NOTE] Thought\n> ${content.replace(/\n/g, '\n> ')}\n\n`;
                break;
            case 'tool-call':
                output += `### 🛠️ Tool Call\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
                break;
            case 'tool-output':
                output += `### 📝 Tool Output\n\`\`\`text\n${content}\n\`\`\`\n\n`;
                break;
            case 'tool-result':
                output += `### 📊 Tool Result\n\`\`\`json\n${content}\n\`\`\`\n\n`;
                break;
            case 'code':
                output += `### 💻 Code\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
                break;
            case 'file-change':
                // Fallback if not caught by file-activity
                output += `### 📁 File Change\n\`\`\`diff\n${content}\n\`\`\`\n\n`;
                break;
            case 'file-diff':
                // Expanded diff content with actual code changes
                output += `### 📝 File Diff\n\`\`\`diff\n${content}\n\`\`\`\n\n`;
                break;
            case 'tool-call-arg':
                // Tool call arguments (JSON-like)
                output += `### 🔧 Tool Args\n\`\`\`json\n${content}\n\`\`\`\n\n`;
                break;
            case 'timestamp':
                // Timestamp marker
                output += `*⏱️ ${content}*\n\n`;
                break;
            case 'file-activity':
                // e.g. "Edited session.ts"
                let icon = '📄';
                if (content.startsWith('Edited')) icon = '✏️';
                else if (content.startsWith('Analyzed')) icon = '🔍';
                else if (content.startsWith('Viewed') || content.startsWith('Reading') || content.startsWith('Read')) icon = '👀';
                else if (content.startsWith('Created')) icon = '✨';
                else if (content.startsWith('Deleted')) icon = '🗑️';

                output += `### ${icon} ${content}\n\n`;
                break;
            case 'terminal':
                output += `### 💲 Terminal\n\`\`\`bash\n${item.content}\n\`\`\`\n\n`;
                break;
            case 'task-status':
                output += `### 🎯 Task Status\n**${item.content}**\n\n`;
                break;
            case 'error':
                output += `> [!CAUTION] Error\n> ${item.content}\n\n`;
                break;
            case 'image':
                output += `### 🖼️ Image\n![Image](${item.content})\n\n`;
                break;
            case 'table':
                output += `### 📊 Table\n${item.content}\n\n`;
                break;
            default:
                output += `### [${item.type.toUpperCase()}]\n${item.content}\n\n`;
        }
    }

    return output;
}

main();
