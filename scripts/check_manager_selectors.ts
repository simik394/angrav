
import { connectToApp } from '../src/core';
import { openAgentManager } from '../src/manager';

function log(msg: string) {
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
    log('🚀 Checking Manager Selectors...');

    let browser;
    try {
        const conn = await connectToApp();
        browser = conn.browser;
        const context = conn.context;

        log('📋 Opening/Finding Manager...');
        const managerCtx = await openAgentManager(context);
        const page = managerCtx.page;
        
        // Assume a session is already selected or we click one
        // User said "already opened chat session in the agent manager"
        // So let's just inspect the current state first
        
        // Check IFRAMES
        log('🔍 Checking iframes...');
        const frames = page.frames();
        log(`Total frames: ${frames.length}`);
        
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            log(`  Frame ${i}: "${frame.name()}" src="${frame.url()}"`);
            
            try {
                const chatBg = frame.locator('.bg-ide-chat-background');
                if (await chatBg.count() > 0) {
                    log('    ✅ Found .bg-ide-chat-background in this frame!');
                }
                
                const pros = frame.locator('.prose');
                if (await pros.count() > 0) {
                    log(`    ✅ Found ${await pros.count()} .prose elements in this frame.`);
                }
            } catch (e) {
                log(`    ❌ Error inspecting frame: ${e}`);
            }
        }

    } catch (error) {
        log(`🔥 Fatal: ${(error as Error).message}`);
    } finally {
        if (browser) await browser.close();
    }
}

main();
