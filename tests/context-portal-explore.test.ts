import { test, expect } from '@playwright/test';
import { connectToApp, getAgentFrame } from '../src/core';

/**
 * Context Menu Exploration - Search All Locations
 * The @ popup might render outside the agent iframe as a portal
 */

test.describe('Context Menu - Portal Search', () => {
    test('search main page for @ popup after typing', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Focus and type @ in the agent frame
            const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();
            await input.click();
            await page.keyboard.type('@');
            await page.waitForTimeout(1500);

            // Search MAIN PAGE (not frame) for popups
            const mainPagePopups = await page.evaluate(() => {
                const results: any[] = [];

                // Search for various popup patterns
                const selectors = [
                    '[role="listbox"]',
                    '[role="menu"]',
                    '[class*="typeahead"]',
                    '[class*="popup"]',
                    '[class*="dropdown"]',
                    '[class*="suggest"]',
                    '[class*="autocomplete"]',
                    '.monaco-list',
                    '.quick-input-widget'
                ];

                for (const sel of selectors) {
                    const elements = document.querySelectorAll(sel);
                    elements.forEach(el => {
                        if (el.getBoundingClientRect().height > 0) { // Only visible ones
                            results.push({
                                selector: sel,
                                classes: el.className,
                                visible: true,
                                html: el.outerHTML.slice(0, 800)
                            });
                        }
                    });
                }

                return results;
            });

            console.log('\n=== MAIN PAGE POPUPS ===\n');
            console.log(JSON.stringify(mainPagePopups, null, 2));

            // Also search ALL iframes
            const allFrames = page.frames();
            console.log(`\n=== FOUND ${allFrames.length} FRAMES ===`);

            for (const f of allFrames) {
                const url = f.url();
                console.log(`Frame: ${url.slice(0, 80)}`);

                const framePopups = await f.evaluate(() => {
                    const popups = document.querySelectorAll('[role="listbox"], [role="menu"], [class*="typeahead"]');
                    return Array.from(popups).map(p => ({
                        classes: p.className,
                        visible: p.getBoundingClientRect().height > 0
                    }));
                }).catch(() => []);

                if (framePopups.length > 0) {
                    console.log(`  Popups: ${JSON.stringify(framePopups)}`);
                }
            }

            // Clear
            await page.keyboard.press('Backspace');

        } finally {
            await browser.close();
        }
    });

    test('inspect lexical editor structure', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Get the full structure around the input
            const structure = await frame.evaluate(() => {
                const input = document.querySelector('[data-lexical-editor="true"]');
                if (!input) return 'Input not found';

                // Go up to find container
                let container = input;
                for (let i = 0; i < 5; i++) {
                    if (container.parentElement) container = container.parentElement;
                }

                return container.outerHTML.slice(0, 3000);
            });

            console.log('\n=== LEXICAL EDITOR CONTAINER ===\n');
            console.log(structure);

        } finally {
            await browser.close();
        }
    });
});
