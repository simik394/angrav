
import { chromium } from '@playwright/test';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

async function main() {
    console.log(`Connecting to ${CDP_ENDPOINT}...`);
    let browser;
    try {
        browser = await chromium.connectOverCDP(CDP_ENDPOINT);
        const contexts = browser.contexts();
        console.log(`Found ${contexts.length} contexts.`);

        for (const [c_idx, context] of contexts.entries()) {
            console.log(`\n=== Context ${c_idx} ===`);
            const pages = context.pages();
            console.log(`Found ${pages.length} pages in context ${c_idx}.`);

            for (const [i, page] of pages.entries()) {
                const title = await page.title().catch(() => 'Unknown');
                const url = page.url();
                console.log(`\n--- Page ${i + 1}: "${title}" ---`);
                console.log(`URL: ${url}`);

                const frames = page.frames();
                console.log(`Frames: ${frames.length}`);

                for (const [j, frame] of frames.entries()) {
                    const fUrl = frame.url();
                    const fName = frame.name();
                    console.log(`  [Frame ${j}] "${fName}": ${fUrl.slice(0, 100)}...`);

                    if (fUrl.includes('cascade-panel') || fUrl.includes('jetski-agent')) {
                        console.log('    ---> TARGET FOUND?');
                    }
                }
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        if (browser) await browser.close();
    }
}

main();
