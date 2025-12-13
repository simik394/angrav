# Context Injection Specification

> **Status**: Draft  
> **Date**: 2025-12-13

## 1. Overview

Feed the Antigravity agent with file context, images, and documents programmatically.

## 2. Problem Statement

- Manual typing of `@file` references is slow and error-prone
- No automation for bulk file injection
- Image/document upload requires GUI interaction

## 3. Goals

1. Add file context via `@file` syntax programmatically
2. Upload images and documents via automation
3. Support bulk context injection for complex tasks

## 4. Technical Design

### 4.1 Selectors

| Action | Selector | Notes |
|--------|----------|-------|
| Chat Input | `[contenteditable="true"][data-lexical-editor="true"]` | Main input field |
| File Popup | TBD - appears after `@` typed | File selection dropdown |
| Add Context Button | Plus icon button | Opens context menu |
| Images Option | Menu item "Images" | In context menu |
| Docs Option | Menu item "Docs" | In context menu |

### 4.2 File Reference Flow

```
1. Type "@" in chat input
2. Wait for popup to appear
3. Type filename
4. Select from list (click or Enter)
5. File reference appears as chip in input
```

### 4.3 Data Model

```typescript
interface FileContext {
    path: string;
    type: 'file' | 'image' | 'document';
}

interface ContextInjectionOptions {
    files?: string[];
    images?: string[];
    documents?: string[];
}
```

## 5. Operations

### 5.1 addFileContext()

```typescript
async function addFileContext(frame: Frame, filename: string): Promise<void> {
    const input = frame.locator('[contenteditable="true"][data-lexical-editor="true"]');
    await input.type('@');
    // Wait for popup
    await frame.waitForTimeout(500);
    await input.type(filename);
    // Select first match
    await input.press('Enter');
}
```

### 5.2 uploadImage() / uploadDocument()

```typescript
async function uploadImage(frame: Frame, imagePath: string): Promise<void> {
    // Click Add Context button
    // Select Images option
    // Handle file picker (Playwright setInputFiles)
}
```

## 6. CLI Commands

```bash
# Add file context
angrav context add-file path/to/file.ts

# Add multiple files
angrav context add-files file1.ts file2.ts

# Upload image
angrav context add-image screenshot.png

# Upload document
angrav context add-doc spec.pdf
```

## 7. Integration Points

| Existing Code | Hook |
|--------------|------|
| `submit-prompt.spec.ts` | Add context before sending prompt |
| New automation scripts | Bulk file injection |

---

# Work Breakdown Structure

## Phase 1: File Context (@file)

- [ ] Analyze popup structure (dump HTML after typing @)
- [ ] Create `src/context.ts`
  - [ ] Implement `addFileContext()`
  - [ ] Handle popup selection

## Phase 2: Image/Document Upload

- [ ] Identify Add Context button selector
- [ ] Implement `uploadImage()`
- [ ] Implement `uploadDocument()`
- [ ] Handle file picker dialogs

## Phase 3: CLI Integration

- [ ] Add context commands to CLI
  - [ ] `angrav context add-file`
  - [ ] `angrav context add-image`

## Phase 4: Testing

- [ ] Write tests in `tests/context.test.ts`
- [ ] Verify file reference appears in input
- [ ] Verify image upload success
