/**
 * Output formatting utilities for CLI JSON mode compatibility.
 */

export interface CLIResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: string;
}

/**
 * Wraps data in a standard CLI result envelope.
 */
export function wrapResult<T>(data: T): CLIResult<T> {
    return {
        success: true,
        data,
        timestamp: new Date().toISOString()
    };
}

/**
 * Creates an error result.
 */
export function wrapError(error: Error | string): CLIResult {
    return {
        success: false,
        error: typeof error === 'string' ? error : error.message,
        timestamp: new Date().toISOString()
    };
}

/**
 * Outputs result based on json flag.
 * If json=true, outputs structured JSON.
 * If json=false, calls the human-readable formatter.
 */
export function output<T>(
    data: T,
    jsonMode: boolean,
    humanFormatter?: (data: T) => void
): void {
    if (jsonMode) {
        console.log(JSON.stringify(wrapResult(data), null, 2));
    } else if (humanFormatter) {
        humanFormatter(data);
    } else {
        // Default human output
        console.log(data);
    }
}

/**
 * Outputs an error and exits.
 */
export function outputError(error: Error | string, jsonMode: boolean): never {
    if (jsonMode) {
        console.log(JSON.stringify(wrapError(error), null, 2));
    } else {
        console.error('Error:', typeof error === 'string' ? error : error.message);
    }
    process.exit(1);
}
