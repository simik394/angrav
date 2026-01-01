import { Frame } from '@playwright/test';
import { getFalkorClient, Session as FalkorSession, getAngravTelemetry } from '@agents/shared';

// Get telemetry instance
const telemetry = getAngravTelemetry();

export interface ConversationMessage {
    role: 'user' | 'agent';
    content: string;
    thoughts?: string;
    timestamp?: Date;
}

export interface ConversationHistory {
    messages: ConversationMessage[];
    messageCount: number;
}

/**
 * Starts a new conversation by clicking the New Chat button.
 */
export async function startNewConversation(frame: Frame): Promise<void> {
    console.log('🔄 Starting new conversation...');

    // Start trace for new conversation
    const trace = telemetry.startTrace('session:new-conversation');

    // Selector from ANTIGRAVITY_FEATURES.md and specs
    const btn = frame.locator('[data-tooltip-id="new-conversation-tooltip"]');

    try {
        if (await btn.isVisible()) {
            await btn.click();
            // Wait for potential clearing animation or state change
            await frame.waitForTimeout(1000);
            console.log('✅ New conversation started.');

            telemetry.endTrace(trace, 'New conversation started', true);
        } else {
            throw new Error('New conversation button not found.');
        }
    } catch (error) {
        telemetry.trackError(trace, error as Error);
        telemetry.endTrace(trace, undefined, false);
        throw error;
    }
}

/**
 * Retrieves the full conversation history from the chat UI.
 */
export async function getConversationHistory(frame: Frame): Promise<ConversationHistory> {
    console.log('📜 Fetching conversation history...');

    const messages: ConversationMessage[] = [];

    // Each message row seems to be a div with specific class
    // Based on previous dumps: div.bg-ide-chat-background
    // Note: The UI structure might be complex (virtual list), so we might need more robust traversal logic
    // For now, using the selector identified in research

    const rows = frame.locator('div.bg-ide-chat-background');
    const count = await rows.count();

    console.log(`Found ${count} message rows.`);

    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);

        // We need to determine if it's user or agent
        // User messages usually have specific user icon or class, or are aligned differently
        // Agent messages usually have the "Thought" button or specific background

        // Heuristic: Check for "Thought" button -> Agent
        // Check for user input text locator -> User

        const isAgent = await row.locator('button:has-text("Thought")').count() > 0 ||
            await row.locator('.prose').count() > 0;

        if (isAgent) {
            // Extract Agent Content
            const thoughtsBtn = row.locator('button:has-text("Thought")');
            let thoughts = undefined;

            if (await thoughtsBtn.count() > 0) {
                // We might need to expand thoughts to read them if they are not in DOM
                // But for history reading, we might skip expansion if we just want content
                // Or we try to read hidden content if present
                // For now, let's just note it exists
            }

            const contentEl = row.locator('.prose').last(); // Agent answer usually last prose
            const content = await contentEl.innerText().catch(() => '');

            messages.push({ role: 'agent', content, thoughts });

        } else {
            // User Content
            // Selector from specs: span[data-lexical-text="true"]
            const userTextEl = row.locator('span[data-lexical-text="true"]').first();
            if (await userTextEl.count() > 0) {
                const content = await userTextEl.innerText();
                messages.push({ role: 'user', content });
            } else {
                // Fallback or system message?
                messages.push({ role: 'user', content: '[Unknown User Message Structure]' });
            }
        }
    }

    return {
        messages,
        messageCount: messages.length
    };
}

export type MessageType = 'user' | 'agent' | 'thought' | 'tool-call' | 'tool-output';

export interface StructuredMessage {
    type: MessageType;
    content: string;
    key?: string;
    metadata?: Record<string, any>;
}

export interface StructuredHistory {
    items: StructuredMessage[];
}

/**
 * Expands Progress Updates sections only.
 * Clicks "Expand all" buttons near "Progress Updates" headers.
 */
