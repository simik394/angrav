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

        // Find the main workbench page
        let page = context.pages().find(p => p.url().includes('workbench.html'));

        if (!page) {
            console.log('⚠️ Main workbench page not found immediately, checking others or waiting...');
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

        // Wait for workbench to be stable
        try {
            const workbench = page.locator('.monaco-workbench');
            await workbench.waitFor({ state: 'visible', timeout: 30000 });
        } catch (e) {
            console.warn('⚠️ Warning: Workbench selector not visible strictly, proceeding anyway...');
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
    // 1. Ensure Agent view is visible (Toggle if needed) - skipped for now, assuming visible

    // 2. Find frame
    const agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));

    if (!agentFrame) {
        throw new Error('Agent frame (cascade-panel.html) not found. Is the Agent view open?');
    }

    // Ensure frame is ready
    await agentFrame.waitForLoadState('domcontentloaded');
    return agentFrame;
}
