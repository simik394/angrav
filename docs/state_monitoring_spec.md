# State Monitoring Specification

> **Status**: ✅ Implemented  
> **Date**: 2025-12-14  
> **File**: `src/state.ts`

## 1. Overview

Detect Antigravity agent processing state (thinking, idle, error) to enable intelligent waiting and intervention.

## 2. Implementation

### 2.1 Data Model

```typescript
type AgentState = 'idle' | 'thinking' | 'error';

interface StateInfo {
    state: AgentState;
    errorMessage?: string;
    isInputEnabled: boolean;
}
```

### 2.2 Selectors

| State | Selector | Notes |
|-------|----------|-------|
| Thinking | `button:has-text("Stop")` | Primary indicator |
| Input | `[contenteditable="true"][data-lexical-editor="true"]` | Chat input field |
| Error | `.toast-error, [role="alert"]` | Error messages |

### 2.3 Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getAgentState` | `(frame: Frame) → StateInfo` | Detects current state |
| `waitForIdle` | `(frame: Frame, timeout?: number) → void` | Blocks until agent idle |

## 3. CLI Commands

```bash
angrav status           # Check current state
angrav status --json    # JSON output

angrav wait             # Wait for idle
angrav wait -t 120000   # Custom timeout
```

## 4. Usage Example

```typescript
import { getAgentState, waitForIdle } from './state';

const state = await getAgentState(frame);
if (state.state === 'thinking') {
    await waitForIdle(frame, 60000);
}
```