async function expandCollapsedSections(frame: Frame): Promise<number> {
    const expandedCount = await frame.evaluate(() => {
        let count = 0;
        let fileChangeCount = 0;
        const expandedSet = new Set<Element>();

        // Only click "Expand all" buttons (not "Collapse all")
        // These are specifically for Progress Updates sections
        const expandButtons = Array.from(document.querySelectorAll('span'))
            .filter(el => {
                const text = el.textContent?.trim() || '';
                return text === 'Expand all' || text.startsWith('Expand all');
            });

        for (const btn of expandButtons) {
            (btn as HTMLElement).click();
            count++;
        }

        // Also expand "Thought for ..." buttons
        const thoughtButtons = Array.from(document.querySelectorAll('button'))
            .filter(el => el.textContent?.includes('Thought for'));

        for (const btn of thoughtButtons) {
            // Check if it looks collapsed (check for sibling content)
            // This is a heuristic: if next text sibling isn't visible or parent doesn't show expanded content
            // For now, we'll assume they start collapsed or we can just click them.
            // Better heuristic: Check if the expanded content div is present nearby.
            const parent = btn.parentElement;
            const expandedContent = parent?.querySelector('div.pl-6, div[class*="overflow"]');

            // If we don't see the expanded content div, click it
            if (!expandedContent || window.getComputedStyle(expandedContent).display === 'none') {
                (btn as HTMLElement).click();
                count++;
            }
        }

        // Expand "Used tool" sections
        const toolButtons = Array.from(document.querySelectorAll('button'))
            .filter(el => {
                const text = el.textContent || '';
                return text.includes('Used tool') || text.includes('Tool Call');
            });

        for (const btn of toolButtons) {
            const parent = btn.parentElement;
            // Similar heuristic: look for the tool call details or code block
            const codeBlock = parent?.querySelector('pre, code');

            // If no code block visible, click it
            if (!codeBlock || window.getComputedStyle(codeBlock).display === 'none') {
                (btn as HTMLElement).click();
                count++;
            }
        }

        // Expand "hidden content" placeholders
        // Text: "The actual output content is hidden until clicked"
        const hiddenPlaceholders = Array.from(document.querySelectorAll('div, span, p'))
            .filter(el => {
                const text = el.textContent || '';
                return text.includes('content is hidden until clicked') && text.length < 200;
            });

        for (const el of hiddenPlaceholders) {
            const clickable = el.closest('button') || el.closest('[role="button"]') || el;
            // Don't click body
            if (clickable === document.body) continue;

            if (!expandedSet.has(clickable)) {
                (clickable as HTMLElement).click();
                expandedSet.add(clickable);
                count++;
            }
        }

        // Expand "Files With Changes" sections (Aggressive)
        const fileChangeHeaders = Array.from(document.querySelectorAll('*'))
            .filter(el => {
                const text = el.textContent || '';
                return text.includes('File') && (text.includes('Change') || text.includes('With Changes')) && text.length < 50;
            });

        if (fileChangeHeaders.length > 0) {
            console.log(`    🔍 Found ${fileChangeHeaders.length} potential 'Files With Changes' elements.`);
        }

        for (const el of fileChangeHeaders) {
            // Avoid clicking things we already clicked
            if (expandedSet.has(el)) continue;

            // Ensure it's not the "header" of the whole window, but a collapsible item
            // Usually contained in a border div or distinct block

            // Just click the clickable ancestor
            const clickable = el.closest('button') || el.closest('[role="button"]') || el;

            if (clickable && !expandedSet.has(clickable)) {
                const text = el.textContent?.trim().substring(0, 30);
                const hasChevron = !!clickable.querySelector('svg');
                const ariaExpanded = clickable.getAttribute('aria-expanded');

                // Don't collapse if already expanded (if we can tell)
                if (ariaExpanded === 'true') {
                    expandedSet.add(clickable);
                    continue;
                }

                console.log(`      🖱️ Clicking potential file toggle: "${text}..." (Chevron:${hasChevron})`);
                (clickable as HTMLElement).click();
                expandedSet.add(clickable);
                expandedSet.add(el); // Mark both to be safe
                fileChangeCount++;
                count++;
            }
        }

        // Expand individual file change rows (lines with +N -M stats)
        const fileRows = Array.from(document.querySelectorAll('div'))
            .filter(el => {
                // Must be a row, likely having flex and cursor-pointer
                const cls = el.className || '';
                if (!cls.includes || !cls.includes('flex') || !cls.includes('cursor-pointer')) return false;

                // Check if it has the stats (+10 -5)
                const green = el.querySelector('.text-green-500');
                const red = el.querySelector('.text-red-500');
                if (green && red && green.textContent?.trim().startsWith('+') && red.textContent?.trim().startsWith('-')) {
                    return true;
                }
                return false;
            });

        for (const row of fileRows) {
            if (expandedSet.has(row)) continue;

            // Blind click for now as we assume they start collapsed in the "Changes" view
            // and we can't easily detect checking specific aria attributes on these rows usually.
            // But we can check if there looks like a diff exposed nearby? 
            // Ideally we'd check if it's already open, but clicking them is the best bet.

            console.log(`      🖱️ Clicking file row: ${row.textContent?.substring(0, 40)}...`);
            (row as HTMLElement).click();
            fileChangeCount++;
            expandedSet.add(row);
            count++;
        }

        return count;
    });

    if (expandedCount > 0) {
        console.log(`  🔓 Expanded ${expandedCount} sections (Progress/Thoughts/Files)`);
        await frame.waitForTimeout(800); // Longer wait for expanded content to render
    }

    return expandedCount;
}

/**
 * Retrieves structured conversation history, attempting to distinguish tools and thoughts.
 * Uses progressive scroll to handle virtualized content in the chat UI.
 */
