# Output Extraction Specification

> **Status**: ✅ Implemented  
> **Date**: 2025-12-14  
> **File**: `src/extraction.ts`

## 1. Overview

Programmatically extract code blocks, reasoning (thoughts), and agent answers from the chat interface.

## 2. Implementation

### 2.1 Data Model

```typescript
interface CodeBlock {
    language: string;
    content: string;
    filename?: string;
}

interface AgentResponse {
    fullText: string;
    thoughts?: string;
    codeBlocks: CodeBlock[];
    timestamp: Date;
}
```

### 2.2 Selectors

| Component | Selector | Notes |
|-----------|----------|-------|
| Code Block | `div.prose pre > code` | Contains source code |
| Language | `class="language-*"` | From class attribute |
| Filename | `.code-block-header, [class*="filename"]` | Header element |
| Thought Toggle | `button:has-text("Thought")` | Expands thoughts |
| Thought Content | `.pl-6 .prose` | Container for thoughts |
| Answer Prose | `div.bg-ide-chat-background .prose` | Main answer text |

### 2.3 Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `extractCodeBlocks` | `(frame) → CodeBlock[]` | All code blocks |
| `extractCodeBlocksByLanguage` | `(frame, lang) → CodeBlock[]` | Filtered by language |
| `extractThoughts` | `(frame) → string?` | Agent reasoning |
| `extractAnswer` | `(frame) → string` | Main answer text |
| `extractResponse` | `(frame) → AgentResponse` | Full response |

## 3. CLI Commands

```bash
angrav output last           # Get last response
angrav output last --json    # JSON output

angrav output code           # Extract code blocks
angrav output code -l python # Filter by language
```

## 4. Usage Example

```typescript
import { extractResponse, extractCodeBlocksByLanguage } from './extraction';

const response = await extractResponse(frame);
console.log(response.thoughts);
console.log(response.codeBlocks.length);

const pythonCode = await extractCodeBlocksByLanguage(frame, 'python');
```
