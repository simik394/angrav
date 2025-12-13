# Review & Execution Specification

> **Status**: Draft  
> **Date**: 2025-12-13

## 1. Overview

Control the agent's actions by applying code changes, rejecting bad logic, and verifying terminal outputs.

## 2. Problem Statement

- Manually applying code blocks is slow
- "Apply" buttons are context-dependent and hard to target
- Verifying if a command succeeded requires reading xterm output manually

## 3. Goals

1. Automate "Apply" / "Save to File" clicks
2. Support "Undo" for bad agent actions
3. Read terminal output to verify command success/failure

## 4. Technical Design

### 4.1 Selectors

| Action | Selector | Notes |
|--------|----------|-------|
| Apply Code | `button:has-text("Apply")` | Often on code block header |
| Save File | `button:has-text("Save")` | Alternative to Apply |
| Undo | `[data-lucide="undo2"]` | Revert last action |
| Terminal | `.xterm-screen` | Canvas/DOM for terminal |
| Terminal Text | `.xterm-helper-textarea` | Hidden textarea for input/output |

### 4.2 Data Model

```typescript
interface TerminalState {
    lastOutput: string;
    exitCode?: number; // Inferred from prompt
}
```

## 5. Operations

### 5.1 applyCodeChanges()

```typescript
async function applyCodeChanges(frame: Frame, filePattern?: string): Promise<void> {
    // Find Apply buttons matching the file pattern
    // Click them
    // Wait for completion
}
```

### 5.2 undoLastAction()

```typescript
async function undoLastAction(frame: Frame): Promise<void> {
    await frame.locator('[data-lucide="undo2"]').click();
}
```

### 5.3 readTerminal()

```typescript
async function readTerminal(page: Page): Promise<string> {
    // Xterm canvas reading is hard, might need clipboard hack
    // or accessibility tree
    return await page.locator('.xterm-accessibility').innerText();
}
```

## 6. CLI Commands

```bash
# Apply all changes
angrav apply

# Undo
angrav undo

# Read terminal
angrav terminal read
```

## 7. Integration Points

| Existing Code | Hook |
|--------------|------|
| `submit-prompt.spec.ts` | Verify terminal after command execution |

---

# Work Breakdown Structure

## Phase 1: Action Control

- [ ] Create `src/execution.ts`
  - [ ] Implement `applyCodeChanges()`
  - [ ] Implement `undoLastAction()`

## Phase 2: Terminal Verification

- [ ] Research robust Xterm reading strategy
- [ ] Implement `readTerminal()`

## Phase 3: CLI Integration

- [ ] Add execution commands
  - [ ] `angrav apply`
  - [ ] `angrav undo`

## Phase 4: Testing

- [ ] Write tests in `tests/execution.test.ts`
- [ ] Verify code application
- [ ] Verify undo functionality
