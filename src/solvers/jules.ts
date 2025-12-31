/**
 * Jules Solver Adapter
 * 
 * Integrates with Google's Jules AI coding agent via REST API.
 * 
 * API Reference: https://jules.google/docs/api/reference/
 * 
 * Configuration:
 *   JULES_API_KEY - Required API key from jules.google.com settings
 *   JULES_DEFAULT_SOURCE - Default GitHub repo (e.g., "sources/github/owner/repo")
 */

import { getJulesTelemetry } from '@agents/shared';

// Get telemetry instance
const telemetry = getJulesTelemetry();

// API Configuration
const JULES_API_BASE = 'https://jules.googleapis.com/v1alpha';
const JULES_API_KEY = process.env.JULES_API_KEY || '';

// Types
export interface JulesSource {
    name: string;      // e.g., "sources/github/owner/repo"
    id: string;        // e.g., "github/owner/repo"
    githubRepo?: {
        owner: string;
        repo: string;
    };
}

export interface JulesSession {
    name: string;      // e.g., "sessions/123456"
    id: string;
    title: string;
    prompt: string;
    sourceContext: {
        source: string;
        githubRepoContext?: {
            startingBranch: string;
        };
    };
    outputs?: JulesOutput[];
    state?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

export interface JulesOutput {
    pullRequest?: {
        url: string;
        title: string;
        description: string;
    };
}

export interface JulesActivity {
    name: string;
    type: string;
    content?: string;
    createTime: string;
}

export interface CreateSessionRequest {
    prompt: string;
    sourceContext: {
        source: string;
        githubRepoContext?: {
            startingBranch: string;
        };
    };
    automationMode?: 'AUTO_CREATE_PR' | 'MANUAL';
    title?: string;
    requirePlanApproval?: boolean;
}

// ============================================================================
// API Client
// ============================================================================

async function julesRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    if (!JULES_API_KEY) {
        throw new Error('JULES_API_KEY environment variable not set');
    }

    const url = `${JULES_API_BASE}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': JULES_API_KEY,
            ...options.headers
        }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jules API error: ${response.status} - ${error}`);
    }

    return response.json() as T;
}

// ============================================================================
// Source Management
// ============================================================================

/**
 * List available sources (connected GitHub repos)
 */
export async function listSources(): Promise<JulesSource[]> {
    const response = await julesRequest<{ sources: JulesSource[]; nextPageToken?: string }>('/sources');
    return response.sources || [];
}

/**
 * Get source by owner/repo
 */
