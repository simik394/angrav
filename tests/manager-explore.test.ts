import { test, expect, chromium } from '@playwright/test';

test.describe('Agent Manager Exploration', () => {
    test('should explore Agent Manager access', async () => {
        // Connect via CDP
        console.log('🚀 Connecting to Antigravity...');
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const contexts = browser.contexts();
        const context = contexts[0];
        const pages = context.pages();

        console.log(`Found ${pages.length} pages:`);
        pages.forEach((p, i) => {
            console.log(`  ${i}: ${p.url()}`);
        });

        // Find main workbench
        const workbench = pages.find(p => p.url().includes('workbench.html'));
        if (!workbench) {
            throw new Error('Workbench page not found');
        }

        // List all frames
        console.log('\n📄 Frames in workbench:');
        workbench.frames().forEach((f, i) => {
            console.log(`  ${i}: ${f.url()}`);
        });

        // Try keyboard shortcut for Manager View
        console.log('\n🔍 Trying to open Agent Manager...');

        // Try View menu > Agent Manager (common pattern)
        // First, try Ctrl+Shift+M
        await workbench.keyboard.press('Control+Shift+M');
        await workbench.waitForTimeout(1000);

        // Check for new pages/frames
        const newPages = context.pages();
        console.log(`\nAfter Ctrl+Shift+M: ${newPages.length} pages`);
        newPages.forEach((p, i) => {
            console.log(`  ${i}: ${p.url()}`);
        });

        // Check frames again
        console.log('\nFrames after shortcut:');
        workbench.frames().forEach((f, i) => {
            console.log(`  ${i}: ${f.url()}`);
        });

        // Look for manager-related elements in DOM
        console.log('\n🔍 Looking for manager elements in DOM...');

        // Try to find Manager button or panel
        const managerBtn = workbench.locator('button:has-text("Manager"), [aria-label*="manager"], [title*="Manager"]');
        const managerCount = await managerBtn.count();
        console.log(`Manager buttons found: ${managerCount}`);

        // Check activity bar for manager icon
        const activityBar = workbench.locator('.activitybar');
        const activityItems = activityBar.locator('.action-item');
        const activityCount = await activityItems.count();
        console.log(`Activity bar items: ${activityCount}`);

        for (let i = 0; i < Math.min(activityCount, 10); i++) {
            const item = activityItems.nth(i);
            const title = await item.getAttribute('title') || await item.getAttribute('aria-label') || 'no-title';
            console.log(`  Activity item ${i}: ${title}`);
        }

        // Look for any panels or views with "manager" or "mission" in them
        const allText = await workbench.locator('body').innerHTML();
        const hasManager = allText.toLowerCase().includes('manager');
        const hasMission = allText.toLowerCase().includes('mission');
        console.log(`\nDOM contains 'manager': ${hasManager}`);
        console.log(`DOM contains 'mission': ${hasMission}`);

        // Try command palette
        console.log('\n🔍 Opening command palette...');
        await workbench.keyboard.press('Control+Shift+P');
        await workbench.waitForTimeout(500);

        const commandInput = workbench.locator('.quick-input-widget input');
        if (await commandInput.isVisible()) {
            await commandInput.fill('agent manager');
            await workbench.waitForTimeout(500);

            // Check suggestions
            const suggestions = workbench.locator('.quick-input-list .monaco-list-row');
            const sugCount = await suggestions.count();
            console.log(`Command suggestions for "agent manager": ${sugCount}`);
            for (let i = 0; i < Math.min(sugCount, 5); i++) {
                const text = await suggestions.nth(i).innerText();
                console.log(`  ${i}: ${text}`);
            }

            // Try 'manager' alone
            await commandInput.fill('manager');
            await workbench.waitForTimeout(500);
            const sugCount2 = await suggestions.count();
            console.log(`\nCommand suggestions for "manager": ${sugCount2}`);
            for (let i = 0; i < Math.min(sugCount2, 5); i++) {
                const text = await suggestions.nth(i).innerText();
                console.log(`  ${i}: ${text}`);
            }

            // Try 'mission'
            await commandInput.fill('mission');
            await workbench.waitForTimeout(500);
            const sugCount3 = await suggestions.count();
            console.log(`\nCommand suggestions for "mission": ${sugCount3}`);
            for (let i = 0; i < Math.min(sugCount3, 5); i++) {
                const text = await suggestions.nth(i).innerText();
                console.log(`  ${i}: ${text}`);
            }

            // Close command palette
            await workbench.keyboard.press('Escape');
        }

        await browser.close();
    });
});
