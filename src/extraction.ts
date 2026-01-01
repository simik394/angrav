import { Frame } from '@playwright/test';
import { getAngravTelemetry, TraceHandle } from '@agents/shared';

// Get telemetry instance
const telemetry = getAngravTelemetry();

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
    structuredItems?: Array<{ type: string; content: string; key: string }>;
}

// Rich structured item (matches session.ts scraping output)
export interface StructuredItem {
    type: 'user' | 'agent' | 'thought' | 'code' | 'file-link' | 'file-activity' |
    'file-change' | 'file-diff' | 'tool-call' | 'tool-call-arg' | 'terminal' |
    'timestamp' | 'error' | 'image' | 'approval' | 'task-status' | 'table';
    content: string;
    key: string;
}

// Updated selectors based on DOM inspection (2025-12-30)
const SELECTORS = {
    // Code blocks have language-X class on wrapper div
    codeBlockWrapper: '[class*="language-"]',
    // Also look for pre > code as fallback
    codeBlockFallback: 'pre > code, pre code',
    // Prose containers (main answer text)
    prose: '.prose.prose-sm, div[class*="prose"]',
    // Thought button - contains "Thought" text
    thoughtButton: 'button:has-text("Thought")',
    // Message container for assistant responses
    messageContainer: '[class*="text-ide-message-block-bot"], [class*="assistant"]',
    // Expanded thought content (appears after clicking thought button)
    thoughtContent: '[class*="opacity-70"] .prose, .prose:has-text("Formulating")',
};

/**
 * Extracts all code blocks from the agent's response.
 */
export async function extractCodeBlocks(frame: Frame): Promise<CodeBlock[]> {
    const blocks: CodeBlock[] = [];

    // Strategy 1: Find div.language-X elements (new Antigravity structure)
    const langDivs = frame.locator('[class*="language-"]');
    const langCount = await langDivs.count();

    console.log(`Found ${langCount} language-* elements`);

    for (let i = 0; i < langCount; i++) {
        const langDiv = langDivs.nth(i);
        const classAttr = await langDiv.getAttribute('class') || '';

        // Extract language from class like "language-python"
        const langMatch = classAttr.match(/language-(\w+)/);
        if (!langMatch) continue;

        const language = langMatch[1];

        // Get the code content - look for code element inside or just get text
        const codeEl = langDiv.locator('code').first();
        let content: string;

        if (await codeEl.count() > 0) {
            content = await codeEl.innerText();
        } else {
            content = await langDiv.innerText();
        }

        // Skip if empty or just whitespace
        if (!content.trim()) continue;

        blocks.push({ language, content: content.trim() });
    }

    // Strategy 2: Fallback to pre > code if no language-* divs found
    if (blocks.length === 0) {
        const codeElements = frame.locator(SELECTORS.codeBlockFallback);
        const count = await codeElements.count();
        console.log(`Fallback: Found ${count} pre > code elements`);

        for (let i = 0; i < count; i++) {
            const codeEl = codeElements.nth(i);
            const content = await codeEl.innerText();
            const classAttr = await codeEl.getAttribute('class') || '';
            const langMatch = classAttr.match(/language-(\w+)/);
            const language = langMatch ? langMatch[1] : 'unknown';

            if (content.trim()) {
                blocks.push({ language, content: content.trim() });
            }
        }
    }

    console.log(`Total code blocks extracted: ${blocks.length}`);
    return blocks;
}

/**
 * Extracts the agent's thoughts (reasoning) if available.
 */
export async function extractThoughts(frame: Frame): Promise<string | undefined> {
    // Find the Thought toggle button (contains "Thought for Xs" text)
    const thoughtBtn = frame.locator(SELECTORS.thoughtButton).first();

    if (await thoughtBtn.count() === 0) {
        console.log('No thought button found');
        return undefined;
    }

    console.log('Found thought button, attempting to expand...');

    // Click to ensure it's expanded
    try {
        await thoughtBtn.click();
        await frame.waitForTimeout(500); // Wait for animation
    } catch (e) {
        console.warn('Could not click thought button:', e);
    }

    // Get thoughts: Find prose element that has opacity-70 in its class
    const thoughtText = await frame.evaluate(() => {
        const allProse = document.querySelectorAll('.prose');
        for (const p of Array.from(allProse)) {
            if (p.className.includes('opacity-70')) {
                return (p as HTMLElement).innerText;
            }
        }
        return null;
    });

    if (thoughtText) {
        console.log(`Extracted thought (${thoughtText.length} chars)`);
        return thoughtText;
    }

    return undefined;
}

/**
 * Extracts the main answer text (excluding code blocks and thoughts).
 */
