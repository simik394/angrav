import { chromium } from '@playwright/test';

async function main() {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages().find(p => p.url().includes('workbench-jetski-agent')) || defaultContext.pages()[0];

    if (!page) {
        console.error('No suitable page found.');
        process.exit(1);
    }

    console.log(`Connected to page: ${await page.title()}`);

    // Dump all frames
    const frames = page.frames();
    console.log(`Found ${frames.length} frames.`);

    for (const frame of frames) {
        console.log(`Scanning frame: ${frame.url()}`);
        try {
            const found = await frame.evaluate(() => {
                const els = Array.from(document.querySelectorAll('*'));
                return els
                    .filter(el => el.textContent && el.textContent.includes('Files With Changes'))
                    .map(el => ({
                        tagName: el.tagName,
                        className: el.className,
                        text: el.textContent?.substring(0, 50),
                        outerHTML: el.outerHTML.substring(0, 200)
                    }))
                    .slice(0, 5); // Limit output
            });

            if (found.length > 0) {
                console.log(`Found in frame ${frame.url()}:`, found);
            }
        } catch (e) {
            console.log(`Error scanning frame ${frame.url()}: ${e}`);
        }
    }

    await browser.close();
}

main().catch(console.error);
