/**
 * Windmill Script: Input (Submit Angrav Task)
 * 
 * PHASE 1 of the Input/Output pattern for Angrav.
 * 
 * This script:
 * 1. Acquires the human lock
 * 2. Connects to Angrav browser
 * 3. Types the prompt with human-like delays
 * 4. Injects a MutationObserver that calls a webhook when done
 * 5. Disconnects immediately (frees the worker)
 */

import { chromium } from 'playwright';
import { withHumanHands, humanType } from '../../shared/human-lock';
import { markTabBusy } from '../../shared/tab-pool';
import { getCdpEndpoint, getWindmillEndpoint } from '../../shared/service-discovery';



/**
 * Find the Angrav agent frame within the Electron app
 */
async function findAgentFrame(page: any): Promise<any> {
    // Angrav typically has the agent UI in an iframe or specific container
    const frames = page.frames();

    for (const frame of frames) {
        try {
            // Look for the agent input textarea
            const textarea = frame.locator('textarea, [contenteditable="true"]').first();
            if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
                return frame;
            }
        } catch {
            continue;
        }
    }

    // Fallback to main page
    return page;
}

/**
 * Inject a MutationObserver that watches for task completion
 */
async function injectCompletionObserver(
    page: any,
    tabId: string,
    webhookUrl: string,
    prompt: string
): Promise<void> {
    await page.evaluate(({ webhookUrl, tabId, prompt }) => {
        let webhookFired = false;

        // Function to check if generation is complete
        // Angrav shows different states: thinking, generating, idle
        const checkCompletion = () => {
            // Look for idle state indicators
            const statusEl = document.querySelector('[data-state], .status-indicator, .agent-status');
            const isIdle = statusEl?.textContent?.toLowerCase().includes('idle') ||
                statusEl?.getAttribute('data-state') === 'idle';

            // Or look for completion indicators
            const doneEl = document.querySelector('.response-complete, [data-complete="true"]');

            return isIdle || doneEl !== null;
        };

        const observer = new MutationObserver(() => {
            if (webhookFired) return;

            if (checkCompletion()) {
                webhookFired = true;
                observer.disconnect();

                console.log('[Observer] Task complete, calling webhook...');

                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tabId: tabId,
                        prompt: prompt,
                        timestamp: Date.now(),
                        status: 'ready'
                    })
                }).catch(console.error);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        // Timeout fallback
        setTimeout(() => {
            if (!webhookFired) {
                webhookFired = true;
                observer.disconnect();

                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tabId: tabId,
                        prompt: prompt,
                        timestamp: Date.now(),
                        status: 'timeout'
                    })
                });
            }
        }, 10 * 60 * 1000); // 10 minute timeout for complex tasks

    }, { webhookUrl, tabId, prompt });
}

/**
 * Main entry point for Windmill
 */
export async function main(
    prompt: string,
    context_files?: string[],
    webhook_url?: string
): Promise<{ tabId: string; status: string }> {

    // Discover endpoints via Consul/Nomad
    const cdpEndpoint = await getCdpEndpoint('angrav');
    const browser = await chromium.connectOverCDP(cdpEndpoint);

    try {
        // Get the first page (Angrav is typically a single-page Electron app)
        const pages = browser.contexts()[0]?.pages() || [];
        const page = pages[0] || await browser.contexts()[0]?.newPage();

        if (!page) {
            throw new Error('No page available in Angrav browser');
        }

        // Find the agent frame
        const frame = await findAgentFrame(page);

        // Generate a tab ID for tracking
        const tabId = `angrav_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await markTabBusy(page, tabId);

        // Acquire human lock and perform input
        await withHumanHands(async () => {
            await page.bringToFront();

            // Find the prompt input
            const textarea = frame.locator('textarea, [contenteditable="true"]').first();
            await textarea.waitFor({ state: 'visible', timeout: 10000 });

            // Clear existing content
            await textarea.click();
            await page.keyboard.press('Control+KeyA');
            await page.keyboard.press('Backspace');

            // Type the prompt with human-like delays
            await humanType(page, prompt);

            // Submit (Enter or click send button)
            const sendBtn = frame.locator('button[type="submit"], button:has-text("Send")').first();
            if (await sendBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                await sendBtn.click();
            } else {
                await page.keyboard.press('Enter');
            }
        });

        // Inject completion observer
        const windmillBase = await getWindmillEndpoint();
        const defaultWebhook = `${windmillBase}/api/w/main/jobs/run_wait_result/p/f/angrav/output`;
        const effectiveWebhookUrl = webhook_url || defaultWebhook;
        await injectCompletionObserver(page, tabId, effectiveWebhookUrl, prompt);

        console.log(`📤 Task submitted, tabId: ${tabId}`);

        await browser.close();

        return {
            tabId: tabId,
            status: 'submitted'
        };

    } catch (error: any) {
        await browser.close();
        throw error;
    }
}
