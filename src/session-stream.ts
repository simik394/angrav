import * as http from 'http';
import { SessionRegistry, SessionEvent, SessionId } from './registry';
import { AgentResponse } from './extraction';

// ============================================================================
// SSE Event Types
// ============================================================================

export interface SessionStateEvent {
    type: 'state_change' | 'session_idle' | 'session_closed' | 'response_ready';
    sessionId: string;
    state: 'idle' | 'thinking' | 'error';
    previousState?: 'idle' | 'thinking' | 'error';
    response?: AgentResponse;
    timestamp: number;
}

// ============================================================================
// SSE Helpers
// ============================================================================

/**
 * Sends an SSE event to the client.
 */
function sendSSE(res: http.ServerResponse, event: SessionStateEvent | 'heartbeat'): void {
    if (event === 'heartbeat') {
        res.write(': heartbeat\n\n');
    } else {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
}

/**
 * Sets up SSE headers and returns cleanup function.
 */
function setupSSE(res: http.ServerResponse): () => void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    res.flushHeaders?.();

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
        sendSSE(res, 'heartbeat');
    }, 30000);

    return () => {
        clearInterval(heartbeatInterval);
    };
}

// ============================================================================
// Session Event Stream
// ============================================================================

/**
 * Creates an SSE stream handler for session state changes.
 * Attaches to SessionRegistry events and streams them to the client.
 */
export function createSessionEventStream(
    registry: SessionRegistry
): (res: http.ServerResponse) => void {
    return (res: http.ServerResponse) => {
        const cleanup = setupSSE(res);

        // Event handlers
        const onStateChange = (event: SessionEvent) => {
            const sseEvent: SessionStateEvent = {
                type: 'state_change',
                sessionId: event.sessionId,
                state: event.currentState || 'idle',
                previousState: event.previousState,
                timestamp: Date.now()
            };
            sendSSE(res, sseEvent);
        };

        const onSessionIdle = async (sessionId: SessionId) => {
            const handle = registry.get(sessionId);
            const sseEvent: SessionStateEvent = {
                type: 'session_idle',
                sessionId,
                state: 'idle',
                timestamp: Date.now()
            };
            sendSSE(res, sseEvent);
        };

        const onSessionClosed = (data: { sessionId: SessionId }) => {
            const sseEvent: SessionStateEvent = {
                type: 'session_closed',
                sessionId: data.sessionId,
                state: 'error',
                timestamp: Date.now()
            };
            sendSSE(res, sseEvent);
        };

        // Attach listeners
        registry.on('state_change', onStateChange);
        registry.on('session_idle', onSessionIdle);
        registry.on('session_closed', onSessionClosed);

        // Send initial session states
        for (const session of registry.list()) {
            const initialEvent: SessionStateEvent = {
                type: 'state_change',
                sessionId: session.id,
                state: session.state,
                timestamp: Date.now()
            };
            sendSSE(res, initialEvent);
        }

        // Cleanup on client disconnect
        res.on('close', () => {
            cleanup();
            registry.off('state_change', onStateChange);
            registry.off('session_idle', onSessionIdle);
            registry.off('session_closed', onSessionClosed);
            console.log('📡 SSE client disconnected from session stream');
        });

        console.log('📡 SSE client connected to session stream');
    };
}

/**
 * Creates an SSE stream handler that also extracts responses on idle.
 * More expensive but provides full response data.
 */
export function createSessionEventStreamWithResponses(
    registry: SessionRegistry,
    extractResponse: (frame: import('@playwright/test').Frame) => Promise<AgentResponse>
): (res: http.ServerResponse) => void {
    return (res: http.ServerResponse) => {
        const cleanup = setupSSE(res);

        const onSessionIdle = async (sessionId: SessionId) => {
            const handle = registry.get(sessionId);
            let response: AgentResponse | undefined;

            if (handle) {
                try {
                    response = await extractResponse(handle.frame);
                } catch (e) {
                    console.warn(`⚠️ Failed to extract response for ${sessionId}`);
                }
            }

            const sseEvent: SessionStateEvent = {
                type: 'response_ready',
                sessionId,
                state: 'idle',
                response,
                timestamp: Date.now()
            };
            sendSSE(res, sseEvent);
        };

        registry.on('session_idle', onSessionIdle);

        res.on('close', () => {
            cleanup();
            registry.off('session_idle', onSessionIdle);
        });
    };
}
