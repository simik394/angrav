import { test, chromium } from '@playwright/test';

test('Open new chat via Agent Manager and type test', async () => {
    console.log('🚀 Connecting to Antigravity...');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();

    // Find main workbench
    const workbench = pages.find(p =>
        p.url().includes('workbench.html') &&
        !p.url().includes('jetski')
    );
    if (!workbench) throw new Error('Workbench not found');

    // 1. Open Agent Manager via button or Ctrl+E
    console.log('\n📂 Opening Agent Manager...');
    const openBtn = workbench.locator('.open-agent-manager-button').first();

    if (await openBtn.count() > 0 && await openBtn.isVisible()) {
        console.log('✅ Clicking "Open Agent Manager" button...');
        await openBtn.click();
    } else {
        console.log('⌨️ Using Ctrl+E shortcut...');
        await workbench.keyboard.press('Control+e');
    }
    await workbench.waitForTimeout(1000);

    // 2. Find the Agent Manager (jetski-agent) window
    const allPages = context.pages();
    const managerPage = allPages.find(p => p.url().includes('jetski-agent'));

    if (!managerPage) {
        throw new Error('Agent Manager window not found');
    }
    console.log('✅ Agent Manager window found');

    // 3. Look for "New Chat" or "New Conversation" button
    console.log('\n🔍 Looking for "New Chat" button...');
    const frame = managerPage.mainFrame();

    // Try various selectors for new chat button
    const newChatSelectors = [
        'button:has-text("New")',
        'button:has-text("New Chat")',
        'button:has-text("New Conversation")',
        'button[aria-label*="New"]',
        '[class*="new-chat"]',
        '[class*="new-conversation"]'
    ];

    let newChatBtn = null;
    for (const selector of newChatSelectors) {
        const btn = frame.locator(selector).first();
        if (await btn.count() > 0) {
            const isVisible = await btn.isVisible().catch(() => false);
            if (isVisible) {
                const text = await btn.innerText().catch(() => '');
                console.log(`  Found: ${selector} -> "${text}"`);
                newChatBtn = btn;
                break;
            }
        }
    }

    // Also list all visible buttons for debugging
    console.log('\n📋 All visible buttons in Manager:');
    const allButtons = frame.locator('button:visible');
    const btnCount = await allButtons.count();
    for (let i = 0; i < Math.min(btnCount, 20); i++) {
        const btn = allButtons.nth(i);
        const text = await btn.innerText().catch(() => '');
        const aria = await btn.getAttribute('aria-label') || '';
        if (text.trim() || aria) {
            console.log(`  ${i}: "${text.trim().slice(0, 40)}" [${aria}]`);
        }
    }

    // 4. If found, click new chat button
    if (newChatBtn) {
        console.log('\n✅ Clicking New Chat button...');
        await newChatBtn.click();
        await frame.waitForTimeout(500);
    } else {
        console.log('\n⚠️ No explicit New Chat button found, proceeding to find input...');
    }

    // 5. Find the chat input field
    console.log('\n🔍 Looking for chat input...');
    const inputSelectors = [
        '[contenteditable="true"]',
        'textarea',
        'input[type="text"]',
        '[data-lexical-editor="true"]',
        '[class*="input"]'
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
        const el = frame.locator(selector).first();
        if (await el.count() > 0) {
            const isVisible = await el.isVisible().catch(() => false);
            if (isVisible) {
                console.log(`  Found input: ${selector}`);
                inputEl = el;
                break;
            }
        }
    }

    // Also check cascade-panel frame if exists
    if (!inputEl) {
        console.log('  Checking cascade-panel frame...');
        const cascadeFrame = workbench.frames().find(f => f.url().includes('cascade-panel'));
        if (cascadeFrame) {
            const cascadeInput = cascadeFrame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();
            if (await cascadeInput.count() > 0) {
                console.log('  Found input in cascade-panel!');
                inputEl = cascadeInput;
            }
        }
    }

    // 6. Type "test" without sending
    if (inputEl) {
        console.log('\n⌨️ Typing "test" in input (not sending)...');
        await inputEl.click();
        await inputEl.fill('test');
        // Or use type for more realistic typing:
        // await inputEl.pressSequentially('test', { delay: 100 });

        console.log('✅ "test" typed in input field');

        // Verify the text is there
        const currentText = await inputEl.innerText().catch(() =>
            inputEl!.inputValue().catch(() => 'could not read')
        );
        console.log(`📝 Current input text: "${currentText}"`);
    } else {
        console.log('\n❌ Could not find input field');
    }

    // Take a screenshot for verification
    await managerPage.screenshot({ path: 'agent-manager-test.png' }).catch(() => { });
    console.log('\n📸 Screenshot saved (if permissions allow)');

    // Don't close browser - leave it open for user to see
    console.log('\n✅ Done! Leaving browser open for inspection.');
    await browser.close();
});
