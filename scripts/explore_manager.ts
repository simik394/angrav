import * as fs from 'fs';
import * as path from 'path';
import { connectToApp } from '../src/core';
import { openAgentManager } from '../src/manager';

function log(msg: string) {
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
    log('🚀 Starting Manager Exploration...');

    let browser;
    try {
        const conn = await connectToApp();
        browser = conn.browser;
        const context = conn.context;

        log('📋 Opening/Finding Manager...');
        const managerCtx = await openAgentManager(context);
        const page = managerCtx.page;
        
        // List main buttons
        log('🔍 Finding Sidebar buttons...');
        const inboxBtn = page.locator('text="Inbox"').first();
        const activeBtn = page.locator('text="Active"').first();
        const recentBtn = page.locator('text="Recent"').first();
        
        // 1. Check Inbox
        if (await inboxBtn.count() > 0) {
            log('🖱️ Clicking Inbox (forced)...');
            await inboxBtn.click({ force: true });
            await page.waitForTimeout(2000);
            
            // Try clicking a session
            const sessionName = "Refining Session History Output";
            log(`🖱️ Clicking session: "${sessionName}" (forced)...`);
            
            const sessionBtn = page.locator(`text="${sessionName}"`).first();
            if (await sessionBtn.count() > 0) {
                await sessionBtn.click({ force: true });
                log('⏳ Waiting 10s for content load...');
                await page.waitForTimeout(10000); // Wait for load
                
                log('📥 Dumping Session View in Manager...');
                const frames = page.frames();
                log(`Found ${frames.length} frames in Manager.`);
                
                for (let i = 0; i < frames.length; i++) {
                    const f = frames[i];
                    const url = f.url();
                    const name = f.name();
                    log(`  Frame ${i}: "${name}" (${url})`);
                    
                    try {
                        const text = await f.locator('body').innerText();
                        if (text.length > 100) {
                            fs.writeFileSync(`manager_frame_${i}.txt`, text);
                            log(`    Saved content to manager_frame_${i}.txt`);
                            if (text.includes('User') || text.includes('Agent')) {
                                log('    ✅ Chat content found in this frame!');
                            }
                        }
                    } catch (e) {
                         log(`    Could not read frame content: ${e}`);
                    }
                }
            } else {
                log('❌ Session button not found.');
            }
        }

        // 2. Check Active
        /*
        if (await activeBtn.count() > 0) {
            log('🖱️ Clicking Active...');
            await activeBtn.click();
            await page.waitForTimeout(2000);
            
            log('📥 Dumping Active Content...');
            const activeText = await page.locator('body').innerText();
            fs.writeFileSync('manager_active.txt', activeText);
            log('  Saved to manager_active.txt');
        }
        */

    } catch (error) {
        log(`🔥 Fatal: ${(error as Error).message}`);
    } finally {
        if (browser) await browser.close();
    }
}

main();
