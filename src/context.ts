import { Frame, Page } from '@playwright/test';

/**
 * Context injection operations for Antigravity agent.
 * Allows programmatic file references and uploads.
 */

export interface FileContext {
    path: string;
    type: 'file' | 'image' | 'document';
}

// Context types available via @ menu
export type ContextType =
    | 'code-context-items'
    | 'files'
    | 'directories'
    | 'mcp-servers'
    | 'rules'
    | 'conversations'
    | 'terminal';

// Known selectors (discovered via exploration tests)
const SELECTORS = {
    chatInput: '[contenteditable="true"][data-lexical-editor="true"]',
    // Popup that appears after typing @ (in iframe)
    atPopup: 'div.lexical-typeahead-menu[role="listbox"]',
    atPopupItem: '[role="option"]',
    // + button to open context menu
    addContextButton: 'button:has(svg.lucide-plus)',
    // Context dialog that appears after clicking +
    addContextDialog: '[role="dialog"]',
    // Menu items in the dialog (match by text content)
    imageMenuItem: 'text=Images',
    docsMenuItem: 'text=Docs',
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

    // Wait for popup to appear (verified selector)
    try {
        await frame.locator(SELECTORS.atPopup).waitFor({ state: 'visible', timeout: 3000 });
    } catch {
        console.warn('⚠️ @ popup did not appear, continuing anyway...');
    }

    // Type filename to filter
    await page.keyboard.type(filename);

    // Wait for filtering to take effect
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
 * Adds a context reference by type using the @ menu.
 * Types "@" followed by the type prefix and selects from the popup.
 * 
 * @param frame - The agent frame
 * @param page - The page containing the frame
 * @param contextType - Type of context to add (files, directories, terminal, etc)
 * @param name - Name/filter for the context item
 */
export async function addContextByType(
    frame: Frame,
    page: Page,
    contextType: ContextType,
    name: string
): Promise<void> {
    // Map context types to their @ prefixes
    const prefixMap: Record<ContextType, string> = {
        'code-context-items': 'code',
        'files': 'file',
        'directories': 'dir',
        'mcp-servers': 'mcp',
        'rules': 'rule',
        'conversations': 'conv',
        'terminal': 'term'
    };

    const prefix = prefixMap[contextType];
    console.log(`📂 Adding ${contextType} context: ${name}`);

    const input = frame.locator(SELECTORS.chatInput).first();
    await input.click();

    // Type @ + prefix to filter to this type
    await page.keyboard.type(`@${prefix}`);
    await frame.waitForTimeout(500);

    // Type the specific name
    await page.keyboard.type(name);
    await frame.waitForTimeout(300);

    // Select first match
    await page.keyboard.press('Enter');

    console.log(`✅ ${contextType} context added: ${name}`);
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

    // Click Add Context button (verified selector)
    const addButton = frame.locator(SELECTORS.addContextButton);

    if (await addButton.count() === 0) {
        throw new Error('Add Context button (+) not found. Is the agent panel open?');
    }

    await addButton.click();

    // Wait for dialog to appear
    try {
        await frame.locator(SELECTORS.addContextDialog).waitFor({ state: 'visible', timeout: 3000 });
    } catch {
        console.warn('⚠️ Add context dialog did not appear, continuing anyway...');
    }

    // Select Images option from dialog
    const imageOption = frame.locator(SELECTORS.imageMenuItem);
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

    // Click Add Context button (verified selector)
    const addButton = frame.locator(SELECTORS.addContextButton);

    if (await addButton.count() === 0) {
        throw new Error('Add Context button (+) not found. Is the agent panel open?');
    }

    await addButton.click();

    // Wait for dialog to appear
    try {
        await frame.locator(SELECTORS.addContextDialog).waitFor({ state: 'visible', timeout: 3000 });
    } catch {
        console.warn('⚠️ Add context dialog did not appear, continuing anyway...');
    }

    // Select Docs option from dialog
    const docsOption = frame.locator(SELECTORS.docsMenuItem);
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
