import { test, expect } from '@playwright/test';
import { connectToApp, getAgentFrame } from '../src/core';

/**
 * Context Menu Exploration Test
 * 
 * Purpose: Discover selectors for all @ menu options:
 * - Code Context Items
 * - Files
 * - Directories
 * - MCP servers
 * - Rules
 * - Conversations
 * - Terminal
 */

test.describe('Context Menu - Full Options Discovery', () => {
    test('capture all @ menu options', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Find and focus chat input
            const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();
            await input.click();

            // Type @ to trigger popup
            await page.keyboard.type('@');

            // Wait for popup to fully render
            await page.waitForTimeout(1500);

            // Capture all menu items in the popup
            const menuItems = await frame.evaluate(() => {
                // Look for the popup container
                const popup = document.querySelector('.lexical-typeahead-menu, [role="listbox"]');
                if (!popup) return { error: 'Popup not found', html: '' };

                // Get all option items
                const items = popup.querySelectorAll('[role="option"], li, .menu-item, [data-option]');
                const itemData = Array.from(items).map(item => ({
                    text: item.textContent?.trim(),
                    classes: item.className,
                    dataAttrs: Array.from(item.attributes)
                        .filter(a => a.name.startsWith('data-'))
                        .map(a => `${a.name}="${a.value}"`),
                    ariaLabel: item.getAttribute('aria-label'),
                    selector: item.tagName.toLowerCase() +
                        (item.className ? '.' + item.className.split(' ').join('.') : '')
                }));

                return {
                    popupClasses: popup.className,
                    popupRole: popup.getAttribute('role'),
                    items: itemData,
                    fullHtml: popup.outerHTML.slice(0, 3000)
                };
            });

            console.log('\n=== @ MENU STRUCTURE ===\n');
            console.log(JSON.stringify(menuItems, null, 2));
            console.log('\n========================\n');

            // Also look for the + button
            const plusButton = await frame.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                const plusBtn = Array.from(buttons).find(b =>
                    b.textContent?.includes('+') ||
                    b.querySelector('svg[data-icon="plus"]') ||
                    b.getAttribute('aria-label')?.includes('Add') ||
                    b.getAttribute('aria-label')?.includes('context')
                );
                if (plusBtn) {
                    return {
                        classes: plusBtn.className,
                        ariaLabel: plusBtn.getAttribute('aria-label'),
                        html: plusBtn.outerHTML.slice(0, 500)
                    };
                }
                return null;
            });

            console.log('\n=== + BUTTON ===\n');
            console.log(JSON.stringify(plusButton, null, 2));
            console.log('\n================\n');

            // Clear the @
            await page.keyboard.press('Backspace');

            expect(menuItems).not.toHaveProperty('error');

        } finally {
            await browser.close();
        }
    });

    test('explore each @ option submenu', async () => {
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
        const { browser, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);
            const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();

            const options = ['Files', 'Directories', 'Terminal', 'Rules', 'Conversations'];

            for (const option of options) {
                // Type @ and the option name
                await input.click();
                await page.keyboard.type('@');
                await page.waitForTimeout(500);
                await page.keyboard.type(option.toLowerCase().slice(0, 3)); // Type first 3 chars
                await page.waitForTimeout(500);

                // Capture what's visible
                const state = await frame.evaluate((opt) => {
                    const popup = document.querySelector('.lexical-typeahead-menu, [role="listbox"]');
                    const visibleItems = popup?.querySelectorAll('[role="option"]') || [];
                    return {
                        option: opt,
                        visibleCount: visibleItems.length,
                        items: Array.from(visibleItems).slice(0, 5).map(i => i.textContent?.trim())
                    };
                }, option);

                console.log(`\n${option}: ${JSON.stringify(state)}`);

                // Clear and reset
                await page.keyboard.press('Escape');
                await page.waitForTimeout(200);
            }

        } finally {
            await browser.close();
        }
    });
});
