import * as http from 'http';
import { connectToApp, getAgentFrame, AppContext } from './core';
import { sendPrompt } from './prompt';
import { waitForIdle } from './state';
import { extractResponse, AgentResponse } from './extraction';
import { streamResponse, StreamChunk } from './streaming';
import { startNewConversation, switchSession, listSessions } from './session';
import { openAgentManager, ManagerContext } from './manager';
import { Frame, Page } from '@playwright/test';
import { getFalkorClient } from '@agents/shared';
import { SessionRegistry, SessionId, SessionHandle } from './registry';
import { createSessionEventStream, createSingleSessionEventStream } from './session-stream';
import { extractResponse as extractFullResponse } from './extraction';
import {
    startChatCompletionTrace,
    completeChatCompletionTrace,
    failChatCompletionTrace,
    trackStreamingChunk,
    flushObservability,
    shutdownObservability,
    isObservabilityEnabled,
    TraceContext
} from './observability';

// ============================================================================
// OpenAI-Compatible Types
// ============================================================================

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    session?: string;  // Session name for conversation continuity
}

export interface ChatCompletionChoice {
    index: number;
    message: {
        role: 'assistant';
        content: string;
    };
    finish_reason: 'stop' | 'length' | 'error';
}

export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: ChatCompletionChoice[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    session?: string;  // Echo session for client tracking
}

export interface ModelInfo {
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
}

export interface ModelsResponse {
    object: 'list';
    data: ModelInfo[];
}

// SSE Streaming Types
export interface ChatCompletionChunkChoice {
    index: number;
    delta: {
        role?: 'assistant';
        content?: string;
    };
    finish_reason: 'stop' | 'length' | null;
}

export interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: ChatCompletionChunkChoice[];
}

// ============================================================================
// Server State (Multi-Session)
// ============================================================================

interface RequestQueueItem {
    resolve: (response: ChatCompletionResponse) => void;
    reject: (error: Error) => void;
    request: ChatCompletionRequest;
    timestamp: number;
}

interface SessionQueueState {
    isProcessing: boolean;
    queue: RequestQueueItem[];
}

interface ServerState {
    appContext: AppContext | null;
    registry: SessionRegistry | null;
    managerContext: ManagerContext | null;
    sessionQueues: Map<SessionId, SessionQueueState>;
    // Fallback for single-session mode
    defaultFrame: Frame | null;
    defaultPage: Page | null;
}

// Queue configuration
const MAX_QUEUE_DEPTH_PER_SESSION = 5;
const MAX_TOTAL_QUEUE_DEPTH = 20;
const QUEUE_TIMEOUT_MS = 120000; // 2 minutes

const state: ServerState = {
    appContext: null,
    registry: null,
    managerContext: null,
    sessionQueues: new Map(),
    defaultFrame: null,
    defaultPage: null
};


// ============================================================================
// Core Functions
// ============================================================================

function generateId(): string {
    return 'chatcmpl-' + Math.random().toString(36).substring(2, 15);
}

/**
 * Format all messages into a single conversation string for the agent.
 * Uses a simple "Role: content" format with separators.
 */
function formatConversation(messages: ChatMessage[]): string {
    return messages
        .map(m => {
            const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
            return `${role}: ${m.content}`;
        })
        .join('\n\n---\n\n');
}

/**
 * Validate messages array for common input errors.
 * Returns null if valid, error message string if invalid.
 */
