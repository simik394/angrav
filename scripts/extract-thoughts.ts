/**
 * Extract thoughts with scrolling to capture full content
 */
import { chromium } from '@playwright/test';

const CDP = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

async function main() {
    console.log(`Connecting to ${CDP}...`);
    const browser = await chromium.connectOverCDP(CDP);
    const context = browser.contexts()[0];
    const pages = context.pages();

    for (const page of pages) {
        if (!page.url().includes('workbench.html')) continue;

        const frames = page.frames();
        for (const frame of frames) {
            if (!frame.url().includes('cascade-panel')) continue;

            console.log('\n🎯 Found cascade-panel frame\n');

            // Find thought button and click it to expand
            const btn = frame.locator('button:has-text("Thought")').first();
            if (await btn.count() > 0) {
                console.log('Clicking thought button...');
                await btn.click();
                await frame.waitForTimeout(500);
            }

            // Get thoughts: Find prose element that has opacity-70 in its class
            const thoughtData = await frame.evaluate(() => {
                const allProse = document.querySelectorAll('.prose');
                for (const p of Array.from(allProse)) {
                    if (p.className.includes('opacity-70')) {
                        const el = p as HTMLElement;
                        return {
                            found: true,
                            text: el.innerText,
                            scrollHeight: el.scrollHeight,
                            clientHeight: el.clientHeight,
                            isScrollable: el.scrollHeight > el.clientHeight
                        };
                    }
                }
                return { found: false, text: '', scrollHeight: 0, clientHeight: 0, isScrollable: false };
            });

            if (thoughtData.found) {
                console.log('=== EXTRACTED THOUGHTS ===\n');
                console.log(thoughtData.text);
                console.log('\n=== END THOUGHTS ===');
                console.log('Length:', thoughtData.text.length, 'chars');
                console.log('Scrollable:', thoughtData.isScrollable,
                    '(scrollH:', thoughtData.scrollHeight, 'clientH:', thoughtData.clientHeight, ')');
            } else {
                console.log('No thought container found');
            }
        }
    }

    await browser.close();
}

main().catch(console.error);
