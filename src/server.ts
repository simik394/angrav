import * as http from 'http';
import { connectToApp, getAgentFrame, AppContext } from './core';
import { sendPrompt } from './prompt';
import { waitForIdle } from './state';
import { extractResponse, AgentResponse } from './extraction';
import { Frame, Page } from '@playwright/test';

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
    }>;
}

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

    // Extract the last user message
    const userMessages = request.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
        throw new Error('No user message found in request');
    }
    const prompt = userMessages[userMessages.length - 1].content;

    console.log(`📨 Processing: "${prompt.substring(0, 50)}..."`);

    // Send prompt and wait for response
    await sendPrompt(frame, page, prompt, { wait: true, timeout: 300000 }); // 5 min timeout

    // Extract response
    const agentResponse = await extractResponse(frame);

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
            prompt_tokens: 0, // Not available from Antigravity
            completion_tokens: 0,
            total_tokens: 0
        }
    };

    console.log(`✅ Response ready (${agentResponse.fullText.length} chars)`);
    return response;
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
        state.requestQueue.push({ resolve, reject, request });
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

    if (request.stream) {
        sendError(res, 501, 'Streaming is not supported yet');
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

function handleHealth(res: http.ServerResponse): void {
    sendJson(res, 200, {
        status: 'ok',
        connected: state.appContext !== null,
        queueLength: state.requestQueue.length,
        isProcessing: state.isProcessing
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
        if (state.appContext) {
            await state.appContext.browser.close();
        }
        server.close();
        process.exit(0);
    });

    return server;
}
