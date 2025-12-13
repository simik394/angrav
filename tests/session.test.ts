import { test, expect } from '@playwright/test';
import { connectToApp, getAgentFrame } from '../src/core';
import { startNewConversation, getConversationHistory } from '../src/session';

test.describe('Antigravity Session Management', () => {
    test('should start new conversation and read history', async () => {
        const { browser, page } = await connectToApp();
        const frame = await getAgentFrame(page);

        console.log('✅ Connected');

        // 1. Get current history count
        const initialHistory = await getConversationHistory(frame);
        console.log(`Initial history items: ${initialHistory.messageCount}`);

        // 2. Start new conversation
        await startNewConversation(frame);

        // 3. Verify history is empty (or has just welcome message)
        // Note: Antigravity might have a default welcome message
        const newHistory = await getConversationHistory(frame);
        console.log(`New history items: ${newHistory.messageCount}`);

        // Expectation depends on app behavior (empty vs welcome msg)
        // Assuming it resets to 0 or 1 (welcome)
        expect(newHistory.messageCount).toBeLessThanOrEqual(1);

        await browser.close();
    });
});
