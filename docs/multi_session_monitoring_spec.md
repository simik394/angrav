# Multi-Session Monitoring Specification

> **Status**: Draft  
> **Date**: 2025-12-14  
> **Priority**: High (enables parallel agent orchestration)

## 1. Overview

Enable simultaneous monitoring of multiple Antigravity chat sessions, allowing an orchestrating agent to dispatch tasks to multiple Antigravity instances and await their completion in parallel.

## 2. Problem Statement

- Current implementation is **single-session oriented** — CLI commands and core functions operate on one session at a time
- No way to **wait for multiple agents** completing different tasks simultaneously
- Cannot efficiently **orchestrate parallel workloads** (e.g., assign 3 agents to 3 different code review tasks)
- Manual switching between sessions is **slow and error-prone**
- No **aggregated view** of all running tasks across sessions

## 3. Goals

1. **Parallel Monitoring**: Wait for any/all sessions to reach idle state
2. **Session Identification**: Unique session handles for targeting specific sessions
3. **Concurrent Extraction**: Extract responses from multiple sessions without blocking
4. **Event-Driven Architecture**: React to session state changes without polling
5. **CLI Integration**: Natural multi-session commands

## 4. Non-Goals

- Creating new Antigravity windows (that's `spawnAgent()` in manager.ts)
- Cross-session context sharing
- Load balancing between sessions

---

## 5. Foundation: Single-Session Operations

> **Status**: ✅ Implemented in `src/session.ts`

Multi-session monitoring builds on top of existing single-session primitives. This section documents the foundation.

### 5.1 Core Selectors (cascade-panel frame)

| Action | Selector | Notes |
|--------|----------|-------|
| New Conversation | `[data-tooltip-id="new-conversation-tooltip"]` | Button in cascade-panel |
| Chat History Rows | `div.bg-ide-chat-background` | Each message row |
| User Messages | `span[data-lexical-text="true"]` | User input text |
| Agent Responses | `.prose` | Markdown-rendered responses |
| Thoughts Toggle | `button:has-text("Thought")` | Expands agent reasoning |
| Input Field | `[contenteditable="true"][data-lexical-editor="true"]` | Chat input |
| Stop Button | `button:has-text("Stop")` | Visible during thinking |

### 5.2 Single-Session Data Model

```typescript
// Already implemented in src/session.ts

interface ConversationMessage {
    role: 'user' | 'agent';
    content: string;
    thoughts?: string;
    timestamp?: Date;
}

interface ConversationHistory {
    messages: ConversationMessage[];
    messageCount: number;
}
```

### 5.3 Single-Session Functions

| Function | File | Purpose |
|----------|------|---------|
| `startNewConversation(frame)` | `session.ts` | Clicks new chat button |
| `getConversationHistory(frame)` | `session.ts` | Extracts all messages |
| `getAgentState(frame)` | `state.ts` | Returns idle/thinking/error |
| `waitForIdle(frame, timeout)` | `state.ts` | Blocks until agent done |
| `sendPrompt(frame, text)` | `prompt.ts` | Types and submits prompt |

---

## 6. Technical Design

### 6.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Orchestrating Agent                          │
│                    (rsrch, proj, or script)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SessionRegistry (new)                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Map<sessionId, SessionHandle>                               │ │
│  │   - session-abc → { page, frame, state, lastActivity }      │ │
│  │   - session-def → { page, frame, state, lastActivity }      │ │
│  │   - session-xyz → { page, frame, state, lastActivity }      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│           ┌──────────────────┼──────────────────┐                │
│           ▼                  ▼                  ▼                │
│     SessionHandle      SessionHandle      SessionHandle          │
│     (cascade-panel)    (cascade-panel)    (cascade-panel)        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Antigravity IDE (Electron)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Window 1    │  │  Window 2    │  │  Window 3    │           │
│  │ (workbench)  │  │ (workbench)  │  │ (workbench)  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Data Model

```typescript
/**
 * Unique identifier for a session.
 * Can be derived from page URL, window title, or generated UUID.
 */
type SessionId = string;

/**
 * Live handle to an active session.
 */
interface SessionHandle {
    id: SessionId;
    page: Page;
    frame: Frame;                    // cascade-panel frame
    workspace?: string;              // Associated workspace path
    state: AgentState;               // 'idle' | 'thinking' | 'error'
    lastActivity: Date;
    metadata: {
        title: string;               // Window/conversation title
        messageCount: number;        // Messages in conversation
    };
}

/**
 * Result from waiting on multiple sessions.
 */
interface SessionCompletionResult {
    sessionId: SessionId;
    state: AgentState;
    response?: AgentResponse;        // From extraction.ts
    duration: number;                // ms since wait started
}

/**
 * Options for multi-session wait operations.
 */
interface MultiWaitOptions {
    timeout?: number;                // Default 120000ms
    strategy: 'any' | 'all';         // Wait for first or all
    pollInterval?: number;           // Default 1000ms
    extractResponse?: boolean;       // Auto-extract on completion
}

/**
 * Event emitted when session state changes.
 */
interface SessionEvent {
    type: 'state_change' | 'new_session' | 'session_closed';
    sessionId: SessionId;
    previousState?: AgentState;
    currentState?: AgentState;
    timestamp: Date;
}
```

### 6.3 Core Components

#### 6.3.1 SessionRegistry Class

Central registry managing all active sessions:

```typescript
// src/registry.ts

import { EventEmitter } from 'events';
import { BrowserContext, Page, Frame } from '@playwright/test';
import { getAgentState, AgentState } from './state';
import { getAgentFrame } from './core';

export class SessionRegistry extends EventEmitter {
    private sessions: Map<SessionId, SessionHandle> = new Map();
    private context: BrowserContext;
    private pollTimer?: NodeJS.Timer;

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

        for (const page of pages) {
            // Skip non-workbench pages
            if (!page.url().includes('workbench.html')) continue;
            if (page.url().includes('jetski-agent')) continue;

            try {
                const frame = await getAgentFrame(page);
                const state = await getAgentState(frame);
                const title = await page.title();

                const sessionId = this.generateSessionId(page);

                const handle: SessionHandle = {
                    id: sessionId,
                    page,
                    frame,
                    state: state.state,
                    lastActivity: new Date(),
                    metadata: {
                        title,
                        messageCount: 0  // Updated lazily
                    }
                };

                this.sessions.set(sessionId, handle);
                discovered.push(handle);

            } catch (e) {
                // Page doesn't have cascade-panel, skip
            }
        }

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
     * Starts background polling for state changes.
     */
    startPolling(intervalMs: number = 2000): void {
        this.pollTimer = setInterval(async () => {
            for (const [id, handle] of this.sessions) {
                try {
                    const newState = await getAgentState(handle.frame);
                    
                    if (newState.state !== handle.state) {
                        const event: SessionEvent = {
                            type: 'state_change',
                            sessionId: id,
                            previousState: handle.state,
                            currentState: newState.state,
                            timestamp: new Date()
                        };
                        
                        handle.state = newState.state;
                        handle.lastActivity = new Date();
                        
                        this.emit('state_change', event);
                        
                        // Convenience events
                        if (newState.state === 'idle') {
                            this.emit('session_idle', id);
                        }
                    }
                } catch (e) {
                    // Session closed or frame navigated away
                    this.sessions.delete(id);
                    this.emit('session_closed', { sessionId: id });
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
        }
    }

    private generateSessionId(page: Page): SessionId {
        // Extract from URL or generate stable hash
        const url = page.url();
        const match = url.match(/session[=\/]([a-zA-Z0-9-]+)/);
        if (match) return match[1];
        
        // Fallback: hash of URL + timestamp
        return `session-${Date.now().toString(36)}`;
    }
}
```

#### 6.3.2 Multi-Wait Operations

```typescript
// src/multi-session.ts

import { SessionRegistry, SessionHandle, SessionId } from './registry';
import { waitForIdle } from './state';
import { extractResponse, AgentResponse } from './extraction';

/**
 * Waits for ANY session to become idle.
 * Returns the first session that completes.
 */
export async function waitForAny(
    registry: SessionRegistry,
    options: MultiWaitOptions = { strategy: 'any' }
): Promise<SessionCompletionResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? 120000;

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            registry.off('session_idle', handler);
            reject(new Error(`Timeout waiting for any session (${timeout}ms)`));
        }, timeout);

        const handler = async (sessionId: SessionId) => {
            clearTimeout(timeoutId);
            registry.off('session_idle', handler);

            const handle = registry.get(sessionId);
            if (!handle) {
                reject(new Error(`Session ${sessionId} disappeared`));
                return;
            }

            let response: AgentResponse | undefined;
            if (options.extractResponse) {
                response = await extractResponse(handle.frame);
            }

            resolve({
                sessionId,
                state: 'idle',
                response,
                duration: Date.now() - startTime
            });
        };

        registry.on('session_idle', handler);

        // Check if any are already idle
        for (const session of registry.list()) {
            if (session.state === 'idle') {
                clearTimeout(timeoutId);
                registry.off('session_idle', handler);
                handler(session.id);
                return;
            }
        }
    });
}

/**
 * Waits for ALL sessions to become idle.
 * Returns array of results in completion order.
 */
export async function waitForAll(
    registry: SessionRegistry,
    options: MultiWaitOptions = { strategy: 'all' }
): Promise<SessionCompletionResult[]> {
    const startTime = Date.now();
    const timeout = options.timeout ?? 120000;
    const sessions = registry.list();
    
    const results: SessionCompletionResult[] = [];
    const pending = new Set(sessions.map(s => s.id));

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            registry.off('session_idle', handler);
            reject(new Error(
                `Timeout waiting for all sessions. ` +
                `Completed: ${results.length}/${sessions.length}. ` +
                `Pending: ${Array.from(pending).join(', ')}`
            ));
        }, timeout);

        const handler = async (sessionId: SessionId) => {
            if (!pending.has(sessionId)) return;
            pending.delete(sessionId);

            const handle = registry.get(sessionId);
            if (handle) {
                let response: AgentResponse | undefined;
                if (options.extractResponse) {
                    response = await extractResponse(handle.frame);
                }

                results.push({
                    sessionId,
                    state: 'idle',
                    response,
                    duration: Date.now() - startTime
                });
            }

            if (pending.size === 0) {
                clearTimeout(timeoutId);
                registry.off('session_idle', handler);
                resolve(results);
            }
        };

        registry.on('session_idle', handler);

        // Check already-idle sessions
        for (const session of sessions) {
            if (session.state === 'idle') {
                handler(session.id);
            }
        }
    });
}

/**
 * Waits for a specific session to become idle.
 */
export async function waitForSession(
    registry: SessionRegistry,
    sessionId: SessionId,
    options: Omit<MultiWaitOptions, 'strategy'> = {}
): Promise<SessionCompletionResult> {
    const handle = registry.get(sessionId);
    if (!handle) {
        throw new Error(`Session ${sessionId} not found`);
    }

    if (handle.state === 'idle') {
        return {
            sessionId,
            state: 'idle',
            response: options.extractResponse 
                ? await extractResponse(handle.frame) 
                : undefined,
            duration: 0
        };
    }

    const startTime = Date.now();
    await waitForIdle(handle.frame, options.timeout ?? 120000);

    return {
        sessionId,
        state: 'idle',
        response: options.extractResponse 
            ? await extractResponse(handle.frame) 
            : undefined,
        duration: Date.now() - startTime
    };
}
```

#### 6.3.3 Parallel Operations

```typescript
// src/parallel.ts

import { SessionRegistry, SessionId } from './registry';
import { sendPrompt } from './prompt';
import { extractResponse, AgentResponse } from './extraction';
import { waitForAll, waitForAny } from './multi-session';

interface ParallelTask {
    sessionId: SessionId;
    prompt: string;
}

interface ParallelResult {
    sessionId: SessionId;
    success: boolean;
    response?: AgentResponse;
    error?: string;
    duration: number;
}

/**
 * Sends prompts to multiple sessions and waits for all to complete.
 */
export async function executeParallel(
    registry: SessionRegistry,
    tasks: ParallelTask[],
    options: { timeout?: number; strategy?: 'any' | 'all' } = {}
): Promise<ParallelResult[]> {
    const startTime = Date.now();

    // Phase 1: Send all prompts concurrently
    await Promise.all(
        tasks.map(async ({ sessionId, prompt }) => {
            const handle = registry.get(sessionId);
            if (!handle) throw new Error(`Session ${sessionId} not found`);
            await sendPrompt(handle.frame, prompt);
        })
    );

    // Phase 2: Wait for completion based on strategy
    const strategy = options.strategy ?? 'all';
    
    if (strategy === 'all') {
        const completions = await waitForAll(registry, {
            strategy: 'all',
            timeout: options.timeout,
            extractResponse: true
        });

        return completions.map(c => ({
            sessionId: c.sessionId,
            success: true,
            response: c.response,
            duration: c.duration
        }));

    } else {
        // 'any' strategy - return first completion
        const first = await waitForAny(registry, {
            strategy: 'any',
            timeout: options.timeout,
            extractResponse: true
        });

        return [{
            sessionId: first.sessionId,
            success: true,
            response: first.response,
            duration: first.duration
        }];
    }
}

/**
 * Runs the same prompt on all sessions (fan-out pattern).
 */
export async function fanOut(
    registry: SessionRegistry,
    prompt: string,
    options: { timeout?: number } = {}
): Promise<ParallelResult[]> {
    const sessions = registry.list();
    const tasks = sessions.map(s => ({ sessionId: s.id, prompt }));
    return executeParallel(registry, tasks, { ...options, strategy: 'all' });
}
```

---

## 7. CLI Commands

### 7.1 New Commands

```bash
# Discovery & Listing
angrav sessions list                    # List all active sessions
angrav sessions list --json             # JSON output

# Targeting Specific Sessions
angrav --session <id> status            # Status of specific session
angrav --session <id> prompt "..."      # Send prompt to specific session
angrav --session <id> output last       # Extract from specific session

# Multi-Session Wait
angrav sessions wait --any              # Wait for ANY session to become idle
angrav sessions wait --all              # Wait for ALL sessions to become idle
angrav sessions wait --timeout 60000    # Custom timeout

# Parallel Operations
angrav sessions fanout "Review this code"  # Same prompt to all sessions
```

### 7.2 CLI Implementation

```typescript
// Addition to src/cli.ts

import { SessionRegistry } from './registry';
import { waitForAny, waitForAll, waitForSession } from './multi-session';

const sessionsCmd = program.command('sessions')
    .description('Multi-session operations');

sessionsCmd.command('list')
    .description('List all active sessions')
    .action(async () => {
        const opts = program.opts();
        const { browser, context } = await connectToApp();
        
        const registry = new SessionRegistry(context);
        await registry.discover();
        
        output(() => {
            const sessions = registry.list();
            if (opts.json) {
                return sessions.map(s => ({
                    id: s.id,
                    state: s.state,
                    title: s.metadata.title,
                    workspace: s.workspace
                }));
            } else {
                console.log(`Found ${sessions.length} active sessions:\n`);
                sessions.forEach((s, i) => {
                    console.log(`${i + 1}. [${s.id}] ${s.metadata.title}`);
                    console.log(`   State: ${s.state}`);
                    console.log(`   Workspace: ${s.workspace || 'unknown'}`);
                    console.log('');
                });
            }
        });
    });

sessionsCmd.command('wait')
    .description('Wait for sessions to complete')
    .option('--any', 'Wait for ANY session (first to complete)')
    .option('--all', 'Wait for ALL sessions')
    .option('-t, --timeout <ms>', 'Timeout in milliseconds', '120000')
    .action(async (options) => {
        const opts = program.opts();
        const { browser, context } = await connectToApp();
        
        const registry = new SessionRegistry(context);
        await registry.discover();
        registry.startPolling();

        try {
            if (options.any) {
                const result = await waitForAny(registry, {
                    strategy: 'any',
                    timeout: parseInt(options.timeout),
                    extractResponse: true
                });
                
                output(() => opts.json ? result : {
                    log: `Session ${result.sessionId} completed in ${result.duration}ms`
                });

            } else {
                const results = await waitForAll(registry, {
                    strategy: 'all',
                    timeout: parseInt(options.timeout),
                    extractResponse: true
                });
                
                output(() => opts.json ? results : {
                    log: `All ${results.length} sessions completed`
                });
            }
        } finally {
            registry.stopPolling();
        }
    });
```

---

## 8. Use Cases

### 8.1 Parallel Code Review

```typescript
const registry = new SessionRegistry(context);
await registry.discover();

// 3 files, 3 agents
const tasks = [
    { sessionId: 'session-a', prompt: '@file:auth.ts Review this file for security' },
    { sessionId: 'session-b', prompt: '@file:db.ts Review for SQL injection' },
    { sessionId: 'session-c', prompt: '@file:api.ts Review API design' },
];

const results = await executeParallel(registry, tasks);
// All 3 reviews complete, aggregate results
```

### 8.2 First-Response Wins

```typescript
// Ask same question to multiple models (if different sessions use different models)
const first = await waitForAny(registry, { extractResponse: true });
console.log(`Fastest answer from ${first.sessionId}: ${first.response?.answer}`);
```

### 8.3 Batch Documentation

```typescript
// Generate docs for all modules in parallel
await fanOut(registry, 'Generate JSDoc for all exported functions');
```

---

## 9. Integration with Existing Code

| Existing Module | Integration Point |
|-----------------|-------------------|
| `src/core.ts` | Add `connectToAllPages()` returning `Page[]` |
| `src/state.ts` | No changes (already works per-frame) |
| `src/session.ts` | No changes (already works per-frame) |
| `src/extraction.ts` | No changes (already works per-frame) |
| `src/manager.ts` | `openAgentManager` can spawn sessions tracked by registry |
| `src/cli.ts` | Add global `--session <id>` flag + new `sessions` command group |

---

## 10. Error Handling

| Scenario | Handling |
|----------|----------|
| Session window closed | Remove from registry, emit `session_closed` event |
| Frame navigation | Re-discover frame, update handle |
| Timeout on waitForAll | Reject with list of pending sessions |
| Session not found | Throw `SessionNotFoundError` |

---

> 📋 **Work Breakdown**: See [[wbs|wbs.md]] - Multi-Session Monitoring

---

## 12. Future Enhancements

1. **Session Aliases**: Name sessions (`angrav --session review-agent status`)
2. **Persistent Tracking**: Save session registry to disk for recovery
3. **Load Balancing**: Distribute prompts to least-busy sessions
4. **Session Groups**: Tag sessions and operate on groups
5. **WebSocket API**: Real-time session state streaming to external tools
