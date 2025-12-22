/**
 * Windmill Script: Poll Angrav Task Result
 *
 * Check the status of a previously submitted task and retrieve results when ready.
 *
 * Returns:
 *   - status: 'queued' | 'running' | 'completed' | 'failed'
 *   - result: The task output (if completed)
 *   - error: Error message (if failed)
 */

export async function main(
    job_id: string
): Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed';
    result?: any;
    error?: string;
}> {

    // @ts-ignore - Windmill provides this globally
    const wmill = await import('windmill-client');

    try {
        const job = await wmill.getJob(job_id);

        if (!job) {
            return { status: 'failed', error: `Job ${job_id} not found` };
        }

        // Map Windmill job states to our simplified status
        switch (job.type) {
            case 'QueuedJob':
                return { status: 'queued' };
            case 'RunningJob':
                return { status: 'running' };
            case 'CompletedJob':
                if (job.success) {
                    return { status: 'completed', result: job.result };
                } else {
                    return { status: 'failed', error: job.result?.error || 'Unknown error' };
                }
            default:
                return { status: 'failed', error: `Unknown job state: ${job.type}` };
        }

    } catch (error: any) {
        console.error(`Error polling job ${job_id}:`, error);
        return { status: 'failed', error: error.message };
    }
}
