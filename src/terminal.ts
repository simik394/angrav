import { Frame, Page } from '@playwright/test';
import { select } from '@inquirer/prompts';

/**
 * Terminal management for Antigravity agent.
 * Provides listing, selection (interactive and non-interactive), and context injection.
 */

export interface TerminalInfo {
    index: number;
    name: string;
    raw: string; // Raw text from UI
}

// Selectors for terminal context
const SELECTORS = {
    chatInput: '[contenteditable="true"][data-lexical-editor="true"]',
    atPopup: 'div.lexical-typeahead-menu[role="listbox"]',
    atPopupItem: '[role="option"]',
};

/**
 * Lists all available terminals by querying the @ menu.
 * 
 * @param frame - The agent frame (cascade-panel)
 * @param page - The page containing the frame
 * @returns Array of available terminals
 */
export async function listTerminals(
    frame: Frame,
    page: Page
): Promise<TerminalInfo[]> {
    console.log('📋 Listing available terminals...');

    const input = frame.locator(SELECTORS.chatInput).first();
    await input.click();

    // Type @term to filter to terminals
    await page.keyboard.type('@term');
    await frame.waitForTimeout(800);

    // Query the popup for terminal options
    const terminals = await frame.evaluate(() => {
        const popup = document.querySelector('[role="listbox"], .lexical-typeahead-menu');
        if (!popup) return [];

        const items = popup.querySelectorAll('[role="option"]');
        return Array.from(items).map((item, index) => ({
            index: index + 1,
            name: item.textContent?.trim() || `Terminal ${index + 1}`,
            raw: item.textContent || ''
        }));
    });

    // Clear the input
    await page.keyboard.press('Escape');
    await frame.waitForTimeout(200);

    console.log(`Found ${terminals.length} terminals`);
    return terminals;
}

/**
 * Adds a terminal as context - interactive mode with arrow-key selection.
 * Falls back to first terminal if stdin is not a TTY (for AI agents).
 * 
 * @param frame - The agent frame
 * @param page - The page containing the frame
 * @returns Selected terminal name
 */
export async function addTerminalInteractive(
    frame: Frame,
    page: Page
): Promise<string> {
    const terminals = await listTerminals(frame, page);

    if (terminals.length === 0) {
        throw new Error('No terminals available');
    }

    if (terminals.length === 1) {
        // Only one terminal, select it directly
        await addTerminalByIndex(frame, page, 1);
        return terminals[0].name;
    }

    // Check if we're in interactive mode (TTY)
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

    if (!isInteractive) {
        // Non-interactive mode (AI agent) - return list and let caller decide
        console.log('Non-interactive mode: use index or name to select');
        console.log('Available terminals:');
        terminals.forEach(t => console.log(`  ${t.index}. ${t.name}`));
        throw new Error('Interactive selection not available in non-TTY mode. Use index or name argument.');
    }

    // Interactive mode - show arrow-key selection
    const selectedName = await select({
        message: 'Select terminal to add as context:',
        choices: terminals.map(t => ({
            name: t.name,
            value: t.name,
            description: `Terminal #${t.index}`
        }))
    });

    // Now add the selected terminal
    await addTerminalByName(frame, page, selectedName);
    return selectedName;
}

/**
 * Adds a terminal by index (1-based).
 * Non-interactive, suitable for AI agents.
 */
export async function addTerminalByIndex(
    frame: Frame,
    page: Page,
    index: number
): Promise<void> {
    console.log(`🖥️ Adding terminal by index: ${index}`);

    const terminals = await listTerminals(frame, page);

    if (index < 1 || index > terminals.length) {
        throw new Error(`Invalid terminal index: ${index}. Available: 1-${terminals.length}`);
    }

    const terminal = terminals[index - 1];
    await addTerminalByName(frame, page, terminal.name);
}

/**
 * Adds a terminal by name (partial match).
 * Non-interactive, suitable for AI agents.
 */
export async function addTerminalByName(
    frame: Frame,
    page: Page,
    name: string
): Promise<void> {
    console.log(`🖥️ Adding terminal: ${name}`);

    const input = frame.locator(SELECTORS.chatInput).first();
    await input.click();

    // Type @term + name to filter
    await page.keyboard.type(`@term${name}`);
    await frame.waitForTimeout(500);

    // Select first match
    await page.keyboard.press('Enter');

    console.log(`✅ Terminal added: ${name}`);
}

/**
 * Smart terminal addition - uses index, name, or interactive selection.
 * 
 * @param frame - The agent frame
 * @param page - The page
 * @param selector - Optional: index number, name string, or undefined for interactive
 */
export async function addTerminal(
    frame: Frame,
    page: Page,
    selector?: string | number
): Promise<string> {
    if (selector === undefined) {
        // Interactive mode
        return addTerminalInteractive(frame, page);
    }

    if (typeof selector === 'number') {
        // Index-based
        const terminals = await listTerminals(frame, page);
        await addTerminalByIndex(frame, page, selector);
        return terminals[selector - 1]?.name || `Terminal ${selector}`;
    }

    // Try to parse as number first
    const asNumber = parseInt(selector, 10);
    if (!isNaN(asNumber) && asNumber > 0) {
        return addTerminal(frame, page, asNumber);
    }

    // Name-based
    await addTerminalByName(frame, page, selector);
    return selector;
}