function validateMessages(messages: ChatMessage[]): string | null {
    const validRoles = ['user', 'assistant', 'system'];

    // Empty array check
    if (messages.length === 0) {
        return 'Messages array cannot be empty';
    }

    // First pass: validate each message structure
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // Check role exists and is valid (do this FIRST)
        if (!msg.role || !validRoles.includes(msg.role)) {
            return `Invalid role '${msg.role}' at message ${i}. Must be one of: ${validRoles.join(', ')}`;
        }

        // Check content is string
        if (typeof msg.content !== 'string') {
            return `Message ${i} content must be a string, got ${typeof msg.content}`;
        }

        // Check content is not empty (for user messages)
        if (msg.role === 'user' && msg.content.trim().length === 0) {
            return `User message ${i} cannot have empty content`;
        }
    }

    // Second pass: check for at least one user message
    const hasUserMessage = messages.some(m => m.role === 'user');
    if (!hasUserMessage) {
        return 'At least one user message is required';
    }

    return null; // Valid
}

async function ensureConnection(): Promise<{ registry: SessionRegistry; context: AppContext }> {
    if (!state.appContext || !state.registry) {
        console.log('🔌 Establishing CDP connection...');
        state.appContext = await connectToApp();
        state.registry = new SessionRegistry(state.appContext.context);
        await state.registry.discover();
        state.registry.startPolling(2000);
        console.log(`✅ Connected to Antigravity (${state.registry.size} sessions found)`);
    }
    return { registry: state.registry, context: state.appContext };
}

/**
 * Gets or creates queue state for a session.
 */
function getSessionQueue(sessionId: SessionId): SessionQueueState {
    let queueState = state.sessionQueues.get(sessionId);
    if (!queueState) {
        queueState = { isProcessing: false, queue: [] };
        state.sessionQueues.set(sessionId, queueState);
    }
    return queueState;
}

/**
 * Gets total queue depth across all sessions.
 */
function getTotalQueueDepth(): number {
    let total = 0;
    for (const queueState of state.sessionQueues.values()) {
        total += queueState.queue.length;
    }
    return total;
}

/**
 * Resolves target session for a request.
 * Returns first idle session if none specified.
 */
async function resolveTargetSession(
    registry: SessionRegistry,
    requestedSession?: string
): Promise<SessionHandle | null> {
    if (requestedSession && requestedSession !== 'new') {
        // Look for specific session
        const handle = registry.get(requestedSession);
        if (handle) return handle;

        // Try to find by partial match
        for (const session of registry.list()) {
            if (session.id.includes(requestedSession) || session.metadata.title.includes(requestedSession)) {
                return session;
            }
        }
        console.warn(`⚠️ Session '${requestedSession}' not found`);
    }

    // Return first available session
    const sessions = registry.list();
    if (sessions.length === 0) {
        // No sessions discovered, try fallback to default frame
        if (state.defaultFrame && state.defaultPage) {
            return null; // Will use fallback
        }
        // Try to refresh discovery
        await registry.discover();
        if (registry.size === 0) {
            throw new Error('No Antigravity sessions available');
        }
    }

    // Prefer idle sessions
    const idle = registry.getByState('idle');
    if (idle.length > 0) return idle[0];

    // Otherwise return first session
    return registry.list()[0];
}

async function processRequestForSession(
    request: ChatCompletionRequest,
    handle: SessionHandle
): Promise<ChatCompletionResponse> {
    const { frame, page, id: sessionId } = handle;

    // Handle new conversation
    if (request.session === 'new') {
        console.log('🔄 Starting new conversation');
        await startNewConversation(frame);
    }

    // Start observability trace
    const traceCtx = startChatCompletionTrace(request);

    // Format full conversation for multi-turn context
    const prompt = formatConversation(request.messages);

    console.log(`📨 [${sessionId}] Processing: "${prompt.substring(0, 50)}..."`);

    try {
        const falkor = getFalkorClient();

        // Log query to FalkorDB
        await falkor.logInteraction(sessionId, 'user', 'query', prompt).catch((e: any) => console.error('FalkorDB log failed:', e));

        // Send prompt and wait for response
        await sendPrompt(frame, page, prompt, { wait: true, timeout: 300000 }); // 5 min timeout

        // Extract response
        const agentResponse = await extractResponse(frame);

        // Log response to FalkorDB
        await falkor.logInteraction(sessionId, 'agent', 'response', agentResponse.fullText).catch((e: any) => console.error('FalkorDB log failed:', e));

        // Complete observability trace
        completeChatCompletionTrace(traceCtx, agentResponse.fullText);

        // Build OpenAI-compatible response
        const response: ChatCompletionResponse = {
            id: generateId(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: request.model || 'gemini-antigravity',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: agentResponse.fullText
                },
                finish_reason: 'stop'
            }],
            usage: {
                prompt_tokens: Math.ceil(prompt.length / 4),
                completion_tokens: Math.ceil(agentResponse.fullText.length / 4),
                total_tokens: Math.ceil((prompt.length + agentResponse.fullText.length) / 4)
            },
            session: sessionId
        };

        return response;
    } catch (error) {
        failChatCompletionTrace(traceCtx, error as Error);
        throw error;
    }
}

