
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

async function main() {
    const args = process.argv.slice(2);
    const dumpAll = args.includes('--all');
    const incremental = args.includes('--incremental') || args.includes('-i');
    const fresh = args.includes('--fresh') || args.includes('-f');
    const showTokens = args.includes('--tokens') || args.includes('-t');
    const sessionName = args.find(a => !a.startsWith('--') && !a.startsWith('-'));

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

    const dumpDir = path.resolve(process.cwd(), 'history_dump');
    if (!fs.existsSync(dumpDir)) {
        fs.mkdirSync(dumpDir, { recursive: true });
    }

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

            const { items } = await getStructuredHistory(agentFrame);
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
                    const fileName = `${safeName}${suffix}_${Date.now()}.txt`;
                    const fileContent = formatOutput(itemsToSave);
                    const filePath = path.join(dumpDir, fileName);
                    fs.writeFileSync(filePath, fileContent);
                    console.log(`  💾 Saved ${itemsToSave.length} items to: ${filePath}`);

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
                const { items } = await getStructuredHistory(agentFrame);
                console.log(`  ✅ Extracted ${items.length} items.`);

                if (items.length > 0) {
                    const safeName = session.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const fileName = `${safeName}_${Date.now()}.txt`;
                    const fileContent = formatOutput(items, session.name);
                    const filePath = path.join(dumpDir, fileName);
                    fs.writeFileSync(filePath, fileContent);
                    console.log(`  💾 Saved to: ${filePath}`);
                }
            }
        }

        console.log('\n✅ Dump complete.');

    } catch (error) {
        console.error('🔥 Fatal error:', error);
    } finally {
        if (browser) await browser.close();
    }
}

function formatOutput(items: { type: string; content: string }[], sessionName?: string): string {
    let output = '';

    if (sessionName) {
        output += `Session: ${sessionName}\n`;
        output += `Date: ${new Date().toISOString()}\n`;
        output += `Items: ${items.length}\n`;
        output += `${'='.repeat(50)}\n\n`;
    }

    for (const item of items) {
        // Skip items with empty content
        if (!item.content || item.content.trim().length === 0) continue;

        let prefix = '';
        switch (item.type) {
            case 'user': prefix = '👤 [USER]'; break;
            case 'agent': prefix = '🤖 [AGENT]'; break;
            case 'thought': prefix = '🤔 [THOUGHT]'; break;
            case 'tool-call':
                // Put tool name on same line as prefix
                output += `🛠️ [TOOL CALL] ${item.content}\n\n${'─'.repeat(40)}\n\n`;
                continue;
            case 'tool-output': prefix = '📝 [TOOL OUTPUT]'; break;
            case 'tool-result': prefix = '📊 [TOOL RESULT]'; break;
            case 'code': prefix = '💻 [CODE]'; break;
            case 'file-change': prefix = '📁 [FILE CHANGE]'; break;
            case 'terminal': prefix = '💲 [TERMINAL]'; break;
            case 'task-status': prefix = '🎯 [TASK STATUS]'; break;
            case 'file-link': prefix = '🔗 [FILE LINK]'; break;
            case 'approval': prefix = '✅ [APPROVAL]'; break;
            case 'error': prefix = '❌ [ERROR]'; break;
            case 'image': prefix = '🖼️ [IMAGE]'; break;
            case 'table': prefix = '📊 [TABLE]'; break;
            default: prefix = `[${item.type.toUpperCase()}]`;
        }
        output += `${prefix}\n${item.content}\n\n${'─'.repeat(40)}\n\n`;
    }

    return output;
}

main();
