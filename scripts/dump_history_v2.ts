
import * as fs from 'fs';
import * as path from 'path';
import { connectToApp, getAgentFrame } from '../src/core';
import { getStructuredHistory } from '../src/session';

function log(msg: string) {
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function saveSession(sessionName: string, items: any[], dumpDir: string) {
    let fileContent = `Session: ${sessionName}\nDate: ${new Date().toISOString()}\nMessages: ${items.length}\n===\n\n`;
    items.forEach(item => {
        fileContent += `[${item.type.toUpperCase()}]\n${item.content}\n---\n`;
    });

    const safeName = sessionName.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 100);
    const filePath = path.join(dumpDir, `${safeName}.txt`);
    fs.writeFileSync(filePath, fileContent);
    log(`  💾 Saved: ${safeName}.txt`);
}

async function main() {
    log('🚀 Starting Angrav Session History Dump V2...');

    const dumpDir = path.resolve(process.cwd(), 'history_dump');
    if (!fs.existsSync(dumpDir)) {
        fs.mkdirSync(dumpDir, { recursive: true });
    }

    let browser;
    try {
        log('🔌 Connecting to Antigravity...');
        const conn = await connectToApp();
        browser = conn.browser;
        const context = conn.context;

        // 1. Identify Windows
        const pages = context.pages();
        const managerPage = pages.find(p => p.url().includes('workbench-jetski-agent.html'));
        // Find an editor page (NOT jetski-agent)
        // We prefer the one that is "01-pwf" if available, or just the first workbench
        const editorPage = pages.find(p => p.url().includes('workbench.html') && !p.url().includes('jetski-agent'));

        if (!managerPage) throw new Error('❌ Agent Manager window not found.');
        if (!editorPage) log('⚠️ Editor window NOT found initially. Will try to find it later.');
        else log(`✅ Found Editor window: "${await editorPage.title()}"`);

        log(`✅ Found Manager window: "${await managerPage.title()}"`);

        // 2. List Sessions from Manager
        log('📋 Listing sessions from Manager...');

        // Selector based on debug dump: Class="select-none hover:bg-list-hove..."
        // We'll use a loose match on the class
        const sessionButtons = managerPage.locator('[class*="hover:bg-list-hove"]');
        const count = await sessionButtons.count();

        if (count === 0) {
            log('⚠️ No sessions found in Manager (selector mismatch?).');
            return;
        }

        log(`✅ Found ${count} potential sessions.`);

        // Extract session info first to avoid stale elements issues
        const sessions = [];
        for (let i = 0; i < count; i++) {
            const btn = sessionButtons.nth(i);
            const name = await btn.innerText().catch(() => `Session ${i}`);
            // Filter out obviously wrong items if any
            if (name.trim().length > 3) {
                sessions.push({ index: i, name: name.trim() });
            }
        }

        log(`📋 Processing ${sessions.length} valid sessions...`);

        // 3. Iterate
        for (let i = 0; i < sessions.length; i++) {
            const session = sessions[i];
            log(`
[${i + 1}/${sessions.length}] Processing: "${session.name}"`);

            try {
                // A. Switch Session (Click in Manager)
                log('  🖱️ Switching session in Manager...');
                // Refetch button to avoid detached element
                const btn = sessionButtons.nth(session.index);
                await btn.click();

                // B. Wait for content load
                log('  ⏳ Waiting 10s for session load...');
                await managerPage.waitForTimeout(10000);

                // C. Check for "Agent taking unexpectedly long to load"
                log('  👀 Checking for load error or content...');
                try {
                    // Check for the specific error message or button
                    const openEditorBtn = managerPage.locator('button:has-text("Open Editor")');
                    const errorVisible = await openEditorBtn.isVisible({ timeout: 2000 }).catch(() => false);

                    if (errorVisible) {
                        log('  ⚠️ Detected load error ("Agent taking unexpectedly long to load"). SKIPPING.');
                        continue; // Skip this session
                    }
                } catch (e) {
                    // Ignore
                }

                // C. Normal Path: Scrape from Manager (or existing editor if logic flows there)
                // We assume clicking opens/focuses the editor.
                // We need to find the ACTIVE editor page.
                let activeEditorPage = editorPage;
                if (!activeEditorPage || activeEditorPage.isClosed()) {
                    activeEditorPage = context.pages().find(p => p.url().includes('workbench.html') && !p.url().includes('jetski-agent'));
                }

                if (!activeEditorPage) {
                    log('  ⏳ Waiting for editor window...');
                    activeEditorPage = await context.waitForEvent('page', { timeout: 2000 }).catch(() => undefined);
                }

                if (!activeEditorPage) {
                    log('  ❌ No editor window found. Skipping.');
                    continue;
                }

                // C. Get Agent Frame in Editor
                // Retry getting frame as it might be reloading content
                let agentFrame;
                for (let attempt = 0; attempt < 10; attempt++) {
                    try {
                        await activeEditorPage.waitForTimeout(1000); // Allow render
                        agentFrame = await getAgentFrame(activeEditorPage);
                        // Check if it's the right session? 
                        if (await agentFrame.locator('.bg-ide-chat-background').count() > 0) {
                            break;
                        }
                    } catch (e) {
                        // log(`    Frame attempt ${attempt+1} failed.`);
                    }
                }

                if (!agentFrame) {
                    log('  ❌ Could not get agent frame. Skipping.');
                    continue;
                }

                // D. Scrape
                log('  📥 Extracting history...');
                try {
                    // Wait max 5s for content
                    await agentFrame.waitForSelector('.bg-ide-chat-background', { timeout: 5000 });
                } catch (e) {
                    log('    ⚠️ Timeout waiting for content. Skipping.');
                    continue;
                }

                const { items } = await getStructuredHistory(agentFrame);

                if (items.length === 0) {
                    log('    ⚠️ 0 messages found. Skipping.');
                    continue;
                } else {
                    log(`    ✅ ${items.length} messages extracted.`);
                }

                // E. Save
                saveSession(session.name, items, dumpDir);

                // Switch back focus to Manager for next click? 
                // Playwright doesn't strictly need focus, but let's ensure we are interacting with Manager page next loop.
                await managerPage.bringToFront();

            } catch (err) {
                log(`  ❌ Error: ${(err as Error).message}`);
            }
        }

    } catch (error) {
        log(`🔥 Fatal: ${(error as Error).message}`);
    } finally {
        if (browser) {
            log('🔌 Closing connection...');
            await browser.close();
        }
    }
}

main();
