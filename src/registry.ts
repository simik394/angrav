import { EventEmitter } from 'events';
import { BrowserContext, Page, Frame } from '@playwright/test';
import { getAgentState, AgentState } from './state';
import { getAgentFrame } from './core';

/**
 * Unique identifier for a session.
 */
export type SessionId = string;

/**
 * Live handle to an active session.
 */
export interface SessionHandle {
    id: SessionId;
    page: Page;
    frame: Frame;
    workspace?: string;
    state: AgentState;
    lastActivity: Date;
    metadata: {
        title: string;
        messageCount: number;
    };
}

/**
 * Event emitted when session state changes.
 */
export interface SessionEvent {
    type: 'state_change' | 'new_session' | 'session_closed';
    sessionId: SessionId;
    previousState?: AgentState;
    currentState?: AgentState;
    timestamp: Date;
}

/**
 * Central registry managing all active Antigravity sessions.
 * Emits events: 'state_change', 'session_idle', 'session_closed'
 */
export class SessionRegistry extends EventEmitter {
    private sessions: Map<SessionId, SessionHandle> = new Map();
    private context: BrowserContext;
    private pollTimer?: ReturnType<typeof setInterval>;

    constructor(context: BrowserContext) {
        super();
        this.context = context;
    }

    /**
     * Discovers all active Antigravity sessions.
     * Scans all pages in context for cascade-panel frames.
     */
    async discover(): Promise<SessionHandle[]> {
        const pages = this.context.pages();
        const discovered: SessionHandle[] = [];

        console.log(`🔍 Discovering sessions from ${pages.length} pages...`);

        for (const page of pages) {
            const url = page.url();

            // Skip non-workbench pages and Agent Manager
            if (!url.includes('workbench.html')) continue;
            if (url.includes('jetski-agent')) continue;

            try {
                const frame = await getAgentFrame(page);
                const stateInfo = await getAgentState(frame);
                const title = await page.title();

                const sessionId = this.generateSessionId(page);

                const handle: SessionHandle = {
                    id: sessionId,
                    page,
                    frame,
                    state: stateInfo.state,
                    lastActivity: new Date(),
                    metadata: {
                        title: title || 'Untitled',
                        messageCount: 0
                    }
                };

                this.sessions.set(sessionId, handle);
                discovered.push(handle);

                console.log(`  ✅ Found session: ${sessionId} (${stateInfo.state})`);

            } catch (e) {
                // Page doesn't have cascade-panel, skip
                console.log(`  ⏭️ Skipping page (no agent panel): ${url}`);
            }
        }

        console.log(`📋 Discovered ${discovered.length} active sessions.`);
        return discovered;
    }

    /**
     * Gets a session by ID.
     */
    get(sessionId: SessionId): SessionHandle | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Lists all tracked sessions.
     */
    list(): SessionHandle[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Gets sessions filtered by state.
     */
    getByState(state: AgentState): SessionHandle[] {
        return this.list().filter(s => s.state === state);
    }

    /**
     * Checks if all sessions are idle.
     */
    allIdle(): boolean {
        return this.list().every(s => s.state === 'idle');
    }

    /**
     * Checks if any session is idle.
     */
    anyIdle(): boolean {
        return this.list().some(s => s.state === 'idle');
    }

    /**
     * Starts background polling for state changes.
     */
    startPolling(intervalMs: number = 2000): void {
        if (this.pollTimer) {
            console.log('⚠️ Polling already active');
            return;
        }

        console.log(`🔄 Starting state polling (${intervalMs}ms interval)...`);

        this.pollTimer = setInterval(async () => {
            for (const [id, handle] of this.sessions) {
                try {
                    const newStateInfo = await getAgentState(handle.frame);

                    if (newStateInfo.state !== handle.state) {
                        const event: SessionEvent = {
                            type: 'state_change',
                            sessionId: id,
                            previousState: handle.state,
                            currentState: newStateInfo.state,
                            timestamp: new Date()
                        };

                        const oldState = handle.state;
                        handle.state = newStateInfo.state;
                        handle.lastActivity = new Date();

                        this.emit('state_change', event);

                        // Convenience events
                        if (newStateInfo.state === 'idle') {
                            console.log(`✅ Session ${id} became idle`);
                            this.emit('session_idle', id);
                        } else if (newStateInfo.state === 'thinking') {
                            console.log(`🤔 Session ${id} started thinking`);
                        }
                    }
                } catch (e) {
                    // Session closed or frame navigated away
                    console.log(`❌ Session ${id} closed or unavailable`);
                    this.sessions.delete(id);
                    this.emit('session_closed', { sessionId: id, timestamp: new Date() });
                }
            }
        }, intervalMs);
    }

    /**
     * Stops background polling.
     */
    stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
            console.log('⏹️ Stopped state polling');
        }
    }

    /**
     * Clears all tracked sessions.
     */
    clear(): void {
        this.stopPolling();
        this.sessions.clear();
    }

    /**
     * Gets count of tracked sessions.
     */
    get size(): number {
        return this.sessions.size;
    }

    private generateSessionId(page: Page): SessionId {
        const url = page.url();

        // Try to extract session ID from URL
        const match = url.match(/session[=\/]([a-zA-Z0-9-]+)/);
        if (match) return match[1];

        // Fallback: use page viewport position or generate
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 6);
        return `session-${timestamp}-${random}`;
    }
}
