import { chromium, Frame, Page } from '@playwright/test';

const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://100.73.45.27:9224';

interface RateLimitInfo {
    model: string;
    isLimited: boolean;
    availableAt?: string;  // ISO date or human-readable
    rawMessage?: string;
}

async function detectRateLimits(frame: Frame): Promise<RateLimitInfo[]> {
    console.log('🔍 Scanning for rate limit indicators...\n');

    // Look for the rate limit popup message
    const popupInfo = await frame.evaluate(() => {
        const results: { model: string; availableAt: string; rawMessage: string }[] = [];

        // Search all text for rate limit messages
        const divs = document.querySelectorAll('div');
        divs.forEach((div) => {
            const text = (div as HTMLElement).innerText;
            if (text && text.includes('quota limit') && text.includes('resume')) {
                // Extract model name and time
                const modelMatch = text.match(/for ([^.]+)\./);
                const timeMatch = text.match(/at ([^.]+)\./);

                if (modelMatch && timeMatch) {
                    results.push({
                        model: modelMatch[1].trim(),
                        availableAt: timeMatch[1].trim(),
                        rawMessage: text.slice(0, 300)
                    });
                }
            }
        });

        return results;
    });

    console.log('Popup detection results:', popupInfo);

    // Also try to find warning icons in the model selector
    const warningIcons = await frame.evaluate(() => {
        const icons = document.querySelectorAll('svg');
        let count = 0;
        icons.forEach((svg) => {
            const cls = svg.getAttribute('class') || '';
            if (cls.includes('warning') || cls.includes('alert') || cls.includes('exclamation')) {
                count++;
            }
        });
        return count;
    });

    console.log(`Warning icons found: ${warningIcons}`);

    // Convert to RateLimitInfo
    return popupInfo.map(p => ({
        model: p.model,
        isLimited: true,
        availableAt: p.availableAt,
        rawMessage: p.rawMessage
    }));
}

async function main() {
    console.log(`Connecting to ${CDP_ENDPOINT}...\n`);

    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const ctx = browser.contexts()[0];

    for (const page of ctx.pages()) {
        if (!page.url().includes('workbench')) continue;

        for (const frame of page.frames()) {
            if (!frame.url().includes('cascade-panel')) continue;

            console.log('🎯 Found cascade-panel frame\n');

            const limits = await detectRateLimits(frame);

            console.log('\n=== RATE LIMIT STATUS ===\n');
            if (limits.length === 0) {
                console.log('No rate limits detected.');
            } else {
                limits.forEach(l => {
                    console.log(`Model: ${l.model}`);
                    console.log(`  Limited: ${l.isLimited}`);
                    console.log(`  Available at: ${l.availableAt}`);
                    console.log(`  Message: ${l.rawMessage?.slice(0, 100)}...`);
                    console.log('');
                });
            }
        }
    }

    await browser.close();
    console.log('✅ Done');
}

main().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
