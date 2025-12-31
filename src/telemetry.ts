/**
 * Session-Level Langfuse Telemetry for Angrav Agent
 * 
 * Provides tracing for agent session operations:
 * - Session lifecycle (start/end)
 * - Prompt submission
 * - Thinking/reasoning steps
 * - Code extraction
 * - Errors
 * 
 * Complements observability.ts which handles chat completions API.
 */

import * as dotenv from 'dotenv';
dotenv.config(); // Load .env file

import { Langfuse, LangfuseTraceClient, LangfuseSpanClient } from 'langfuse';

// ============================================================================
// Types
// ============================================================================

export interface TelemetryConfig {
    enabled: boolean;
    publicKey?: string;
    secretKey?: string;
    host?: string;
    debug?: boolean;
}

export interface SessionTrace {
    trace: LangfuseTraceClient;
    sessionId: string;
    startTime: number;
    currentSpan?: LangfuseSpanClient;
}

export interface CodeBlock {
    language: string;
    content: string;
}

// ============================================================================
// Configuration
// ============================================================================

function getConfig(): TelemetryConfig {
    const enabled = process.env.LANGFUSE_ENABLED !== 'false' &&
        !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

    return {
        enabled,
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        host: process.env.LANGFUSE_HOST || process.env.LANGFUSE_URL || 'https://cloud.langfuse.com',
        debug: process.env.LANGFUSE_DEBUG === 'true'
    };
}

// ============================================================================
// AgentTelemetry Class
// ============================================================================

export class AgentTelemetry {
    private langfuse: Langfuse | null = null;
    private config: TelemetryConfig;
    private activeTraces: Map<string, SessionTrace> = new Map();

    constructor(config?: Partial<TelemetryConfig>) {
        this.config = { ...getConfig(), ...config };

        if (this.config.enabled && this.config.publicKey && this.config.secretKey) {
            this.langfuse = new Langfuse({
                publicKey: this.config.publicKey,
                secretKey: this.config.secretKey,
                baseUrl: this.config.host
            });

            if (this.config.debug) {
                console.log('[Telemetry] Langfuse client initialized');
            }
        }
    }

    /**
     * Check if telemetry is enabled
     */
    isEnabled(): boolean {
        return this.langfuse !== null;
    }

    /**
     * Start a new session trace
     */
    startSession(sessionId: string, metadata?: Record<string, any>): SessionTrace | null {
        if (!this.langfuse) return null;

        const trace = this.langfuse.trace({
            name: 'agent-session',
            sessionId,
            metadata: {
                sessionId,
                startedAt: new Date().toISOString(),
                ...metadata
            },
            tags: ['angrav', 'session']
        });

        const sessionTrace: SessionTrace = {
            trace,
            sessionId,
            startTime: Date.now()
        };

        this.activeTraces.set(sessionId, sessionTrace);

        if (this.config.debug) {
            console.log(`[Telemetry] Started session trace: ${sessionId}`);
        }

        return sessionTrace;
    }

    /**
     * Track prompt submission
     */
    trackPromptSubmission(
        traceOrSessionId: SessionTrace | string,
        prompt: string,
        context?: { files?: string[]; model?: string }
    ): void {
        const trace = this.getTrace(traceOrSessionId);
        if (!trace) return;

        const span = trace.trace.span({
            name: 'prompt-submission',
            input: prompt.substring(0, 1000), // Truncate for storage
            metadata: {
                promptLength: prompt.length,
                hasContext: !!context?.files?.length,
                contextFiles: context?.files,
                model: context?.model
            }
        });

        trace.currentSpan = span;

        if (this.config.debug) {
            console.log(`[Telemetry] Tracked prompt submission (${prompt.length} chars)`);
        }
    }

    /**
     * Track thinking/reasoning step
     */
    trackThinking(
        traceOrSessionId: SessionTrace | string,
        thinkingContent: string,
        stepIndex?: number
    ): void {
        const trace = this.getTrace(traceOrSessionId);
        if (!trace) return;

        trace.trace.span({
            name: 'thinking',
            input: thinkingContent.substring(0, 500),
            metadata: {
                stepIndex,
                contentLength: thinkingContent.length
            }
        });

        if (this.config.debug) {
            console.log(`[Telemetry] Tracked thinking step ${stepIndex ?? ''}`);
        }
    }

