
/**
 * Windmill Script: Execute Angrav Task
 *
 * This script is executed by the Windmill Worker (blocking).
 * It connects to the Angrav Browser via CDP and executes the prompt.
 * 
 * Called by submit.ts asynchronously. Use poll.ts to check results.
 * 
 * It relies on the pre-built 'angrav' package in ../dist
 */

import { connectToApp, getAgentFrame } from '../../dist/core';
import { sendPrompt } from '../../dist/prompt';
import { waitForIdle } from '../../dist/state';
import { extractResponse } from '../../dist/extraction';
import * as dns from 'node:dns';

// Windmill entrypoint
export async function main(
    prompt: string,
    cdp_endpoint: string = 'http://angrav-browser:9223',
    timeout_ms: number = 120000
) {
    console.log(`🚀 Starting Angrav Task: "${prompt.substring(0, 50)}..."`);

    // Resolve hostname if needed (Windmill worker -> angrav-browser)
    // Docker DNS should handle 'angrav-browser', but Chrome CDP might reject Host header.
    // We use the same IP resolution trick as in the original worker.

    let finalEndpoint = cdp_endpoint;
    try {
        const url = new URL(cdp_endpoint);
        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
            const { address } = await dns.promises.lookup(url.hostname);
            url.hostname = address;
            finalEndpoint = url.origin;
            console.log(`  🔍 Resolved CDP endpoint to IP: ${address}`);
        }
    } catch (e) {
        console.warn('  ⚠️ DNS lookup failed, using original endpoint:', e);
    }

    const { browser, context, page } = await connectToApp(finalEndpoint);

    try {
        const frame = await getAgentFrame(page);

        // Send prompt
        console.log('  📤 Sending prompt...');
        await sendPrompt(frame, page, prompt, { wait: false });

        // Wait
        console.log(`  ⏳ Waiting for completion (timeout: ${timeout_ms}ms)...`);
        await waitForIdle(frame, timeout_ms);

        // Extract
        console.log('  📥 Extracting response...');
        const response = await extractResponse(frame);

        return {
            success: true,
            response
        };

    } catch (error) {
        console.error('❌ Task failed:', error);
        throw error;
    } finally {
        // close connection
        await browser.close();
    }
}
