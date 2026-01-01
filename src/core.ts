import { chromium, Browser, BrowserContext, Page, Frame } from '@playwright/test';

export interface AppContext {
    browser: Browser;
    context: BrowserContext;
    page: Page;
}

/**
 * Connects to the running Antigravity Electron application via CDP.
 * Reads from BROWSER_CDP_ENDPOINT env var, or defaults to localhost:9222.
 */
export async function connectToApp(cdpUrl?: string): Promise<AppContext> {
    const endpoint = cdpUrl || process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
    console.log(`🚀 Connecting to Antigravity via ${endpoint}...`);

    try {
        const browser = await chromium.connectOverCDP(endpoint);
        const contexts = browser.contexts();

        if (contexts.length === 0) {
            await browser.close();
            throw new Error('No browser context found. Is Antigravity running?');
        }

        const context = contexts[0];

        // Find the main workbench page or agent manager page
        // Prioritize agent manager (Launchpad) if available
        let page = context.pages().find(p => p.url().includes('workbench-jetski-agent.html'));

        if (!page) {
            page = context.pages().find(p => p.url().includes('workbench.html'));
        }

        if (!page) {
            console.log('⚠️ Main workbench/manager page not found immediately, checking others or waiting...');
            // Fallback: wait for event or pick first
            if (context.pages().length > 0) {
                page = context.pages()[0];
            } else {
                page = await context.waitForEvent('page');
            }
        }

        if (!page) {
            await browser.close();
            throw new Error('Could not resolve a valid page instance.');
        }

        // Wait for workbench or manager content to be stable
        try {
            // Check for either standard workbench or agent manager specific element
            const stableSelector = page.url().includes('workbench-jetski-agent.html')
                ? 'body' // Manager page might not have .monaco-workbench, just wait for body
                : '.monaco-workbench';

            await page.locator(stableSelector).waitFor({ state: 'visible', timeout: 5000 });
        } catch (e) {
            console.warn('⚠️ Warning: Workbench/Manager selector not visible strictly, proceeding anyway...');
        }

        return { browser, context, page };
    } catch (error) {
        console.error('❌ Failed to connect to Antigravity:', error);
        throw error;
    }
}

/**
 * Helper to find the Agent UI frame (cascade-panel.html)
 */
export async function getAgentFrame(page: Page): Promise<Frame> {
    // 1. Try to find the frame first
    let agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));

    if (!agentFrame) {
        console.log('  ⚠️ Agent frame not found immediately. Attempting to open Agent view...');

        // Try to find the Agent icon in the Activity Bar and click it
        // Selectors are tricky, but usually it has an aria-label or title "Agent" or "Cascade"
        // Or checking for the antigravity icon
        try {
            // Common selectors for activity bar items
            const activityBar = page.locator('.activitybar');
            // Try "Agent" or "Antigravity"
            const agentIcon = activityBar.locator('a[aria-label="Agent"], a[title="Agent"], a[aria-label="Antigravity"], a[title="Antigravity"]');

            if (await agentIcon.count() > 0) {
                await agentIcon.first().click();
                console.log('  🖱️ Clicked Agent icon in Activity Bar.');
                // Wait for frame to appear
                await page.waitForTimeout(2000);
                agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));
            } else {
                console.log('  ⚠️ Could not find Agent icon in Activity Bar.');
            }
        } catch (e) {
            console.log('  ⚠️ Error interacting with Activity Bar:', e);
        }
    }

    // 2. Retry frame search
    if (!agentFrame) {
        // One last check with a small wait
        await page.waitForTimeout(1000);
        agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));
    }

    if (!agentFrame) {
        // List frames for debugging
        const frames = page.frames().map(f => f.url());
        console.log('  ❌ Available frames:', frames);
        throw new Error('Agent frame (cascade-panel.html) not found. Is the Agent view open?');
    }

    // Ensure frame is ready
    await agentFrame.waitForLoadState('domcontentloaded');
    return agentFrame;
}
