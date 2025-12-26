/**
 * Langfuse Observability Module for Angrav
 * 
 * Provides comprehensive LLM tracing for the OpenAI-compatible API.
 * Tracks: prompts, responses, latency, token usage, errors.
 */

import { Langfuse, LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse';

// ============================================================================
// Configuration
// ============================================================================

interface ObservabilityConfig {
    enabled: boolean;
    publicKey?: string;
    secretKey?: string;
    baseUrl?: string;
    debug?: boolean;
}

function getConfig(): ObservabilityConfig {
    return {
        enabled: !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY),
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_URL || 'https://cloud.langfuse.com',
        debug: process.env.LANGFUSE_DEBUG === 'true'
    };
}

// ============================================================================
// Singleton Langfuse Client
// ============================================================================

let langfuseClient: Langfuse | null = null;

function getLangfuse(): Langfuse | null {
    const config = getConfig();

    if (!config.enabled) {
        return null;
    }

    if (!langfuseClient) {
        langfuseClient = new Langfuse({
            publicKey: config.publicKey!,
            secretKey: config.secretKey!,
            baseUrl: config.baseUrl
        });
        console.log('[Observability] Langfuse client initialized');
    }

    return langfuseClient;
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count from text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// ============================================================================
// Trace Context
// ============================================================================

export interface TraceContext {
    trace: LangfuseTraceClient;
    generation?: LangfuseGenerationClient;
    startTime: number;
}

export interface ChatRequest {
    model: string;
    messages: Array<{ role: string; content: string }>;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start a trace for a chat completion request
 */
export function startChatCompletionTrace(
    request: ChatRequest,
    metadata?: Record<string, any>
): TraceContext | null {
    const langfuse = getLangfuse();
    if (!langfuse) return null;

    const trace = langfuse.trace({
        name: 'chat-completion',
        input: request.messages,
        metadata: {
            model: request.model,
            streaming: !!request.stream,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            ...metadata
        },
        tags: [
            'angrav',
            request.model,
            request.stream ? 'streaming' : 'sync'
        ]
    });

    // Calculate prompt tokens
    const promptText = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const promptTokens = estimateTokens(promptText);

    const generation = trace.generation({
        name: 'llm-response',
        model: request.model,
        input: promptText,
        usage: {
            promptTokens
        }
    });

    return {
        trace,
        generation,
        startTime: Date.now()
    };
}

/**
 * Complete a successful trace
 */
export function completeChatCompletionTrace(
    ctx: TraceContext | null,
    response: string,
    finishReason: 'stop' | 'length' | 'error' = 'stop'
): void {
    if (!ctx) return;

    const latencyMs = Date.now() - ctx.startTime;
    const completionTokens = estimateTokens(response);

    ctx.generation?.end({
        output: response,
        usage: {
            completionTokens,
            totalTokens: completionTokens // prompt tokens already set
        },
        completionStartTime: new Date(ctx.startTime),
        level: finishReason === 'error' ? 'ERROR' : 'DEFAULT'
    });

    ctx.trace.update({
        output: response.substring(0, 500), // Truncate for display
        metadata: {
            latencyMs,
            completionTokens,
            finishReason
        }
    });
}

/**
 * Complete trace with error
 */
export function failChatCompletionTrace(
    ctx: TraceContext | null,
    error: Error | string
): void {
    if (!ctx) return;

    const errorMessage = error instanceof Error ? error.message : error;
    const latencyMs = Date.now() - ctx.startTime;

    ctx.generation?.end({
        output: null,
        level: 'ERROR',
        statusMessage: errorMessage
    });

    ctx.trace.update({
        output: null,
        metadata: {
            latencyMs,
            error: errorMessage,
            finishReason: 'error'
        }
    });
}

/**
 * Track streaming chunk (for detailed streaming analysis)
 */
export function trackStreamingChunk(
    ctx: TraceContext | null,
    chunkContent: string,
    chunkIndex: number
): void {
    if (!ctx || !chunkContent) return;

    // Add span for chunk batches (every 10 chunks to avoid spam)
    if (chunkIndex % 10 === 0 && chunkIndex > 0) {
        ctx.trace.span({
            name: `streaming-batch-${Math.floor(chunkIndex / 10)}`,
            metadata: {
                chunkIndex,
                elapsedMs: Date.now() - ctx.startTime
            }
        });
    }
}

/**
 * Track health/status endpoint calls
 */
export function trackHealthCheck(endpoint: string): void {
    const langfuse = getLangfuse();
    if (!langfuse) return;

    langfuse.trace({
        name: 'health-check',
        metadata: { endpoint },
        tags: ['angrav', 'health']
    });
}

/**
 * Flush pending events (call on shutdown)
 */
export async function flushObservability(): Promise<void> {
    if (langfuseClient) {
        await langfuseClient.flushAsync();
        console.log('[Observability] Flushed pending events');
    }
}

/**
 * Shutdown observability (call on process exit)
 */
export async function shutdownObservability(): Promise<void> {
    if (langfuseClient) {
        await langfuseClient.shutdownAsync();
        langfuseClient = null;
        console.log('[Observability] Shutdown complete');
    }
}

/**
 * Check if observability is enabled
 */
export function isObservabilityEnabled(): boolean {
    return getConfig().enabled;
}
