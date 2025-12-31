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
    metadata?: Record<string, any>;
}

export interface StructuredHistory {
    items: StructuredMessage[];
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

                // TOOL CALLS
                if (el.tagName === 'SPAN' &&
                    el.classList.contains('truncate') &&
                    el.hasAttribute('title') &&
                    el.closest('div.animate-fade-in')) {
                    const title = el.getAttribute('title');
                    if (title) {
                        const key = `tool:${title}`;
                        items.push({ type: 'tool-call', content: title, key });
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

    const items: StructuredMessage[] = allItems.map(({ type, content }) => ({
        type: type as StructuredMessage['type'],
        content
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