async function processSessionQueue(sessionId: SessionId): Promise<void> {
    const queueState = getSessionQueue(sessionId);

    if (queueState.isProcessing || queueState.queue.length === 0) {
        return;
    }

    queueState.isProcessing = true;
    const item = queueState.queue.shift()!;

    try {
        const { registry } = await ensureConnection();
        const handle = registry.get(sessionId);

        if (!handle) {
            throw new Error(`Session ${sessionId} no longer available`);
        }

        const response = await processRequestForSession(item.request, handle);
        item.resolve(response);
    } catch (error) {
        item.reject(error as Error);
    } finally {
        queueState.isProcessing = false;
        // Process next in this session's queue
        processSessionQueue(sessionId);
    }
}

async function queueRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { registry } = await ensureConnection();

    // Resolve target session
    const handle = await resolveTargetSession(registry, request.session);
    if (!handle) {
        throw new Error('No session available to process request');
    }

    const sessionId = handle.id;
    const queueState = getSessionQueue(sessionId);

    return new Promise((resolve, reject) => {
        // Check per-session queue depth
        if (queueState.queue.length >= MAX_QUEUE_DEPTH_PER_SESSION) {
            reject(new Error(`Session ${sessionId} queue full (max ${MAX_QUEUE_DEPTH_PER_SESSION}). Try again later.`));
            return;
        }

        // Check total queue depth
        if (getTotalQueueDepth() >= MAX_TOTAL_QUEUE_DEPTH) {
            reject(new Error(`Server queue full (max ${MAX_TOTAL_QUEUE_DEPTH}). Try again later.`));
            return;
        }

        queueState.queue.push({
            resolve,
            reject,
            request,
            timestamp: Date.now()
        });
        processSessionQueue(sessionId);
    });
}

// ============================================================================
// HTTP Handlers
// ============================================================================

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
    sendJson(res, status, {
        error: {
            message,
            type: 'api_error',
            code: status
        }
    });
}

async function handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    for await (const chunk of req) {
        body += chunk;
    }

    let request: ChatCompletionRequest;
    try {
        request = JSON.parse(body);
    } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
    }

    if (!request.messages || !Array.isArray(request.messages)) {
        sendError(res, 400, 'Missing or invalid "messages" field');
        return;
    }

    // Validate message content
    const validationError = validateMessages(request.messages);
    if (validationError) {
        sendError(res, 400, validationError);
        return;
    }

    if (request.stream) {
        await handleStreamingChatCompletions(request, res);
        return;
    }

    try {
        const response = await queueRequest(request);
        sendJson(res, 200, response);
    } catch (error) {
        console.error('❌ Request failed:', error);
        sendError(res, 500, (error as Error).message);
    }
}

/**
 * Handles streaming chat completions via Server-Sent Events (SSE).
 * Uses per-session queues to ensure sequential processing per tab.
 */
