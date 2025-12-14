import { Frame, Page } from '@playwright/test';
import { waitForIdle } from './state';

/**
 * Sends a prompt to the Antigravity agent.
 * @param frame - The agent frame (cascade-panel)
 * @param page - The page containing the frame (for keyboard access)
 * @param prompt - The prompt text to send
 * @param options - Send options
 */
export async function sendPrompt(
    frame: Frame,
    page: Page,
    prompt: string,
    options: { wait?: boolean; timeout?: number } = {}
): Promise<void> {
    const { wait = true, timeout = 120000 } = options;

    console.log(`💬 Sending prompt (${prompt.length} chars)...`);

    // Find the chat input
    const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]').first();

    if (await input.count() === 0) {
        throw new Error('Chat input not found. Is the agent panel open?');
    }

    // Click to focus
    await input.click();

    // Clear any existing content
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');

    // Type the prompt
    await input.fill(prompt);

    console.log('✅ Prompt typed');

    // Send with Enter
    await page.keyboard.press('Enter');
    console.log('✅ Prompt sent');

    // Optionally wait for agent to finish
    if (wait) {
        console.log('⏳ Waiting for agent to finish...');
        await waitForIdle(frame, timeout);
    }
}
