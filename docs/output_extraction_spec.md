# Output Extraction Specification

> **Status**: Draft  
> **Date**: 2025-12-13

## 1. Overview

Programmatically extract code blocks, reasoning (thoughts), and agent answers from the chat interface.

## 2. Problem Statement

- Manual copy-pasting of code is inefficient
- Hard to distinguish between reasoning and final answer
- No structured way to get the output for downstream processing

## 3. Goals

1. Extract all code blocks with language metadata
2. Extract reasoning/thought sections for logic verification
3. Parse final answer text cleanly

## 4. Technical Design

### 4.1 Selectors

| Component | Selector | Notes |
|-----------|----------|-------|
| Code Block | `div.prose pre > code` | Contains source code |
| Language Tag | `div.code-block-header` or attributes | Metadata |
| Thought Toggle | `button:has-text("Thought")` | Expands thoughts |
| Thought Content | `.pl-6 .prose` | Container for thoughts |
| Answer Prose | `.prose` | Main answer text |

### 4.2 Data Model

```typescript
interface CodeBlock {
    language: string;
    content: string;
}

interface AgentResponse {
    fullText: string;
    thoughts?: string;
    codeBlocks: CodeBlock[];
    timestamp: Date;
}
```

## 5. Operations

### 5.1 extractResponse()

```typescript
async function extractResponse(frame: Frame, messageIndex: number = -1): Promise<AgentResponse> {
    // Locate the message container
    // Extract thoughts if available
    // Extract answer text
    // Extract code blocks
}
```

### 5.2 getCodeBlocks()

```typescript
async function getCodeBlocks(frame: Frame): Promise<CodeBlock[]> {
    const blocks = frame.locator('div.prose pre > code');
    // iterate and map to CodeBlock structure
}
```

## 6. CLI Commands

```bash
# Get last response
angrav output last

# Get last response as JSON
angrav output last --json

# Extract only code
angrav output code --lang python
```

## 7. Integration Points

| Existing Code | Hook |
|--------------|------|
| `read-response.spec.ts` | Refactor to use `extractResponse` |
| `session_management` | Used by session history |

---

# Work Breakdown Structure

## Phase 1: Core Extraction

- [ ] Create `src/extraction.ts`
  - [ ] Implement `extractResponse()`
  - [ ] Implement `getCodeBlocks()`
  - [ ] Handle "Thinking" toggle logic

## Phase 2: CLI Integration

- [ ] Add output commands to CLI
  - [ ] `angrav output`

## Phase 3: Testing

- [ ] Write tests in `tests/extraction.test.ts`
- [ ] Verify code block filtering
- [ ] Verify thought extraction
