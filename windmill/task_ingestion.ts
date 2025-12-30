/**
 * Windmill Flow: Task Ingestion
 * 
 * Polls YouTrack for issues ready for automation and triggers solver_dispatch.
 * 
 * Ready criteria:
 * - State: "Open" or "Submitted"  
 * - Has automation tag: #auto, #agent, or solver-specific tag
 * - Not already being processed (no #processing tag)
 * 
 * This is meant to be run as a scheduled flow (e.g., every 5 minutes).
 */

// Windmill SDK would be imported here
// import * as wmill from 'windmill-client';

// YouTrack API would be called via MCP or REST
// For now, we define the interface and simulate

interface YouTrackIssue {
    id: string;
    summary: string;
    description: string;
    type: string;
    priority: string;
    state: string;
    tags: string[];
    project: string;
}

interface IngestionResult {
    processed: number;
    dispatched: string[];
    skipped: string[];
    errors: string[];
}

// Configuration
const AUTOMATION_TAGS = ['auto', 'agent', 'angrav', 'gemini', 'perplexity', 'slm', 'jules'];
const READY_STATES = ['Open', 'Submitted', 'Reopened'];
const PROJECT_KEY = process.env.YOUTRACK_PROJECT || 'SAM';

/**
 * Check if an issue is ready for automation
 */
function isReadyForAutomation(issue: YouTrackIssue): boolean {
    // Must be in a ready state
    if (!READY_STATES.includes(issue.state)) {
        return false;
    }

    // Must have an automation tag
    const hasAutoTag = issue.tags.some(tag =>
        AUTOMATION_TAGS.includes(tag.toLowerCase())
    );
    if (!hasAutoTag) {
        return false;
    }

    // Must not be already processing
    if (issue.tags.includes('processing')) {
        return false;
    }

    return true;
}

/**
 * Fetch issues from YouTrack (via MCP or REST)
 * This is a placeholder - actual implementation would use YouTrack API
 */
async function fetchReadyIssues(project: string): Promise<YouTrackIssue[]> {
    // In real implementation:
    // const issues = await mcp_napovedayt_search_issues({
    //     query: `project: ${project} State: Open, Submitted, Reopened tag: auto, agent, angrav, gemini, perplexity, slm -tag: processing`
    // });

    console.log(`🔍 Would search YouTrack for ready issues in ${project}`);

    // Placeholder - return empty for now
    // Actual implementation would parse YouTrack search results
    return [];
}

/**
 * Add processing tag to prevent re-dispatch
 */
async function markAsProcessing(issueId: string): Promise<void> {
    console.log(`🏷️ Would add #processing tag to ${issueId}`);
    // await mcp_napovedayt_manage_issue_tags({
    //     issueId,
    //     tag: 'processing',
    //     operation: 'add'
    // });
}

/**
 * Trigger solver dispatch for an issue
 */
async function triggerDispatch(issue: YouTrackIssue): Promise<boolean> {
    console.log(`🚀 Triggering dispatch for ${issue.id}: ${issue.summary}`);

    // In Windmill, this would be:
    // await wmill.runScriptAsync('f/angrav/solver_dispatch', {
    //     issue_id: issue.id,
    //     issue_summary: issue.summary,
    //     issue_description: issue.description,
    //     issue_type: issue.type,
    //     issue_priority: issue.priority,
    //     issue_tags: issue.tags.join(',')
    // });

    return true;
}

// ============================================================================
// Windmill Entrypoint
// ============================================================================

import Redis from 'ioredis';
import { selectParallelBatch, ScoredIssue } from './task_scorer';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_PARALLEL_JULES = 15;

interface IngestionResultV2 extends IngestionResult {
    batch: Array<{ id: string; score: number; summary: string }>;
    conflicting: number;
}

