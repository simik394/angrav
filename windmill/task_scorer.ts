/**
 * Windmill Flow: Task Scorer
 * 
 * Implements the prioritization algorithm from agents/proj workflow taxonomy.
 * Scores tasks for dispatch and selects optimal parallel batches.
 * 
 * Score = Urgency(25) + Importance(20) + Impact(20) + Effort(15) + Parallel(10) + Solver(10)
 *       = 100 max
 */

import Redis from 'ioredis';

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const KEY_PREFIX = 'angrav:ratelimit';

// Types
interface YouTrackIssue {
    id: string;
    summary: string;
    description: string;
    type: string;
    priority: string;
    state: string;
    tags: string[];
    dueDate?: string;
    estimate?: number;  // in hours
    blockedBy?: string[];
    blocks?: string[];
    affectedFiles?: string[];  // Inferred from description
}

export interface ScoredIssue {
    issue: YouTrackIssue;
    score: number;
    breakdown: TaskScoreBreakdown;
    affectedFiles: string[];
}

interface TaskScoreBreakdown {
    urgency: number;        // 0-25: Deadline proximity
    importance: number;     // 0-20: Priority level
    impact: number;         // 0-20: Number of issues this unblocks
    effort: number;         // 0-15: Smaller tasks score higher
    parallelizable: number; // 0-10: Can run without file conflicts
    solverMatch: number;    // 0-10: Has available solver
}

// Priority weights from YouTrack
const PRIORITY_SCORES: Record<string, number> = {
    'Show-stopper': 20,
    'Critical': 16,
    'Major': 12,
    'Normal': 8,
    'Minor': 4
};

// Solver capabilities (for matching)
const SOLVER_TAGS = ['angrav', 'jules', 'gemini', 'perplexity', 'slm', 'auto', 'agent'];

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Score deadline urgency (0-25)
 * Closer deadlines = higher score
 */
function scoreDeadline(dueDate?: string): number {
    if (!dueDate) return 5;  // No deadline = medium-low urgency

    const due = new Date(dueDate);
    const now = new Date();
    const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) return 25;      // Overdue = max urgency
    if (daysUntilDue === 0) return 25;    // Due today
    if (daysUntilDue === 1) return 22;    // Due tomorrow
    if (daysUntilDue <= 3) return 18;     // Within 3 days
    if (daysUntilDue <= 7) return 14;     // Within a week
    if (daysUntilDue <= 14) return 10;    // Within 2 weeks
    if (daysUntilDue <= 30) return 6;     // Within a month
    return 3;                              // Far future
}

/**
 * Score priority/importance (0-20)
 */
function scorePriority(priority: string): number {
    return PRIORITY_SCORES[priority] || 8;  // Default to Normal
}

/**
 * Score impact - how many issues this unblocks (0-20)
 */
function scoreImpact(blocks?: string[]): number {
    if (!blocks || blocks.length === 0) return 5;  // No dependents = some impact

    const count = blocks.length;
    if (count >= 5) return 20;     // Critical blocker
    if (count >= 3) return 16;     // Important blocker
    if (count >= 2) return 12;     // Some dependents
    return 8;                       // One dependent
}

/**
 * Score effort - smaller tasks get higher scores (0-15)
 * Preference for quick wins
 */
function scoreEffort(estimate?: number): number {
    if (!estimate) return 10;  // Unknown = medium

    if (estimate <= 1) return 15;      // 1 hour or less
    if (estimate <= 2) return 13;      // Up to 2 hours
    if (estimate <= 4) return 11;      // Half day
    if (estimate <= 8) return 9;       // Full day
    if (estimate <= 16) return 6;      // 2 days
    if (estimate <= 40) return 3;      // Week
    return 1;                           // > week
}

/**
 * Score solver availability (0-10)
 * Check if preferred solver is available via Redis
 */
async function scoreSolverMatch(
    redis: Redis,
    issue: YouTrackIssue
): Promise<number> {
    // Check if issue has solver tag
    const solverTag = issue.tags.find(t => SOLVER_TAGS.includes(t.toLowerCase()));

    if (!solverTag) return 8;  // No preference = available

    // Check rate limit for preferred solver
    const normalizedSolver = solverTag.toLowerCase();
    const pattern = `${KEY_PREFIX}:current:*${normalizedSolver}*`;
    const keys = await redis.keys(pattern);

    for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
            const record = JSON.parse(data);
            if (record.isLimited && record.availableAtUnix > Date.now()) {
                return 3;  // Preferred solver rate-limited
            }
        }
    }

    return 10;  // Solver available
}

/**
 * Infer affected files from issue description
 * Looks for file paths, function names, module references
 */
function inferAffectedFiles(issue: YouTrackIssue): string[] {
    if (issue.affectedFiles) return issue.affectedFiles;

    const text = `${issue.summary} ${issue.description}`;
    const files: Set<string> = new Set();

    // Match file paths (e.g., src/foo.ts, components/Bar.tsx)
    const pathPattern = /(?:^|\s)([a-zA-Z0-9_\-\/]+\.[a-zA-Z]{2,4})(?:\s|$|,|:)/g;
    let match;
    while ((match = pathPattern.exec(text)) !== null) {
        files.add(match[1].toLowerCase());
    }

    // Match module references (e.g., "the auth module", "UserService")
    const modulePattern = /(?:module|component|service|class)\s+([A-Z][a-zA-Z0-9]+)/gi;
    while ((match = modulePattern.exec(text)) !== null) {
        files.add(match[1].toLowerCase());
    }

    // If no files found, use project key as a fallback
    if (files.size === 0) {
        files.add(issue.id.split('-')[0].toLowerCase());  // e.g., "SAM"
    }

    return Array.from(files);
}

