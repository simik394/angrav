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

export async function main(
    prompt: string,
    context_files?: string[],
    timeout_ms: number = 120000,
    worker_tag?: string  // Optional: specify worker group (e.g., 'server', 'ntb-local')
): Promise<{ job_id: string; status: string }> {

    // @ts-ignore - Windmill provides this globally
    const wmill = await import('windmill-client');

    // Build the job options
    const jobOptions: any = {
        path: 'f/angrav/execute',
        args: {
            prompt,
            context_files,
            timeout_ms
        }
    };

    // Only add tag if specified (otherwise uses default worker group)
    if (worker_tag) {
        jobOptions.tag = worker_tag;
    }

    // Run the execute script asynchronously
    const jobId = await wmill.runScriptAsync(jobOptions);

    console.log(`📋 Submitted Angrav task with job_id: ${jobId}`);

    return {
        job_id: jobId,
        status: 'queued'
    };
}

