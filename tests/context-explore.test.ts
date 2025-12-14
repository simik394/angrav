import { test, expect } from '@playwright/test';
import { connectToApp, getAgentFrame } from '../src/core';
import { dumpContextUIStructure, addFileContext } from '../src/context';

/**
 * Context Injection Exploration Test
 * 
 * Purpose: Discover selectors for @file popup and context menu.
 * Run via: BROWSER_CDP_ENDPOINT=http://localhost:9223 npx playwright test tests/context-explore.test.ts
 */

test.describe('Context Injection - Selector Discovery', () => {
    test('dump chat input container structure', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Dump structure around chat input
            const html = await dumpContextUIStructure(frame);
            console.log('\n=== CHAT CONTAINER STRUCTURE ===\n');
            console.log(html);
            console.log('\n================================\n');

            expect(html).not.toBe('Chat input not found');
        } finally {
            await browser.close();
        }
    });

    test('trigger @file popup and capture structure', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9223';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Find and focus chat input
            const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();
            await input.click();

            // Type @ to trigger popup
            await page.keyboard.type('@');

            // Wait for popup
            await page.waitForTimeout(1000);

            // Capture full frame HTML to find popup selector
            const popupHtml = await frame.evaluate(() => {
                // Look for popup-like elements that appeared
                const popups = document.querySelectorAll('[class*="popup"], [class*="dropdown"], [class*="menu"], [class*="suggest"], [role="listbox"], [role="menu"]');
                return Array.from(popups).map(p => ({
                    classes: p.className,
                    role: p.getAttribute('role'),
                    html: p.outerHTML.slice(0, 500)
                }));
            });

            console.log('\n=== POTENTIAL POPUP ELEMENTS ===\n');
            console.log(JSON.stringify(popupHtml, null, 2));
            console.log('\n================================\n');

            // Clear the @
            await page.keyboard.press('Backspace');

        } finally {
            await browser.close();
        }
    });

    test('test addFileContext with sample filename', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9223';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Try adding a file context (will log progress)
            await addFileContext(frame, page, 'README');

            // Wait a moment before cleanup
            await page.waitForTimeout(1000);

            console.log('✅ addFileContext completed without throwing');

        } finally {
            await browser.close();
        }
    });
});
