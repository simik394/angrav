#!/usr/bin/env npx tsx
/**
 * Capture Antigravity session data using Chrome DevTools Protocol.
 * 
 * This intercepts network requests within Electron, capturing the 
 * StreamCascadeReactiveUpdates response that contains full session data.
 * 
 * Usage:
 *   BROWSER_CDP_ENDPOINT=http://localhost:9222 npx tsx scripts/capture_grpc.ts
 *   
 * This requires Antigravity to be running with --remote-debugging-port=9222
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
const OUTPUT_DIR = path.resolve(process.cwd(), 'history_dump', 'grpc_captures');

interface CapturedResponse {
    url: string;
    method: string;
    timestamp: string;
    size: number;
    body: string | null;
}

async function main() {
    console.log('🔌 Connecting to Antigravity...');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const context = browser.contexts()[0];

    if (!context) {
        console.error('❌ No browser context found');
        process.exit(1);
    }

    const pages = context.pages();
    console.log(`📄 Found ${pages.length} pages`);

    // Find the main workbench page
    const mainPage = pages.find(p =>
        p.url().includes('workbench.html') && !p.url().includes('workbench-jetski-agent')
    );

    if (!mainPage) {
        console.error('❌ Main workbench page not found');
        process.exit(1);
    }

    console.log('✅ Connected to main page');

    // Get CDP session for network interception
    const cdpSession = await context.newCDPSession(mainPage);

    // Enable network domain
    await cdpSession.send('Network.enable');

    const captures: CapturedResponse[] = [];
    let captureCount = 0;

    console.log('🎯 Listening for gRPC responses...');
    console.log('   Switch sessions in Antigravity to trigger data fetch.');
    console.log('   Press Ctrl+C to stop and save.\n');

    // Listen for responses
    cdpSession.on('Network.responseReceived', async (params) => {
        const url = params.response.url;

        // Filter for session-related gRPC calls
        if (url.includes('StreamCascadeReactiveUpdates') ||
            url.includes('GetCascadeHistory') ||
            url.includes('127.0.0.1:43405')) {

            console.log(`📦 Captured: ${url.split('/').pop()}`);

            try {
                // Get response body
                const bodyResult = await cdpSession.send('Network.getResponseBody', {
                    requestId: params.requestId
                });

                const body = bodyResult.base64Encoded
                    ? Buffer.from(bodyResult.body, 'base64').toString('utf-8')
                    : bodyResult.body;

                captures.push({
                    url,
                    method: params.response.requestHeaders?.['method'] || 'POST',
                    timestamp: new Date().toISOString(),
                    size: body?.length || 0,
                    body
                });

                captureCount++;
                console.log(`   Size: ${(body?.length || 0).toLocaleString()} bytes`);

                // Save immediately for large responses
                if (body && body.length > 100000) {
                    const filename = `session_${Date.now()}_${captureCount}.json`;
                    const filepath = path.join(OUTPUT_DIR, filename);
                    fs.writeFileSync(filepath, JSON.stringify({
                        url,
                        timestamp: new Date().toISOString(),
                        body
                    }, null, 2));
                    console.log(`   💾 Saved: ${filename}`);
                }

            } catch (e) {
                // Response body might not be available
                console.log(`   ⚠️ Could not get body: ${(e as Error).message}`);
            }
        }
    });

    // Handle Ctrl+C
    process.on('SIGINT', async () => {
        console.log('\n\n🛑 Stopping capture...');

        if (captures.length > 0) {
            const summaryFile = path.join(OUTPUT_DIR, `capture_summary_${Date.now()}.json`);
            fs.writeFileSync(summaryFile, JSON.stringify(captures, null, 2));
            console.log(`📁 Saved ${captures.length} captures to: ${summaryFile}`);
        } else {
            console.log('📭 No captures recorded');
        }

        await browser.close();
        process.exit(0);
    });

    // Keep running
    console.log('⏳ Waiting for responses... (Ctrl+C to stop)\n');
    await new Promise(() => { }); // Never resolves
}

main().catch(console.error);
