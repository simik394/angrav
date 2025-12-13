import { test, expect } from '@playwright/test';
import { connectToApp, getAgentFrame } from '../src/core';
import { getAgentState, waitForIdle } from '../src/state';

test.describe('Antigravity State Monitoring', () => {
    test('should detect agent state correctly', async () => {
        // 1. Connect
        const { browser, page } = await connectToApp();
        const frame = await getAgentFrame(page);

        console.log('✅ Connected to Agent frame');

        // 2. Check initial state (should be idle usually)
        const initialState = await getAgentState(frame);
        console.log('Initial State:', initialState);

        expect(initialState.state).toBe('idle');
        expect(initialState.isInputEnabled).toBe(true);

        // 3. Test waitForIdle (should resolve immediately if idle)
        const start = Date.now();
        await waitForIdle(frame, 5000);
        const duration = Date.now() - start;

        console.log(`waitForIdle took ${duration}ms`);
        expect(duration).toBeLessThan(5000);

        // 4. Cleanup
        await browser.close();
    });
});
