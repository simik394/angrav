import { Frame, Page } from '@playwright/test';

/**
 * Review and Execution module for Antigravity agent.
 * Handles applying code changes, undoing actions, and reading terminal output.
 */

export interface CodeChange {
    filename: string;
    language: string;
    hasApplyButton: boolean;
}

export interface TerminalOutput {
    text: string;
    timestamp: Date;
}

// Selectors discovered from DOM inspection
const SELECTORS = {
    // Code blocks with language class
    codeBlock: '[class*="language-"]',
    // Code block header with filename
    codeBlockHeader: '.code-block-header, [class*="rounded-t"]',
    // Apply button - appears in code block header when hovering
    applyButton: 'button:has-text("Apply"), button[aria-label*="Apply"]',
    // Copy button - usually present
    copyButton: 'button:has-text("Copy"), button[aria-label*="Copy"]',
    // Terminal elements
    terminal: '.terminal.xterm',
    terminalScreen: '.xterm-screen',
    terminalWrapper: '.terminal-wrapper.active',
    // Undo button - often in toolbar
    undoButton: 'button[aria-label*="Undo"], button:has(svg[class*="undo"])',
};

/**
 * Lists all code changes in the current response.
 */
export async function listCodeChanges(frame: Frame): Promise<CodeChange[]> {
    console.log('🔍 Scanning for code changes...');

    const changes = await frame.evaluate(() => {
        const results: Array<{ filename: string; language: string; hasApplyButton: boolean }> = [];

        document.querySelectorAll('[class*="language-"]').forEach((block) => {
            const classAttr = block.className || '';
            const langMatch = classAttr.match(/language-(\w+)/);
            const language = langMatch ? langMatch[1] : 'unknown';

            // Try to find filename from parent header
            const parent = block.parentElement;
            let filename = 'untitled';

            if (parent) {
                // Look for header with filename
                const header = parent.querySelector('[class*="rounded-t"], .code-block-header');
                if (header) {
                    filename = (header as HTMLElement).innerText.trim() || filename;
                }

                // Also check for filename attribute
                const filenameAttr = block.getAttribute('data-filename');
                if (filenameAttr) filename = filenameAttr;
            }

            // Check if Apply button exists (look for buttons with "Apply" text)
            let hasApply = false;
            if (parent) {
                const buttons = parent.querySelectorAll('button');
                buttons.forEach(btn => {
                    if ((btn as HTMLElement).innerText.toLowerCase().includes('apply')) {
                        hasApply = true;
                    }
                });
            }

            results.push({ filename, language, hasApplyButton: hasApply });
        });

        return results;
    });

    console.log(`📋 Found ${changes.length} code changes`);
    return changes;
}

/**
 * Applies all pending code changes.
 * Clicks all visible "Apply" buttons.
 */
export async function applyAllChanges(frame: Frame): Promise<number> {
    console.log('🔧 Applying all code changes...');

    // Find all Apply buttons
    const applyButtons = frame.locator(SELECTORS.applyButton);
    const count = await applyButtons.count();

    if (count === 0) {
        console.log('No Apply buttons found');
        return 0;
    }

    console.log(`Found ${count} Apply buttons`);

    // Click each one
    for (let i = 0; i < count; i++) {
        try {
            await applyButtons.nth(i).click();
            await frame.waitForTimeout(500); // Wait for apply to complete
            console.log(`  ✅ Applied change ${i + 1}/${count}`);
        } catch (e) {
            console.warn(`  ⚠️ Failed to apply change ${i + 1}:`, e);
        }
    }

    return count;
}

/**
 * Applies code change for a specific file.
 */
