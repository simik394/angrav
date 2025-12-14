import { Frame } from '@playwright/test';

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
}

/**
 * Lists all available sessions from the Agent Manager window.
 * Sessions appear as buttons with conversation titles.
 */
export async function listSessions(managerFrame: Frame): Promise<SessionInfo[]> {
    console.log('📋 Listing sessions...');

    const sessions: SessionInfo[] = [];

    // Sessions are buttons in the manager with conversation titles
    // Based on exploration: buttons with non-menu text (not File/Edit/View etc)
    const buttons = managerFrame.locator('button:visible');
    const count = await buttons.count();

    const menuItems = ['File', 'Edit', 'View', 'Antigravity'];

    for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const text = await btn.innerText().catch(() => '');
        const trimmed = text.trim();

        // Skip menu items and empty
        if (!trimmed || menuItems.includes(trimmed)) continue;

        // Skip very short texts (likely icons)
        if (trimmed.length < 5) continue;

        sessions.push({ name: trimmed, index: i });
    }

    console.log(`Found ${sessions.length} sessions.`);
    return sessions;
}

/**
 * Switches to a session by name (partial match).
 */
export async function switchSession(managerFrame: Frame, sessionName: string): Promise<boolean> {
    console.log(`🔄 Switching to session: ${sessionName}...`);

    const sessions = await listSessions(managerFrame);
    const match = sessions.find(s =>
        s.name.toLowerCase().includes(sessionName.toLowerCase())
    );

    if (!match) {
        console.error(`Session "${sessionName}" not found.`);
        return false;
    }

    // Click the session button
    const btn = managerFrame.locator('button:visible').nth(match.index);
    await btn.click();
    await managerFrame.waitForTimeout(500);

    console.log(`✅ Switched to: ${match.name}`);
    return true;
}