export async function getStructuredHistory(frame: Frame, limitPx?: number): Promise<StructuredHistory> {
    console.log('📜 Fetching structured history (with scroll extraction)...');


    const allItems: Array<{ type: string; content: string; key: string }> = [];
    const seenKeys = new Set<string>();

    // Helper to extract currently visible items
    const extractVisibleItems = async () => {
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

                // FILE ACTIVITY - "Edited foo.ts +10 -5", "Analyzed bar.ts", "Viewed baz.md"
                if (el.tagName === 'DIV' || el.tagName === 'SPAN') {
                    const text = el.textContent?.trim() || '';
                    const parent = el.parentElement;
                    const className = el.className?.toString() || '';

                    if (className.includes('text-green-500') || className.includes('text-red-500') ||
                        (text.includes('Files With Changes') && parent?.hasAttribute('data-tooltip-id'))) {

                        const key = `activity:${text.substring(0, 80)}`;
                        items.push({ type: 'file-activity', content: text, key });
                    }
                }

                // TOOL CALLS - look for spans with title attribute that contain tool names
                // Also try to capture associated code block with arguments
                if (el.tagName === 'SPAN' && el.hasAttribute('title')) {
                    const title = el.getAttribute('title') || '';
                    // Skip very short titles, or titles that look like prose/content
                    // Tool names are typically 2-5 words like "Retrieved Browser Pages"
                    if (title &&
                        title.length >= 5 &&
                        title.length <= 60 &&
                        /^[A-Z][a-zA-Z]/.test(title) &&  // Starts with capital
                        title.split(' ').length >= 2 &&
                        title.split(' ').length <= 8) {

                        // Try to find associated code block (tool arguments)
                        // Walk up to find a container, then look for code-block inside
                        let codeContent = '';
                        let container = el.parentElement?.parentElement?.parentElement?.parentElement;
                        if (container) {
                            const codeBlock = container.querySelector('.code-block');
                            if (codeBlock) {
                                codeContent = codeBlock.textContent?.trim() || '';
                                // No truncation - capture full code block for accurate token count
                            }
                        }

                        const fullContent = codeContent
                            ? `${title}\n\`\`\`\n${codeContent}\n\`\`\``
                            : title;
                        const key = `tool:${title}`;
                        items.push({ type: 'tool-call', content: fullContent, key });
                    }
                }

                // USER MESSAGES - look for .whitespace-pre-wrap with word-break style
                // These are inside bg-gray-500/15 containers
                if (el.classList.contains('whitespace-pre-wrap')) {
                    const style = el.getAttribute('style') || '';
                    // User input has word-break: break-word style
                    if (style.includes('word-break')) {
                        const text = el.textContent?.trim() || '';
                        // User messages are actual sentences/questions
                        // Skip very short or CSS-looking content
                        if (text.length > 10 &&
                            !text.includes('{') &&  // Skip CSS
                            !text.includes('class=') &&  // Skip HTML
                            !text.startsWith('.') && // Skip selectors
                            text.split(' ').length >= 2) {
                            const key = `user:${text.substring(0, 80)}`;
                            items.push({ type: 'user', content: text, key });
                        }
                    }
                }

                // PROSE blocks
                if (el.classList.contains('prose')) {
                    const text = el.textContent?.trim() || '';
                    if (text.length > 20 && !el.closest('button') && !el.closest('div.pl-6')) {
                        const key = `prose:${text.substring(0, 80)}`;
                        items.push({ type: 'agent', content: text, key });
                    }
                }

                // CODE BLOCKS - pre and code elements (but filter out CSS artifacts)
                if (el.tagName === 'PRE' || (el.tagName === 'CODE' && !el.closest('pre'))) {
                    const text = el.textContent?.trim() || '';
                    // Skip very small code snippets (likely inline code)
                    // Also skip CSS artifacts that leak from UI
                    const isCssArtifact = text.includes('background-color:') ||
                        text.includes('box-shadow:') ||
                        text.includes('::selection') ||
                        text.includes('.code-block') ||
                        text.includes('.code-line') ||
                        text.includes('rgba(128 128 128') ||
                        text.startsWith('.') && text.includes('{');

                    if (text.length > 30 && !isCssArtifact) {
                        const key = `code:${text.substring(0, 80)}`;
                        items.push({ type: 'code', content: text, key });
                    }
                }

                // FILE CHANGE SUMMARIES - elements showing file modifications
                // Headers have data-tooltip-id="toolbar-title-tooltip" with "Files With Changes" text
                // Rows have text-green-500/text-red-500 spans for +/- counts
                if (el.hasAttribute('data-tooltip-id') &&
                    el.textContent?.includes('Files With Changes')) {
                    const text = el.textContent?.trim() || '';
                    const key = `filechange-header:${text}`;
                    items.push({ type: 'file-change', content: text, key });
                }

                // File change rows - look for spans with green/red text classes
                // Using className.includes for better Tailwind class matching
                const className = el.className?.toString() || '';
                if (className.includes('text-green-500') || className.includes('text-red-500')) {
                    const parent = el.parentElement;
                    if (parent) {
                        const rowText = parent.textContent?.trim() || '';
                        // Pattern: + 12 - 0 filename.ts (or similar)
                        if (/\+\s*\d+/.test(rowText) && /-\s*\d+/.test(rowText) &&
                            rowText.includes('.') && rowText.length < 150) {
                            const key = `filechange-row:${rowText.substring(0, 80)}`;
                            items.push({ type: 'file-change', content: rowText, key });
                        }
                    }
                }

                // TERMINAL COMMANDS - lines with $ prompt followed by command
                // Format: ~/path $ command
                const text = el.textContent?.trim() || '';
                if (el.tagName === 'DIV' &&
                    /^~\/[^\s]*\s+\$\s+\S+/.test(text) &&
                    text.length < 500 &&
                    !text.includes('[TOOL CALL]') &&
                    !text.includes('Background Steps') &&
                    !text.includes('Running') &&
                    !text.includes('Relocate') &&
                    text.length > 15) {

                    // Try to find the associated output (usually next pre element)
                    let outputText = '';
                    const nextSibling = el.nextElementSibling;
                    if (nextSibling?.tagName === 'PRE') {
                        outputText = nextSibling.textContent?.trim() || '';
                        // No truncation - capture full terminal output for accurate token count
                    }

                    const fullContent = outputText
                        ? `${text}\n\`\`\`\n${outputText}\n\`\`\``
                        : text;
                    const key = `terminal:${text.substring(0, 80)}`;
                    items.push({ type: 'terminal', content: fullContent, key });
                }

                // TOOL RESULT BUTTONS - "Show JavaScript Result" etc.
                if (el.tagName === 'BUTTON' &&
                    el.textContent?.includes('JavaScript Result')) {
                    const btnText = el.textContent?.trim() || '';
                    const key = `result:${btnText.substring(0, 80)}`;
                    items.push({ type: 'tool-result', content: btnText, key });
                }

                // TASK STATUS - Planning/Executing/Verifying phase indicators
                if ((el.tagName === 'BUTTON' || el.tagName === 'DIV') &&
                    el.textContent) {
                    const statusText = el.textContent.trim();
                    const phases = ['Planning', 'Executing', 'Verifying', 'PLANNING', 'EXECUTION', 'VERIFICATION'];
                    const startsWithPhase = phases.some(p => statusText.startsWith(p));
                    if (startsWithPhase &&
                        statusText.length < 50 &&
                        !statusText.includes('=>') &&
                        !statusText.includes('includes')) {
                        const key = `status:${statusText.substring(0, 80)}`;
                        items.push({ type: 'task-status', content: statusText, key });
                    }
                }

                // FILE LINKS - clickable file paths WITH action verb AND +/- stats
                // Format: "Edited session.ts +38 -3" or "Analyzed core.ts"
                if ((el.tagName === 'SPAN' || el.tagName === 'A' || el.tagName === 'BDI') &&
                    el.className?.includes && el.className.includes('cursor-pointer')) {
                    const linkText = el.textContent?.trim() || '';
                    // Must look like a file path
                    if ((linkText.includes('/') || /\.[a-z]{2,4}$/i.test(linkText)) &&
                        linkText.length > 3 && linkText.length < 200) {

                        // Try to find action verb (Edited, Analyzed, etc.) from context
                        let actionVerb = '';
                        const parent = el.parentElement;
                        const actionWords = ['Edited', 'Analyzed', 'Viewed', 'Created', 'Deleted', 'Reading', 'Read', 'Writing', 'Wrote'];

                        if (parent) {
                            // Method 1: Check previous sibling's text
                            const prevSibling = el.previousElementSibling;
                            if (prevSibling && !actionVerb) {
                                const prevText = prevSibling.textContent?.trim() || '';
                                for (const verb of actionWords) {
                                    if (prevText === verb || prevText.endsWith(verb)) {
                                        actionVerb = verb + ' ';
                                        break;
                                    }
                                }
                            }

                            // Method 2: Check parent's full text - extract verb at start
                            if (!actionVerb) {
                                const parentText = parent.textContent?.trim() || '';
                                for (const verb of actionWords) {
                                    if (parentText.startsWith(verb + ' ') && parentText.includes(linkText)) {
                                        actionVerb = verb + ' ';
                                        break;
                                    }
                                }
                            }

                            // Method 3: Check grandparent's text (different UI layouts)
                            if (!actionVerb) {
                                const grandparent = parent.parentElement;
                                if (grandparent) {
                                    const gpText = grandparent.textContent?.trim() || '';
                                    for (const verb of actionWords) {
                                        if (gpText.startsWith(verb + ' ') && gpText.includes(linkText)) {
                                            actionVerb = verb + ' ';
                                            break;
                                        }
                                    }
                                }
                            }

                            // Method 4: Look at previous sibling at parent level
                            if (!actionVerb) {
                                const parentPrevSibling = parent.previousElementSibling;
                                if (parentPrevSibling) {
                                    const prevText = parentPrevSibling.textContent?.trim() || '';
                                    for (const verb of actionWords) {
                                        if (prevText === verb) {
                                            actionVerb = verb + ' ';
                                            break;
                                        }
                                    }
                                }
                            }

                            // Method 5: Traverse ancestors looking for group header (e.g. "Files With Changes", "2 Edited Files")
                            if (!actionVerb) {
                                let ancestor: Element | null = parent;
                                for (let i = 0; i < 10 && ancestor; i++) {
                                    const ancestorText = ancestor.textContent || '';
                                    // Check for group header patterns
                                    if (ancestorText.includes('Files With Changes') || ancestorText.includes('With Changes')) {
                                        actionVerb = 'Edited ';
                                        break;
                                    }
                                    if (ancestorText.includes('Edited Files') || ancestorText.includes('edited files')) {
                                        actionVerb = 'Edited ';
                                        break;
                                    }
                                    if (ancestorText.includes('Analyzed Files') || ancestorText.includes('analyzed files')) {
                                        actionVerb = 'Analyzed ';
                                        break;
                                    }
                                    if (ancestorText.includes('Viewed Files') || ancestorText.includes('viewed files')) {
                                        actionVerb = 'Viewed ';
                                        break;
                                    }
                                    ancestor = ancestor.parentElement;
                                }
                            }
                        }

                        // Try to find +N -M stats in parent/sibling elements
                        let statsText = '';
                        if (parent) {
                            const greenSpan = parent.querySelector('.text-green-500, [class*="text-green"]');
                            const redSpan = parent.querySelector('.text-red-500, [class*="text-red"]');

                            if (greenSpan && redSpan) {
                                const addCount = greenSpan.textContent?.trim() || '';
                                const delCount = redSpan.textContent?.trim() || '';
                                if (addCount.startsWith('+') && delCount.startsWith('-')) {
                                    statsText = ` ${addCount} ${delCount}`;
                                }
                            }

                            // Also try grandparent (different UI layouts)
                            if (!statsText) {
                                const grandparent = parent.parentElement;
                                if (grandparent) {
                                    const greenSpan2 = grandparent.querySelector('.text-green-500, [class*="text-green"]');
                                    const redSpan2 = grandparent.querySelector('.text-red-500, [class*="text-red"]');

                                    if (greenSpan2 && redSpan2) {
                                        const addCount = greenSpan2.textContent?.trim() || '';
                                        const delCount = redSpan2.textContent?.trim() || '';
                                        if (addCount.startsWith('+') && delCount.startsWith('-')) {
                                            statsText = ` ${addCount} ${delCount}`;
                                        }
                                    }
                                }
                            }
                        }

                        const fullContent = actionVerb + linkText + statsText;
                        const key = `filelink:${fullContent.substring(0, 80)}`;
                        items.push({ type: 'file-link', content: fullContent, key });
                    }
                }

                // APPROVAL BUTTONS - Accept/Reject user decision points
                if (el.tagName === 'BUTTON') {
                    const btnText = el.textContent?.trim() || '';
                    if (['Accept', 'Reject', 'Accept all', 'Reject all', 'Run', 'Cancel'].some(w => btnText.includes(w)) &&
                        btnText.length < 50) {
                        const key = `approval:${btnText}`;
                        items.push({ type: 'approval', content: btnText, key });
                    }
                }

                // ERROR MESSAGES - elements with red text/background classes
                const elClass = el.className?.toString() || '';
                if (elClass.includes('text-red-') || elClass.includes('bg-red-') || elClass.includes('border-red-')) {
                    const errText = el.textContent?.trim() || '';
                    if (errText.length > 5 && errText.length < 500) {
                        const key = `error:${errText.substring(0, 80)}`;
                        items.push({ type: 'error', content: errText, key });
                    }
                }

                // IMAGES - non-icon images (likely attachments/screenshots)
                if (el.tagName === 'IMG') {
                    const img = el as HTMLImageElement;
                    if (img.width > 50 && img.height > 50 && !img.src.includes('profile')) {
                        const content = `[Image: ${img.src.split('/').pop() || 'image'}] (${img.width}x${img.height})`;
                        const key = `image:${img.src.substring(0, 80)}`;
                        items.push({ type: 'image', content, key });
                    }
                }

                // TABLES - markdown/HTML tables
                if (el.tagName === 'TABLE') {
                    const tableText = el.textContent?.trim() || '';
                    if (tableText.length > 10) {
                        const key = `table:${tableText.substring(0, 80)}`;
                        items.push({ type: 'table', content: tableText, key });
                    }
                }

                // GENERIC DIFF/CODE CAPTURE - for things that don't match strict code blocks
                // but look like diffs (font-mono, whitespace-pre, containing diff chars)
                const style = el.getAttribute('style') || '';
                const isMonospace = el.classList.contains('font-mono') ||
                    el.classList.contains('whitespace-pre') ||
                    style.includes('font-family: monospace') ||
                    style.includes('font-family: Consolas');

                if ((el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'PRE') &&
                    isMonospace &&
                    el.textContent && el.textContent.length > 20) {

                    const text = el.textContent;
                    // Check for diff signatures - Relaxed
                    const isDiff = text.includes('Index: ') ||
                        text.includes('@@') ||
                        text.includes('diff --git') ||
                        (text.includes('\n+') && text.includes('\n-')) ||
                        // Check for valid diff lines: +..., -..., or context lines (space)
                        (text.split('\n').slice(0, 10).filter(l => l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')).length > 3);

                    if (isDiff) {
                        const key = `diff:${text.substring(0, 80)}`;
                        items.push({ type: 'code', content: text, key });
                    }
                }

                // EXPANDED DIFF PANELS - content that appears after clicking file rows
                // Look for code-block containers with line numbers and colored diff content
                if (el.classList.contains('code-block') ||
                    (el.tagName === 'DIV' && el.querySelector('.code-line'))) {

                    // Get all code lines within this block
                    const codeLines = el.querySelectorAll('.code-line, .line-content, [class*="line"]');
                    if (codeLines.length > 5) {
                        // Build the diff content from individual lines
                        let diffContent = '';
                        let hasAdditions = false;
                        let hasDeletions = false;

                        codeLines.forEach((line: Element) => {
                            const lineText = line.textContent || '';
                            const lineClass = line.className?.toString() || '';
                            const parentClass = line.parentElement?.className?.toString() || '';

                            // Check for addition/deletion markers via class or color
                            if (lineClass.includes('green') || parentClass.includes('green') ||
                                lineClass.includes('addition') || lineClass.includes('inserted')) {
                                diffContent += '+' + lineText + '\n';
                                hasAdditions = true;
                            } else if (lineClass.includes('red') || parentClass.includes('red') ||
                                lineClass.includes('deletion') || lineClass.includes('removed')) {
                                diffContent += '-' + lineText + '\n';
                                hasDeletions = true;
                            } else {
                                diffContent += ' ' + lineText + '\n';
                            }
                        });

                        // Only capture if it looks like a real diff
                        if ((hasAdditions || hasDeletions) && diffContent.length > 50) {
                            const key = `expanded-diff:${diffContent.substring(0, 80)}`;
                            items.push({ type: 'file-diff', content: diffContent.trim(), key });
                        }
                    }
                }

                // INLINE DIFF VIEWER - Monaco-style diff with side-by-side or inline changes
                if (el.classList.contains('monaco-editor') ||
                    el.classList.contains('diff-editor') ||
                    el.querySelector('.view-lines')) {

                    const viewLines = el.querySelectorAll('.view-line');
                    if (viewLines.length > 3) {
                        let diffText = '';
                        let foundChanges = false;

                        viewLines.forEach((line: Element) => {
                            const lineContent = line.textContent || '';
                            const lineEl = line as HTMLElement;
                            const bgColor = window.getComputedStyle(lineEl).backgroundColor;

                            // Green-ish background = addition, red-ish = deletion
                            if (bgColor.includes('rgba(0') && bgColor.includes(', 128') ||
                                bgColor.includes('rgba(35') || bgColor.includes('#') && bgColor.includes('2')) {
                                diffText += '+' + lineContent + '\n';
                                foundChanges = true;
                            } else if (bgColor.includes('rgba(128') || bgColor.includes('rgba(255')) {
                                diffText += '-' + lineContent + '\n';
                                foundChanges = true;
                            } else if (lineContent.trim()) {
                                diffText += ' ' + lineContent + '\n';
                            }
                        });

                        if (foundChanges && diffText.length > 30) {
                            const key = `monaco-diff:${diffText.substring(0, 80)}`;
                            items.push({ type: 'file-diff', content: diffText.trim(), key });
                        }
                    }
                }

                // FILE ACTIVITY - "Edited foo.ts +10 -5", "Analyzed bar.ts", "Viewed baz.md"
                if (el.tagName === 'DIV' || el.tagName === 'SPAN') {
                    const text = el.textContent?.trim() || '';

                    // Specific regex for file actions
                    // Matches: "Edited session.ts +10 -5" or "Analyzed session.ts#L1-10"
                    const actionRegex = /^(Edited|Analyzed|Viewed|Created|Deleted|Reading|Read)\s+([a-zA-Z0-9_\-\.\/]+)(\.(ts|js|md|py|json|html|css|sh|yaml|yml))(#L?\d+[-:]\d+)?(\s+\+\d+(\s+-\d+)?)?$/;

                    // Also accept slightly looser if it has the verb and a filename extension
                    // But filter out long sentences ("I Analyzed the file...")
                    const isFileAction =
                        (actionRegex.test(text) ||
                            (/^(Edited|Analyzed|Viewed|Created|Deleted)\s/.test(text) && /\.[a-z]{2,5}/.test(text))) &&
                        text.length < 80 &&
                        !text.includes(' I ') && // Not a sentence
                        !text.endsWith('.'); // Not a sentence

                    if (isFileAction) {
                        const key = `file-activity:${text}`;
                        items.push({ type: 'file-activity', content: text, key });
                    }
                }
            });

            return items;
        });
    };

    // Get scroll info - find the actual scrollable chat container
    const scrollInfo = await frame.evaluate(() => {
        // Find all potential scrollable containers
        const candidates = document.querySelectorAll('.overflow-y-auto');

        // Find the one that has actual scrollable content (scrollHeight > clientHeight)
        for (const el of candidates) {
            const elem = el as HTMLElement;
            if (elem.scrollHeight > elem.clientHeight + 100) {
                return {
                    height: elem.scrollHeight,
                    client: elem.clientHeight,
                    found: true
                };
            }
        }

        return { height: 0, client: 0, found: false };
    });

    if (!scrollInfo.found) {
        console.log('  ⚠️ No scrollable container found');
        const items = await extractVisibleItems();
        return { items: items.map(({ type, content }) => ({ type: type as any, content })) };
    }

    console.log(`  📏 Scroll height: ${scrollInfo.height}px, viewport: ${scrollInfo.client}px`);

    // === STRATEGY: Load History (Top) -> Scan Down (Bottom) to ensure correct order and capture ===

    let lastHeight = scrollInfo.height;

    // 1. Force Load History (Scroll to TOP) - ONLY if no limit (or user wants full history)
    if (!limitPx) {
        console.log('  ⏳ Loading full history (scrolling to top)...');
        let stableCount = 0;

        // Try to load history by hitting top repeatedly
        for (let i = 0; i < 30; i++) {
            await frame.evaluate(() => {
                const el = document.querySelector('.overflow-y-auto') as HTMLElement;
                if (el) el.scrollTop = 0;
            });

            await frame.waitForTimeout(1000); // Wait for history loading

            const newHeight = await frame.evaluate(() => document.querySelector('.overflow-y-auto')?.scrollHeight || 0);

            if (newHeight > lastHeight + 100) {
                console.log(`    Height grew: ${lastHeight} -> ${newHeight}px`);
                lastHeight = newHeight;
                stableCount = 0;
            } else {
                stableCount++;
            }

            if (stableCount >= 3) break; // Height stable
        }
    } else {
        console.log(`  ⏩ Skipping full history load (Limit: ${limitPx}px)`);
        // We might need to ensure we are at the bottom first to get the true height?
        // Usually scrollInfo.height is accurate if we are already at bottom (default state).
    }

    // 2. Scan from Start to Bottom
    // If limitPx is set, start near the bottom. Otherwise start at 0.
    const startPos = limitPx ? Math.max(0, lastHeight - limitPx) : 0;

    console.log(`  📉 Scanning content (Top -> Bottom), height: ${lastHeight}px, starting at ${startPos}px`);

    const scrollStep = 400; // Safe overlap for ~900px viewport
    const startIndex = Math.floor(startPos / scrollStep);
    const maxScrolls = Math.ceil(lastHeight / scrollStep) + 20;

    for (let i = startIndex; i < maxScrolls; i++) {
        const targetPos = i * scrollStep;

        if (targetPos > lastHeight + 2000) { // Allow some overscroll
            console.log(`  ✅ Reached bottom.`);
            break;
        }

        // Scroll
        const currentPos = await frame.evaluate((target: number) => {
            const el = document.querySelector('.overflow-y-auto') as HTMLElement;
            if (el) {
                el.scrollTop = target;
                return el.scrollTop;
            }
            return 0;
        }, targetPos);

        await frame.waitForTimeout(400); // Wait for render

        // Expand visible sections (Thoughts, Progress, Files)
        await expandCollapsedSections(frame);
        // Note: expandCollapsedSections has internal wait if it performs actions

        // Extract content immediately while expanded
        const visibleItems = await extractVisibleItems();
        let newCount = 0;
        for (const item of visibleItems) {
            if (!seenKeys.has(item.key)) {
                seenKeys.add(item.key);
                allItems.push(item);
                newCount++;
            }
        }

        if (newCount > 0 || i % 10 === 0) {
            console.log(`    Step ${i}: pos=${targetPos}px (actual ${currentPos}px), +${newCount} items (total ${allItems.length})`);
        }

        // Check if we reached bottom (actual position didn't move past target significantly)
        // Or if target is way past height
        if (targetPos > lastHeight + 1000) break;
        if (i > 5 && currentPos < targetPos - 50) {
            // We tried to scroll to X but stayed at Y < X
            // Likely bottom reached
            console.log(`    Reached bottom at ${currentPos}px`);
            break;
        }
    }


    const items: StructuredMessage[] = allItems.map(({ type, content, key }) => ({
        type: type as StructuredMessage['type'],
        content,
        key
    }));

    console.log(`  ✅ Total items extracted: ${items.length}`);
    return { items };
}

