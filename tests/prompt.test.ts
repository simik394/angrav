import { test, chromium } from '@playwright/test';
import { getAgentFrame } from '../src/core';
import { sendPrompt } from '../src/prompt';
import { getAgentState } from '../src/state';

test('Send prompt test', async () => {
    console.log('🚀 Connecting...');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const context = browser.contexts()[0];
    const pages = context.pages();

    const workbench = pages.find(p =>
        p.url().includes('workbench.html') &&
        !p.url().includes('jetski')
    );
    if (!workbench) throw new Error('Workbench not found');

    const frame = await getAgentFrame(workbench);

    // Check initial state
    const state = await getAgentState(frame);
    console.log(`Initial state: ${state.state}`);

    // Send a simple test prompt (without waiting to avoid long test)
    console.log('\n📝 Sending test prompt...');
    await sendPrompt(frame, workbench, 'Say "Hello World" and nothing else.', { wait: false });

    console.log('✅ Prompt sent!');

    // Give it a moment then check state
    await workbench.waitForTimeout(2000);
    const newState = await getAgentState(frame);
    console.log(`State after send: ${newState.state}`);

    await browser.close();
});
