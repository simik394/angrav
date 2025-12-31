import * as fs from 'fs';
import * as path from 'path';
import { connectToApp } from '../src/core';

function log(msg: string) {
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
    log('🚀 Starting Manager Button Debug...');

    let browser;
    try {
        const conn = await connectToApp();
        browser = conn.browser;
        const context = conn.context;

        const pages = context.pages();
        const managerPage = pages.find(p => p.url().includes('workbench-jetski-agent.html'));

        if (!managerPage) {
            log('❌ Manager Page NOT found.');
            return;
        }

        log(`✅ Found Manager Page: "${await managerPage.title()}"`);
        
        log('🔍 Dumping all buttons/links...');
        const buttons = managerPage.locator('button, a, div[role="button"]');
        const count = await buttons.count();
        log(`Found ${count} clickable elements.`);
        
        for (let i = 0; i < count; i++) {
            const txt = await buttons.nth(i).innerText().catch(() => '');
            const title = await buttons.nth(i).getAttribute('title') || '';
            const cls = await buttons.nth(i).getAttribute('class') || '';
            
            if (txt.trim() || title) {
                console.log(`[${i}] Text="${txt.replace(/\n/g, ' ').trim()}" Title="${title}" Class="${cls.substring(0, 30)}..."`);
            }
        }

    } catch (error) {
        log(`🔥 Fatal: ${(error as Error).message}`);
    } finally {
        if (browser) await browser.close();
    }
}

main();
