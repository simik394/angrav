# Context Injection Specification

> **Status**: 📋 Planned  
> **Date**: 2025-12-14  
> **Priority**: Phase 3 in WBS

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

### 4.1 Selectors (Unverified)

| Action | Selector | Status |
|--------|----------|--------|
| Chat Input | `[contenteditable="true"][data-lexical-editor="true"]` | ✅ Verified |
| File Popup | TBD - appears after `@` typed | ⏳ Needs research |
| Add Context Button | Plus icon button | ⏳ Needs research |
| Images Option | Menu item "Images" | ⏳ Needs research |
| Docs Option | Menu item "Docs" | ⏳ Needs research |

### 4.2 File Reference Flow

```
1. Type "@" in chat input
2. Wait for popup to appear
3. Type filename
4. Select from list (click or Enter)
5. File reference appears as chip in input
```

### 4.3 Proposed Data Model

```typescript
interface FileContext {
    path: string;
    type: 'file' | 'image' | 'document';
}
```

## 5. Proposed Operations

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

## 6. Proposed CLI Commands

```bash
angrav context add-file path/to/file.ts
angrav context add-files file1.ts file2.ts
angrav context add-image screenshot.png
angrav context add-doc spec.pdf
```

## 7. Work Breakdown

| Task | Est. Time | Complexity |
|------|-----------|------------|
| Analyze popup structure | 1h | 3 |
| Implement `addFileContext()` | 1.5h | 4 |
| Handle popup selection | 1h | 4 |
| Identify Add Context button | 30min | 2 |
| Implement `uploadImage()` | 1h | 3 |
| Implement `uploadDocument()` | 1h | 3 |
| CLI integration | 40min | 2 |
| Testing | 1h | 3 |

**Total: ~8h anticipated**
