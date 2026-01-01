import { chromium } from '@playwright/test';

async function main() {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages().find(p => p.url().includes('workbench-jetski-agent')) || defaultContext.pages()[0];

    if (!page) {
        console.error('No suitable page found.');
        process.exit(1);
    }

    console.log(`Connected to page: ${await page.title()}`);

    // Find the chat frame
    const frames = page.frames();
    const chatFrame = frames.find(f => f.url().includes('cascade-panel')) || frames[0];
    console.log(`Using frame: ${chatFrame.url()}`);

    // Scroll up looking for "Files With Changes"
    await chatFrame.evaluate(async () => {
        // MATCH SESSION.TS LOGIC
        const chatContainer = document.querySelector('#cascade, #chat, [class*="chat"]') || document.body;
        const scrollContainer = chatContainer.querySelector('.overflow-y-auto') || document.body;

        const maxScroll = scrollContainer.scrollHeight;

        console.log(`Max scroll: ${maxScroll}`);
        console.log(`Scroll Container: ${scrollContainer.tagName} ${scrollContainer.className}`);

        // Scroll from bottom to top
        for (let pos = maxScroll; pos >= 0; pos -= 500) {
            window.scrollTo(0, pos); // Match session.ts logic
            await new Promise(r => setTimeout(r, 400)); // Increase wait

            // Check for element
            const els = Array.from(document.querySelectorAll('*'));
            const found = els.filter(el => el.textContent && el.textContent.includes('Files With Changes'));

            if (found.length > 0) {
                const target = found[0];
                const container = target.closest('.border') || target.parentElement?.parentElement || target;

                return {
                    found: true,
                    html: container.outerHTML.substring(0, 3000), // Larger buffer
                    pos: pos,
                    tagName: target.tagName
                };
            }
        }
        return { found: false };
    }).then(result => {
        if (result.found) {
            console.log("FOUND 'Files With Changes'!");
            console.log("Position:", result.pos);
            console.log("HTML Structure:");
            console.log(result.html);
        } else {
            console.log("Could not find 'Files With Changes' by scrolling.");
        }
    });

    await browser.close();
}

main().catch(console.error);
