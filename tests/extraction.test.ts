import { test, expect } from '@playwright/test';
import { connectToApp, getAgentFrame } from '../src/core';
import { extractCodeBlocks, extractThoughts, extractAnswer, extractResponse } from '../src/extraction';

test.describe('Antigravity Output Extraction', () => {
    test('should extract code blocks from response', async () => {
        const { browser, page } = await connectToApp();
        const frame = await getAgentFrame(page);

        console.log('✅ Connected');

        // Extract code blocks (assuming there's a response with code)
        const codeBlocks = await extractCodeBlocks(frame);
        console.log(`Found ${codeBlocks.length} code blocks`);

        // Verify structure
        codeBlocks.forEach((block, i) => {
            console.log(`Block ${i}: ${block.language}, ${block.content.length} chars`);
            expect(block.language).toBeDefined();
            expect(block.content).toBeDefined();
        });

        await browser.close();
    });

    test('should extract full response', async () => {
        const { browser, page } = await connectToApp();
        const frame = await getAgentFrame(page);

        const response = await extractResponse(frame);

        console.log('Response:', {
            textLength: response.fullText.length,
            hasThoughts: !!response.thoughts,
            codeBlocks: response.codeBlocks.length
        });

        expect(response.timestamp).toBeDefined();

        await browser.close();
    });
});
