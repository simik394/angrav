
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { getStructuredHistory } from '../src/session';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

async function main() {
    console.log('🚀 Starting Angrav Session History Dump (Browser Connection Mode)...');

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
        console.log(`🔍 Found ${pages.length} pages via Browser Connection.`);

        // Find the active window
        // If there's only one, use it.
        // We know 'Launchpad' (BF67...) is usually the one.
        let targetPage = pages.find(p => !p.url().includes('devtools://'));

        if (!targetPage) {
            if (pages.length > 0) targetPage = pages[0];
        }

        if (!targetPage) {
            console.error('❌ No valid pages found.');
            return;
        }

        console.log(`✅ Targeted Page: "${await targetPage.title()}"`);
        console.log(`   URL: ${targetPage.url()}`);

        const mainFrame = targetPage.mainFrame();

        // 1. Check for Chat in Main Frame
        console.log('🔍 Scanning Main Frame for chat content...');
        // We look for any text/elements that resemble the chat
        // Selector: div.bg-ide-chat-background
        const count = await mainFrame.locator('div.bg-ide-chat-background').count();
        console.log(`   Found ${count} message rows in Main Frame.`);

        let extractionSource = mainFrame;

        // 2. Check Frames (iframes)
        if (count === 0) {
            console.log('🔍 Scanning subframes for chat...');
            const frames = targetPage.frames();
            console.log(`   Found ${frames.length} subframes.`);

            for (const f of frames) {
                const fCount = await f.locator('div.bg-ide-chat-background').count();
                if (fCount > 0) {
                    console.log(`   ✅ Found ${fCount} rows in frame: ${f.url().slice(0, 50)}...`);
                    extractionSource = f;
                    break;
                }
            }
        }

        // 3. Extract
        console.log('📜 Extracting history...');
        const { items } = await getStructuredHistory(extractionSource);
        console.log(`  ✅ Extracted ${items.length} items.`);

        if (items.length > 0) {
            const fileName = `dump_${Date.now()}.txt`;
            const fileContent = items.map(i => `[${i.type.toUpperCase()}]\n${i.content}`).join('\n\n----------------\n\n');
            const filePath = path.join(dumpDir, fileName);
            fs.writeFileSync(filePath, fileContent);
            console.log(`  💾 Saved to: ${filePath}`);
        } else {
            console.warn('  ⚠️ No content found. Dumping frame HTML to debug...');
            const html = await extractionSource.content();
            const debugPath = path.join(dumpDir, 'debug_browser_mode.html');
            fs.writeFileSync(debugPath, html);
            console.log(`  💾 Saved HTML dump to: ${debugPath}`);
        }

    } catch (error) {
        console.error('🔥 Fatal error:', error);
    } finally {
        if (browser) await browser.close();
    }
}

main();
