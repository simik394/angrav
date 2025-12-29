import { Frame, Page } from '@playwright/test';

/**
 * Model and mode configuration for Antigravity agent.
 * Allows programmatic switching of AI models and conversation modes.
 */

// Available models in Antigravity
export type AgentModel =
    | 'claude-3.5-sonnet'
    | 'claude-3-opus'
    | 'claude-3-sonnet'
    | 'claude-3-haiku'
    | 'gpt-4o'
    | 'gpt-4-turbo'
    | 'gemini-1.5-pro';

// Conversation modes
export type ConversationMode = 'planning' | 'code' | 'chat' | 'fast';

export interface AgentConfig {
    model: AgentModel | string;
    mode: ConversationMode | string;
}

// Discovered selectors from UI exploration
const SELECTORS = {
    // Model dropdown is in the agent panel header area
    // Shows current model name with a dropdown arrow
    modelDropdownTrigger: '[class*="model-selector"], [class*="model-dropdown"]',
    // Fallback: Look for text containing model name
    modelDropdownFallback: ':text("Claude"), :text("GPT"), :text("Gemini")',
    // Dropdown menu items
    modelOption: '[role="option"], [role="menuitem"]',

    // Mode selector - typically icons or text buttons in the header
    modeSelector: '[class*="mode-selector"], [class*="mode-toggle"]',
    // Mode options text identifiers
    modeOptionPlanning: ':text("Planning"), :text("planning")',
    modeOptionCode: ':text("Code"), :text("code")',
    modeOptionChat: ':text("Chat"), :text("chat")',
    modeOptionFast: ':text("Fast"), :text("fast")',

    // Agent panel header for finding controls
    agentPanelHeader: '[class*="cascade-header"], [class*="agent-header"]',

    // Chat input area (for context)
    chatInput: '[contenteditable="true"][data-lexical-editor="true"]',
};

/**
 * Attempts to click the model selector dropdown.
 * Returns true if dropdown appears to have opened.
 */
async function openModelDropdown(frame: Frame): Promise<boolean> {
    console.log('🔧 Opening model dropdown...');

    // Try primary selector
    const modelTrigger = frame.locator(SELECTORS.modelDropdownTrigger).first();
    if (await modelTrigger.count() > 0) {
        await modelTrigger.click();
        await frame.waitForTimeout(500);
        return true;
    }

    // Try fallback - look for model name text
    const modelText = frame.locator(SELECTORS.modelDropdownFallback).first();
    if (await modelText.count() > 0) {
        await modelText.click();
        await frame.waitForTimeout(500);
        return true;
    }

    console.warn('⚠️ Model dropdown trigger not found');
    return false;
}

/**
 * Sets the AI model for the current session.
 * Opens the model dropdown and selects the specified model.
 * 
 * @param frame - The agent frame (cascade-panel)
 * @param model - The model to select
 */
export async function setModel(
    frame: Frame,
    model: AgentModel | string
): Promise<void> {
    console.log(`🔧 Setting model to: ${model}`);

    const opened = await openModelDropdown(frame);
    if (!opened) {
        throw new Error('Could not open model dropdown. Model selector not found.');
    }

    // Look for the model option in the dropdown
    const modelOption = frame.locator(`${SELECTORS.modelOption}:has-text("${model}")`);

    if (await modelOption.count() === 0) {
        // Try case-insensitive partial match
        const allOptions = frame.locator(SELECTORS.modelOption);
        const count = await allOptions.count();

        for (let i = 0; i < count; i++) {
            const text = await allOptions.nth(i).textContent();
            if (text?.toLowerCase().includes(model.toLowerCase())) {
                await allOptions.nth(i).click();
                console.log(`✅ Model set to: ${text}`);
                return;
            }
        }

        // Close dropdown by clicking elsewhere
        await frame.locator('body').first().click();
        throw new Error(`Model "${model}" not found in dropdown.`);
    }

    await modelOption.click();
    console.log(`✅ Model set to: ${model}`);
}

/**
 * Sets the conversation mode.
 * 
 * @param frame - The agent frame
 * @param mode - The mode to set (planning, code, chat, fast)
 */
export async function setMode(
    frame: Frame,
    mode: ConversationMode
): Promise<void> {
    console.log(`🔧 Setting mode to: ${mode}`);

    const modeMap: Record<ConversationMode, string> = {
        'planning': SELECTORS.modeOptionPlanning,
        'code': SELECTORS.modeOptionCode,
        'chat': SELECTORS.modeOptionChat,
        'fast': SELECTORS.modeOptionFast,
    };

    const selector = modeMap[mode];
    const modeButton = frame.locator(selector).first();

    if (await modeButton.count() === 0) {
        // Try looking in the agent panel header
        const header = frame.locator(SELECTORS.agentPanelHeader);
        if (await header.count() > 0) {
            const headerModeButton = header.locator(`:text("${mode}")`);
            if (await headerModeButton.count() > 0) {
                await headerModeButton.click();
                console.log(`✅ Mode set to: ${mode}`);
                return;
            }
        }

        console.warn(`⚠️ Mode button for "${mode}" not found. Modes may not be available in this version.`);
        return;
    }

    await modeButton.click();
    console.log(`✅ Mode set to: ${mode}`);
}

/**
 * Gets the current model and mode configuration.
 * Reads values from the UI.
 * 
 * @param frame - The agent frame
 */
export async function getConfig(frame: Frame): Promise<AgentConfig> {
    console.log('🔧 Reading current configuration...');

    let model = 'unknown';
    let mode = 'unknown';

    // Try to read model from the model selector text
    const modelTrigger = frame.locator(SELECTORS.modelDropdownTrigger).first();
    if (await modelTrigger.count() > 0) {
        model = (await modelTrigger.textContent()) || 'unknown';
    } else {
        // Fallback: look for known model names in the header
        const modelPatterns = ['Claude', 'GPT', 'Gemini'];
        for (const pattern of modelPatterns) {
            const modelText = frame.locator(`:text("${pattern}")`).first();
            if (await modelText.count() > 0) {
                model = (await modelText.textContent()) || 'unknown';
                break;
            }
        }
    }

    // Try to determine mode from active button state
    const modeButtons = ['planning', 'code', 'chat', 'fast'];
    for (const m of modeButtons) {
        const button = frame.locator(`:text("${m}")`).first();
        if (await button.count() > 0) {
            // Check if it appears "active" (e.g., has certain class)
            const isActive = await button.evaluate((el) => {
                return el.classList.contains('active') ||
                    el.getAttribute('aria-selected') === 'true' ||
                    el.getAttribute('data-state') === 'active';
            });
            if (isActive) {
                mode = m;
                break;
            }
        }
    }

    const config: AgentConfig = {
        model: model.trim(),
        mode: mode.trim(),
    };

    console.log(`📋 Current config: model="${config.model}", mode="${config.mode}"`);
    return config;
}

/**
 * Lists available models by opening the dropdown and reading options.
 * 
 * @param frame - The agent frame
 */
export async function listModels(frame: Frame): Promise<string[]> {
    console.log('🔧 Listing available models...');

    const opened = await openModelDropdown(frame);
    if (!opened) {
        console.warn('⚠️ Could not open model dropdown');
        return [];
    }

    const options = frame.locator(SELECTORS.modelOption);
    const count = await options.count();
    const models: string[] = [];

    for (let i = 0; i < count; i++) {
        const text = await options.nth(i).textContent();
        if (text) {
            models.push(text.trim());
        }
    }

    // Close dropdown by clicking elsewhere
    await frame.locator('body').first().click();

    console.log(`📋 Available models: ${models.join(', ')}`);
    return models;
}
