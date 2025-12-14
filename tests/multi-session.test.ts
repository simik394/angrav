import { test, expect } from '@playwright/test';
import { connectToApp } from '../src/core';
import { SessionRegistry } from '../src/registry';

test.describe('Multi-Session Monitoring', () => {

    test('should discover active sessions', async () => {
        const { browser, context } = await connectToApp();

        try {
            const registry = new SessionRegistry(context);
            const sessions = await registry.discover();

            console.log(`Discovered ${sessions.length} sessions:`);
            for (const session of sessions) {
                console.log(`  - ${session.id}: ${session.state} (${session.metadata.title})`);
            }

            // Should find at least one session
            expect(sessions.length).toBeGreaterThanOrEqual(1);

            // Each session should have valid properties
            for (const session of sessions) {
                expect(session.id).toBeTruthy();
                expect(['idle', 'thinking', 'error']).toContain(session.state);
                expect(session.frame).toBeTruthy();
                expect(session.page).toBeTruthy();
            }

            // Registry should track the sessions
            expect(registry.list().length).toBe(sessions.length);

        } finally {
            await browser.close();
        }
    });

    test('should poll for state changes', async () => {
        const { browser, context } = await connectToApp();

        try {
            const registry = new SessionRegistry(context);
            await registry.discover();

            // Set up event listener
            const stateChanges: any[] = [];
            registry.on('state_change', (event) => {
                stateChanges.push(event);
                console.log(`State change: ${event.sessionId} ${event.previousState} → ${event.currentState}`);
            });

            // Start polling with faster interval for testing
            registry.startPolling(1000);

            // Wait a bit to see if we get any events
            await new Promise(r => setTimeout(r, 3000));

            // Stop polling
            registry.stopPolling();

            console.log(`Captured ${stateChanges.length} state changes during polling`);

            // Note: we may or may not see changes depending on agent activity
            // This test mainly verifies polling doesn't crash

        } finally {
            await browser.close();
        }
    });

    test('should list sessions by state', async () => {
        const { browser, context } = await connectToApp();

        try {
            const registry = new SessionRegistry(context);
            await registry.discover();

            const idleSessions = registry.getByState('idle');
            const thinkingSessions = registry.getByState('thinking');

            console.log(`Idle: ${idleSessions.length}, Thinking: ${thinkingSessions.length}`);

            // All sessions should be in one state or another
            expect(idleSessions.length + thinkingSessions.length).toBe(registry.size);

        } finally {
            await browser.close();
        }
    });
});