async function handleStreamingChatCompletions(
    request: ChatCompletionRequest,
    res: http.ServerResponse
): Promise<void> {
    // Set up SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const id = generateId();
    const model = request.model || 'gemini-antigravity';
    const created = Math.floor(Date.now() / 1000);

    // Helper to send SSE chunk
    const sendSSE = (data: ChatCompletionChunk | '[DONE]') => {
        if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
        } else {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };

    try {
        const { registry } = await ensureConnection();
        const handle = await resolveTargetSession(registry, request.session);

        if (!handle) {
            throw new Error('No session available for streaming');
        }

        const sessionId = handle.id;
        const queueState = getSessionQueue(sessionId);

        // Check if session is busy
        if (queueState.isProcessing) {
            sendSSE({
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                    index: 0,
                    delta: { content: `[Session ${sessionId} busy - try again or specify different session]` },
                    finish_reason: 'stop'
                }]
            });
            sendSSE('[DONE]');
            res.end();
            return;
        }

        // Mark session as processing
        queueState.isProcessing = true;

        try {
            const { frame, page } = handle;

            // Extract prompt
            const userMessages = request.messages.filter(m => m.role === 'user');
            if (userMessages.length === 0) {
                throw new Error('No user message found');
            }
            const prompt = userMessages[userMessages.length - 1].content;

            console.log(`📡 [${sessionId}] Streaming request: "${prompt.substring(0, 50)}..."`);

            // Send initial role chunk
            sendSSE({
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                    index: 0,
                    delta: { role: 'assistant' },
                    finish_reason: null
                }]
            });

            // Send prompt (NOT waiting - we'll stream the response)
            await sendPrompt(frame, page, prompt, { wait: false });

            // Stream response via DOM polling
            await streamResponse(frame, (chunk: StreamChunk) => {
                if (chunk.content) {
                    sendSSE({
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model,
                        choices: [{
                            index: 0,
                            delta: { content: chunk.content },
                            finish_reason: chunk.isComplete ? 'stop' : null
                        }]
                    });
                }

                if (chunk.isComplete) {
                    sendSSE('[DONE]');
                }
            });

            res.end();
            console.log(`✅ [${sessionId}] Streaming complete`);
        } finally {
            queueState.isProcessing = false;
            // Process any queued requests for this session
            processSessionQueue(sessionId);
        }
    } catch (error) {
        console.error('❌ Streaming failed:', error);
        sendSSE({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
                index: 0,
                delta: { content: `\n\n[ERROR: ${(error as Error).message}]` },
                finish_reason: 'stop'
            }]
        });
        sendSSE('[DONE]');
        res.end();
    }
}

// Handler for listing sessions
async function handleSessions(res: http.ServerResponse): Promise<void> {
    try {
        console.log('📋 GET /v1/sessions requested');
        const { registry } = await ensureConnection();

        const sessions = registry.list();

        sendJson(res, 200, {
            object: 'list',
            data: sessions.map(s => ({
                id: s.id,
                name: s.metadata.title,
                state: s.state,
                object: 'session',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'antigravity'
            }))
        });
    } catch (error: any) {
        console.error('❌ Failed to list sessions:', error);
        sendError(res, 500, error.message || 'Failed to list sessions');
    }
}

/**
 * Handler for SSE stream of session state changes.
 */
async function handleSessionsStream(res: http.ServerResponse): Promise<void> {
    try {
        const { registry } = await ensureConnection();
        const streamHandler = createSessionEventStream(registry);
        streamHandler(res);
    } catch (error: any) {
        sendError(res, 500, error.message || 'Failed to start session stream');
    }
}

/**
 * Handler for SSE stream of a SINGLE session's events.
 */
async function handleSingleSessionStream(sessionId: string, res: http.ServerResponse): Promise<void> {
    try {
        const { registry } = await ensureConnection();
        const streamHandler = createSingleSessionEventStream(registry, sessionId, {
            includeResponses: true,
            extractResponse: extractFullResponse
        });
        streamHandler(res);
    } catch (error: any) {
        sendError(res, 500, error.message || 'Failed to start session stream');
    }
}

