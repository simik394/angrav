import { connectToApp } from '../src/core';
import * as path from 'path';

async function main() {
    console.log('🔍 Taking screenshots of all pages...');
    
    let browser;
    try {
        const conn = await connectToApp();
        browser = conn.browser;
        const context = conn.context;

        const pages = context.pages();
        console.log(`Found ${pages.length} pages.`);

        for (const [i, p] of pages.entries()) {
            const title = await p.title().catch(() => 'Error');
            const url = p.url();
            console.log(`Page ${i}: "${title}" (${url})`);
            
            const screenshotPath = path.resolve(process.cwd(), `page_${i}_screenshot.png`);
            await p.screenshot({ path: screenshotPath });
            console.log(`  📸 Screenshot saved to: ${screenshotPath}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        if (browser) await browser.close();
    }
}

main();