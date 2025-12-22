/**
 * Windmill Script: Output (Scrape Angrav Result)
 * 
 * PHASE 2 of the Input/Output pattern for Angrav.
 * 
 * Triggered by webhook from input.ts when task is complete.
 */

import { chromium } from 'playwright';
import { markTabFree } from '../../shared/tab-pool';

// CDP endpoint
const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || 'http://angrav-browser:9223';

/**
 * Resolve hostname to IP for CDP connection
 */
async function resolveCdpEndpoint(endpoint: string): Promise<string> {
    const url = new URL(endpoint);

    if (url.hostname !== 'localhost' && !url.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        const dns = await import('node:dns');
        const { promisify } = await import('node:util');
        const lookup = promisify(dns.lookup);

        try {
            const { address } = await lookup(url.hostname);
            url.hostname = address;
            return url.toString();
        } catch {
            return endpoint;
        }
    }

    return endpoint;
}

/**
 * Extract the response from Angrav
 */
async function extractResponse(page: any): Promise<{
    response: string;
    code_blocks: string[];
    files_modified: string[];
}> {
    return await page.evaluate(() => {
        // Main response text
        const responseEl = document.querySelector('.response, .agent-output, [data-testid="response"]');
        const response = responseEl?.textContent?.trim() || '';

        // Code blocks
        const codeEls = document.querySelectorAll('pre code, .code-block');
        const code_blocks: string[] = [];
        codeEls.forEach((el) => {
            const code = el.textContent?.trim();
            if (code) code_blocks.push(code);
        });

        // Files modified (if shown)
        const fileEls = document.querySelectorAll('.file-modified, [data-file]');
        const files_modified: string[] = [];
        fileEls.forEach((el) => {
            const file = el.getAttribute('data-file') || el.textContent?.trim();
            if (file) files_modified.push(file);
        });

        return { response, code_blocks, files_modified };
    });
}

/**
 * Main entry point for Windmill
 */
export async function main(
    tabId: string,
    prompt: string,
    status: string,
    timestamp: number
): Promise<{
    status: 'success' | 'timeout' | 'error';
    prompt: string;
    response: string;
    code_blocks: string[];
    files_modified: string[];
    processingTimeMs: number;
}> {

    const startTime = Date.now();
    const resolvedEndpoint = await resolveCdpEndpoint(CDP_ENDPOINT);
    const browser = await chromium.connectOverCDP(resolvedEndpoint);

    try {
        // Get the page
        const pages = browser.contexts()[0]?.pages() || [];
        const page = pages[0];

        if (!page) {
            throw new Error('No page available in Angrav browser');
        }

        console.log(`📥 Extracting response for task ${tabId}...`);

        // Extract the response
        const result = await extractResponse(page);

        // Calculate processing time
        const processingTimeMs = Date.now() - timestamp;

        console.log(`✅ Response extracted (${result.response.length} chars, ${result.code_blocks.length} code blocks)`);

        // Mark tab as free (Angrav is single-page, so just reset state)
        await markTabFree(page);

        await browser.close();

        return {
            status: status === 'timeout' ? 'timeout' : 'success',
            prompt: prompt,
            response: result.response,
            code_blocks: result.code_blocks,
            files_modified: result.files_modified,
            processingTimeMs: processingTimeMs
        };

    } catch (error: any) {
        await browser.close();

        return {
            status: 'error',
            prompt: prompt,
            response: error.message,
            code_blocks: [],
            files_modified: [],
            processingTimeMs: Date.now() - startTime
        };
    }
}
