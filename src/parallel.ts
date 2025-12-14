import { SessionRegistry, SessionId } from './registry';
import { sendPrompt } from './prompt';
import { extractResponse, AgentResponse } from './extraction';
import { waitForAll, waitForAny, SessionCompletionResult } from './multi-session';

/**
 * A task to execute on a specific session.
 */
export interface ParallelTask {
    sessionId: SessionId;
    prompt: string;
}

/**
 * Result of a parallel task execution.
 */
export interface ParallelResult {
    sessionId: SessionId;
    success: boolean;
    response?: AgentResponse;
    error?: string;
    duration: number;
}

/**
 * Options for parallel execution.
 */
export interface ParallelOptions {
    timeout?: number;
    strategy?: 'any' | 'all';
}

/**
 * Sends prompts to multiple sessions and waits for completion.
 * @param registry - Session registry with discovered sessions
 * @param tasks - Array of tasks to execute
 * @param options - Execution options
 */
export async function executeParallel(
    registry: SessionRegistry,
    tasks: ParallelTask[],
    options: ParallelOptions = {}
): Promise<ParallelResult[]> {
    const strategy = options.strategy ?? 'all';

    console.log(`🚀 Executing ${tasks.length} tasks in parallel (strategy: ${strategy})...`);

    // Phase 1: Send all prompts concurrently
    const sendResults = await Promise.allSettled(
        tasks.map(async ({ sessionId, prompt }) => {
            const handle = registry.get(sessionId);
            if (!handle) {
                throw new Error(`Session ${sessionId} not found`);
            }
            console.log(`  📤 Sending prompt to ${sessionId}...`);
            await sendPrompt(handle.frame, handle.page, prompt, { wait: false });
            return sessionId;
        })
    );

    // Check for send failures
    const failedSends: ParallelResult[] = [];
    for (let i = 0; i < sendResults.length; i++) {
        const result = sendResults[i];
        if (result.status === 'rejected') {
            failedSends.push({
                sessionId: tasks[i].sessionId,
                success: false,
                error: result.reason?.message || 'Failed to send prompt',
                duration: 0
            });
        }
    }

    // Phase 2: Wait for completion based on strategy
    let completions: SessionCompletionResult[] = [];

    try {
        if (strategy === 'all') {
            completions = await waitForAll(registry, {
                timeout: options.timeout,
                extractResponse: true
            });
        } else {
            const first = await waitForAny(registry, {
                timeout: options.timeout,
                extractResponse: true
            });
            completions = [first];
        }
    } catch (e) {
        console.error(`❌ Wait failed: ${(e as Error).message}`);
        // Return partial results with errors
        return [
            ...failedSends,
            ...tasks
                .filter(t => !failedSends.some(f => f.sessionId === t.sessionId))
                .map(t => ({
                    sessionId: t.sessionId,
                    success: false,
                    error: (e as Error).message,
                    duration: 0
                }))
        ];
    }

    // Combine results
    const results: ParallelResult[] = [
        ...failedSends,
        ...completions.map(c => ({
            sessionId: c.sessionId,
            success: true,
            response: c.response,
            duration: c.duration
        }))
    ];

    console.log(`✅ Parallel execution complete: ${completions.length} succeeded, ${failedSends.length} failed`);
    return results;
}

/**
 * Runs the same prompt on all sessions (fan-out pattern).
 * @param registry - Session registry with discovered sessions
 * @param prompt - Prompt to send to all sessions
 * @param options - Execution options
 */
export async function fanOut(
    registry: SessionRegistry,
    prompt: string,
    options: Omit<ParallelOptions, 'strategy'> = {}
): Promise<ParallelResult[]> {
    const sessions = registry.list();
    console.log(`📡 Fan-out: sending prompt to ${sessions.length} sessions...`);

    const tasks = sessions.map(s => ({
        sessionId: s.id,
        prompt
    }));

    return executeParallel(registry, tasks, { ...options, strategy: 'all' });
}

/**
 * Race multiple sessions - returns first to complete.
 * @param registry - Session registry with discovered sessions
 * @param prompt - Prompt to send to all sessions
 * @param options - Execution options
 */
export async function race(
    registry: SessionRegistry,
    prompt: string,
    options: Omit<ParallelOptions, 'strategy'> = {}
): Promise<ParallelResult> {
    const sessions = registry.list();
    console.log(`🏁 Racing ${sessions.length} sessions...`);

    const tasks = sessions.map(s => ({
        sessionId: s.id,
        prompt
    }));

    const results = await executeParallel(registry, tasks, { ...options, strategy: 'any' });
    return results[0];
}