export async function main(
    project: string = PROJECT_KEY,
    dry_run: boolean = false,
    max_parallel: number = MAX_PARALLEL_JULES
): Promise<IngestionResultV2> {
    console.log(`\n📋 Task Ingestion: Scanning ${project} for ready issues`);
    console.log(`   Dry run: ${dry_run}`);
    console.log(`   Max parallel slots: ${max_parallel}`);

    const result: IngestionResultV2 = {
        processed: 0,
        dispatched: [],
        skipped: [],
        errors: [],
        batch: [],
        conflicting: 0
    };

    const redis = new Redis(REDIS_URL);

    try {
        // Fetch ready issues
        const issues = await fetchReadyIssues(project);
        console.log(`   Found ${issues.length} potential issues`);

        // Filter to only ready issues
        const readyIssues = issues.filter(isReadyForAutomation);
        console.log(`   Ready for automation: ${readyIssues.length}`);

        result.skipped = issues
            .filter(i => !isReadyForAutomation(i))
            .map(i => i.id);

        if (readyIssues.length === 0) {
            console.log('   No issues to process');
            return result;
        }

        // Use task_scorer to select optimal parallel batch
        console.log(`\n📊 Scoring and selecting optimal batch...`);
        const scoredBatch = await selectParallelBatch(
            redis,
            readyIssues.map(i => ({
                ...i,
                dueDate: undefined,  // Would come from YouTrack
                estimate: undefined,
                blockedBy: undefined,
                blocks: undefined,
                affectedFiles: undefined
            })),
            max_parallel
        );

        result.batch = scoredBatch.map(s => ({
            id: s.issue.id,
            score: s.score,
            summary: s.issue.summary
        }));
        result.conflicting = readyIssues.length - scoredBatch.length;

        console.log(`   Selected ${scoredBatch.length} issues for dispatch`);
        console.log(`   Conflicting (deferred): ${result.conflicting}`);

        // Dispatch selected batch
        for (const scored of scoredBatch) {
            const issue = scored.issue as YouTrackIssue;

            try {
                if (!dry_run) {
                    // Mark as processing
                    await markAsProcessing(issue.id);

                    // Trigger dispatch
                    await triggerDispatch(issue);
                }

                result.dispatched.push(issue.id);
                result.processed++;

                console.log(`   ✅ ${issue.id} (score: ${scored.score})`);

            } catch (error) {
                console.error(`   ❌ ${issue.id}:`, error);
                result.errors.push(`${issue.id}: ${String(error)}`);
            }
        }

        console.log(`\n✅ Ingestion complete:`);
        console.log(`   Processed: ${result.processed}`);
        console.log(`   Dispatched: ${result.dispatched.length}`);
        console.log(`   Conflicting (next batch): ${result.conflicting}`);
        console.log(`   Errors: ${result.errors.length}`);

        return result;

    } catch (error) {
        console.error('❌ Ingestion failed:', error);
        result.errors.push(String(error));
        return result;
    } finally {
        await redis.quit();
    }
}

// ============================================================================
// Webhook Handler (Alternative to polling)
// ============================================================================

/**
 * This function can be triggered by a YouTrack webhook when an issue
 * is created or updated. More efficient than polling.
 */
export async function webhook_handler(
    issue_id: string,
    issue_summary: string,
    issue_state: string,
    issue_tags: string,
    event_type: string  // 'created' | 'updated' | 'tag_added'
): Promise<{ dispatched: boolean; reason?: string }> {
    console.log(`\n🔔 Webhook: ${event_type} - ${issue_id}`);

    const tags = issue_tags.split(',').map(t => t.trim());

    // Check if ready for automation
    if (!READY_STATES.includes(issue_state)) {
        return { dispatched: false, reason: `State ${issue_state} not ready` };
    }

    const hasAutoTag = tags.some(tag => AUTOMATION_TAGS.includes(tag.toLowerCase()));
    if (!hasAutoTag) {
        return { dispatched: false, reason: 'No automation tag' };
    }

    if (tags.includes('processing')) {
        return { dispatched: false, reason: 'Already processing' };
    }

    // Would trigger dispatch here
    console.log(`  → Would dispatch ${issue_id}`);

    return { dispatched: true };
}