export interface SessionInfo {
    name: string;
    index: number;
    id?: string; // Stable ID if available
}

/**
 * Lists all available sessions from the Agent Manager window.
 * Sessions appear as buttons with conversation titles.
 * Syncs with FalkorDB to provide stable UUIDs.
 */
export async function listSessions(managerFrame: Frame, workspace: string = 'workspace'): Promise<SessionInfo[]> {
    console.log('📋 Listing sessions (Manager Window)...');

    // Sync with FalkorDB for stable IDs
    const falkor = getFalkorClient();
    const dbSessions = await falkor.listSessions(workspace);

    const result: SessionInfo[] = [];
    const processedNames = new Set<string>();

    // Strategy: The Manager Window lists sessions as plain text or buttons.
    // Based on dump: "01-pwf", "Refining Session History Output", etc.
    // They seem to be clickable elements.

    // Let's find all elements that look like session items.
    // We'll target text that matches known session patterns or just list all clickable text

    // Heuristic: Get all elements with text content that might be a session
    // And exclude UI noise.

    const candidates = managerFrame.locator('div, span, a, button');
    const count = await candidates.count();

    // Optimization: Don't iterate 1000s of elements. 
    // The previous dump showed them in a column.
    // Let's look for the container first? No clear container found.
    // Let's try locating by text content length and structure.

    const validSessions = [];
    const lines = (await managerFrame.locator('body').innerText()).split('\n');

    let isCapture = false;
    for (const line of lines) {
        const trimmed = line.trim();
        // Start capturing after "Workspaces" or specific markers if possible
        // But simply filtering by length and exclusion list might be enough for now.

        const skip = ['Antigravity', 'File', 'Edit', 'View', 'Agent Manager', 'Open Editor',
            'Inbox', 'Start conversation', 'Workspaces', 'Playground', 'Model',
            'Gemini 3 Pro (High)', '01-pwf', '05-Prago', '04-škola'];
        // Note: 01-pwf is workspace name, might appear as header. 
        // Detailed session names follow.

        if (trimmed.length > 5 && !skip.includes(trimmed)) {
            if (!processedNames.has(trimmed)) {
                processedNames.add(trimmed);
                validSessions.push(trimmed);
            }
        }
    }

    for (const name of validSessions) {
        // Try to find existing session in DB by name
        let dbSession = dbSessions.find(s => s.name === name);

        if (dbSession) {
            result.push({ name, index: result.length, id: dbSession.id });
            if (dbSession.name !== name) {
                await falkor.updateSessionName(dbSession.id, name);
            }
        } else {
            const id = await falkor.createSession(name, workspace);
            result.push({ name, index: result.length, id });
        }
    }

    console.log(`Found ${result.length} sessions:`);
    result.forEach(s => console.log(`  - "${s.name}" (ID: ${s.id || 'none'})`));

    return result;
}

