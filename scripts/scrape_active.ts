import * as fs from 'fs';
import * as path from 'path';
import { connectToApp, getAgentFrame } from '../src/core';
import { getStructuredHistory } from '../src/session';

function log(msg: string) {
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
    log('🚀 Starting Active Session Scrape...');

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

        log('🔍 Finding Active Editor...');
        const pages = context.pages();
        let editorPage = pages.find(p => p.url().includes('workbench.html') && !p.url().includes('jetski-agent'));

        if (!editorPage) {
            log('⚠️ Editor not found immediately. Waiting 5s...');
            editorPage = await context.waitForEvent('page', { timeout: 5000 }).catch(() => undefined);
        }

        if (!editorPage) {
            log('❌ No editor window found. Available pages:');
            context.pages().forEach((p, i) => log(`  [${i}] "${p.url()}"`));
            throw new Error('❌ No editor window found.');
        }

        log(`✅ Found Editor: "${await editorPage.title()}"`);

        log('🖼️ Locating Agent Frame...');
        const agentFrame = await getAgentFrame(editorPage);
        
        log('📥 Extracting history...');
        const { items } = await getStructuredHistory(agentFrame);
        
        if (items.length === 0) {
            log('⚠️ No messages found in active chat.');
        } else {
            log(`✅ ${items.length} messages extracted.`);
            
            // Try to infer session name from first message or just use timestamp
            let sessionName = `manual_scrape_${Date.now()}`;
            // Try to find session title in UI if possible
            // ... skipping for now
            
            let fileContent = `Session: ${sessionName} (Manual Scrape)\nDate: ${new Date().toISOString()}\nMessages: ${items.length}\n===\n\n`;
            items.forEach(item => {
                fileContent += `[${item.type.toUpperCase()}]\n${item.content}\n---\n`;
            });

            const filePath = path.join(dumpDir, `${sessionName}.txt`);
            fs.writeFileSync(filePath, fileContent);
            log(`💾 Saved to: ${filePath}`);
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
