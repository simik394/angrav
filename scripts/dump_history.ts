
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { getStructuredHistory, listSessions, switchSession } from '../src/session';
import { getAgentFrame } from '../src/core';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

async function main() {
    const args = process.argv.slice(2);
    const dumpAll = args.includes('--all');
    const sessionName = args.find(a => !a.startsWith('--'));

    console.log('🚀 Starting Angrav Session History Dump...');
    if (dumpAll) {
        console.log('   Mode: Dump ALL sessions');
    } else if (sessionName) {
        console.log(`   Mode: Dump session "${sessionName}"`);
    } else {
        console.log('   Mode: Dump ACTIVE session only');
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
            console.log(`  ✅ Extracted ${items.length} items.`);

            if (items.length > 0) {
                // Truncate name to avoid ENAMETOOLONG 
                let safeName = pageTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'active';
                if (safeName.length > 80) safeName = safeName.substring(0, 80);
                const fileName = `${safeName}_${Date.now()}.txt`;
                const fileContent = formatOutput(items);
                const filePath = path.join(dumpDir, fileName);
                fs.writeFileSync(filePath, fileContent);
                console.log(`  💾 Saved to: ${filePath}`);
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
            default: prefix = `[${item.type.toUpperCase()}]`;
        }
        output += `${prefix}\n${item.content}\n\n${'─'.repeat(40)}\n\n`;
    }

    return output;
}

main();
