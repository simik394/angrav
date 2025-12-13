import { Frame, Page, BrowserContext } from '@playwright/test';

export interface AgentTask {
    id: string;
    status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
    workspace: string;
    description?: string;
    timestamp: Date;
}

export interface ManagerContext {
    page: Page;
    frame: Frame;
}

/**
 * Opens the Agent Manager ("Mission Control") view.
 * Returns the manager page/frame context for further operations.
 */
export async function openAgentManager(context: BrowserContext): Promise<ManagerContext> {
    console.log('🚀 Opening Agent Manager...');

    // The Agent Manager is accessed via a menu or keyboard shortcut
    // Looking for pages with manager-related URLs or titles
    const pages = context.pages();

    // Try to find existing manager page
    let managerPage = pages.find(p =>
        p.url().includes('manager') ||
        p.url().includes('mission-control')
    );

    if (!managerPage) {
        // Try to open via command palette or menu
        // First, get the main workbench page
        const workbenchPage = pages.find(p => p.url().includes('workbench.html'));

        if (workbenchPage) {
            // Try keyboard shortcut (Cmd/Ctrl + Shift + M is common for manager views)
            await workbenchPage.keyboard.press('Control+Shift+M');
            await workbenchPage.waitForTimeout(1000);

            // Check for new pages
            const newPages = context.pages();
            managerPage = newPages.find(p =>
                p.url().includes('manager') ||
                p.url().includes('cascade-manager')
            );
        }
    }

    if (!managerPage) {
        throw new Error('Could not find or open Agent Manager. Make sure Antigravity is running with manager view available.');
    }

    // Find the manager frame
    await managerPage.waitForLoadState('domcontentloaded');
    const frames = managerPage.frames();
    const managerFrame = frames.find(f =>
        f.url().includes('manager') ||
        f.url().includes('cascade-manager.html')
    ) || managerPage.mainFrame();

    console.log('✅ Agent Manager opened.');

    return { page: managerPage, frame: managerFrame };
}

/**
 * Lists all agent tasks from the Manager view.
 */
export async function listAgentTasks(managerFrame: Frame): Promise<AgentTask[]> {
    console.log('📋 Listing agent tasks...');

    const tasks: AgentTask[] = [];

    // Task items in the manager (selector to be refined based on actual DOM)
    // Common patterns: list items, cards, or rows with task info
    const taskItems = managerFrame.locator('[class*="task-item"], [class*="agent-card"], [role="listitem"]');
    const count = await taskItems.count();

    console.log(`Found ${count} task items.`);

    for (let i = 0; i < count; i++) {
        const item = taskItems.nth(i);

        // Extract task info (selectors to be refined)
        const id = await item.getAttribute('data-task-id') ||
            await item.getAttribute('data-id') ||
            `task-${i}`;

        const statusText = await item.locator('[class*="status"]').innerText().catch(() => 'unknown');
        const workspace = await item.locator('[class*="workspace"], [class*="path"]').innerText().catch(() => 'unknown');
        const description = await item.locator('[class*="description"], [class*="title"]').innerText().catch(() => undefined);

        // Map status text to enum
        let status: AgentTask['status'] = 'pending';
        const statusLower = statusText.toLowerCase();
        if (statusLower.includes('running') || statusLower.includes('active')) status = 'running';
        else if (statusLower.includes('await') || statusLower.includes('approval')) status = 'awaiting_approval';
        else if (statusLower.includes('complete') || statusLower.includes('done')) status = 'completed';
        else if (statusLower.includes('fail') || statusLower.includes('error')) status = 'failed';

        tasks.push({
            id,
            status,
            workspace,
            description,
            timestamp: new Date()
        });
    }

    return tasks;
}

/**
 * Gets the status of a specific task.
 */
export async function getTaskStatus(managerFrame: Frame, taskId: string): Promise<AgentTask | null> {
    const tasks = await listAgentTasks(managerFrame);
    return tasks.find(t => t.id === taskId) || null;
}

/**
 * Approves a pending task.
 */
export async function approveTask(managerFrame: Frame, taskId: string): Promise<boolean> {
    console.log(`✅ Approving task ${taskId}...`);

    const taskItem = managerFrame.locator(`[data-task-id="${taskId}"], [data-id="${taskId}"]`).first();

    if (await taskItem.count() === 0) {
        console.error(`Task ${taskId} not found.`);
        return false;
    }

    // Find and click approve button
    const approveBtn = taskItem.locator('button:has-text("Approve"), button:has-text("Accept"), button[aria-label*="approve"]');

    if (await approveBtn.count() > 0) {
        await approveBtn.click();
        await managerFrame.waitForTimeout(500);
        console.log(`✅ Task ${taskId} approved.`);
        return true;
    }

    console.error(`No approve button found for task ${taskId}`);
    return false;
}

/**
 * Rejects a pending task.
 */
export async function rejectTask(managerFrame: Frame, taskId: string): Promise<boolean> {
    console.log(`❌ Rejecting task ${taskId}...`);

    const taskItem = managerFrame.locator(`[data-task-id="${taskId}"], [data-id="${taskId}"]`).first();

    if (await taskItem.count() === 0) {
        console.error(`Task ${taskId} not found.`);
        return false;
    }

    // Find and click reject button
    const rejectBtn = taskItem.locator('button:has-text("Reject"), button:has-text("Deny"), button[aria-label*="reject"]');

    if (await rejectBtn.count() > 0) {
        await rejectBtn.click();
        await managerFrame.waitForTimeout(500);
        console.log(`❌ Task ${taskId} rejected.`);
        return true;
    }

    console.error(`No reject button found for task ${taskId}`);
    return false;
}

/**
 * Spawns a new agent on a specific workspace with a task.
 */
export async function spawnAgent(managerFrame: Frame, workspace: string, taskDescription: string): Promise<string> {
    console.log(`🚀 Spawning agent for workspace: ${workspace}`);

    // Find "New Agent" or "Add Agent" button
    const newBtn = managerFrame.locator('button:has-text("New Agent"), button:has-text("Add Agent"), button:has-text("Spawn")');

    if (await newBtn.count() === 0) {
        throw new Error('Could not find button to spawn new agent.');
    }

    await newBtn.first().click();
    await managerFrame.waitForTimeout(500);

    // Fill in workspace path
    const workspaceInput = managerFrame.locator('input[placeholder*="workspace"], input[name*="workspace"]');
    if (await workspaceInput.count() > 0) {
        await workspaceInput.fill(workspace);
    }

    // Fill in task description
    const taskInput = managerFrame.locator('textarea[placeholder*="task"], input[placeholder*="task"], textarea[name*="description"]');
    if (await taskInput.count() > 0) {
        await taskInput.fill(taskDescription);
    }

    // Submit
    const submitBtn = managerFrame.locator('button:has-text("Start"), button:has-text("Launch"), button[type="submit"]');
    if (await submitBtn.count() > 0) {
        await submitBtn.first().click();
    }

    await managerFrame.waitForTimeout(1000);

    // Return the new task ID if we can find it
    // This would require checking the list and finding the newest item
    const tasks = await listAgentTasks(managerFrame);
    const newestTask = tasks[tasks.length - 1];

    console.log(`✅ Agent spawned with ID: ${newestTask?.id || 'unknown'}`);
    return newestTask?.id || 'unknown';
}
