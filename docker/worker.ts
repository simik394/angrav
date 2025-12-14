/**
 * Angrav Worker - watches for task files and executes them via Antigravity
 * 
 * Input:  /workspace/tasks/task-*.json
 * Output: /workspace/output/task-*-result.json
 */

/// <reference types="node" />
import * as fs from 'node:fs';
import * as path from 'node:path';
import { connectToApp, getAgentFrame } from './src/core';
import { sendPrompt } from './src/prompt';
import { waitForIdle } from './src/state';
import { extractResponse } from './src/extraction';

const TASKS_DIR = '/workspace/tasks';
const OUTPUT_DIR = '/workspace/output';
const POLL_INTERVAL = 5000; // 5 seconds

interface TaskFile {
    prompt: string;
    context?: string[];
    timeout?: number;
}

interface TaskResult {
    taskId: string;
    success: boolean;
    response?: {
        fullText: string;
        thoughts?: string;
        codeBlocks: Array<{
            language: string;
            content: string;
            filename?: string;
        }>;
    };
    error?: string;
    startTime: string;
    endTime: string;
    duration: number;
}

async function processTask(taskPath: string): Promise<void> {
    const taskId = path.basename(taskPath, '.json');
    const outputPath = path.join(OUTPUT_DIR, `${taskId}-result.json`);
    const startTime = new Date();

    console.log(`📋 Processing task: ${taskId}`);

    let result: TaskResult = {
        taskId,
        success: false,
        startTime: startTime.toISOString(),
        endTime: '',
        duration: 0
    };

    try {
        // Read task file
        const taskContent = fs.readFileSync(taskPath, 'utf-8');
        const task: TaskFile = JSON.parse(taskContent);

        if (!task.prompt) {
            throw new Error('Task file missing "prompt" field');
        }

        // Connect to Antigravity via CDP (uses env var in Docker)
        const cdpEndpoint = process.env.BROWSER_CDP_ENDPOINT || 'http://localhost:9222';
        console.log(`  🔌 Connecting to Antigravity at ${cdpEndpoint}...`);
        const { browser, context, page } = await connectToApp(cdpEndpoint);

        try {
            const frame = await getAgentFrame(page);

            // Send prompt
            console.log('  📤 Sending prompt...');
            await sendPrompt(frame, page, task.prompt, { wait: false });

            // Wait for completion
            const timeout = task.timeout ?? 120000;
            console.log(`  ⏳ Waiting for response (timeout: ${timeout}ms)...`);
            await waitForIdle(frame, timeout);

            // Extract response
            console.log('  📥 Extracting response...');
            const response = await extractResponse(frame);

            result.success = true;
            result.response = response;

            console.log(`  ✅ Task ${taskId} completed successfully`);

        } finally {
            await browser.close();
        }

    } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ Task ${taskId} failed: ${result.error}`);
    }

    // Calculate duration
    const endTime = new Date();
    result.endTime = endTime.toISOString();
    result.duration = endTime.getTime() - startTime.getTime();

    // Write result
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`  💾 Result written to: ${outputPath}`);

    // Move processed task to prevent re-processing
    const processedPath = taskPath.replace('.json', '.processed');
    fs.renameSync(taskPath, processedPath);
}

async function watchTasks(): Promise<void> {
    console.log('👀 Watching for tasks in:', TASKS_DIR);
    console.log('📁 Output directory:', OUTPUT_DIR);

    // Ensure directories exist
    if (!fs.existsSync(TASKS_DIR)) {
        fs.mkdirSync(TASKS_DIR, { recursive: true });
    }
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Wait for Antigravity to be ready
    console.log('⏳ Waiting for Antigravity to start...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    while (true) {
        try {
            const files = fs.readdirSync(TASKS_DIR)
                .filter((f: string) => f.endsWith('.json') && !f.endsWith('.processed'));

            for (const file of files) {
                const taskPath = path.join(TASKS_DIR, file);
                await processTask(taskPath);
            }

        } catch (error) {
            console.error('Error scanning tasks:', error);
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
}

// Start watching
watchTasks().catch(console.error);
