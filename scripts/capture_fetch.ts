#!/usr/bin/env npx tsx
/**
 * Capture Antigravity session data using CDP Fetch domain.
 * 
 * This intercepts requests/responses at the Fetch API level,
 * which may work for JavaScript-initiated gRPC calls.
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9223';
const OUTPUT_DIR = path.resolve(process.cwd(), 'history_dump', 'fetch_captures');

async function main() {
    console.log('🔌 Connecting to Antigravity...');

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

    // Find the agent manager (jetski) page 
    const agentPage = pages.find(p => p.url().includes('workbench-jetski-agent'));
    const mainPage = pages.find(p =>
        p.url().includes('workbench.html') && !p.url().includes('workbench-jetski-agent')
    );

    const targetPage = agentPage || mainPage;

    if (!targetPage) {
        console.error('❌ No suitable page found');
        process.exit(1);
    }

    console.log(`✅ Using page: ${targetPage.url().split('/').pop()}`);

    const cdpSession = await context.newCDPSession(targetPage);

    // Enable Fetch domain to intercept requests
    await cdpSession.send('Fetch.enable', {
        patterns: [
            { urlPattern: '*', requestStage: 'Response' }
        ]
    });

    console.log('🎯 Fetch domain enabled - intercepting all responses');

    let captureCount = 0;

    cdpSession.on('Fetch.requestPaused', async (params) => {
        const url = params.request.url;

        // Check if this is a gRPC or Cascade-related request
        const isInteresting = url.includes('Cascade') ||
            url.includes('grpc') ||
            url.includes('language_server') ||
            url.includes('127.0.0.1');

        if (isInteresting) {
            captureCount++;
            console.log(`📦 [${captureCount}] ${params.request.method} ${url.substring(0, 80)}...`);

            try {
                // Get response body
                const response = await cdpSession.send('Fetch.getResponseBody', {
                    requestId: params.requestId
                });

                const body = response.base64Encoded
                    ? Buffer.from(response.body, 'base64')
                    : Buffer.from(response.body);

                console.log(`   Size: ${body.length.toLocaleString()} bytes`);

                // Save capture
                const filename = `capture_${Date.now()}_${captureCount}.bin`;
                const filepath = path.join(OUTPUT_DIR, filename);
                fs.writeFileSync(filepath, body);

                // Also save metadata
                const meta = {
                    timestamp: new Date().toISOString(),
                    url,
                    method: params.request.method,
                    size: body.length
                };
                fs.writeFileSync(filepath + '.json', JSON.stringify(meta, null, 2));

                console.log(`   💾 Saved: ${filename}`);

            } catch (e) {
                console.log(`   ⚠️ Could not get body: ${(e as Error).message}`);
            }
        }

        // Continue the request
        try {
            await cdpSession.send('Fetch.continueRequest', {
                requestId: params.requestId
            });
        } catch (e) {
            // Request may have already completed
        }
    });

    console.log('');
    console.log('⏳ Waiting for requests... Switch sessions in Antigravity UI.');
    console.log('   Press Ctrl+C to stop.\n');

    process.on('SIGINT', async () => {
        console.log(`\n\n🛑 Captured ${captureCount} requests`);
        console.log(`📁 Saved to: ${OUTPUT_DIR}`);
        await browser.close();
        process.exit(0);
    });

    await new Promise(() => { });
}

main().catch(console.error);
