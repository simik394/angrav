import { test, chromium } from '@playwright/test';

test('Open Agent Manager and list contents', async () => {
    console.log('🚀 Connecting...');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();

    // Find main workbench
    const workbench = pages.find(p => p.url().includes('workbench.html') && !p.url().includes('jetski'));
    if (!workbench) throw new Error('Workbench not found');

    // Find and click "Open Agent Manager" button
    console.log('🔍 Looking for Open Agent Manager button...');
    const openBtn = workbench.locator('.open-agent-manager-button, button:has-text("Open Agent Manager")').first();

    if (await openBtn.count() > 0) {
        console.log('✅ Found button, clicking...');
        await openBtn.click();
        await workbench.waitForTimeout(1000);
    } else {
        console.log('⌨️ Button not visible, trying Ctrl+E...');
        await workbench.keyboard.press('Control+e');
        await workbench.waitForTimeout(1000);
    }

    // Check for new pages or changes
    const newPages = context.pages();
    console.log(`\nPages after action: ${newPages.length}`);
    newPages.forEach((p, i) => {
        console.log(`  ${i}: ${p.url()}`);
    });

    // Find a jetski-agent page with content
    const jetskiPage = newPages.find(p =>
        p.url().includes('jetski-agent') &&
        p.url().includes('workbench-jetski-agent')
    );

    if (jetskiPage) {
        console.log('\n=== Jetski Agent Page Content ===');
        await jetskiPage.waitForTimeout(500);

        // Look for task list elements
        const frame = jetskiPage.mainFrame();

        // Find any cards or list items
        const cards = frame.locator('[class*="card"], [class*="item"], [class*="task"], [class*="agent"]');
        const cardCount = await cards.count();
        console.log(`Card/Item elements: ${cardCount}`);

        // Get all visible text in panels/containers
        const containers = frame.locator('.panel, .view-content, .list-container, [class*="content"]');
        const containerCount = await containers.count();
        console.log(`Content containers: ${containerCount}`);

        // Look for specific manager UI elements
        const statusElements = frame.locator('[class*="status"], [class*="state"]');
        const statusCount = await statusElements.count();
        console.log(`Status elements: ${statusCount}`);

        // Get visible buttons
        const buttons = frame.locator('button:visible');
        const btnCount = await buttons.count();
        console.log(`\nVisible buttons: ${btnCount}`);
        for (let i = 0; i < Math.min(btnCount, 15); i++) {
            const text = await buttons.nth(i).innerText().catch(() => '');
            if (text.trim()) console.log(`  ${i}: "${text.trim().slice(0, 50)}"`);
        }

        // Dump some HTML for analysis
        const bodyHtml = await frame.locator('body').innerHTML();
        // Look for interesting class patterns
        const classMatches = bodyHtml.match(/class="[^"]*(?:task|agent|manager|status|workspace|conversation)[^"]*"/gi);
        if (classMatches) {
            console.log('\nRelevant class patterns found:');
            const unique = [...new Set(classMatches.slice(0, 20))];
            unique.forEach(c => console.log(`  ${c}`));
        }
    } else {
        console.log('\n❌ Jetski-agent page not found');
    }

    await browser.close();
});
