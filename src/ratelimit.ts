import { Frame } from '@playwright/test';

/**
 * Rate Limit Detection module for Antigravity agent.
 * Detects when models are rate-limited and extracts availability time.
 */

export interface RateLimitInfo {
    model: string;
    isLimited: boolean;
    availableAt: string | null;  // Human-readable timestamp
    availableAtDate: Date | null; // Parsed Date object
    rawMessage?: string;
}

export interface ModelAvailability {
    [modelName: string]: RateLimitInfo;
}

/**
 * Detects rate limit status from the current popup message.
 * Returns info about the currently selected model if it's rate-limited.
 */
export async function detectRateLimit(frame: Frame): Promise<RateLimitInfo | null> {
    console.log('🔍 Checking for rate limit popup...');

    const limitInfo = await frame.evaluate(() => {
        // Look for the specific rate limit popup
        // It contains "Model quota limit exceeded" as the header
        const divs = document.querySelectorAll('div');

        for (const div of Array.from(divs)) {
            const text = (div as HTMLElement).innerText;

            // Must start with or contain the quota limit header
            if (text && text.includes('Model quota limit exceeded') && text.includes('resume')) {
                // Extract model name and time
                // Pattern: "for ModelName. You can resume using this model at DateTime."
                const modelMatch = text.match(/quota limit for ([^.]+)\./);
                const timeMatch = text.match(/resume using this model at ([^.]+)\./);

                if (modelMatch && timeMatch) {
                    return {
                        model: modelMatch[1].trim(),
                        availableAt: timeMatch[1].trim(),
                        rawMessage: text.slice(0, 300)
                    };
                }
            }
        }

        return null;
    });

    if (!limitInfo) {
        console.log('✅ No rate limit detected');
        return null;
    }

    console.log(`⚠️ Rate limit detected: ${limitInfo.model} until ${limitInfo.availableAt}`);

    // Parse the date
    let availableAtDate: Date | null = null;
    try {
        availableAtDate = new Date(limitInfo.availableAt);
        if (isNaN(availableAtDate.getTime())) {
            availableAtDate = null;
        }
    } catch {
        availableAtDate = null;
    }

    return {
        model: limitInfo.model,
        isLimited: true,
        availableAt: limitInfo.availableAt,
        availableAtDate,
        rawMessage: limitInfo.rawMessage
    };
}

/**
 * Scans the model dropdown for all rate-limited models.
 * This requires the model dropdown to be open.
 */
export async function scanAllModelLimits(frame: Frame): Promise<ModelAvailability> {
    console.log('🔍 Scanning all models for rate limits...');

    // First, try to open the model dropdown
    const modelSelector = frame.locator('button:has(svg.lucide-chevron-up)').first();
    const selectorCount = await modelSelector.count();

    if (selectorCount === 0) {
        console.warn('⚠️ Model selector not found');
        return {};
    }

    // Click to open dropdown
    await modelSelector.click();
    await frame.waitForTimeout(500);

    // Look for warning icons next to model names
    const modelsWithLimits = await frame.evaluate(() => {
        const results: { [key: string]: { isLimited: boolean } } = {};

        // Find model list items
        const items = document.querySelectorAll('[role="listbox"] [role="option"], [class*="menu-item"]');

        items.forEach(item => {
            const text = (item as HTMLElement).innerText.trim();
            // Check for warning icon
            const hasWarning = item.querySelector('svg[class*="warning"], svg[class*="alert"]') !== null;
            // Also check for the AlertTriangle lucide icon
            const hasAlertTriangle = item.querySelector('svg.lucide-triangle-alert, svg.lucide-alert-triangle') !== null;

            if (text) {
                results[text] = { isLimited: hasWarning || hasAlertTriangle };
            }
        });

        return results;
    });

    // Close dropdown
    await frame.locator('body').first().click();

    console.log(`📋 Scanned ${Object.keys(modelsWithLimits).length} models`);

    // Convert to ModelAvailability
    const availability: ModelAvailability = {};
    for (const [model, info] of Object.entries(modelsWithLimits)) {
        availability[model] = {
            model,
            isLimited: info.isLimited,
            availableAt: null,
            availableAtDate: null
        };
    }

    return availability;
}

/**
 * Gets time remaining until a rate-limited model is available.
 * Returns null if not limited or time unknown.
 */
export function getTimeRemaining(limitInfo: RateLimitInfo): string | null {
    if (!limitInfo.isLimited || !limitInfo.availableAtDate) {
        return null;
    }

    const now = new Date();
    const diff = limitInfo.availableAtDate.getTime() - now.getTime();

    if (diff <= 0) {
        return 'Available now';
    }

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
}

/**
 * Dismisses the rate limit popup if present.
 */
export async function dismissRateLimitPopup(frame: Frame): Promise<boolean> {
    try {
        const dismissBtn = frame.locator('button:has-text("Dismiss")').first();
        if (await dismissBtn.count() > 0) {
            await dismissBtn.click();
            console.log('✅ Dismissed rate limit popup');
            return true;
        }
    } catch {
        // No popup to dismiss
    }
    return false;
}

/**
 * Clicks "Select another model" button if present.
 */
export async function selectAnotherModel(frame: Frame): Promise<boolean> {
    try {
        const btn = frame.locator('button:has-text("Select another model")').first();
        if (await btn.count() > 0) {
            await btn.click();
            console.log('✅ Clicked "Select another model"');
            return true;
        }
    } catch {
        // No button present
    }
    return false;
}
