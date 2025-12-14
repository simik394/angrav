import { SessionRegistry, SessionHandle, SessionId } from './registry';
import { waitForIdle } from './state';
import { extractResponse, AgentResponse } from './extraction';

/**
 * Result from waiting on multiple sessions.
 */
export interface SessionCompletionResult {
    sessionId: SessionId;
    state: 'idle' | 'thinking' | 'error';
    response?: AgentResponse;
    duration: number;  // ms since wait started
}

/**
 * Options for multi-session wait operations.
 */
export interface MultiWaitOptions {
    timeout?: number;           // Default 120000ms
    extractResponse?: boolean;  // Auto-extract on completion
}

/**
 * Waits for ANY session to become idle.
 * Returns the first session that completes.
 */
export async function waitForAny(
    registry: SessionRegistry,
    options: MultiWaitOptions = {}
): Promise<SessionCompletionResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? 120000;

    // Check if any are already idle
    const alreadyIdle = registry.getByState('idle');
    if (alreadyIdle.length > 0) {
        const session = alreadyIdle[0];
        return {
            sessionId: session.id,
            state: 'idle',
            response: options.extractResponse
                ? await extractResponse(session.frame)
                : undefined,
            duration: 0
        };
    }

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
                try {
                    response = await extractResponse(handle.frame);
                } catch (e) {
                    console.warn(`⚠️ Failed to extract response from ${sessionId}`);
                }
            }

            resolve({
                sessionId,
                state: 'idle',
                response,
                duration: Date.now() - startTime
            });
        };

        registry.on('session_idle', handler);
    });
}

/**
 * Waits for ALL sessions to become idle.
 * Returns array of results in completion order.
 */
export async function waitForAll(
    registry: SessionRegistry,
    options: MultiWaitOptions = {}
): Promise<SessionCompletionResult[]> {
    const startTime = Date.now();
    const timeout = options.timeout ?? 120000;
    const sessions = registry.list();

    if (sessions.length === 0) {
        return [];
    }

    const results: SessionCompletionResult[] = [];
    const pending = new Set(sessions.map(s => s.id));

    // Process already-idle sessions first
    for (const session of sessions) {
        if (session.state === 'idle') {
            pending.delete(session.id);
            results.push({
                sessionId: session.id,
                state: 'idle',
                response: options.extractResponse
                    ? await extractResponse(session.frame)
                    : undefined,
                duration: 0
            });
        }
    }

    // If all already idle, return
    if (pending.size === 0) {
        return results;
    }

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
                    try {
                        response = await extractResponse(handle.frame);
                    } catch (e) {
                        console.warn(`⚠️ Failed to extract response from ${sessionId}`);
                    }
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
    });
}

/**
 * Waits for a specific session to become idle.
 */
export async function waitForSession(
    registry: SessionRegistry,
    sessionId: SessionId,
    options: MultiWaitOptions = {}
): Promise<SessionCompletionResult> {
    const handle = registry.get(sessionId);
    if (!handle) {
        throw new Error(`Session ${sessionId} not found`);
    }

    // Already idle
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
