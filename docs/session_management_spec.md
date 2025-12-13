# Session Management Specification

> **Status**: Draft  
> **Date**: 2025-12-13

## 1. Overview

Manage Antigravity conversation sessions - start new conversations and retrieve conversation history.

## 2. Problem Statement

- Context pollution between tasks leads to confused agent responses
- No programmatic access to conversation history for auditing
- Manual session management is error-prone

## 3. Goals

1. Reset context immediately without restarting the IDE
2. Retrieve full conversation history for audit/analysis
3. Detect when agent is going in loops

## 4. Technical Design

### 4.1 Selectors

| Action | Selector | Notes |
|--------|----------|-------|
| New Conversation | `[data-tooltip-id="new-conversation-tooltip"]` | Button in cascade-panel |
| Chat History Rows | `div.bg-ide-chat-background` | Each message row |
| User Messages | `span[data-lexical-text="true"]` | User input text |
| Agent Responses | `.prose` | Markdown-rendered responses |

### 4.2 Data Model

```typescript
interface ConversationMessage {
    role: 'user' | 'agent';
    content: string;
    thoughts?: string;
    timestamp?: Date;
}

interface ConversationHistory {
    messages: ConversationMessage[];
    messageCount: number;
}
```

## 5. Operations

### 5.1 startNewConversation()

```typescript
async function startNewConversation(frame: Frame): Promise<void> {
    const btn = frame.locator('[data-tooltip-id="new-conversation-tooltip"]');
    await btn.click();
    // Wait for chat to clear
    await frame.waitForTimeout(1000);
}
```

### 5.2 getConversationHistory()

```typescript
async function getConversationHistory(frame: Frame): Promise<ConversationHistory> {
    const rows = frame.locator('div.bg-ide-chat-background');
    // Extract messages from each row
    // Return structured history
}
```

## 6. CLI Commands

```bash
# Start new conversation
angrav session new

# Get conversation history
angrav session history
angrav session history --json
angrav session history --last 10
```

## 7. Integration Points

| Existing Code | Hook |
|--------------|------|
| `submit-prompt.spec.ts` | Call `startNewConversation()` before test |
| `read-response.spec.ts` | Use `getConversationHistory()` for extraction |

---

# Work Breakdown Structure

## Phase 1: Core Functions

- [ ] Create `src/session.ts`
  - [ ] Implement `startNewConversation()`
  - [ ] Implement `getConversationHistory()`
  - [ ] Define `ConversationMessage` types

## Phase 2: CLI Integration

- [ ] Create CLI commands in `src/cli.ts`
  - [ ] `angrav session new`
  - [ ] `angrav session history`

## Phase 3: Testing

- [ ] Write tests in `tests/session.test.ts`
- [ ] Run tests: `npx playwright test tests/session.test.ts`
- [ ] Verify new conversation clears chat
- [ ] Verify history extraction accuracy
