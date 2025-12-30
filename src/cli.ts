import { Command } from 'commander';
import { connectToApp, getAgentFrame } from './core';
import { getAgentState, waitForIdle, StateInfo } from './state';
import { startNewConversation, getConversationHistory, ConversationHistory } from './session';
import { output, outputError } from './output';
import { startServer } from './server';
import { listCodeChanges, applyAllChanges, applyChangeForFile, readTerminal, undoLastAction, getTerminalLastLines, CodeChange, TerminalOutput } from './execution';

const program = new Command();

// Global --json flag
program
    .name('angrav')
    .description('Antigravity Automation CLI')
    .version('0.0.1')
    .option('--json', 'Output as JSON (machine-readable)', false);

// Serve command (OpenAI-compatible API server)
program.command('serve')
    .description('Start OpenAI-compatible API server')
    .option('-p, --port <number>', 'Port to listen on', '8080')
    .option('-h, --host <address>', 'Host to bind to', 'localhost')
    .action((options) => {
        startServer({
            port: parseInt(options.port),
            host: options.host
        });
    });

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

// Session list/switch commands (uses Agent Manager)
import { listSessions, switchSession, SessionInfo } from './session';
import { openAgentManager } from './manager';

session.command('list')
    .description('List all sessions from Agent Manager')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, context } = await connectToApp();
            const { frame } = await openAgentManager(context);
            const sessions = await listSessions(frame);
            await browser.close();

            output<SessionInfo[]>(sessions, opts.json, (data) => {
                if (data.length === 0) {
                    console.log('No sessions found.');
                    return;
                }
                console.log('\n=== Sessions ===\n');
                data.forEach((s, i) => {
                    console.log(`${i + 1}. ${s.name}`);
                });
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

session.command('switch')
    .description('Switch to a session by name (partial match)')
    .argument('<name>', 'Session name to switch to')
    .action(async (name: string) => {
        const opts = program.opts();
        try {
            const { browser, context } = await connectToApp();
            const { frame } = await openAgentManager(context);
            const success = await switchSession(frame, name);
            await browser.close();

            output({ switched: success, name }, opts.json, () => {
                console.log(success ? `✅ Switched to: ${name}` : `❌ Session "${name}" not found`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Prompt command
import { sendPrompt } from './prompt';
import * as fs from 'fs';

program.command('prompt')
    .description('Send a prompt to the agent')
    .argument('<text>', 'Prompt text (or use --file)')
    .option('-f, --file <path>', 'Read prompt from file')
    .option('--no-wait', 'Do not wait for agent to finish')
    .option('-t, --timeout <ms>', 'Wait timeout in ms', '120000')
    .action(async (text: string, options: { file?: string; wait: boolean; timeout: string }) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);

            const promptText = options.file
                ? fs.readFileSync(options.file, 'utf-8')
                : text;

            await sendPrompt(frame, page, promptText, {
                wait: options.wait !== false,
                timeout: parseInt(options.timeout)
            });

            await browser.close();

            output({ sent: true, length: promptText.length, waited: options.wait }, opts.json, () => {
                console.log(`✅ Prompt sent (${promptText.length} chars)`);
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
import { listAgentTasks, approveTask, rejectTask, spawnAgent, AgentTask } from './manager';

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

// Context injection commands
import { addFileContext, addMultipleFileContexts, uploadImage, uploadDocument } from './context';

const contextCmd = program.command('context')
    .description('Inject context (files, images, documents)');

contextCmd.command('add-file')
    .description('Add a file reference to the prompt using @file syntax')
    .argument('<filename>', 'Filename to reference (partial match)')
    .action(async (filename: string) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await addFileContext(frame, page, filename);
            await browser.close();

            output({ action: 'add_file', filename, success: true }, opts.json, () => {
                console.log(`✅ File context added: ${filename}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

contextCmd.command('add-files')
    .description('Add multiple file references')
    .argument('<filenames...>', 'Filenames to reference')
    .action(async (filenames: string[]) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await addMultipleFileContexts(frame, page, filenames);
            await browser.close();

            output({ action: 'add_files', filenames, count: filenames.length, success: true }, opts.json, () => {
                console.log(`✅ Added ${filenames.length} file contexts`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

contextCmd.command('add-image')
    .description('Upload an image to the agent context')
    .argument('<path>', 'Path to image file')
    .action(async (path: string) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await uploadImage(frame, page, path);
            await browser.close();

            output({ action: 'add_image', path, success: true }, opts.json, () => {
                console.log(`✅ Image uploaded: ${path}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

contextCmd.command('add-doc')
    .description('Upload a document to the agent context')
    .argument('<path>', 'Path to document file')
    .action(async (path: string) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await uploadDocument(frame, page, path);
            await browser.close();

            output({ action: 'add_doc', path, success: true }, opts.json, () => {
                console.log(`✅ Document uploaded: ${path}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Terminal management commands
import { listTerminals, addTerminal, TerminalInfo } from './terminal';

const terminalCmd = program.command('terminal')
    .description('Manage terminal context (supports interactive TUI selection)');

terminalCmd.command('list')
    .description('List all available terminals')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const terminals = await listTerminals(frame, page);
            await browser.close();

            output<TerminalInfo[]>(terminals, opts.json, (data) => {
                if (data.length === 0) {
                    console.log('No terminals available.');
                    return;
                }
                console.log('\n=== Available Terminals ===\n');
                data.forEach(t => {
                    console.log(`  ${t.index}. ${t.name}`);
                });
                console.log('\nUse `angrav terminal add <index|name>` to add as context.');
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

terminalCmd.command('add')
    .description('Add terminal as context (interactive if no argument)')
    .argument('[selector]', 'Terminal index (1-based) or name (partial match)')
    .action(async (selector?: string) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const name = await addTerminal(frame, page, selector);
            await browser.close();

            output({ action: 'add_terminal', terminal: name, success: true }, opts.json, () => {
                console.log(`✅ Terminal added: ${name}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Terminal read command - uses execution module (imported with execute commands below)

terminalCmd.command('read')
    .description('Read current terminal output')
    .option('-n, --lines <number>', 'Show only last N lines', '50')
    .action(async (options: { lines: string }) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();

            const lineCount = parseInt(options.lines);
            const text = lineCount < 1000
                ? await getTerminalLastLines(page, lineCount)
                : (await readTerminal(page)).text;

            await browser.close();

            output<TerminalOutput>({ text, timestamp: new Date() }, opts.json, () => {
                console.log('\n=== Terminal Output ===\n');
                console.log(text);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Rate limit commands
import { detectRateLimit, getTimeRemaining, dismissRateLimitPopup, RateLimitInfo } from './ratelimit';

const ratelimitCmd = program.command('ratelimit')
    .description('Check and manage model rate limits');

ratelimitCmd.command('check')
    .description('Check if current model is rate-limited')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const limitInfo = await detectRateLimit(frame);
            await browser.close();

            if (limitInfo) {
                const remaining = getTimeRemaining(limitInfo);
                output<RateLimitInfo & { timeRemaining: string | null }>(
                    { ...limitInfo, timeRemaining: remaining },
                    opts.json,
                    (data) => {
                        console.log('\n⚠️ RATE LIMIT ACTIVE\n');
                        console.log(`  Model: ${data.model}`);
                        console.log(`  Available at: ${data.availableAt}`);
                        if (remaining) console.log(`  Time remaining: ${remaining}`);
                    }
                );
            } else {
                output({ isLimited: false }, opts.json, () => {
                    console.log('✅ No rate limit detected');
                });
            }
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

ratelimitCmd.command('dismiss')
    .description('Dismiss the rate limit popup')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const dismissed = await dismissRateLimitPopup(frame);
            await browser.close();

            output({ action: 'dismiss', success: dismissed }, opts.json, () => {
                console.log(dismissed ? '✅ Popup dismissed' : '❌ No popup to dismiss');
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Redis storage commands
import {
    persistRateLimit as persistToRedis,
    getCurrentRateLimit as getFromRedis,
    getRateLimitHistory,
    getAllCurrentLimits,
    closeRedis,
    RateLimitRecord
} from './ratelimit-storage';

ratelimitCmd.command('persist')
    .description('Detect and persist current rate limit to Redis')
    .requiredOption('-a, --account <email>', 'Account email')
    .option('-s, --session <id>', 'Session ID', 'default')
    .action(async (options: { account: string; session: string }) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const limitInfo = await detectRateLimit(frame);
            await browser.close();

            if (limitInfo) {
                const entryId = await persistToRedis(limitInfo, options.account, options.session);
                await closeRedis();

                output({ action: 'persist', entryId, ...limitInfo }, opts.json, () => {
                    console.log(`\n📝 Rate limit persisted to Redis`);
                    console.log(`  Model: ${limitInfo.model}`);
                    console.log(`  Account: ${options.account}`);
                    console.log(`  Entry ID: ${entryId}`);
                });
            } else {
                await closeRedis();
                output({ action: 'persist', success: false, reason: 'no_limit' }, opts.json, () => {
                    console.log('✅ No rate limit to persist');
                });
            }
        } catch (error) {
            await closeRedis();
            outputError(error as Error, opts.json);
        }
    });

ratelimitCmd.command('get')
    .description('Get current rate limit for a model from Redis')
    .requiredOption('-m, --model <name>', 'Model name')
    .requiredOption('-a, --account <email>', 'Account email')
    .action(async (options: { model: string; account: string }) => {
        const opts = program.opts();
        try {
            const record = await getFromRedis(options.model, options.account);
            await closeRedis();

            if (record) {
                const remaining = record.availableAtUnix > Date.now()
                    ? Math.floor((record.availableAtUnix - Date.now()) / 60000) + 'm'
                    : 'Available now';

                output<RateLimitRecord & { timeRemaining: string }>(
                    { ...record, timeRemaining: remaining },
                    opts.json,
                    (data) => {
                        console.log('\n📊 Rate Limit Status (from Redis)\n');
                        console.log(`  Model: ${data.model}`);
                        console.log(`  Account: ${data.account}`);
                        console.log(`  Limited: ${data.isLimited}`);
                        console.log(`  Available at: ${data.availableAt}`);
                        console.log(`  Time remaining: ${remaining}`);
                        console.log(`  Last checked: ${data.detectedAt}`);
                    }
                );
            } else {
                output({ found: false }, opts.json, () => {
                    console.log('❌ No rate limit record found');
                });
            }
        } catch (error) {
            await closeRedis();
            outputError(error as Error, opts.json);
        }
    });

ratelimitCmd.command('history')
    .description('Get rate limit history for a model')
    .requiredOption('-m, --model <name>', 'Model name')
    .requiredOption('-a, --account <email>', 'Account email')
    .option('-n, --limit <number>', 'Number of entries', '10')
    .action(async (options: { model: string; account: string; limit: string }) => {
        const opts = program.opts();
        try {
            const records = await getRateLimitHistory(options.model, options.account, parseInt(options.limit));
            await closeRedis();

            output<RateLimitRecord[]>(records, opts.json, (data) => {
                console.log(`\n📜 Rate Limit History (${data.length} entries)\n`);
                data.forEach((r, i) => {
                    console.log(`  ${i + 1}. ${r.detectedAt} - ${r.isLimited ? '⚠️ Limited' : '✅ Available'} until ${r.availableAt}`);
                });
            });
        } catch (error) {
            await closeRedis();
            outputError(error as Error, opts.json);
        }
    });

ratelimitCmd.command('list-all')
    .description('List all currently rate-limited models')
    .action(async () => {
        const opts = program.opts();
        try {
            const records = await getAllCurrentLimits();
            await closeRedis();

            output<RateLimitRecord[]>(records, opts.json, (data) => {
                if (data.length === 0) {
                    console.log('✅ No active rate limits');
                    return;
                }
                console.log(`\n⚠️ Active Rate Limits (${data.length})\n`);
                data.forEach((r) => {
                    const remaining = Math.floor((r.availableAtUnix - Date.now()) / 60000);
                    console.log(`  ${r.model} (${r.account}) - ${remaining}m remaining`);
                });
            });
        } catch (error) {
            await closeRedis();
            outputError(error as Error, opts.json);
        }
    });

// Model/Mode configuration commands
import { setModel, setMode, getConfig, listModels, AgentModel, ConversationMode } from './config';

const configCmd = program.command('config')
    .description('Configure agent model and mode');

configCmd.command('show')
    .description('Show current model and mode configuration')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const config = await getConfig(frame);
            await browser.close();

            output(config, opts.json, (data) => {
                console.log(`\n=== Agent Configuration ===\n`);
                console.log(`Model: ${data.model}`);
                console.log(`Mode:  ${data.mode}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

configCmd.command('models')
    .description('List available models')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const models = await listModels(frame);
            await browser.close();

            output({ models }, opts.json, (data) => {
                console.log('\n=== Available Models ===\n');
                data.models.forEach((m: string, i: number) => {
                    console.log(`  ${i + 1}. ${m}`);
                });
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

configCmd.command('set-model')
    .description('Set the AI model')
    .argument('<model>', 'Model name (e.g., claude-3.5-sonnet, gpt-4o)')
    .action(async (model: string) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await setModel(frame, model as AgentModel);
            await browser.close();

            output({ action: 'set_model', model, success: true }, opts.json, () => {
                console.log(`✅ Model set to: ${model}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

configCmd.command('set-mode')
    .description('Set the conversation mode')
    .argument('<mode>', 'Mode: planning, code, chat, or fast')
    .action(async (mode: string) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            await setMode(frame, mode as ConversationMode);
            await browser.close();

            output({ action: 'set_mode', mode, success: true }, opts.json, () => {
                console.log(`✅ Mode set to: ${mode}`);
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

// Execution commands (Phase 5) - imports at top of file

const executeCmd = program.command('execute')
    .description('Apply code changes and manage execution');

executeCmd.command('list')
    .description('List all code changes in the current response')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const changes = await listCodeChanges(frame);
            await browser.close();

            output<CodeChange[]>(changes, opts.json, (data) => {
                if (data.length === 0) {
                    console.log('No code changes found.');
                    return;
                }
                console.log('\n=== Code Changes ===\n');
                data.forEach((c, i) => {
                    console.log(`  ${i + 1}. [${c.language}] ${c.filename} ${c.hasApplyButton ? '✓' : ''}`);
                });
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

executeCmd.command('apply')
    .description('Apply code changes')
    .option('-f, --file <pattern>', 'Apply only to files matching pattern')
    .action(async (options: { file?: string }) => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);

            let applied: number | boolean;
            if (options.file) {
                applied = await applyChangeForFile(frame, options.file);
            } else {
                applied = await applyAllChanges(frame);
            }
            await browser.close();

            output({ action: 'apply', applied, file: options.file }, opts.json, () => {
                if (typeof applied === 'number') {
                    console.log(`✅ Applied ${applied} code changes`);
                } else {
                    console.log(applied ? '✅ Change applied' : '❌ No changes applied');
                }
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

executeCmd.command('undo')
    .description('Undo the last action')
    .action(async () => {
        const opts = program.opts();
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);
            const success = await undoLastAction(frame);
            await browser.close();

            output({ action: 'undo', success }, opts.json, () => {
                console.log(success ? '✅ Undo executed' : '❌ Undo not available');
            });
        } catch (error) {
            outputError(error as Error, opts.json);
        }
    });

program.parse();