/**
 * Helper: Extract sessions from UI without FalkorDB sync.
 * (Deprecated/Unused in this new logic but kept for interface compatibility if needed internally)
 */
async function getSessionsFromUI(managerFrame: Frame): Promise<SessionInfo[]> {
    return [];
}

/**
 * Switches to a session by ID (exact match) or name (partial match).
 */
export async function switchSession(managerFrame: Frame, sessionIdOrName: string): Promise<boolean> {
    console.log(`🔄 Switching to session: ${sessionIdOrName}...`);

    const sessions = await listSessions(managerFrame);

    // Priority 1: Match by ID (exact)
    let match = sessions.find(s => s.id === sessionIdOrName);

    // Priority 2: Match by name (partial)
    if (!match) {
        match = sessions.find(s => s.name.toLowerCase().includes(sessionIdOrName.toLowerCase()));
    }

    if (!match) {
        console.error(`Session "${sessionIdOrName}" not found (checked ${sessions.length} sessions).`);
        return false;
    }

    // Click the session button
    // Try by Title first
    const btnByTitle = managerFrame.locator(`button[title="${match.name}"]`);
    if (await btnByTitle.count() > 0 && await btnByTitle.first().isVisible()) {
        await btnByTitle.first().click({ force: true });
    } else {
        // Fallback to text match
        const btnByText = managerFrame.locator(`text="${match.name}"`);
        if (await btnByText.count() > 0) {
            await btnByText.first().click({ force: true });
        } else {
            console.warn(`  ⚠️ Could not click session "${match.name}" - Locators failed.`);
            return false;
        }
    }

    await managerFrame.waitForTimeout(500);

    console.log(`✅ Switched to: "${match.name}" (ID: ${match.id || 'none'})`);
    return true;
}

