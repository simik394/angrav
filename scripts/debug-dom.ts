/**
 * Debug script to inspect the actual DOM structure of the Antigravity chat panel.
 * Run with: BROWSER_CDP_ENDPOINT="http://100.73.45.27:9224" npx ts-node scripts/debug-dom.ts
 */

import { chromium } from '@playwright/test';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

async function main() {
    console.log(`🔍 Connecting to ${CDP_ENDPOINT}...`);

    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const context = browser.contexts()[0];
    const pages = context.pages();

    console.log(`📄 Found ${pages.length} pages`);

    for (const page of pages) {
        const url = page.url();
        if (!url.includes('workbench.html')) continue;

        console.log(`\n=== Inspecting page: ${url.slice(0, 80)}... ===\n`);

        // Find the cascade-panel iframe
        const frames = page.frames();
        console.log(`Frames: ${frames.length}`);

        for (const frame of frames) {
            const frameUrl = frame.url();
            if (!frameUrl.includes('cascade-panel')) continue;

            console.log(`\n🎯 Found cascade-panel frame: ${frameUrl.slice(0, 60)}...\n`);

            // Dump key elements
            const elements = await frame.evaluate(() => {
                const results: Record<string, string[]> = {
                    // Look for code blocks
                    'code blocks': [],
                    'prose containers': [],
                    'thought buttons': [],
                    'message containers': [],
                    // Any div with prose class
                    'prose divs': [],
                };

                // Find all pre > code elements (code blocks)
                document.querySelectorAll('pre > code, pre code').forEach((el, i) => {
                    const lang = el.className.match(/language-(\w+)/)?.[1] || 'unknown';
                    const content = (el as HTMLElement).innerText.slice(0, 100);
                    results['code blocks'].push(`[${i}] lang=${lang}: ${content}...`);
                });

                // Find prose
                document.querySelectorAll('.prose, [class*="prose"]').forEach((el, i) => {
                    const text = (el as HTMLElement).innerText.slice(0, 80);
                    results['prose containers'].push(`[${i}] ${el.className.slice(0, 50)}: ${text}...`);
                });

                // Find thought buttons
                document.querySelectorAll('button').forEach((el) => {
                    const text = el.innerText.toLowerCase();
                    if (text.includes('thought')) {
                        results['thought buttons'].push(`${el.className.slice(0, 50)}: "${el.innerText}"`);
                    }
                });

                // Find assistant message containers
                document.querySelectorAll('[class*="assistant"], [class*="message"], [class*="response"]').forEach((el, i) => {
                    if (i < 5) {
                        results['message containers'].push(`${el.tagName} class="${el.className.slice(0, 60)}"`);
                    }
                });

                // Count total prose divs
                const proseCount = document.querySelectorAll('.prose').length;
                results['prose divs'].push(`Total: ${proseCount}`);

                // Get the HTML of the first prose element
                const firstProse = document.querySelector('.prose');
                if (firstProse) {
                    results['prose divs'].push(`Sample HTML: ${firstProse.outerHTML.slice(0, 300)}...`);
                }

                return results;
            });

            console.log('📊 DOM Analysis:');
            for (const [key, values] of Object.entries(elements)) {
                console.log(`\n  ${key.toUpperCase()}:`);
                for (const v of values) {
                    console.log(`    - ${v}`);
                }
            }

            // Also look for bg-ide-chat-background
            const chatBg = await frame.evaluate(() => {
                const els = document.querySelectorAll('[class*="bg-ide"], [class*="chat"], [class*="background"]');
                return Array.from(els).slice(0, 10).map(el => ({
                    tag: el.tagName,
                    class: el.className.slice(0, 80),
                    text: (el as HTMLElement).innerText.slice(0, 50)
                }));
            });

            console.log('\n  CHAT BACKGROUND ELEMENTS:');
            for (const el of chatBg) {
                console.log(`    - ${el.tag}.${el.class}: "${el.text}..."`);
            }
        }
    }

    await browser.close();
    console.log('\n✅ Done');
}

main().catch(console.error);
