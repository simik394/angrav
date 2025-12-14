# Model Configuration Specification

> **Status**: 📋 Planned  
> **Date**: 2025-12-14  
> **Priority**: Phase 4 in WBS

## 1. Overview

Configure the intelligent agent's parameters: Model selection and Conversation Mode (Planning vs Fast).

## 2. Problem Statement

- Switching models manually is repetitive
- Different tasks require different models (Planning = high reasoning, Fast = simple edits)
- No way to ensure the correct model is set before starting a task

## 3. Goals

1. Switch between available models programmatically
2. Toggle between Planning and Fast modes based on task complexity
3. Verify current configuration

## 4. Technical Design

### 4.1 Selectors (Unverified)

| Setting | Selector | Status |
|---------|----------|--------|
| Model Dropdown | `.model-selector-trigger` | ⏳ Needs research |
| Model Option | `[role="option"]` | ⏳ Needs research |
| Mode Dropdown | `.mode-selector-trigger` | ⏳ Needs research |
| Mode Options | "Planning", "Fast", "Chat" | ⏳ Needs research |

### 4.2 Proposed Data Model

```typescript
type AgentModel = 'claude-3-opus' | 'claude-3-sonnet' | 'gpt-4o';
type ConversationMode = 'planning' | 'fast' | 'chat';

interface AgentConfig {
    model: AgentModel;
    mode: ConversationMode;
}
```

## 5. Proposed Operations

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

### 5.3 getConfig()

```typescript
async function getConfig(frame: Frame): Promise<AgentConfig> {
    // Read current model and mode from UI
}
```

## 6. Proposed CLI Commands

```bash
angrav config --model claude-3-opus
angrav config --mode planning
angrav config show
angrav config show --json
```

## 7. Work Breakdown

| Task | Est. Time | Complexity |
|------|-----------|------------|
| Analyze model dropdown selectors | 45min | 3 |
| Implement `setModel()` | 45min | 3 |
| Analyze mode dropdown selectors | 30min | 2 |
| Implement `setMode()` | 45min | 3 |
| Implement `getConfig()` | 30min | 2 |
| CLI integration | 40min | 2 |
| Testing | 45min | 2 |

**Total: ~5h anticipated**