// ============================================================================
// Main Scoring Function
// ============================================================================

/**
 * Calculate full score for an issue
 */
export async function scoreTask(
    redis: Redis,
    issue: YouTrackIssue
): Promise<ScoredIssue> {
    const urgency = scoreDeadline(issue.dueDate);
    const importance = scorePriority(issue.priority);
    const impact = scoreImpact(issue.blocks);
    const effort = scoreEffort(issue.estimate);
    const solverMatch = await scoreSolverMatch(redis, issue);
    const affectedFiles = inferAffectedFiles(issue);

    // Parallelizable score is computed during batch selection
    const parallelizable = 10;  // Default to max, will be adjusted in batch selection

    const breakdown: TaskScoreBreakdown = {
        urgency,
        importance,
        impact,
        effort,
        parallelizable,
        solverMatch
    };

    const score = urgency + importance + impact + effort + parallelizable + solverMatch;

    return {
        issue,
        score,
        breakdown,
        affectedFiles
    };
}

// ============================================================================
// Parallel Batch Selection
// ============================================================================

/**
 * Select optimal batch of non-conflicting tasks for parallel execution
 * 
 * Algorithm:
 * 1. Score all issues
 * 2. Sort by score descending
 * 3. For each, check file conflicts with already-selected
 * 4. Add to batch if no conflict
 * 5. Stop at maxSlots
 */
export async function selectParallelBatch(
    redis: Redis,
    issues: YouTrackIssue[],
    maxSlots: number = 15
): Promise<ScoredIssue[]> {
    // Score all issues
    const scored = await Promise.all(
        issues.map(issue => scoreTask(redis, issue))
    );

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const batch: ScoredIssue[] = [];
    const usedFiles = new Set<string>();

    for (const scoredIssue of scored) {
        if (batch.length >= maxSlots) break;

        // Check for file conflicts
        const hasConflict = scoredIssue.affectedFiles.some(f => usedFiles.has(f));

        if (!hasConflict) {
            batch.push(scoredIssue);
            scoredIssue.affectedFiles.forEach(f => usedFiles.add(f));
        } else {
            // Reduce parallelizable score for skipped items (for reporting)
            scoredIssue.breakdown.parallelizable = 0;
            scoredIssue.score -= 10;
        }
    }

    console.log(`📊 Selected ${batch.length}/${issues.length} issues for parallel batch`);
    console.log(`   Files in use: ${usedFiles.size}`);

    return batch;
}

/**
 * Get issues that were skipped due to conflicts
 */
export function getConflictingIssues(
    allScored: ScoredIssue[],
    selected: ScoredIssue[]
): ScoredIssue[] {
    const selectedIds = new Set(selected.map(s => s.issue.id));
    return allScored.filter(s => !selectedIds.has(s.issue.id));
}

// ============================================================================
// Windmill Entrypoint
// ============================================================================

/**
 * Score and rank issues, optionally select parallel batch
 */
export async function main(
    issues_json: string,  // JSON array of YouTrackIssue
    max_parallel: number = 15,
    select_batch: boolean = true
): Promise<{
    batch: ScoredIssue[];
    conflicting: ScoredIssue[];
    summary: {
        total: number;
        selected: number;
        conflicting: number;
        avgScore: number;
    };
}> {
    console.log(`\n📊 Task Scorer: Processing ${JSON.parse(issues_json).length} issues`);

    const redis = new Redis(REDIS_URL);

    try {
        const issues: YouTrackIssue[] = JSON.parse(issues_json);

        // Score all issues
        const allScored = await Promise.all(
            issues.map(issue => scoreTask(redis, issue))
        );

        // Sort by score
        allScored.sort((a, b) => b.score - a.score);

        let batch: ScoredIssue[];
        let conflicting: ScoredIssue[];

        if (select_batch) {
            batch = await selectParallelBatch(redis, issues, max_parallel);
            conflicting = getConflictingIssues(allScored, batch);
        } else {
            batch = allScored;
            conflicting = [];
        }

        const avgScore = batch.length > 0
            ? batch.reduce((sum, s) => sum + s.score, 0) / batch.length
            : 0;

        console.log(`\n✅ Scoring complete:`);
        console.log(`   Total: ${issues.length}`);
        console.log(`   Selected: ${batch.length}`);
        console.log(`   Conflicting: ${conflicting.length}`);
        console.log(`   Avg score: ${avgScore.toFixed(1)}`);

        return {
            batch,
            conflicting,
            summary: {
                total: issues.length,
                selected: batch.length,
                conflicting: conflicting.length,
                avgScore: Math.round(avgScore * 10) / 10
            }
        };

    } finally {
        await redis.quit();
    }
}
