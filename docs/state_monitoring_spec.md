# State Monitoring Specification

> **Status**: Draft  
> **Date**: 2025-12-13

## 1. Overview

Detect Antigravity agent processing state (thinking, idle, error) to enable intelligent waiting and intervention.

## 2. Problem Statement

- Fixed waits are unreliable and slow
- No way to detect when agent is stuck or errored
- Manual observation required to know when response is complete

## 3. Goals

1. Detect when agent is thinking/processing
2. Detect error states (failed requests, rate limits)
3. Enable automation to wait intelligently for responses

## 4. Technical Design

### 4.1 Selectors

| State | Selector/Signal | Notes |
|-------|-----------------|-------|
| Thinking | `button:has-text("Stop")` | Primary indicator (Stop Generating) |
| Thinking | Input `[contenteditable="false"]` | Disabled during processing |
| Streaming | Thought section updating | Text growing in real-time |
| Error | `.toast-error`, `[role="alert"]` | Error messages |
| Error | "Request failed" in chat | Inline error |
| Idle | Submit button enabled | Ready for input |

### 4.2 Data Model

```typescript
type AgentState = 'idle' | 'thinking' | 'streaming' | 'error';

interface StateInfo {
    state: AgentState;
    errorMessage?: string;
    isInputEnabled: boolean;
}
```

## 5. Operations

### 5.1 getAgentState()

```typescript
async function getAgentState(frame: Frame): Promise<StateInfo> {
    const stopBtn = frame.locator('button:has-text("Stop")');
    const input = frame.locator('[contenteditable="true"]');
    
    if (await stopBtn.isVisible()) {
        return { state: 'thinking', isInputEnabled: false };
    }
    
    // Check for errors...
    return { state: 'idle', isInputEnabled: true };
}
```

### 5.2 waitForIdle()

```typescript
async function waitForIdle(frame: Frame, timeout = 60000): Promise<void> {
    await expect(frame.locator('button:has-text("Stop")')).toBeHidden({ timeout });
}
```

### 5.3 isError()

```typescript
async function isError(frame: Frame): Promise<string | null> {
    const errorToast = frame.locator('.toast-error, [role="alert"]');
    if (await errorToast.isVisible()) {
        return await errorToast.textContent();
    }
    return null;
}
```

## 6. CLI Commands

```bash
# Check current state
angrav status

# Wait for idle (blocks until agent finishes)
angrav wait --timeout 120
```

## 7. Integration Points

| Existing Code | Hook |
|--------------|------|
| `submit-prompt.spec.ts` | `waitForIdle()` after sending |
| `read-response.spec.ts` | Check `getAgentState()` before reading |

---

# Work Breakdown Structure

## Phase 1: State Detection

- [ ] Create `src/state.ts`
  - [ ] Implement `getAgentState()`
  - [ ] Implement `isThinking()`
  - [ ] Implement `isError()`

## Phase 2: Waiting Utilities

- [ ] Implement `waitForIdle()`
- [ ] Implement `waitForResponse()` with streaming detection

## Phase 3: CLI Integration

- [ ] Add `angrav status` command
- [ ] Add `angrav wait` command

## Phase 4: Testing

- [ ] Write tests in `tests/state.test.ts`
- [ ] Verify state transitions during query
