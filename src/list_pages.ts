import { chromium } from 'playwright';

(async () => {
    try {
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const context = browser.contexts()[0];
        const pages = context.pages();

        console.log(`Found ${pages.length} pages:`);
        for (const page of pages) {
            const title = await page.title();
            const url = page.url();
            console.log(`- Title: "${title}"`);
            console.log(`  URL:   "${url}"`);
        }

        await browser.close();
    } catch (err) {
        console.error('Error connecting:', err);
    }
})();