export async function extractAnswer(frame: Frame): Promise<string> {
    // Find prose elements - the main response text
    // Look for .prose.prose-sm (the standard prose container)
    const proseElements = frame.locator('.prose.prose-sm.max-w-none');
    let count = await proseElements.count();

    // Fallback to any .prose element if specific one not found
    if (count === 0) {
        const fallbackProse = frame.locator(SELECTORS.prose);
        count = await fallbackProse.count();

        if (count === 0) {
            console.log('No prose elements found');
            return '';
        }

        // Get the last one (most recent message)
        const lastProse = fallbackProse.nth(count - 1);
        return await lastProse.innerText();
    }

    // Get the last prose element (most recent answer)
    // Skip the first one if it's the thought content (has opacity-70 parent)
    let lastIndex = count - 1;
    for (let i = count - 1; i >= 0; i--) {
        const prose = proseElements.nth(i);
        const parent = prose.locator('..');
        const parentClass = await parent.getAttribute('class') || '';

        // Skip thought content
        if (!parentClass.includes('opacity-70')) {
            lastIndex = i;
            break;
        }
    }

    const lastProse = proseElements.nth(lastIndex);
    const text = await lastProse.innerText();
    console.log(`Extracted answer (${text.length} chars)`);
    return text;
}

/**
 * Extracts a complete agent response with all components.
 * Optionally accepts a trace handle for telemetry.
 */
export async function extractResponse(frame: Frame, trace?: TraceHandle | null): Promise<AgentResponse> {
    console.log('🔍 Extracting agent response...');

    // Start extraction trace if not provided
    const extractionTrace = trace || telemetry.startTrace('extraction:response');

    // Track thought extraction
    const thoughtSpan = telemetry.startThoughtSpan(extractionTrace, 'Extracting agent thoughts');
    const thoughts = await extractThoughts(frame);
    telemetry.endSpan(thoughtSpan, thoughts || 'No thoughts found');

    // Track code block extraction  
    const codeSpan = telemetry.startExtractionSpan(extractionTrace, 'code-blocks');
    const codeBlocks = await extractCodeBlocks(frame);
    telemetry.endSpan(codeSpan, { count: codeBlocks.length, languages: codeBlocks.map(b => b.language) });

    // Track answer extraction
    const answerSpan = telemetry.startAnswerSpan(extractionTrace);
    const fullText = await extractAnswer(frame);
    telemetry.endSpan(answerSpan, fullText.substring(0, 200));

    // Extract rich structured items (file links, tool calls, etc.)
    const structuredSpan = telemetry.startExtractionSpan(extractionTrace, 'structured-items');
    const structuredItems = await extractStructuredItems(frame);
    telemetry.endSpan(structuredSpan, { count: structuredItems.length });

    console.log(`📋 Extraction complete: ${fullText.length} chars, ${codeBlocks.length} code blocks, ${structuredItems.length} structured items, thoughts: ${thoughts ? 'yes' : 'no'}`);

    // End trace if we started it
    if (!trace) {
        telemetry.endTrace(extractionTrace, `Extracted ${codeBlocks.length} blocks, ${structuredItems.length} items`, true);
    }

    return {
        fullText,
        thoughts,
        codeBlocks,
        timestamp: new Date(),
        structuredItems
    };
}

/**
 * Extracts code blocks filtered by language.
 */
export async function extractCodeBlocksByLanguage(frame: Frame, language: string): Promise<CodeBlock[]> {
    const allBlocks = await extractCodeBlocks(frame);
    return allBlocks.filter(b => b.language.toLowerCase() === language.toLowerCase());
}

/**
 * Extracts all visible messages from the chat history.
 */
export async function extractAllMessages(frame: Frame): Promise<Array<{ role: 'user' | 'assistant', content: string }>> {
    const messages: Array<{ role: 'user' | 'assistant', content: string }> = [];

    // Find message containers
    const containers = frame.locator('[class*="flex-col"][class*="gap-"]');
    const count = await containers.count();

    for (let i = 0; i < count; i++) {
        const container = containers.nth(i);
        const classAttr = await container.getAttribute('class') || '';

        // Determine role based on class hints
        const isAssistant = classAttr.includes('bot') || classAttr.includes('assistant');
        const isUser = classAttr.includes('user');

        if (!isAssistant && !isUser) continue;

        const text = await container.innerText();
        if (text.trim()) {
            messages.push({
                role: isAssistant ? 'assistant' : 'user',
                content: text.trim()
            });
        }
    }

    return messages;
}

/**
 * Extracts structured items from the latest agent response.
 * Provides rich content similar to getStructuredHistory from session.ts.
 */
