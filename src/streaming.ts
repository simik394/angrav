import { Frame } from '@playwright/test';
import { getAgentState, AgentState } from './state';

// ============================================================================
// Streaming Types
// ============================================================================

export interface StreamChunk {
    content: string;
    isComplete: boolean;
    state: AgentState;
}

export type StreamCallback = (chunk: StreamChunk) => void;

// ============================================================================
// DOM Polling for Streaming
// ============================================================================

/**
 * Extracts the current partial response text from the agent's UI.
 * This reads the last (currently generating) response element.
 */
async function extractPartialResponse(frame: Frame): Promise<string> {
    try {
        // Get all prose elements (agent responses)
        const proseElements = frame.locator('div.bg-ide-chat-background .prose');
        const count = await proseElements.count();

        if (count === 0) {
            return '';
        }

        // Get the last one (currently generating response)
        const lastProse = proseElements.nth(count - 1);

        // Check if it's visible before extracting
        if (await lastProse.isVisible()) {
            return await lastProse.innerText();
        }

        return '';
    } catch (error) {
        // DOM might be updating, return empty
        return '';
    }
}

/**
 * Streams the agent's response by polling the DOM at regular intervals.
 * Sends delta updates (new text since last poll) to the callback.
 * 
 * Constraints:
 * - Single-threaded: never runs in parallel with other interactions
 * - READ-ONLY: only observes DOM, no clicks/typing during polling
 * - Human-paced: reasonable polling interval (not too aggressive)
 */
export async function streamResponse(
    frame: Frame,
    callback: StreamCallback,
    options: {
        pollIntervalMs?: number;
        timeoutMs?: number;
    } = {}
): Promise<string> {
    const {
        pollIntervalMs = 300, // Poll every 300ms - human-like reading pace
        timeoutMs = 300000    // 5 min max
    } = options;

    let previousContent = '';
    let lastState: AgentState = 'thinking';
    const startTime = Date.now();

    console.log('📡 Starting SSE stream...');

    while (true) {
        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
            callback({
                content: '',
                isComplete: true,
                state: 'error'
            });
            throw new Error('Streaming timeout');
        }

        // Get current state and content
        const stateInfo = await getAgentState(frame);
        const currentContent = await extractPartialResponse(frame);

        // Calculate delta (new content since last poll)
        const delta = currentContent.slice(previousContent.length);

        // Send delta if there's new content
        if (delta.length > 0) {
            callback({
                content: delta,
                isComplete: false,
                state: stateInfo.state
            });
            previousContent = currentContent;
        }

        // Check if generation is complete
        if (stateInfo.state === 'idle' && lastState === 'thinking') {
            // Final chunk with any remaining content
            const finalDelta = currentContent.slice(previousContent.length);
            callback({
                content: finalDelta,
                isComplete: true,
                state: 'idle'
            });
            console.log('✅ SSE stream complete');
            return currentContent;
        }

        // Handle error state
        if (stateInfo.state === 'error') {
            callback({
                content: stateInfo.errorMessage || 'Unknown error',
                isComplete: true,
                state: 'error'
            });
            throw new Error(stateInfo.errorMessage || 'Agent error during streaming');
        }

        lastState = stateInfo.state;

        // Wait before next poll (human-like pacing)
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
}

/**
 * Variant that returns an async generator for easier consumption.
 */
export async function* streamResponseGenerator(
    frame: Frame,
    options: {
        pollIntervalMs?: number;
        timeoutMs?: number;
    } = {}
): AsyncGenerator<StreamChunk> {
    const chunks: StreamChunk[] = [];
    let resolveNext: ((chunk: StreamChunk) => void) | null = null;
    let done = false;

    // Start streaming in background
    const streamPromise = streamResponse(frame, (chunk) => {
        if (resolveNext) {
            resolveNext(chunk);
            resolveNext = null;
        } else {
            chunks.push(chunk);
        }
        if (chunk.isComplete) {
            done = true;
        }
    }, options);

    // Yield chunks as they come
    while (!done) {
        if (chunks.length > 0) {
            yield chunks.shift()!;
        } else {
            yield await new Promise<StreamChunk>(resolve => {
                resolveNext = resolve;
            });
        }
    }

    // Wait for stream to fully complete
    await streamPromise;
}
