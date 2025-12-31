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
 * Extracts in DOM order to maintain chronological sequence.
 */
export async function getStructuredHistory(frame: Frame): Promise<StructuredHistory> {
    console.log('📜 Fetching structured history...');

    // Use JavaScript evaluation to extract all elements in DOM order
    const rawItems = await frame.evaluate(() => {
        const items: Array<{ type: string; content: string; order: number }> = [];

        const chatContainer = document.querySelector('#cascade, #chat, [class*="chat"]');
        if (!chatContainer) return items;

        // Get all relevant elements and track their DOM position
        const allElements = chatContainer.querySelectorAll('*');
        let order = 0;

        allElements.forEach((el) => {
            // THOUGHT buttons
            if (el.tagName === 'BUTTON' && el.textContent?.includes('Thought for')) {
                const btnText = el.textContent.trim();
                // Try to get expanded content from next sibling
                const parent = el.parentElement;
                const expandedDiv = parent?.querySelector('div.pl-6, div[class*="overflow"]');
                const expandedText = expandedDiv?.textContent?.trim() || '';
                items.push({
                    type: 'thought',
                    content: expandedText ? `${btnText}\n${expandedText}` : btnText,
                    order: order++
                });
            }

            // TOOL CALLS - spans with title inside animate-fade-in
            if (el.tagName === 'SPAN' &&
                el.classList.contains('truncate') &&
                el.hasAttribute('title') &&
                el.closest('div.animate-fade-in')) {
                const title = el.getAttribute('title');
                if (title && !items.some(i => i.content === title)) {
                    items.push({ type: 'tool-call', content: title, order: order++ });
                }
            }

            // PROSE blocks (agent responses)
            if (el.classList.contains('prose')) {
                const text = el.textContent?.trim() || '';
                // Skip if too short or is inside a thought
                if (text.length > 20 && !el.closest('button') && !el.closest('div.pl-6')) {
                    // Avoid duplicates
                    const key = text.substring(0, 100);
                    if (!items.some(i => i.content.substring(0, 100) === key)) {
                        items.push({ type: 'agent', content: text, order: order++ });
                    }
                }
            }
        });

        return items;
    });

    // Sort by DOM order and remove the order field
    rawItems.sort((a, b) => a.order - b.order);
    const items: StructuredMessage[] = rawItems.map(({ type, content }) => ({
        type: type as StructuredMessage['type'],
        content
    }));

    console.log(`  Found ${items.length} items in chronological order.`);
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