export async function getSource(owner: string, repo: string): Promise<JulesSource | null> {
    const sources = await listSources();
    return sources.find(s =>
        s.githubRepo?.owner === owner && s.githubRepo?.repo === repo
    ) || null;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new Jules session
 */
export async function createSession(
    prompt: string,
    source: string,
    options: {
        branch?: string;
        title?: string;
        autoCreatePR?: boolean;
        requirePlanApproval?: boolean;
    } = {}
): Promise<JulesSession> {
    const request: CreateSessionRequest = {
        prompt,
        sourceContext: {
            source,
            githubRepoContext: {
                startingBranch: options.branch || 'main'
            }
        },
        automationMode: options.autoCreatePR ? 'AUTO_CREATE_PR' : 'MANUAL',
        title: options.title || prompt.substring(0, 50),
        requirePlanApproval: options.requirePlanApproval ?? false
    };

    console.log(`🚀 Creating Jules session: "${prompt.substring(0, 50)}..."`);

    return julesRequest<JulesSession>('/sessions', {
        method: 'POST',
        body: JSON.stringify(request)
    });
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<JulesSession> {
    return julesRequest<JulesSession>(`/sessions/${sessionId}`);
}

/**
 * List recent sessions
 */
export async function listSessions(pageSize: number = 10): Promise<JulesSession[]> {
    const response = await julesRequest<{ sessions: JulesSession[] }>(
        `/sessions?pageSize=${pageSize}`
    );
    return response.sessions || [];
}

/**
 * Approve a plan (if requirePlanApproval was true)
 */
export async function approvePlan(sessionId: string): Promise<void> {
    await julesRequest(`/sessions/${sessionId}:approvePlan`, {
        method: 'POST'
    });
    console.log(`✅ Approved plan for session ${sessionId}`);
}

/**
 * Send a follow-up message to a session
 */
export async function sendMessage(sessionId: string, message: string): Promise<void> {
    await julesRequest(`/sessions/${sessionId}:sendMessage`, {
        method: 'POST',
        body: JSON.stringify({ prompt: message })
    });
    console.log(`💬 Sent message to session ${sessionId}`);
}

// ============================================================================
// Activity Management
// ============================================================================

/**
 * List activities in a session
 */
export async function listActivities(
    sessionId: string,
    pageSize: number = 30
): Promise<JulesActivity[]> {
    const response = await julesRequest<{ activities: JulesActivity[] }>(
        `/sessions/${sessionId}/activities?pageSize=${pageSize}`
    );
    return response.activities || [];
}

/**
 * Get the latest agent response from a session
 */
export async function getLatestResponse(sessionId: string): Promise<string | null> {
    const activities = await listActivities(sessionId);

    // Find the latest agent activity with content
    for (const activity of activities.reverse()) {
        if (activity.type === 'AGENT_MESSAGE' && activity.content) {
            return activity.content;
        }
    }

    return null;
}

// ============================================================================
// Concurrent Session Management (Jules supports 15 concurrent sessions)
// ============================================================================

const MAX_CONCURRENT_SESSIONS = 15;

/**
 * Get count of active (non-completed) sessions
 */
export async function getActiveSessionCount(): Promise<number> {
    const sessions = await listSessions(50);
    return sessions.filter(s =>
        s.state !== 'COMPLETED' && s.state !== 'FAILED'
    ).length;
}

/**
 * Check if we have capacity for new sessions
 */
export async function hasCapacity(): Promise<boolean> {
    const active = await getActiveSessionCount();
    return active < MAX_CONCURRENT_SESSIONS;
}

/**
 * Get overview of all active sessions
 */
export async function getSessionOverview(): Promise<{
    total: number;
    active: number;
    available: number;
    sessions: Array<{
        id: string;
        title: string;
        state: string;
        repo: string;
        hasPR: boolean;
    }>;
}> {
    const sessions = await listSessions(50);

    const active = sessions.filter(s =>
        s.state !== 'COMPLETED' && s.state !== 'FAILED'
    );

    return {
        total: sessions.length,
        active: active.length,
        available: MAX_CONCURRENT_SESSIONS - active.length,
        sessions: sessions.map(s => ({
            id: s.id,
            title: s.title,
            state: s.state || 'unknown',
            repo: s.sourceContext?.source?.replace('sources/github/', '') || 'unknown',
            hasPR: !!s.outputs?.[0]?.pullRequest
        }))
    };
}

// ============================================================================
// High-Level Solver Interface
// ============================================================================

export interface JulesTaskResult {
    success: boolean;
    sessionId: string;
    sessionUrl: string;
    response?: string;
    pullRequestUrl?: string;
    error?: string;
}

/**
 * Execute a task with Jules (high-level)
 * 
 * Creates a session, waits for completion, returns result.
 */
export async function executeTask(
    prompt: string,
    options: {
        owner: string;
        repo: string;
        branch?: string;
        autoCreatePR?: boolean;
        pollIntervalMs?: number;
        timeoutMs?: number;
    }
): Promise<JulesTaskResult> {
    const { owner, repo, branch = 'main', autoCreatePR = false } = options;
    const pollInterval = options.pollIntervalMs || 10000; // 10s default
    const timeout = options.timeoutMs || 600000; // 10 min default

    // Start trace for Jules task
    const trace = telemetry.startTrace('jules:execute-task', {
        prompt: prompt.substring(0, 100),
        repo: `${owner}/${repo}`,
        branch,
        autoCreatePR
    });

    try {
        // Find source
        const sourceSpan = telemetry.startToolSpan(trace, 'find-source', { owner, repo });
        const source = await getSource(owner, repo);
        telemetry.endSpan(sourceSpan, source ? 'Found' : 'Not found', !!source);

        if (!source) {
            telemetry.trackError(trace, `Source not found: ${owner}/${repo}`);
            telemetry.endTrace(trace, 'Source not found', false);
            return {
                success: false,
                sessionId: '',
                sessionUrl: '',
                error: `Source not found: ${owner}/${repo}. Connect it at jules.google.com first.`
            };
        }

        // Create session
        const createSpan = telemetry.startToolSpan(trace, 'create-session', {
            source: source.name,
            branch
        });
        const session = await createSession(prompt, source.name, {
            branch,
            autoCreatePR,
            requirePlanApproval: false
        });
        telemetry.endSpan(createSpan, { sessionId: session.id });

        const sessionUrl = `https://jules.google.com/sessions/${session.id}`;
        console.log(`📋 Session created: ${sessionUrl}`);

        // Poll for completion
        const pollSpan = telemetry.startToolSpan(trace, 'poll-completion', { sessionId: session.id });
        const startTime = Date.now();
        let pollCount = 0;

        while (Date.now() - startTime < timeout) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            pollCount++;

            const updated = await getSession(session.id);

            if (updated.state === 'COMPLETED') {
                const response = await getLatestResponse(session.id);
                const prUrl = updated.outputs?.[0]?.pullRequest?.url;

                telemetry.endSpan(pollSpan, { state: 'COMPLETED', pollCount });

                // Track success score
                telemetry.addScore(trace, 'success', 1, 'Task completed successfully');
                telemetry.endTrace(trace, response?.substring(0, 200) || 'Completed', true);

                return {
                    success: true,
                    sessionId: session.id,
                    sessionUrl,
                    response: response || 'Task completed',
                    pullRequestUrl: prUrl
                };
            }

            if (updated.state === 'FAILED') {
                telemetry.endSpan(pollSpan, { state: 'FAILED', pollCount });
                telemetry.addScore(trace, 'success', 0, 'Session failed');
                telemetry.endTrace(trace, 'Session failed', false);

                return {
                    success: false,
                    sessionId: session.id,
                    sessionUrl,
                    error: 'Session failed'
                };
            }

            console.log(`⏳ Polling session ${session.id}... (state: ${updated.state || 'unknown'})`);
        }

        // Timeout
        telemetry.endSpan(pollSpan, { state: 'TIMEOUT', pollCount });
        telemetry.addScore(trace, 'success', 0, 'Timeout');
        telemetry.endTrace(trace, `Timeout after ${timeout}ms`, false);

        return {
            success: false,
            sessionId: session.id,
            sessionUrl,
            error: `Timeout after ${timeout}ms`
        };

    } catch (error) {
        telemetry.trackError(trace, error as Error);
        telemetry.endTrace(trace, undefined, false);

        return {
            success: false,
            sessionId: '',
            sessionUrl: '',
            error: String(error)
        };
    }
}

// ============================================================================
// Windmill Entrypoint
// ============================================================================

/**
 * Windmill-compatible entrypoint for Jules solver
 */
export async function main(
    prompt: string,
    github_owner: string,
    github_repo: string,
    branch: string = 'main',
    auto_create_pr: boolean = false,
    timeout_minutes: number = 10
): Promise<JulesTaskResult> {
    console.log(`\n🤖 Jules Solver: ${prompt.substring(0, 50)}...`);
    console.log(`   Repo: ${github_owner}/${github_repo}`);
    console.log(`   Branch: ${branch}`);
    console.log(`   Auto PR: ${auto_create_pr}`);

    return executeTask(prompt, {
        owner: github_owner,
        repo: github_repo,
        branch,
        autoCreatePR: auto_create_pr,
        timeoutMs: timeout_minutes * 60000
    });
}
