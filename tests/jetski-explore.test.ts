import { test, chromium } from '@playwright/test';

test('Explore jetski-agent pages', async () => {
    console.log('🚀 Connecting...');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();

    // Find jetski-agent pages
    const jetskiPages = pages.filter(p => p.url().includes('jetski-agent'));
    console.log(`Found ${jetskiPages.length} jetski-agent pages\n`);

    for (let i = 0; i < jetskiPages.length; i++) {
        const page = jetskiPages[i];
        console.log(`\n=== Jetski Page ${i} ===`);
        console.log(`URL: ${page.url()}`);

        // Get page title
        const title = await page.title();
        console.log(`Title: ${title}`);

        // List frames
        const frames = page.frames();
        console.log(`Frames: ${frames.length}`);
        frames.forEach((f, j) => {
            console.log(`  Frame ${j}: ${f.url().slice(0, 100)}...`);
        });

        // Look for task/agent related elements
        const mainFrame = page.mainFrame();

        // Find any headings
        const headings = await mainFrame.locator('h1, h2, h3').allInnerTexts();
        console.log(`\nHeadings: ${headings.slice(0, 10).join(', ')}`);

        // Find buttons
        const buttons = mainFrame.locator('button');
        const btnCount = await buttons.count();
        console.log(`Buttons: ${btnCount}`);
        for (let b = 0; b < Math.min(btnCount, 10); b++) {
            const text = await buttons.nth(b).innerText().catch(() => '');
            const ariaLabel = await buttons.nth(b).getAttribute('aria-label') || '';
            if (text || ariaLabel) {
                console.log(`  Button ${b}: "${text}" / aria: "${ariaLabel}"`);
            }
        }

        // Look for task-related text
        const body = await mainFrame.locator('body').innerHTML();
        const hasTask = body.toLowerCase().includes('task');
        const hasAgent = body.toLowerCase().includes('agent');
        const hasApprove = body.toLowerCase().includes('approve');
        const hasWorkspace = body.toLowerCase().includes('workspace');
        console.log(`\nContains 'task': ${hasTask}`);
        console.log(`Contains 'agent': ${hasAgent}`);
        console.log(`Contains 'approve': ${hasApprove}`);
        console.log(`Contains 'workspace': ${hasWorkspace}`);

        // Try to find any list items (tasks)
        const listItems = mainFrame.locator('[role="listitem"], li, .task-item, .agent-card');
        const listCount = await listItems.count();
        console.log(`List items: ${listCount}`);
    }

    // Also check the main workbench for Manager buttons
    console.log('\n\n=== Main Workbench Manager Buttons ===');
    const workbench = pages.find(p => p.url().includes('workbench.html') && !p.url().includes('jetski'));
    if (workbench) {
        const managerBtns = workbench.locator('button:has-text("Manager"), [aria-label*="manager" i], [title*="Manager" i]');
        const count = await managerBtns.count();
        console.log(`Manager buttons: ${count}`);
        for (let m = 0; m < count; m++) {
            const btn = managerBtns.nth(m);
            const text = await btn.innerText().catch(() => '');
            const aria = await btn.getAttribute('aria-label') || '';
            const title = await btn.getAttribute('title') || '';
            const classes = await btn.getAttribute('class') || '';
            console.log(`  ${m}: text="${text}" aria="${aria}" title="${title}" class="${classes.slice(0, 50)}"`);
        }
    }

    await browser.close();
});
