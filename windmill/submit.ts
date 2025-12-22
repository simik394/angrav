/**
 * Windmill Script: Submit Angrav Task (Non-blocking)
 *
 * This script enqueues a task for Angrav and returns immediately with a job_id.
 * The caller can use the job_id to poll for results.
 *
 * Usage in Windmill:
 *   const { job_id } = await submit({ prompt: "Create a Python script..." });
 *   // Later...
 *   const result = await poll({ job_id });
 */

// Windmill SDK imports (available at runtime in Windmill)
// import * as wmill from 'windmill-client';

export async function main(
    prompt: string,
    context_files?: string[],
    timeout_ms: number = 120000
): Promise<{ job_id: string; status: string }> {

    // @ts-ignore - Windmill provides this globally
    const wmill = await import('windmill-client');

    // Run the execute script asynchronously
    // 'f/angrav/execute' is the path where the execute script is deployed in Windmill
    const jobId = await wmill.runScriptAsync({
        path: 'f/angrav/execute',
        args: {
            prompt,
            context_files,
            timeout_ms
        },
        // Tag ensures it runs on the NTB worker that has access to angrav-browser
        tag: 'ntb-local'
    });

    console.log(`📋 Submitted Angrav task with job_id: ${jobId}`);

    return {
        job_id: jobId,
        status: 'queued'
    };
}