export async function extractStructuredItems(frame: Frame): Promise<Array<{ type: string; content: string; key: string }>> {
    return await frame.evaluate(() => {
        const items: Array<{ type: string; content: string; key: string }> = [];
        const chatContainer = document.querySelector('#cascade, #chat, [class*="chat"]');
        if (!chatContainer) return items;

        const allElements = chatContainer.querySelectorAll('*');

        allElements.forEach((el) => {
            // THOUGHT buttons
            if (el.tagName === 'BUTTON' && el.textContent?.includes('Thought for')) {
                const btnText = el.textContent.trim();
                const parent = el.parentElement;
                const expandedDiv = parent?.querySelector('div.pl-6, div[class*="overflow"]');
                const expandedText = expandedDiv?.textContent?.trim() || '';
                const content = expandedText ? `${btnText}\n${expandedText}` : btnText;
                const key = `thought:${content.substring(0, 80)}`;
                items.push({ type: 'thought', content, key });
            }

            // FILE ACTIVITY - "Edited foo.ts +10 -5", "Analyzed bar.ts"
            if (el.tagName === 'DIV' || el.tagName === 'SPAN') {
                const text = el.textContent?.trim() || '';
                const activityMatch = text.match(/^(Edited|Analyzed|Viewed|Reading|Read|Created|Deleted|Wrote)\s+(\S+\.[\w]+)(\s+\+\d+(\s+-\d+)?)?$/);
                if (activityMatch && text.length < 100) {
                    const key = `activity:${text.substring(0, 80)}`;
                    items.push({ type: 'file-activity', content: text, key });
                }
            }

            // FILE LINKS - clickable file paths with stats
            if ((el.tagName === 'SPAN' || el.tagName === 'A' || el.tagName === 'BDI') &&
                el.className?.includes && el.className.includes('cursor-pointer')) {
                const linkText = el.textContent?.trim() || '';
                if ((linkText.includes('/') || /\.[a-z]{2,4}$/i.test(linkText)) &&
                    linkText.length > 3 && linkText.length < 200) {

                    let actionVerb = '';
                    let statsText = '';
                    const parent = el.parentElement;

                    if (parent) {
                        // Look for verb in ancestor text
                        const actionWords = ['Edited', 'Analyzed', 'Viewed', 'Created', 'Deleted'];
                        let ancestor: Element | null = parent;
                        for (let i = 0; i < 5 && ancestor; i++) {
                            const ancestorText = ancestor.textContent || '';
                            if (ancestorText.includes('Files With Changes') || ancestorText.includes('With Changes')) {
                                actionVerb = 'Edited ';
                                break;
                            }
                            for (const verb of actionWords) {
                                if (ancestorText.startsWith(verb + ' ')) {
                                    actionVerb = verb + ' ';
                                    break;
                                }
                            }
                            if (actionVerb) break;
                            ancestor = ancestor.parentElement;
                        }

                        // Look for +/- stats
                        const greenSpan = parent.querySelector('.text-green-500, [class*="text-green"]');
                        const redSpan = parent.querySelector('.text-red-500, [class*="text-red"]');
                        if (greenSpan && redSpan) {
                            const addCount = greenSpan.textContent?.trim() || '';
                            const delCount = redSpan.textContent?.trim() || '';
                            if (addCount.startsWith('+') && delCount.startsWith('-')) {
                                statsText = ` ${addCount} ${delCount}`;
                            }
                        }
                    }

                    const fullContent = actionVerb + linkText + statsText;
                    const key = `filelink:${fullContent.substring(0, 80)}`;
                    items.push({ type: 'file-link', content: fullContent, key });
                }
            }

            // TOOL CALLS
            if (el.tagName === 'SPAN' && el.hasAttribute('title')) {
                const title = el.getAttribute('title') || '';
                if (title && title.length >= 5 && title.length <= 60 &&
                    /^[A-Z][a-zA-Z]/.test(title) &&
                    title.split(' ').length >= 2 && title.split(' ').length <= 8) {
                    const key = `tool:${title}`;
                    items.push({ type: 'tool-call', content: title, key });
                }
            }

            // CODE BLOCKS
            if (el.tagName === 'PRE' || (el.tagName === 'CODE' && !el.closest('pre'))) {
                const text = el.textContent?.trim() || '';
                const isCssArtifact = text.includes('background-color:') ||
                    text.includes('box-shadow:') || text.includes('::selection');
                if (text.length > 30 && !isCssArtifact) {
                    const key = `code:${text.substring(0, 80)}`;
                    items.push({ type: 'code', content: text, key });
                }
            }

            // ERRORS
            const elClass = el.className?.toString() || '';
            if (elClass.includes('text-red-') || elClass.includes('bg-red-')) {
                const errText = el.textContent?.trim() || '';
                if (errText.length > 5 && errText.length < 500) {
                    const key = `error:${errText.substring(0, 80)}`;
                    items.push({ type: 'error', content: errText, key });
                }
            }
        });

        // Deduplicate by key
        const seen = new Set<string>();
        return items.filter(item => {
            if (seen.has(item.key)) return false;
            seen.add(item.key);
            return true;
        });
    });
}