function handleModels(res: http.ServerResponse): void {
    const models: ModelsResponse = {
        object: 'list',
        data: [{
            id: 'gemini-antigravity',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'angrav'
        }]
    };
    sendJson(res, 200, models);
}

function handleModelById(modelId: string, res: http.ServerResponse): void {
    // Our supported model
    if (modelId === 'gemini-antigravity') {
        const model: ModelInfo = {
            id: 'gemini-antigravity',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'angrav'
        };
        sendJson(res, 200, model);
    } else {
        sendError(res, 404, `Model '${modelId}' not found`);
    }
}

function handleHealth(res: http.ServerResponse): void {
    const totalQueueDepth = getTotalQueueDepth();
    const busySessions = Array.from(state.sessionQueues.entries())
        .filter(([_, q]) => q.isProcessing)
        .map(([id, _]) => id);

    sendJson(res, 200, {
        status: 'ok',
        connected: state.appContext !== null,
        sessions: state.registry?.size || 0,
        queue: {
            totalDepth: totalQueueDepth,
            maxTotalDepth: MAX_TOTAL_QUEUE_DEPTH,
            maxPerSession: MAX_QUEUE_DEPTH_PER_SESSION,
            busySessions
        }
    });
}

// ============================================================================
// Server Entry Point
// ============================================================================

export interface ServerOptions {
    port: number;
    host: string;
}

export function startServer(options: ServerOptions): http.Server {
    const { port, host } = options;

    const server = http.createServer(async (req, res) => {
        const url = req.url || '/';
        const method = req.method || 'GET';

        console.log(`${method} ${url}`);

        // CORS preflight
        if (method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end();
            return;
        }

        // Routes
        if (url === '/health' && method === 'GET') {
            handleHealth(res);
        } else if (url === '/v1/models' && method === 'GET') {
            handleModels(res);
        } else if (url === '/v1/sessions' && method === 'GET') {
            await handleSessions(res);
        } else if (url === '/v1/sessions/stream' && method === 'GET') {
            await handleSessionsStream(res);
        } else if (url.match(/^\/v1\/sessions\/[^/]+\/events$/) && method === 'GET') {
            const sessionId = url.split('/')[3];
            await handleSingleSessionStream(sessionId, res);
        } else if (url.startsWith('/v1/models/') && method === 'GET') {
            const modelId = url.replace('/v1/models/', '');
            handleModelById(modelId, res);
        } else if (url === '/v1/chat/completions' && method === 'POST') {
            await handleChatCompletions(req, res);
        } else {
            sendError(res, 404, `Not found: ${url}`);
        }
    });

    server.listen(port, host, () => {
        console.log(`
🚀 Angrav OpenAI-Compatible Server (Multi-Session)
   =================================================
   Listening on: http://${host}:${port}
   
   Endpoints:
   - GET  /health               Health check
   - GET  /v1/models            List models
   - GET  /v1/sessions          List active sessions
   - GET  /v1/sessions/stream   SSE stream of session events
   - POST /v1/chat/completions  Chat completions (supports session targeting)
   
   Usage examples:
   
   # List sessions
   curl http://${host}:${port}/v1/sessions
   
   # Stream session events (SSE)
   curl -N http://${host}:${port}/v1/sessions/stream
   
   # Send chat to specific session
   curl -X POST http://${host}:${port}/v1/chat/completions \\
     -H "Content-Type: application/json" \\
     -d '{"model":"gemini-antigravity","messages":[{"role":"user","content":"Hello!"}],"session":"session-abc"}'
`);
    });

    // Cleanup on shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await flushObservability();
        await shutdownObservability();
        if (state.registry) {
            state.registry.stopPolling();
        }
        if (state.appContext) {
            await state.appContext.browser.close();
        }
        server.close();
        process.exit(0);
    });

    return server;
}
