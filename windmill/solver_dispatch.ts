/**
 * Windmill Flow: Solver Dispatch
 * 
 * Takes a YouTrack issue (via webhook or manual trigger) and:
 * 1. Parses task requirements
 * 2. Checks rate limits in Redis
 * 3. Selects appropriate solver
 * 4. Dispatches to solver
 * 5. Updates YouTrack with result
 * 
 * Uses tags for solver hints: #angrav, #jules, #gemini, #perplexity, #slm
 */

import Redis from 'ioredis';

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const ANGRAV_SERVER = process.env.ANGRAV_SERVER || 'http://localhost:3333';
const YOUTRACK_BASE = process.env.YOUTRACK_BASE || 'https://youtrack.example.com';

// Solver configuration
interface SolverConfig {
    name: string;
    tag: string;           // YouTrack tag to match
    endpoint: string;      // API endpoint
    account: string;       // For rate limit tracking
    priority: number;      // Lower = higher priority
    capabilities: string[]; // Task types this solver handles well
}

const SOLVERS: SolverConfig[] = [
    {
        name: 'angrav-claude',
        tag: 'angrav',
        endpoint: `${ANGRAV_SERVER}/v1/chat/completions`,
        account: 'user@google.com',
        priority: 1,
        capabilities: ['code', 'implementation', 'debugging', 'refactoring']
    },
    {
        name: 'angrav-gemini',
        tag: 'gemini',
        endpoint: `${ANGRAV_SERVER}/v1/chat/completions`,
        account: 'user@google.com',
        priority: 2,
        capabilities: ['code', 'documentation', 'analysis']
    },
    {
        name: 'jules',
        tag: 'jules',
        endpoint: 'https://jules.googleapis.com/v1alpha/sessions',
        account: 'jules',
        priority: 2,
        capabilities: ['code', 'implementation', 'feature', 'refactoring', 'github']
    },
    {
        name: 'perplexity',
        tag: 'perplexity',
        endpoint: 'http://rsrch-server:3000/api/query', // rsrch agent
        account: 'default',
        priority: 3,
        capabilities: ['research', 'web-search', 'documentation']
    },
    {
        name: 'local-slm',
        tag: 'slm',
        endpoint: 'http://localhost:11434/api/generate', // Ollama
        account: 'local',
        priority: 10,
        capabilities: ['formatting', 'simple-tasks', 'templates']
    }
];

// Rate limit record structure (matches ratelimit-storage.ts)
interface RateLimitRecord {
    model: string;
    account: string;
    isLimited: boolean;
    availableAt: string;
    availableAtUnix: number;
}

// YouTrack issue structure (simplified)
interface YouTrackIssue {
    id: string;
    summary: string;
    description: string;
    type: string;
    priority: string;
    state: string;
    tags: string[];
}

/**
 * Check rate limit for a solver
 */
async function checkRateLimit(redis: Redis, solver: SolverConfig): Promise<boolean> {
    const key = `angrav:ratelimit:current:${solver.name.toLowerCase()}:${solver.account.toLowerCase()}`;
    const data = await redis.get(key);

    if (!data) return true; // No limit recorded = available

    const record: RateLimitRecord = JSON.parse(data);
    return !record.isLimited || record.availableAtUnix <= Date.now();
}

/**
 * Select best available solver for a task
 */
async function selectSolver(
    redis: Redis,
    issue: YouTrackIssue
): Promise<SolverConfig | null> {
    // First: check if issue has explicit solver tag
    for (const solver of SOLVERS) {
        if (issue.tags.includes(solver.tag)) {
            const available = await checkRateLimit(redis, solver);
            if (available) {
                console.log(`  ✅ Explicit solver ${solver.name} available`);
                return solver;
            } else {
                console.log(`  ⚠️ Explicit solver ${solver.name} rate-limited`);
                // Continue to fallback
            }
        }
    }

    // Second: match by task type/capabilities
    const taskType = inferTaskType(issue);
    const candidates = SOLVERS
        .filter(s => s.capabilities.includes(taskType))
        .sort((a, b) => a.priority - b.priority);

    for (const solver of candidates) {
        const available = await checkRateLimit(redis, solver);
        if (available) {
            console.log(`  ✅ Selected ${solver.name} for ${taskType} task`);
            return solver;
        }
    }

    console.log(`  ❌ No solvers available for ${taskType} task`);
    return null;
}

