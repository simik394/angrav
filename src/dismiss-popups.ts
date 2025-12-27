/**
 * Dismiss Popups - Automatically handles common Antigravity popups
 * 
 * Handles:
 * - Shell environment resolution warnings
 * - Model update notifications (Gemini 3 Flash, etc.)
 * - Update Available prompts
 * 
 * Run via: npx ts-node src/dismiss-popups.ts
 * Or integrate into worker startup
 */

import { connectToApp, getAgentFrame } from './core';
import { Page, Frame } from '@playwright/test';

interface DismissResult {
    dismissed: string[];
    errors: string[];
}

/**
 * Dismiss shell environment warning popup
 */
async function dismissShellWarning(page: Page): Promise<boolean> {
    try {
        // Look for the shell environment warning banner
        const dismissButton = page.locator('text="Restart"').or(page.locator('text="Dismiss"')).first();

        // Check if visible within the notification area
        const shellWarning = page.locator(':has-text("Unable to resolve your shell environment")');
        if (await shellWarning.isVisible({ timeout: 2000 })) {
            // Click the X or Dismiss button
            const closeBtn = shellWarning.locator('a.codicon-close, button:has-text("Dismiss"), .close-button').first();
            if (await closeBtn.isVisible({ timeout: 1000 })) {
                await closeBtn.click();
                console.log('  ✓ Dismissed shell environment warning');
                return true;
            }
        }
    } catch (e) {
        // Not visible or already dismissed
    }
    return false;
}

/**
 * Dismiss Gemini model update notifications
 */
async function dismissModelNotifications(frame: Frame): Promise<boolean> {
    try {
        // Look for "Dismiss" button in the agent panel notifications
        const dismissBtn = frame.locator('button:has-text("Dismiss")').first();
        if (await dismissBtn.isVisible({ timeout: 2000 })) {
            await dismissBtn.click();
            console.log('  ✓ Dismissed model notification');
            return true;
        }
    } catch (e) {
        // Not visible
    }
    return false;
}

/**
 * Dismiss Update Available banner
 */
async function dismissUpdateBanner(page: Page): Promise<boolean> {
    try {
        const updateBtn = page.locator('.update-available, button:has-text("Update Available")');
        if (await updateBtn.isVisible({ timeout: 1000 })) {
            // Just click away or dismiss - don't actually update
            const closeBtn = page.locator('.notification-toast-container .codicon-close').first();
            if (await closeBtn.isVisible({ timeout: 500 })) {
                await closeBtn.click();
                console.log('  ✓ Dismissed update banner');
                return true;
            }
        }
    } catch (e) {
        // Not visible
    }
    return false;
}

/**
 * Main popup dismissal routine
 */
export async function dismissAllPopups(cdpEndpoint?: string): Promise<DismissResult> {
    const result: DismissResult = {
        dismissed: [],
        errors: []
    };

    console.log('🧹 Checking for popups to dismiss...');

    try {
        let endpoint = cdpEndpoint || process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

        // Resolve hostname to IP to bypass Host header check (same as worker.ts)
        try {
            const url = new URL(endpoint);
            if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
                const dns = require('node:dns').promises;
                const { address } = await dns.lookup(url.hostname);
                url.hostname = address;
                endpoint = url.origin;
                console.log(`  🔍 Resolved CDP endpoint to ${address}`);
            }
        } catch (e) {
            console.warn('  ⚠️ Failed to resolve CDP hostname:', e);
        }

        const { browser, page } = await connectToApp(endpoint);

        try {
            // 1. Shell warning (on main page)
            if (await dismissShellWarning(page)) {
                result.dismissed.push('shell-warning');
            }

            // 2. Update banner
            if (await dismissUpdateBanner(page)) {
                result.dismissed.push('update-banner');
            }

            // 3. Agent frame notifications
            try {
                const frame = await getAgentFrame(page);
                if (await dismissModelNotifications(frame)) {
                    result.dismissed.push('model-notification');
                }
            } catch (e) {
                // Agent frame might not be open
                result.errors.push('agent-frame-not-found');
            }

        } finally {
            await browser.close();
        }

    } catch (e) {
        result.errors.push(`connection-failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (result.dismissed.length === 0 && result.errors.length === 0) {
        console.log('  ✓ No popups found');
    }

    return result;
}

// CLI execution
if (require.main === module) {
    dismissAllPopups()
        .then(result => {
            console.log('\n📋 Result:', JSON.stringify(result, null, 2));
            process.exit(result.errors.length > 0 ? 1 : 0);
        })
        .catch(e => {
            console.error('❌ Failed:', e);
            process.exit(1);
        });
}
