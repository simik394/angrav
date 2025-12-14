# Review & Execution Specification

> **Status**: 📋 Planned  
> **Date**: 2025-12-14  
> **Priority**: Phase 5 in WBS (Most Complex)

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

### 4.1 Selectors (Unverified)

| Action | Selector | Status |
|--------|----------|--------|
| Apply Code | `button:has-text("Apply")` | ⏳ Needs research |
| Save File | `button:has-text("Save")` | ⏳ Needs research |
| Undo | `[data-lucide="undo2"]` | ⏳ Needs research |
| Terminal | `.xterm-screen` | ⏳ Needs research |
| Terminal Accessibility | `.xterm-accessibility` | ⏳ Needs research |

### 4.2 Proposed Data Model

```typescript
interface TerminalState {
    lastOutput: string;
    exitCode?: number;
}
```

## 5. Proposed Operations

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
    // Xterm canvas reading requires accessibility tree
    // or clipboard hack
    return await page.locator('.xterm-accessibility').innerText();
}
```

## 6. Proposed CLI Commands

```bash
angrav apply              # Apply all pending changes
angrav apply --file *.ts  # Apply to specific files

angrav undo               # Undo last action

angrav terminal read      # Read terminal output
angrav terminal read --json
```

## 7. Challenges

| Challenge | Notes |
|-----------|-------|
| Xterm Canvas | Terminal renders to canvas, text extraction is hard |
| Apply Button Scope | Buttons are per-code-block, need to target correctly |
| Undo Scope | May affect multiple files |

---

> 📋 **Work Breakdown**: See [[wbs|wbs.md]] Phase 5

