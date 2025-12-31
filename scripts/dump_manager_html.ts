
import * as fs from 'fs';
import * as path from 'path';
import { connectToApp } from '../src/core';
import { openAgentManager } from '../src/manager';

function log(msg: string) {
    console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
    log('🚀 Dumping Manager DOM...');

    let browser;
    try {
        const conn = await connectToApp();
        browser = conn.browser;
        const context = conn.context;

        const managerCtx = await openAgentManager(context);
        const page = managerCtx.page;
        
        log('📥 Dumping HTML...');
        const html = await page.content();
        
        const dumpPath = path.resolve(process.cwd(), 'manager_full.html');
        fs.writeFileSync(dumpPath, html);
        log(`💾 HTML saved to: ${dumpPath}`);
        
        // Also dump visible text to cross-reference
        const text = await page.innerText('body');
        fs.writeFileSync(path.resolve(process.cwd(), 'manager_full.txt'), text);

    } catch (error) {
        log(`🔥 Fatal: ${(error as Error).message}`);
    } finally {
        if (browser) await browser.close();
    }
}

main();
