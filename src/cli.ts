import { Command } from 'commander';
import { connectToApp, getAgentFrame } from './core';
import { getAgentState, waitForIdle } from './state';

const program = new Command();

program
    .name('angrav')
    .description('Antigravity Automation CLI')
    .version('0.0.1');

program.command('status')
    .description('Get current agent state')
    .action(async () => {
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);

            const info = await getAgentState(frame);
            console.log(JSON.stringify(info, null, 2));

            await browser.close();
        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    });

program.command('wait')
    .description('Wait for agent to become idle')
    .option('-t, --timeout <number>', 'Timeout in ms', '60000')
    .action(async (options) => {
        try {
            const { browser, page } = await connectToApp();
            const frame = await getAgentFrame(page);

            await waitForIdle(frame, parseInt(options.timeout));

            await browser.close();
        } catch (error) {
            console.error('Error:', error);
            process.exit(1);
        }
    });

program.parse();
