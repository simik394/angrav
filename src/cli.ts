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

program.parse();
