import { Frame } from '@playwright/test';
import { getFalkorClient, Session as FalkorSession } from '@agents/shared';

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

    // Selector from ANTIGRAVITY_FEATURES.md and specs
    const btn = frame.locator('[data-tooltip-id="new-conversation-tooltip"]');

    if (await btn.isVisible()) {
        await btn.click();
        // Wait for potential clearing animation or state change
        await frame.waitForTimeout(1000);
        console.log('✅ New conversation started.');
    } else {
        throw new Error('New conversation button not found.');
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
    console.log('📋 Listing sessions...');

    // Get sessions from UI
    const uiSessions = await getSessionsFromUI(managerFrame);

    // Sync with FalkorDB for stable IDs
    const falkor = getFalkorClient();
    const dbSessions = await falkor.listSessions(workspace);

    // Merge: UI is source of truth for available sessions, DB for IDs
    const result: SessionInfo[] = [];

    for (const ui of uiSessions) {
        // Try to find existing session in DB by name
        let dbSession = dbSessions.find(s => s.name === ui.name);

        if (dbSession) {
            // Session exists in DB - use its stable ID
            result.push({ ...ui, id: dbSession.id });
            // Update name if it changed
            if (dbSession.name !== ui.name) {
                await falkor.updateSessionName(dbSession.id, ui.name);
            }
        } else {
            // New session - create in DB with stable UUID
            const id = await falkor.createSession(ui.name, workspace);
            result.push({ ...ui, id });
        }
    }

    console.log(`Found ${result.length} sessions:`);
    result.forEach(s => console.log(`  - "${s.name}" (ID: ${s.id || 'none'})`));

    return result;
}

/**
 * Helper: Extract sessions from UI without FalkorDB sync.
 * Based on DOM analysis: Sessions are in sidebar under "Workspaces > workspace"
 * Structure: div[style*="padding-left: 30px"] > div > button > span.text-sm.grow.truncate
 */
async function getSessionsFromUI(managerFrame: Frame): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];

    // Debug: log frame URL to verify we're on the right page
    const frameUrl = await managerFrame.url();
    console.log(`  Frame URL: ${frameUrl.slice(0, 80)}...`);

    // Skip patterns - items that are UI elements, not sessions
    const skipPatterns = ['Start', 'New', 'Open', 'workspace', 'Inbox', 'Playground',
        'Knowledge', 'Browser', 'Settings', 'File', 'Edit', 'View',
        'Agent Manager', 'project', 'Recent', 'Active'];

    // Strategy 1: Session names are in span.grow.truncate inside buttons (from DOM analysis)
    let elements = managerFrame.locator('button span.grow.truncate');
    let count = await elements.count();
    console.log(`  Selector 'button span.grow.truncate': ${count} matches`);

    if (count > 0) {
        for (let i = 0; i < count; i++) {
            const el = elements.nth(i);
            const text = await el.innerText().catch(() => '');
            const trimmed = text.trim();

            if (trimmed.length >= 3 && !skipPatterns.some(p => trimmed === p)) {
                if (!sessions.find(s => s.name === trimmed)) {
                    sessions.push({ name: trimmed, index: sessions.length });
                }
            }
        }
    }

    // Strategy 2: Try span.text-sm.truncate if first didn't work
    if (sessions.length === 0) {
        elements = managerFrame.locator('span.text-sm.truncate');
        count = await elements.count();
        console.log(`  Selector 'span.text-sm.truncate': ${count} matches`);

        for (let i = 0; i < count; i++) {
            const el = elements.nth(i);
            const text = await el.innerText().catch(() => '');
            const trimmed = text.trim();

            if (trimmed.length >= 5 && !skipPatterns.some(p => trimmed.toLowerCase().includes(p.toLowerCase()))) {
                if (!sessions.find(s => s.name === trimmed)) {
                    sessions.push({ name: trimmed, index: sessions.length });
                }
            }
        }
    }

    // Strategy 3: Fallback - visible buttons with longer text
    if (sessions.length === 0) {
        console.log('  Trying fallback button:visible selector...');
        elements = managerFrame.locator('button:visible');
        count = await elements.count();
        console.log(`  Found ${count} visible buttons`);

        for (let i = 0; i < count; i++) {
            const btn = elements.nth(i);
            const text = await btn.innerText().catch(() => '');
            const trimmed = text.trim().split('\n')[0]; // First line only

            if (trimmed.length >= 8 && !skipPatterns.some(p => trimmed.toLowerCase().includes(p.toLowerCase()))) {
                if (!sessions.find(s => s.name === trimmed)) {
                    sessions.push({ name: trimmed, index: i });
                }
            }
        }
    }

    return sessions;
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
    const btn = managerFrame.locator('button:visible').nth(match.index);
    await btn.click();
    await managerFrame.waitForTimeout(500);

    console.log(`✅ Switched to: "${match.name}" (ID: ${match.id || 'none'})`);
    return true;
}

