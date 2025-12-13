import { Command } from 'commander';
import { connectToApp, getAgentFrame } from './core';
import { getAgentState, waitForIdle, StateInfo } from './state';
import { startNewConversation, getConversationHistory, ConversationHistory } from './session';
import { output, outputError } from './output';

const program = new Command();

// Global --json flag
program
    .name('angrav')
    .description('Antigravity Automation CLI')
    .version('0.0.1')
    .option('--json', 'Output as JSON (machine-readable)', false);

program.command('status')
    .description('Get current agent state')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const info = await getAgentState(frame);
            await browser.close();

            output<StateInfo>(info, opts.json, (data) => {
                console.log(`State: ${data.state}`);
                console.log(`Input enabled: ${data.isInputEnabled}`);
                if (data.errorMessage) console.log(`Error: ${data.errorMessage}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

program.command('wait')
    .description('Wait for agent to become idle')
    .option('-t, --timeout <number>', 'Timeout in ms', '60000')
    .action(async (options) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await waitForIdle(frame, parseInt(options.timeout));
            await browser.close();

            output({ waited: true, timeout: parseInt(options.timeout) }, opts.json, () => {
                console.log('✅ Agent is idle.');
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

const session = program.command('session')
    .description('Manage conversation sessions');

session.command('new')
    .description('Start a new clean conversation')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await startNewConversation(frame);
            await browser.close();

            output({ action: 'new_conversation', success: true }, opts.json, () => {
                console.log('✅ New conversation started.');
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

session.command('history')
    .description('Get conversation history')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const history = await getConversationHistory(frame);
            await browser.close();

            output<ConversationHistory>(history, opts.json, (data) => {
                console.log(`\n=== Conversation History (${data.messageCount} messages) ===\n`);
                data.messages.forEach(msg => {
                    console.log(`[${msg.role.toUpperCase()}]`);
                    console.log(msg.content);
                    if (msg.thoughts) console.log(`(Thoughts: ${msg.thoughts})`);
                    console.log('---');
                });
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Output extraction commands
import { extractResponse, extractCodeBlocks, extractCodeBlocksByLanguage, AgentResponse, CodeBlock } from './extraction';

const outputCmd = program.command('output')
    .description('Extract agent output (code, thoughts, answers)');

outputCmd.command('last')
    .description('Get the last agent response')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const response = await extractResponse(frame);
            await browser.close();

            output<AgentResponse>(response, opts.json, (data) => {
                if (data.thoughts) {
                    console.log('\n=== Thoughts ===');
                    console.log(data.thoughts);
                }
                console.log('\n=== Answer ===');
                console.log(data.fullText);
                if (data.codeBlocks.length > 0) {
                    console.log(`\n=== Code Blocks (${data.codeBlocks.length}) ===`);
                    data.codeBlocks.forEach((block, i) => {
                        console.log(`\n[${i + 1}] ${block.language}${block.filename ? ` (${block.filename})` : ''}`);
                        console.log(block.content.slice(0, 200) + (block.content.length > 200 ? '...' : ''));
                    });
                }
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

outputCmd.command('code')
    .description('Extract code blocks')
    .option('-l, --lang <language>', 'Filter by language')
    .action(async (options: { lang?: string }) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);

            const blocks = options.lang
                ? await extractCodeBlocksByLanguage(frame, options.lang)
                : await extractCodeBlocks(frame);
            await browser.close();

            output<CodeBlock[]>(blocks, opts.json, (data) => {
                if (data.length === 0) {
                    console.log('No code blocks found.');
                    return;
                }
                data.forEach((block, i) => {
                    console.log(`\n=== Block ${i + 1}: ${block.language} ===`);
                    console.log(block.content);
                });
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Agent Manager commands
import { openAgentManager, listAgentTasks, approveTask, rejectTask, spawnAgent, AgentTask } from './manager';

const managerCmd = program.command('manager')
    .description('Control Agent Manager (Mission Control)');

managerCmd.command('list')
    .description('List all agent tasks')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, context } = await connectToApp();
            const { frame } = await openAgentManager(context);
            const tasks = await listAgentTasks(frame);
            await browser.close();

            output<AgentTask[]>(tasks, opts.json, (data) => {
                if (data.length === 0) {
                    console.log('No active tasks.');
                    return;
                }
                console.log('\n=== Agent Tasks ===\n');
                data.forEach(task => {
                    console.log(`[${task.status.toUpperCase()}] ${task.id}`);
                    console.log(`  Workspace: ${task.workspace}`);
                    if (task.description) console.log(`  Description: ${task.description}`);
                    console.log('');
                });
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

managerCmd.command('approve')
    .description('Approve a pending task')
    .argument('<taskId>', 'Task ID to approve')
    .action(async (taskId: string) => {
        const opts = program.opts();
        try {
            const { browser, context } = await connectToApp();
            const { frame } = await openAgentManager(context);
            const success = await approveTask(frame, taskId);
            await browser.close();

            output({ taskId, approved: success }, opts.json, () => {
                console.log(success ? `✅ Task ${taskId} approved.` : `❌ Failed to approve task ${taskId}.`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

managerCmd.command('reject')
    .description('Reject a pending task')
    .argument('<taskId>', 'Task ID to reject')
    .action(async (taskId: string) => {
        const opts = program.opts();
        try {
            const { browser, context } = await connectToApp();
            const { frame } = await openAgentManager(context);
            const success = await rejectTask(frame, taskId);
            await browser.close();

            output({ taskId, rejected: success }, opts.json, () => {
                console.log(success ? `❌ Task ${taskId} rejected.` : `⚠️ Failed to reject task ${taskId}.`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

managerCmd.command('spawn')
    .description('Spawn a new agent')
    .argument('<workspace>', 'Workspace path')
    .argument('<task>', 'Task description')
    .action(async (workspace: string, task: string) => {
        const opts = program.opts();
        try {
            const { browser, context } = await connectToApp();
            const { frame } = await openAgentManager(context);
            const newTaskId = await spawnAgent(frame, workspace, task);
            await browser.close();

            output({ taskId: newTaskId, workspace, task }, opts.json, () => {
                console.log(`🚀 Agent spawned with ID: ${newTaskId}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

program.parse();