/**
 * Infer task type from issue content
 */
function inferTaskType(issue: YouTrackIssue): string {
    const text = `${issue.summary} ${issue.description}`.toLowerCase();

    if (text.includes('research') || text.includes('find') || text.includes('search')) {
        return 'research';
    }
    if (text.includes('implement') || text.includes('create') || text.includes('add')) {
        return 'implementation';
    }
    if (text.includes('fix') || text.includes('bug') || text.includes('error')) {
        return 'debugging';
    }
    if (text.includes('refactor') || text.includes('clean') || text.includes('improve')) {
        return 'refactoring';
    }
    if (text.includes('document') || text.includes('readme') || text.includes('explain')) {
        return 'documentation';
    }

    return 'code'; // Default
}

/**
 * Dispatch to Angrav server
 */
async function dispatchToAngrav(
    solver: SolverConfig,
    issue: YouTrackIssue
): Promise<{ success: boolean; response: string }> {
    const prompt = `
Task: ${issue.summary}

Description:
${issue.description}

Please complete this task. Provide your response with clear reasoning.
    `.trim();

    const response = await fetch(solver.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'gemini-antigravity',
            messages: [{ role: 'user', content: prompt }],
            stream: false
        })
    });

    if (!response.ok) {
        throw new Error(`Angrav request failed: ${response.status}`);
    }

    const data = await response.json();
    return {
        success: true,
        response: data.choices?.[0]?.message?.content || 'No response'
    };
}

/**
 * Update YouTrack issue with result
 */
async function updateYouTrack(
    issueId: string,
    result: { success: boolean; response: string; solver: string }
): Promise<void> {
    // This would use the YouTrack MCP or REST API
    // For now, just log the action
    console.log(`📝 Would update YouTrack issue ${issueId}:`);
    console.log(`   Solver: ${result.solver}`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Response length: ${result.response.length} chars`);
}

// ============================================================================
// Windmill Entrypoint
// ============================================================================

export async function main(
    issue_id: string,
    issue_summary: string,
    issue_description: string = '',
    issue_type: string = 'Task',
    issue_priority: string = 'Normal',
    issue_tags: string = ''  // Comma-separated
): Promise<{
    success: boolean;
    solver: string | null;
    response?: string;
    error?: string;
    rate_limited?: boolean;
}> {
    console.log(`\n🚀 Solver Dispatch: ${issue_id} - ${issue_summary}`);

    const redis = new Redis(REDIS_URL);

    try {
        // Build issue object
        const issue: YouTrackIssue = {
            id: issue_id,
            summary: issue_summary,
            description: issue_description,
            type: issue_type,
            priority: issue_priority,
            state: 'Open',
            tags: issue_tags.split(',').map(t => t.trim()).filter(Boolean)
        };

        // Select solver
        const solver = await selectSolver(redis, issue);

        if (!solver) {
            return {
                success: false,
                solver: null,
                error: 'No solvers available (all rate-limited)',
                rate_limited: true
            };
        }

        // Dispatch based on solver type
        let result: { success: boolean; response: string };

        if (solver.tag === 'angrav' || solver.tag === 'gemini') {
            result = await dispatchToAngrav(solver, issue);
        } else if (solver.tag === 'perplexity') {
            // Would call rsrch server
            result = { success: false, response: 'Perplexity not implemented yet' };
        } else if (solver.tag === 'slm') {
            // Would call Ollama
            result = { success: false, response: 'Local SLM not implemented yet' };
        } else {
            result = { success: false, response: `Unknown solver: ${solver.name}` };
        }

        // Update YouTrack
        await updateYouTrack(issue.id, { ...result, solver: solver.name });

        return {
            success: result.success,
            solver: solver.name,
            response: result.response
        };

    } catch (error) {
        console.error('❌ Dispatch failed:', error);
        return {
            success: false,
            solver: null,
            error: String(error)
        };
    } finally {
        await redis.quit();
    }
}
