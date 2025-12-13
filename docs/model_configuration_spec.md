# Model Configuration Specification

> **Status**: Draft  
> **Date**: 2025-12-13

## 1. Overview

Configure the intelligent agent's parameters: Model selection (e.g., Claude, GPT) and Conversation Mode (Planning vs Fast).

## 2. Problem Statement

- Switching models manually is repetitive
- Different tasks require different models (Planning = high reasoning, Fast = simple edits)
- No way to ensure the correct model is set before starting a task

## 3. Goals

1. Switch between available models programmatically
2. Toggle between Planning and Fast modes based on task complexity
3. Verify current configuration

## 4. Technical Design

### 4.1 Selectors

| Setting | Selector | Notes |
|---------|----------|-------|
| Model Dropdown | `.model-selector-trigger` | Opens model list |
| Model Option | `[role="option"]` | Individual model item |
| Mode Dropdown | `.mode-selector-trigger` | Left of model selector |
| Mode Option | "Planning", "Fast", "Chat" | Menu items |

### 4.2 Data Model

```typescript
type AgentModel = 'claude-3-opus' | 'claude-3-sonnet' | 'gpt-4o';
type ConversationMode = 'planning' | 'fast' | 'chat';

interface AgentConfig {
    model: AgentModel;
    mode: ConversationMode;
}
```

## 5. Operations

### 5.1 setModel(modelName)

```typescript
async function setModel(frame: Frame, model: AgentModel): Promise<void> {
    await frame.click('.model-selector-trigger');
    await frame.click(`[role="option"]:has-text("${model}")`);
}
```

### 5.2 setMode(modeName)

```typescript
async function setMode(frame: Frame, mode: ConversationMode): Promise<void> {
    await frame.click('.mode-selector-trigger');
    await frame.click(`text="${mode}"`);
}
```

## 6. CLI Commands

```bash
# Set config
angrav config --model claude-3-opus
angrav config --mode planning

# Get config
angrav config show
```

## 7. Integration Points

| Existing Code | Hook |
|--------------|------|
| `session_management` | Set config when starting new session |

---

# Work Breakdown Structure

## Phase 1: Configuration Logic

- [ ] Create `src/config.ts`
  - [ ] Implement `setModel()`
  - [ ] Implement `setMode()`
  - [ ] Implement `getConfig()`

## Phase 2: CLI Integration

- [ ] Add config commands to CLI
  - [ ] `angrav config`

## Phase 3: Testing

- [ ] Write tests in `tests/config.test.ts`
- [ ] Verify model switching persists
- [ ] Verify mode switching
