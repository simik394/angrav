import { Frame } from '@playwright/test';

export interface CodeBlock {
    language: string;
    content: string;
    filename?: string;
}

export interface AgentResponse {
    fullText: string;
    thoughts?: string;
    codeBlocks: CodeBlock[];
    timestamp: Date;
}

/**
 * Extracts all code blocks from the agent's response.
 */
export async function extractCodeBlocks(frame: Frame): Promise<CodeBlock[]> {
    const blocks: CodeBlock[] = [];

    // Code blocks are in pre > code elements within .prose containers
    const codeElements = frame.locator('div.prose pre > code');
    const count = await codeElements.count();

    console.log(`Found ${count} code blocks`);

    for (let i = 0; i < count; i++) {
        const codeEl = codeElements.nth(i);
        const content = await codeEl.innerText();

        // Try to get language from class (e.g., "language-typescript")
        const classAttr = await codeEl.getAttribute('class') || '';
        const langMatch = classAttr.match(/language-(\w+)/);
        const language = langMatch ? langMatch[1] : 'unknown';

        // Try to get filename from header if present
        const parent = codeEl.locator('..').locator('..');
        const headerEl = parent.locator('.code-block-header, [class*="filename"]');
        const filename = await headerEl.count() > 0 ? await headerEl.innerText() : undefined;

        blocks.push({ language, content, filename });
    }

    return blocks;
}

/**
 * Extracts the agent's thoughts (reasoning) if available.
 */
export async function extractThoughts(frame: Frame): Promise<string | undefined> {
    // Find the Thought toggle button
    const thoughtBtn = frame.locator('button:has-text("Thought")').first();

    if (await thoughtBtn.count() === 0) {
        return undefined;
    }

    // Check if already expanded by looking for visible content
    const thoughtContent = frame.locator('.pl-6 .prose').first();

    // If not visible, click to expand
    if (await thoughtContent.count() === 0 || !(await thoughtContent.isVisible())) {
        await thoughtBtn.click();
        await frame.waitForTimeout(500); // Wait for animation
    }

    // Now read the thoughts
    const content = await frame.locator('.pl-6 .prose').first();
    if (await content.count() > 0 && await content.isVisible()) {
        return await content.innerText();
    }

    return undefined;
}

/**
 * Extracts the main answer text (excluding code blocks and thoughts).
 */
export async function extractAnswer(frame: Frame): Promise<string> {
    // Get the last agent response prose
    const proseElements = frame.locator('div.bg-ide-chat-background .prose');
    const count = await proseElements.count();

    if (count === 0) {
        return '';
    }

    // Get the last prose element (most recent answer)
    const lastProse = proseElements.nth(count - 1);
    return await lastProse.innerText();
}

/**
 * Extracts a complete agent response with all components.
 */
export async function extractResponse(frame: Frame): Promise<AgentResponse> {
    const thoughts = await extractThoughts(frame);
    const codeBlocks = await extractCodeBlocks(frame);
    const fullText = await extractAnswer(frame);

    return {
        fullText,
        thoughts,
        codeBlocks,
        timestamp: new Date()
    };
}

/**
 * Extracts code blocks filtered by language.
 */
export async function extractCodeBlocksByLanguage(frame: Frame, language: string): Promise<CodeBlock[]> {
    const allBlocks = await extractCodeBlocks(frame);
    return allBlocks.filter(b => b.language.toLowerCase() === language.toLowerCase());
}