    /**
     * Track code block extraction
     */
    trackExtraction(
        traceOrSessionId: SessionTrace | string,
        blocks: CodeBlock[]
    ): void {
        const trace = this.getTrace(traceOrSessionId);
        if (!trace) return;

        const languages = [...new Set(blocks.map(b => b.language))];
        const totalChars = blocks.reduce((sum, b) => sum + b.content.length, 0);

        trace.trace.span({
            name: 'code-extraction',
            output: `Extracted ${blocks.length} blocks`,
            metadata: {
                blockCount: blocks.length,
                languages,
                totalChars
            }
        });

        if (this.config.debug) {
            console.log(`[Telemetry] Tracked extraction: ${blocks.length} blocks`);
        }
    }

    /**
     * Track model switch
     */
    trackModelSwitch(
        traceOrSessionId: SessionTrace | string,
        previousModel: string,
        newModel: string
    ): void {
        const trace = this.getTrace(traceOrSessionId);
        if (!trace) return;

        trace.trace.event({
            name: 'model-switch',
            metadata: {
                previousModel,
                newModel,
                timestamp: new Date().toISOString()
            }
        });

        if (this.config.debug) {
            console.log(`[Telemetry] Model switched: ${previousModel} -> ${newModel}`);
        }
    }

    /**
     * Track error
     */
    trackError(
        traceOrSessionId: SessionTrace | string,
        error: Error | string,
        context?: Record<string, any>
    ): void {
        const trace = this.getTrace(traceOrSessionId);
        if (!trace) return;

        const errorMessage = error instanceof Error ? error.message : error;
        const errorStack = error instanceof Error ? error.stack : undefined;

        trace.trace.event({
            name: 'error',
            level: 'ERROR',
            metadata: {
                message: errorMessage,
                stack: errorStack,
                ...context
            }
        });

        if (this.config.debug) {
            console.log(`[Telemetry] Tracked error: ${errorMessage}`);
        }
    }

    /**
     * End a session trace
     */
    endSession(
        traceOrSessionId: SessionTrace | string,
        output?: string,
        success: boolean = true
    ): void {
        const trace = this.getTrace(traceOrSessionId);
        if (!trace) return;

        const duration = Date.now() - trace.startTime;

        trace.trace.update({
            output: output?.substring(0, 500),
            metadata: {
                durationMs: duration,
                success
            }
        });

        // Clean up
        this.activeTraces.delete(trace.sessionId);

        if (this.config.debug) {
            console.log(`[Telemetry] Ended session: ${trace.sessionId} (${duration}ms)`);
        }
    }

    /**
     * Flush pending events
     */
    async flush(): Promise<void> {
        if (this.langfuse) {
            await this.langfuse.flushAsync();
            if (this.config.debug) {
                console.log('[Telemetry] Flushed pending events');
            }
        }
    }

    /**
     * Shutdown telemetry
     */
    async shutdown(): Promise<void> {
        if (this.langfuse) {
            await this.langfuse.shutdownAsync();
            this.langfuse = null;
            if (this.config.debug) {
                console.log('[Telemetry] Shutdown complete');
            }
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private getTrace(traceOrSessionId: SessionTrace | string): SessionTrace | null {
        if (typeof traceOrSessionId === 'string') {
            return this.activeTraces.get(traceOrSessionId) || null;
        }
        return traceOrSessionId;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let telemetryInstance: AgentTelemetry | null = null;

/**
 * Get or create the global telemetry instance
 */
export function getTelemetry(config?: Partial<TelemetryConfig>): AgentTelemetry {
    if (!telemetryInstance) {
        telemetryInstance = new AgentTelemetry(config);
    }
    return telemetryInstance;
}

/**
 * Disable telemetry (for --no-telemetry flag)
 */
export function disableTelemetry(): void {
    if (telemetryInstance) {
        telemetryInstance.shutdown();
    }
    telemetryInstance = new AgentTelemetry({ enabled: false });
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
    return getTelemetry().isEnabled();
}
