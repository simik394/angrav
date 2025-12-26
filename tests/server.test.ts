import { test, expect } from '@playwright/test';
import * as http from 'http';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8099';

// ============================================================================
// Helper Functions
// ============================================================================

async function httpRequest(
    method: string,
    path: string,
    body?: object
): Promise<{ status: number; data: unknown }> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, SERVER_URL);
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode || 500,
                        data: data ? JSON.parse(data) : null
                    });
                } catch {
                    resolve({ status: res.statusCode || 500, data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// ============================================================================
// Health Endpoint Tests
// ============================================================================

test.describe('Health Endpoint', () => {
    test('GET /health returns status ok', async () => {
        const { status, data } = await httpRequest('GET', '/health');

        expect(status).toBe(200);
        expect(data).toMatchObject({
            status: 'ok',
            connected: expect.any(Boolean),
            queueLength: expect.any(Number),
            isProcessing: expect.any(Boolean)
        });
    });
});

// ============================================================================
// Models Endpoint Tests
// ============================================================================

test.describe('Models Endpoint', () => {
    test('GET /v1/models returns model list', async () => {
        const { status, data } = await httpRequest('GET', '/v1/models');

        expect(status).toBe(200);
        expect(data).toMatchObject({
            object: 'list',
            data: expect.arrayContaining([
                expect.objectContaining({
                    id: 'gemini-antigravity',
                    object: 'model',
                    owned_by: 'angrav'
                })
            ])
        });
    });
});

// ============================================================================
// Chat Completions Endpoint Tests
// ============================================================================

test.describe('Chat Completions Endpoint', () => {
    test('POST /v1/chat/completions rejects invalid JSON', async () => {
        const { status, data } = await httpRequest('POST', '/v1/chat/completions');

        expect(status).toBe(400);
        expect(data).toMatchObject({
            error: expect.objectContaining({
                message: expect.stringContaining('Invalid')
            })
        });
    });

    test('POST /v1/chat/completions rejects missing messages', async () => {
        const { status, data } = await httpRequest('POST', '/v1/chat/completions', {
            model: 'gemini-antigravity'
        });

        expect(status).toBe(400);
        expect(data).toMatchObject({
            error: expect.objectContaining({
                message: expect.stringContaining('messages')
            })
        });
    });

    test('POST /v1/chat/completions rejects streaming requests', async () => {
        const { status, data } = await httpRequest('POST', '/v1/chat/completions', {
            model: 'gemini-antigravity',
            messages: [{ role: 'user', content: 'Hello' }],
            stream: true
        });

        expect(status).toBe(501);
        expect(data).toMatchObject({
            error: expect.objectContaining({
                message: expect.stringContaining('Streaming')
            })
        });
    });

    // This test requires Antigravity to be running
    test.skip('POST /v1/chat/completions returns valid response', async () => {
        const { status, data } = await httpRequest('POST', '/v1/chat/completions', {
            model: 'gemini-antigravity',
            messages: [{ role: 'user', content: 'Say "test passed" and nothing else' }]
        });

        expect(status).toBe(200);
        expect(data).toMatchObject({
            id: expect.stringMatching(/^chatcmpl-/),
            object: 'chat.completion',
            created: expect.any(Number),
            model: 'gemini-antigravity',
            choices: expect.arrayContaining([
                expect.objectContaining({
                    index: 0,
                    message: expect.objectContaining({
                        role: 'assistant',
                        content: expect.any(String)
                    }),
                    finish_reason: 'stop'
                })
            ]),
            usage: expect.objectContaining({
                prompt_tokens: expect.any(Number),
                completion_tokens: expect.any(Number),
                total_tokens: expect.any(Number)
            })
        });
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test.describe('Error Handling', () => {
    test('GET /unknown returns 404', async () => {
        const { status, data } = await httpRequest('GET', '/unknown');

        expect(status).toBe(404);
        expect(data).toMatchObject({
            error: expect.objectContaining({
                message: expect.stringContaining('Not found')
            })
        });
    });

    test('POST /v1/models returns 404 (wrong method)', async () => {
        const { status } = await httpRequest('POST', '/v1/models');

        expect(status).toBe(404);
    });
});

// ============================================================================
// CORS Tests
// ============================================================================

test.describe('CORS Headers', () => {
    test('Response includes CORS headers', async () => {
        // Manual check for CORS - our httpRequest helper doesn't expose headers
        // so we use a direct http call
        await new Promise<void>((resolve, reject) => {
            const url = new URL('/health', SERVER_URL);
            http.get({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname
            }, (res) => {
                expect(res.headers['access-control-allow-origin']).toBe('*');
                resolve();
            }).on('error', reject);
        });
    });
});
