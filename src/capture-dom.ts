/**
 * DOM Capture Script v4
 * Captures Agent Manager window DOM (separate window, not iframe)
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SNAPSHOT_DIR = path.join(__dirname, '../docs/dom-snapshots');
const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9223';

function timestamp(): string {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
}

async function saveDOM(content: string, component: string, description: string): Promise<string> {
    const filename = `${timestamp()}_${component}_${description}.html`;
    const filepath = path.join(SNAPSHOT_DIR, filename);
    fs.writeFileSync(filepath, content, 'utf-8');
    console.log(`✅ Saved: ${filename} (${Math.round(content.length / 1024)}KB)`);
    return filepath;
}

async function main() {
    console.log(`🚀 Connecting to ${CDP_ENDPOINT}...`);

    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const contexts = browser.contexts();

    if (contexts.length === 0) {
        console.error('❌ No browser contexts found');
        await browser.close();
        return;
    }

    const context = contexts[0];
    const pages = context.pages();

    console.log(`📄 Found ${pages.length} pages:`);
    pages.forEach((p, i) => {
        console.log(`  ${i}: ${p.url().slice(0, 80)}...`);
    });

    // Capture ALL pages - Agent Manager might be a separate window
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const url = page.url();

        let component = 'unknown';
        if (url.includes('jetski-agent')) {
            component = 'launchpad';
        } else if (url.includes('workbench')) {
            component = 'workbench';
        } else if (url.includes('manager') || url.includes('agent')) {
            component = 'agent-manager';
        }

        console.log(`\n📋 Capturing page ${i}: ${component}`);

        try {
            const html = await page.content();
            await saveDOM(html, component, `page-${i}`);

            // Also capture all frames
            for (const frame of page.frames()) {
                if (frame !== page.mainFrame()) {
                    try {
                        const frameHTML = await frame.content();
                        const frameName = frame.name() || 'unnamed';
                        await saveDOM(frameHTML, component, `frame-${frameName}`);
                    } catch (e) {
                        console.log(`  ⚠️ Frame capture failed: ${e}`);
                    }
                }
            }
        } catch (e) {
            console.log(`  ❌ Page capture failed: ${e}`);
        }
    }

    await browser.close();
    console.log('\n✅ DOM capture complete');
}

main().catch(console.error);
