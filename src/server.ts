import * as http from 'http';
import { connectToApp, getAgentFrame, AppContext } from './core';
import { sendPrompt } from './prompt';
import { waitForIdle } from './state';
import { extractResponse, AgentResponse } from './extraction';
import { streamResponse, StreamChunk } from './streaming';
import { Frame, Page } from '@playwright/test';
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
// Server State
// ============================================================================

interface ServerState {
    appContext: AppContext | null;
    frame: Frame | null;
    page: Page | null;
    isProcessing: boolean;
    requestQueue: Array<{
        resolve: (response: ChatCompletionResponse) => void;
        reject: (error: Error) => void;
        request: ChatCompletionRequest;
        timestamp: number; // When request was queued
    }>;
}

// Queue configuration
const MAX_QUEUE_DEPTH = 10;
const QUEUE_TIMEOUT_MS = 120000; // 2 minutes

const state: ServerState = {
    appContext: null,
    frame: null,
    page: null,
    isProcessing: false,
    requestQueue: []
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

    // Must have at least one user message
    const hasUserMessage = messages.some(m => m.role === 'user');
    if (!hasUserMessage) {
        return 'At least one user message is required';
    }

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        // Check role exists and is valid
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

    return null; // Valid
}

async function ensureConnection(): Promise<{ frame: Frame; page: Page }> {
    if (!state.appContext || !state.frame || !state.page) {
        console.log('🔌 Establishing CDP connection...');
        state.appContext = await connectToApp();
        state.page = state.appContext.page;
        state.frame = await getAgentFrame(state.page);
        console.log('✅ Connected to Antigravity');
    }
    return { frame: state.frame, page: state.page };
}

async function processRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { frame, page } = await ensureConnection();

    // Start observability trace
    const traceCtx = startChatCompletionTrace(request);

    // Format full conversation for multi-turn context
    const prompt = formatConversation(request.messages);

    console.log(`📨 Processing: "${prompt.substring(0, 50)}..."`);

    try {
        // Send prompt and wait for response
        await sendPrompt(frame, page, prompt, { wait: true, timeout: 300000 }); // 5 min timeout

        // Extract response
        const agentResponse = await extractResponse(frame);

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
            }
        };

        return response;
    } catch (error) {
        failChatCompletionTrace(traceCtx, error as Error);
        throw error;
    }
}

async function processQueue(): Promise<void> {
    if (state.isProcessing || state.requestQueue.length === 0) {
        return;
    }

    state.isProcessing = true;
    const item = state.requestQueue.shift()!;

    try {
        const response = await processRequest(item.request);
        item.resolve(response);
    } catch (error) {
        item.reject(error as Error);
    } finally {
        state.isProcessing = false;
        // Process next in queue
        processQueue();
    }
}

function queueRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return new Promise((resolve, reject) => {
        // Check queue depth limit
        if (state.requestQueue.length >= MAX_QUEUE_DEPTH) {
            reject(new Error(`Queue full (max ${MAX_QUEUE_DEPTH} requests). Try again later.`));
            return;
        }

        state.requestQueue.push({
            resolve,
            reject,
            request,
            timestamp: Date.now()
        });
        processQueue();
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
 * IMPORTANT: Uses queue to ensure sequential processing (human-like behavior).
 * Only ONE interaction at a time - reading DOM is passive/read-only.
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

    // Queue this streaming request (still sequential!)
    return new Promise((resolve, reject) => {
        const processStreaming = async () => {
            try {
                const { frame, page } = await ensureConnection();

                // Extract prompt
                const userMessages = request.messages.filter(m => m.role === 'user');
                if (userMessages.length === 0) {
                    throw new Error('No user message found');
                }
                const prompt = userMessages[userMessages.length - 1].content;

                console.log(`📡 Streaming request: "${prompt.substring(0, 50)}..."`);

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
                console.log('✅ Streaming complete');
                resolve();
            } catch (error) {
                console.error('❌ Streaming failed:', error);
                // Send error as final chunk
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
                // Resolve (not reject) since we already sent the error via SSE
                resolve();
            }
        };

        // Add to queue for sequential processing
        state.requestQueue.push({
            resolve: () => { /* handled above */ },
            reject: () => { /* handled above */ },
            request,
            timestamp: Date.now()
        });

        // Check if we can process immediately
        if (!state.isProcessing) {
            state.isProcessing = true;
            state.requestQueue.pop(); // Remove from queue, we're handling it
            processStreaming().finally(() => {
                state.isProcessing = false;
                processQueue(); // Process next in queue
            });
        } else {
            // Wait in queue - will be processed when current finishes
            // Note: This simplified queue doesn't fully support streaming queuing
            // For now, reject if busy
            state.requestQueue.pop();
            sendSSE({
                id,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                    index: 0,
                    delta: { content: '[Server busy - try again]' },
                    finish_reason: 'stop'
                }]
            });
            sendSSE('[DONE]');
            res.end();
            resolve();
        }
    });
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
    sendJson(res, 200, {
        status: 'ok',
        connected: state.appContext !== null,
        queue: {
            length: state.requestQueue.length,
            maxDepth: MAX_QUEUE_DEPTH,
            isProcessing: state.isProcessing
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
🚀 Angrav OpenAI-Compatible Server
   ================================
   Listening on: http://${host}:${port}
   
   Endpoints:
   - GET  /health              Health check
   - GET  /v1/models           List models
   - POST /v1/chat/completions Chat completions
   
   Usage example:
   curl -X POST http://${host}:${port}/v1/chat/completions \\
     -H "Content-Type: application/json" \\
     -d '{"model":"gemini-antigravity","messages":[{"role":"user","content":"Hello!"}]}'
`);
    });

    // Cleanup on shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await flushObservability();
        await shutdownObservability();
        if (state.appContext) {
            await state.appContext.browser.close();
        }
        server.close();
        process.exit(0);
    });

    return server;
}
