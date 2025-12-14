import { Frame, Page } from '@playwright/test';

/**
 * Context injection operations for Antigravity agent.
 * Allows programmatic file references and uploads.
 */

export interface FileContext {
    path: string;
    type: 'file' | 'image' | 'document';
}

// Known selectors (discovered via exploration tests)
const SELECTORS = {
    chatInput: '[contenteditable="true"][data-lexical-editor="true"]',
    // Popup that appears after typing @
    filePopup: 'div.lexical-typeahead-menu[role="listbox"]',
    filePopupItem: 'div.lexical-typeahead-menu [role="option"]',
    // TBD - needs further DOM discovery
    addContextButton: 'button[aria-label*="context"], button[aria-label*="Add"]',
    imageOption: '[data-option="image"], [aria-label*="image"]',
    documentOption: '[data-option="document"], [aria-label*="document"]',
};

/**
 * Adds a file reference to the current prompt using @file syntax.
 * Types "@" to trigger the popup, then selects the matching file.
 * 
 * @param frame - The agent frame (cascade-panel)
 * @param page - The page containing the frame
 * @param filename - Filename to reference (partial match supported)
 */
export async function addFileContext(
    frame: Frame,
    page: Page,
    filename: string
): Promise<void> {
    console.log(`📂 Adding file context: ${filename}`);

    const input = frame.locator(SELECTORS.chatInput).first();

    if (await input.count() === 0) {
        throw new Error('Chat input not found. Is the agent panel open?');
    }

    // Click to focus
    await input.click();

    // Type @ to trigger file popup
    await page.keyboard.type('@');

    // Wait for popup to appear
    // TODO: Replace with actual popup selector once discovered
    await frame.waitForTimeout(500);

    // Type filename to filter
    await page.keyboard.type(filename);

    // Wait for filtering
    await frame.waitForTimeout(300);

    // Press Enter to select first match
    await page.keyboard.press('Enter');

    console.log(`✅ File context added: ${filename}`);
}

/**
 * Adds multiple file references to the current prompt.
 * 
 * @param frame - The agent frame
 * @param page - The page containing the frame
 * @param filenames - Array of filenames to reference
 */
export async function addMultipleFileContexts(
    frame: Frame,
    page: Page,
    filenames: string[]
): Promise<void> {
    console.log(`📂 Adding ${filenames.length} file contexts...`);

    for (const filename of filenames) {
        await addFileContext(frame, page, filename);
        // Small delay between additions
        await frame.waitForTimeout(200);
    }

    console.log(`✅ Added ${filenames.length} file contexts`);
}

/**
 * Uploads an image to the agent context.
 * Uses the Add Context button -> Images option.
 * 
 * @param frame - The agent frame
 * @param page - The page containing the frame
 * @param imagePath - Absolute path to the image file
 */
export async function uploadImage(
    frame: Frame,
    page: Page,
    imagePath: string
): Promise<void> {
    console.log(`🖼️ Uploading image: ${imagePath}`);

    // Click Add Context button
    // TODO: Discover actual selector
    const addButton = frame.locator(SELECTORS.addContextButton);
    await addButton.click();

    // Wait for menu
    await frame.waitForTimeout(300);

    // Select Images option
    const imageOption = frame.locator(SELECTORS.imageOption);
    await imageOption.click();

    // Handle file input (Playwright can set files directly)
    const fileInput = await page.locator('input[type="file"]');
    await fileInput.setInputFiles(imagePath);

    console.log(`✅ Image uploaded: ${imagePath}`);
}

/**
 * Uploads a document to the agent context.
 * 
 * @param frame - The agent frame
 * @param page - The page containing the frame
 * @param documentPath - Absolute path to the document file
 */
export async function uploadDocument(
    frame: Frame,
    page: Page,
    documentPath: string
): Promise<void> {
    console.log(`📄 Uploading document: ${documentPath}`);

    // Click Add Context button
    const addButton = frame.locator(SELECTORS.addContextButton);
    await addButton.click();

    // Wait for menu
    await frame.waitForTimeout(300);

    // Select Docs option
    const docsOption = frame.locator(SELECTORS.documentOption);
    await docsOption.click();

    // Handle file input
    const fileInput = await page.locator('input[type="file"]');
    await fileInput.setInputFiles(documentPath);

    console.log(`✅ Document uploaded: ${documentPath}`);
}

/**
 * Dumps the DOM structure around the chat input for selector discovery.
 * Useful for finding the actual popup selectors.
 */
export async function dumpContextUIStructure(frame: Frame): Promise<string> {
    console.log('🔍 Dumping context UI structure...');

    // Get the parent container of the chat input
    const html = await frame.evaluate(() => {
        const input = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
        if (!input) return 'Chat input not found';

        // Get surrounding structure
        const container = input.closest('.chat-container, .input-container, [class*="chat"], [class*="input"]') || input.parentElement?.parentElement?.parentElement;
        return container?.outerHTML || 'Container not found';
    });

    return html;
}
