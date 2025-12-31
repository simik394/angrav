
import { chromium } from '@playwright/test';

async function diagnose() {
    console.log('Connecting to http://localhost:9222...');
    try {
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const context = browser.contexts()[0];
        const pages = context.pages();

        console.log(`Found ${pages.length} pages.`);
        for (const [i, p] of pages.entries()) {
            const title = await p.title();
            const url = p.url();
            console.log(`Page ${i + 1}:`);
            console.log(`  Title: "${title}"`);
            console.log(`  URL:   ${url}`);
        }
        await browser.close();
    } catch (e) {
        console.error('Error connecting or querying pages:', e);
    }
}

diagnose();
