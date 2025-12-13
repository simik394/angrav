import { Frame, Page, expect } from '@playwright/test';

export type AgentState = 'idle' | 'thinking' | 'error';

export interface StateInfo {
    state: AgentState;
    errorMessage?: string;
    isInputEnabled: boolean;
}

/**
 * Detects the current state of the Antigravity agent.
 */
export async function getAgentState(frame: Frame): Promise<StateInfo> {
    const stopBtn = frame.locator('button:has-text("Stop")');
    const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]');

    // 1. Check for Thinking state (Stop button visible)
    if (await stopBtn.isVisible()) {
        return {
            state: 'thinking',
            isInputEnabled: false
        };
    }

    // 2. Check for Error state
    const errorToast = frame.locator('.toast-error, [role="alert"]');
    if (await errorToast.isVisible()) {
        const msg = await errorToast.textContent() || 'Unknown error';
        return {
            state: 'error',
            errorMessage: msg,
            isInputEnabled: await input.isEditable()
        };
    }

    // 3. Default to Idle
    return {
        state: 'idle',
        isInputEnabled: await input.isEditable() // Might be false if still initializing
    };
}

/**
 * Waits until the agent enters the 'idle' state.
 */
export async function waitForIdle(frame: Frame, timeout: number = 60000): Promise<void> {
    console.log(`⏳ Waiting for agent idle state (timeout: ${timeout}ms)...`);

    // Wait for Stop button to disappear
    await expect(frame.locator('button:has-text("Stop")')).toBeHidden({ timeout });

    // Optionally wait for input to be enabled?
    // await expect(frame.locator('[contenteditable="true"]')).toBeEditable();

    console.log('✅ Agent is idle.');
}