export async function applyChangeForFile(frame: Frame, filenamePattern: string): Promise<boolean> {
    console.log(`🔧 Looking for Apply button for file matching "${filenamePattern}"...`);

    // Find code blocks that match the filename
    const applied = await frame.evaluate((pattern) => {
        const blocks = document.querySelectorAll('[class*="language-"]');
        for (const block of Array.from(blocks)) {
            const parent = block.parentElement;
            if (!parent) continue;

            // Get filename from header or attribute
            const header = parent.querySelector('[class*="rounded-t"], .code-block-header');
            const filename = header ? (header as HTMLElement).innerText.trim() : '';

            if (filename.toLowerCase().includes(pattern.toLowerCase())) {
                // Found matching file, look for Apply button
                const applyBtn = parent.querySelector('button') as HTMLButtonElement;
                if (applyBtn && applyBtn.innerText.toLowerCase().includes('apply')) {
                    applyBtn.click();
                    return true;
                }
            }
        }
        return false;
    }, filenamePattern);

    if (applied) {
        console.log(`✅ Applied change for "${filenamePattern}"`);
    } else {
        console.log(`❌ No Apply button found for "${filenamePattern}"`);
    }

    return applied;
}

/**
 * Reads the terminal output from the active terminal.
 * Uses the xterm accessibility layer to extract text.
 */
export async function readTerminal(page: Page): Promise<TerminalOutput> {
    console.log('📺 Reading terminal output...');

    // Try accessibility layer first (most reliable)
    try {
        const accessibilityText = await page.evaluate(() => {
            const el = document.querySelector('.xterm-accessibility');
            return el ? (el as HTMLElement).innerText : null;
        });

        if (accessibilityText && accessibilityText.trim()) {
            console.log(`Read ${accessibilityText.length} chars from accessibility layer`);
            return {
                text: accessibilityText,
                timestamp: new Date()
            };
        }
    } catch (e) {
        console.warn('Accessibility layer not available');
    }

    // Fallback: try to read from terminal rows
    const terminalText = await page.evaluate(() => {
        const rows = document.querySelectorAll('.xterm-rows > div');
        const lines: string[] = [];
        rows.forEach(row => {
            lines.push((row as HTMLElement).innerText || '');
        });
        return lines.join('\n');
    });

    console.log(`Read ${terminalText.length} chars from terminal rows`);
    return {
        text: terminalText,
        timestamp: new Date()
    };
}

/**
 * Gets the last N lines from the terminal.
 */
export async function getTerminalLastLines(page: Page, lines: number = 20): Promise<string> {
    const output = await readTerminal(page);
    const allLines = output.text.split('\n');
    return allLines.slice(-lines).join('\n');
}

/**
 * Undoes the last action.
 * Note: This is a best-effort operation - Undo behavior varies.
 */
export async function undoLastAction(frame: Frame): Promise<boolean> {
    console.log('⏪ Attempting to undo last action...');

    // Try to find Undo button
    const undoBtn = frame.locator(SELECTORS.undoButton).first();

    if (await undoBtn.count() > 0) {
        await undoBtn.click();
        console.log('✅ Clicked Undo button');
        return true;
    }

    // Fallback: try Ctrl+Z keyboard shortcut
    try {
        await frame.locator('body').first().press('Control+z');
        console.log('✅ Sent Ctrl+Z');
        return true;
    } catch (e) {
        console.warn('⚠️ Could not send Ctrl+Z');
    }

    console.log('❌ No Undo mechanism found');
    return false;
}

/**
 * Waits for a specific pattern to appear in terminal output.
 */
export async function waitForTerminalPattern(
    page: Page,
    pattern: string | RegExp,
    timeoutMs: number = 30000
): Promise<boolean> {
    console.log(`⏳ Waiting for terminal pattern: ${pattern} (timeout: ${timeoutMs}ms)`);

    const startTime = Date.now();
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    while (Date.now() - startTime < timeoutMs) {
        const output = await readTerminal(page);
        if (regex.test(output.text)) {
            console.log('✅ Pattern found in terminal');
            return true;
        }
        await page.waitForTimeout(500);
    }

    console.log('⏰ Timeout waiting for pattern');
    return false;
}
