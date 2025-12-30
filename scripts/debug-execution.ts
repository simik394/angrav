/**
 * Debug script to find Review & Execution UI elements
 */
import { chromium } from '@playwright/test';

const CDP = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';

async function main() {
    console.log(`Connecting to ${CDP}...`);
    const browser = await chromium.connectOverCDP(CDP);
    const context = browser.contexts()[0];
    const pages = context.pages();

    for (const page of pages) {
        if (!page.url().includes('workbench.html')) continue;

        console.log('\n=== Inspecting main page ===\n');

        // Find Apply buttons in the cascade-panel
        const frames = page.frames();
        for (const frame of frames) {
            if (!frame.url().includes('cascade-panel')) continue;

            console.log('🎯 Found cascade-panel frame\n');

            const elements = await frame.evaluate(() => {
                const results: Record<string, string[]> = {
                    'Apply buttons': [],
                    'Save buttons': [],
                    'Undo buttons': [],
                    'All buttons with icons': [],
                };

                // Find Apply buttons
                document.querySelectorAll('button').forEach((btn) => {
                    const text = btn.innerText.toLowerCase();
                    const className = btn.className;

                    if (text.includes('apply')) {
                        results['Apply buttons'].push(`"${btn.innerText}" class="${className.slice(0, 60)}"`);
                    }
                    if (text.includes('save')) {
                        results['Save buttons'].push(`"${btn.innerText}" class="${className.slice(0, 60)}"`);
                    }
                    if (text.includes('undo') || btn.querySelector('[class*="undo"]') || btn.querySelector('svg[class*="undo"]')) {
                        results['Undo buttons'].push(`"${btn.innerText}" class="${className.slice(0, 60)}"`);
                    }

                    const svg = btn.querySelector('svg[class*="lucide"]');
                    if (svg) {
                        const svgClass = svg.getAttribute('class') || '';
                        results['All buttons with icons'].push(`"${btn.innerText.slice(0, 20)}" svg="${svgClass.slice(0, 40)}"`);
                    }
                });

                return results;
            });

            console.log('📊 Cascade Panel Buttons:');
            for (const [key, values] of Object.entries(elements)) {
                console.log(`\n  ${key.toUpperCase()}:`);
                if (values.length === 0) {
                    console.log('    (none found)');
                } else {
                    for (const v of values) {
                        console.log(`    - ${v}`);
                    }
                }
            }
        }

        // Find terminals in main page (not iframe)
        console.log('\n\n=== Looking for terminals in main page ===\n');

        const terminalInfo = await page.evaluate(() => {
            const results: string[] = [];

            // Xterm terminals
            document.querySelectorAll('.xterm, [class*="xterm"]').forEach((el, i) => {
                results.push(`[${i}] xterm: class="${el.className.slice(0, 60)}"`);
            });

            // Accessibility layer
            document.querySelectorAll('.xterm-accessibility, .xterm-screen').forEach((el, i) => {
                const text = (el as HTMLElement).innerText;
                results.push(`[${i}] accessibility: text="${text.slice(0, 100)}..."`);
            });

            // Terminal panels
            document.querySelectorAll('[class*="terminal"], [id*="terminal"]').forEach((el, i) => {
                if (i < 5) {
                    results.push(`[${i}] terminal element: ${el.tagName} class="${el.className.slice(0, 50)}"`);
                }
            });

            return results;
        });

        console.log('📺 Terminal Elements:');
        for (const t of terminalInfo) {
            console.log(`  - ${t}`);
        }
    }

    await browser.close();
    console.log('\n✅ Done');
}

main().catch(console.error);
