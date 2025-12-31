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

        return count;
    });

    if (expandedCount > 0) {
        console.log(`  🔓 Expanded ${expandedCount} Progress Updates`);
        await frame.waitForTimeout(800); // Longer wait for expanded content to render
    }

    return expandedCount;
}

/**
 * Retrieves structured conversation history, attempting to distinguish tools and thoughts.
 * Uses progressive scroll to handle virtualized content in the chat UI.
 */
export async function getStructuredHistory(frame: Frame): Promise<StructuredHistory> {
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

                // TOOL CALLS - look for spans with title attribute that contain tool names
                // Also try to capture associated code block with arguments
                if (el.tagName === 'SPAN' && el.hasAttribute('title')) {
                    const title = el.getAttribute('title');
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

                // CODE BLOCKS - pre and code elements
                if (el.tagName === 'PRE' || (el.tagName === 'CODE' && !el.closest('pre'))) {
                    const text = el.textContent?.trim() || '';
                    // Skip very small code snippets (likely inline code)
                    if (text.length > 30) {
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

                // FILE LINKS - clickable file paths
                if ((el.tagName === 'SPAN' || el.tagName === 'A' || el.tagName === 'BDI') &&
                    el.className?.includes && el.className.includes('cursor-pointer')) {
                    const linkText = el.textContent?.trim() || '';
                    // Must look like a file path
                    if ((linkText.includes('/') || /\.[a-z]{2,4}$/i.test(linkText)) &&
                        linkText.length > 3 && linkText.length < 200) {
                        const key = `filelink:${linkText.substring(0, 80)}`;
                        items.push({ type: 'file-link', content: linkText, key });
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

    // REVERSE SCROLL APPROACH: Start at bottom and scroll upward
    // This works better with virtualized UIs that snap forward

    // First, ensure we're at the bottom
    await frame.evaluate(() => {
        const candidates = document.querySelectorAll('.overflow-y-auto');
        for (const el of candidates) {
            const elem = el as HTMLElement;
            if (elem.scrollHeight > elem.clientHeight + 100) {
                elem.scrollTop = elem.scrollHeight; // Go to bottom
                break;
            }
        }
    });
    await frame.waitForTimeout(800);

    // Expand collapsed sections before extracting
    await expandCollapsedSections(frame);

    // Extract from bottom first
    const bottomItems = await extractVisibleItems();
    for (const item of bottomItems) {
        if (!seenKeys.has(item.key)) {
            seenKeys.add(item.key);
            allItems.push(item);
        }
    }
    console.log(`  📥 Initial extraction at bottom: ${allItems.length} items`);

    // Scroll upward in increments
    const scrollStep = 500;
    const maxScrolls = Math.ceil(scrollInfo.height / scrollStep) + 10;

    console.log(`  🔄 Scrolling UP from bottom, ~${maxScrolls} iterations`);

    let lastScrollTop = scrollInfo.height;
    let samePositionCount = 0;

    for (let i = 0; i < maxScrolls; i++) {
        // Scroll UP by setting explicit position
        const targetPos = Math.max(0, scrollInfo.height - (i + 1) * scrollStep);

        const scrollResult = await frame.evaluate((target: number) => {
            const candidates = document.querySelectorAll('.overflow-y-auto');
            for (const el of candidates) {
                const elem = el as HTMLElement;
                if (elem.scrollHeight > elem.clientHeight + 100) {
                    elem.scrollTop = target;
                    elem.dispatchEvent(new Event('scroll', { bubbles: true }));
                    return {
                        current: elem.scrollTop,
                        target: target,
                        reachedTop: elem.scrollTop <= 10
                    };
                }
            }
            return { current: 0, target: 0, reachedTop: true };
        }, targetPos) as { current: number; target: number; reachedTop: boolean };

        // Wait for content to render
        await frame.waitForTimeout(600);

        // Expand any collapsed sections before extraction
        await expandCollapsedSections(frame);

        // Extract visible items
        const visibleItems = await extractVisibleItems();
        let newCount = 0;
        for (const item of visibleItems) {
            if (!seenKeys.has(item.key)) {
                seenKeys.add(item.key);
                allItems.push(item);
                newCount++;
            }
        }

        if (i % 10 === 0 || i < 5 || newCount > 0) {
            console.log(`    #${i + 1}: target=${targetPos}px, actual=${scrollResult.current}px, +${newCount} items, total=${allItems.length}`);
        }

        // Check if stuck
        if (scrollResult.current === lastScrollTop && i > 0) {
            samePositionCount++;
            if (samePositionCount >= 3) {
                console.log(`  ⚠️ Scroll stuck at ${scrollResult.current}px`);
                break;
            }
        } else {
            samePositionCount = 0;
            lastScrollTop = scrollResult.current;
        }

        // Check if reached top
        if (scrollResult.reachedTop) {
            console.log(`  ✅ Reached top at iteration ${i + 1}`);
            break;
        }
    }

    // Final extraction at top
    await frame.waitForTimeout(500);
    const topItems = await extractVisibleItems();
    let topNewCount = 0;
    for (const item of topItems) {
        if (!seenKeys.has(item.key)) {
            seenKeys.add(item.key);
            allItems.push(item);
            topNewCount++;
        }
    }
    if (topNewCount > 0) {
        console.log(`  📥 Final extraction at top: +${topNewCount} items`);
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

