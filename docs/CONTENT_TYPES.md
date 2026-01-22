# Angrav Session Export - Content Types

This document lists all content types that the DOM scraping script can extract from Antigravity sessions.

## Complete Content Type Reference

### 1. `user` - User Messages
User prompts and queries sent to the agent.

**Example:**
```
can you scrape the history from the containerized antigravity for me and dump it to a file in the history_dump directory?
```

---

### 2. `agent` - Agent Responses
Prose text responses from the agent (non-code, non-tool content).

**Example:**
```
I'll help you scrape the history from the containerized Antigravity and save it to a file. Let me first check the current state of the container and then extract the session history.
```

---

### 3. `thought` - Agent Thinking
Internal reasoning displayed in "Thought for X seconds" expandable sections.

**Example:**
```
I need to think about how to approach this. The user wants to export the session history. First, I should check if the container is running, then identify which CDP endpoint to use...
```

---

### 4. `tool-call` - Tool Invocations
Headers for tool calls showing which tool was used.

**Example:**
```
Used tool run_command
```json
{
  "CommandLine": "docker ps | grep angrav",
  "Cwd": "/home/sim",
  "SafeToAutoRun": true
}
```
```

---

### 5. `tool-call-arg` - Tool Arguments
JSON arguments passed to tools (captured separately when visible).

**Example:**
```json
{
  "TargetFile": "/home/sim/project/src/utils.ts",
  "CodeMarkdownLanguage": "typescript",
  "Instruction": "Add error handling",
  "StartLine": 45,
  "EndLine": 60
}
```

---

### 6. `tool-output` - Tool Output
Results returned from tool executions.

**Example:**
```
CONTAINER ID   IMAGE             STATUS         PORTS
a1b2c3d4e5f6   angrav-browser   Up 2 hours     0.0.0.0:9223->9222/tcp
```

---

### 7. `tool-result` - Result Buttons
Buttons indicating result availability (e.g., "Show JavaScript Result").

**Example:**
```
Show JavaScript Result
```

---

### 8. `code` - Code Blocks
Source code snippets shown in the conversation.

**Example:**
```typescript
export async function getSessionHistory(page: Page): Promise<SessionHistory> {
    const items = await page.evaluate(() => {
        return document.querySelectorAll('.message-item');
    });
    return { items: Array.from(items) };
}
```

---

### 9. `terminal` - Terminal Commands
Shell commands with their output, showing prompt and results.

**Example:**
```
~/project $ npm run build

> project@1.0.0 build
> tsc && vite build

✓ 142 modules transformed.
dist/index.html   1.42 kB
dist/assets/main.js   245.32 kB
```

---

### 10. `file-change` - File Change Summaries
Headers and summaries for file modifications.

**Example:**
```
Files With Changes (3 files)
```

---

### 11. `file-link` - File Links with Stats
Clickable file paths with action verbs and change statistics.

**Example:**
```
Edited src/session.ts +38 -3
```

---

### 12. `file-diff` - Diff Content ⭐
**Actual line-by-line diff content showing additions and deletions.**
This is captured after clicking "Open diff" buttons.

**Example:**
```diff
 export function processData(input: string): Result {
-    const result = input.split(',');
+    const result = input.trim().split(',').filter(Boolean);
     return {
-        items: result
+        items: result,
+        count: result.length
     };
 }
```

---

### 13. `task-status` - Task Status Indicators
Phase markers showing Planning/Executing/Verifying states.

**Example:**
```
EXECUTION: Implementing DOM scraping improvements
```

---

### 14. `timestamp` - Time Markers
Relative or absolute time indicators in the conversation.

**Example:**
```
2 minutes ago
```

---

### 15. `approval` - User Decision Buttons
Accept/Reject buttons for approving agent actions.

**Example:**
```
Accept all changes
```

---

### 16. `error` - Error Messages
Error messages highlighted in red.

**Example:**
```
Error: browserType.connectOverCDP: socket hang up
Call log:
  - <ws preparing> retrieving websocket url from http://localhost:9223
```

---

### 17. `image` - Image Attachments
Non-icon images (screenshots, attachments, generated images).

**Example:**
```
[Image: screenshot_2026-01-08.png] (1920x1080)
```

---

### 18. `table` - Tables
Markdown or HTML tables in the conversation.

**Example:**
```
| Method          | Result              |
|-----------------|---------------------|
| mitmproxy       | ❌ Breaks app       |
| CDP Fetch       | ❌ No traffic       |
| Frida hooks     | ⚠️ Unstable        |
| DOM scraping    | ✅ Works reliably   |
```

---

## Extraction Details

### Diff Extraction Process

The script performs these steps to capture diffs:

1. **Clicks "Expand all" buttons** - Opens collapsed sections
2. **Clicks "Thought for X" buttons** - Expands agent reasoning
3. **Clicks "Used tool" sections** - Shows tool arguments
4. **Clicks file change rows** (+N -M stats) - Expands file changes
5. **Clicks "Open diff" buttons** - Shows inline diff viewer
6. **Extracts diff content** from:
   - Monaco diff editors (`.view-lines`)
   - Code block containers (`.code-block`)
   - Monospace elements with diff markers (`+`, `-`, `@@`)

### Usage

```bash
# Dump with all expansions including diffs
BROWSER_CDP_ENDPOINT=http://localhost:9223 npx tsx scripts/dump_history.ts

# Generate HTML archive with all content types
BROWSER_CDP_ENDPOINT=http://localhost:9223 npx tsx scripts/dump_history.ts --all --html-index
```

### Output Example

The JSON output includes type annotations:

```json
{
  "items": [
    { "type": "user", "content": "fix the bug in utils.ts" },
    { "type": "agent", "content": "I'll analyze the file and fix the issue." },
    { "type": "tool-call", "content": "Used tool view_file\n{\"path\": \"utils.ts\"}" },
    { "type": "file-link", "content": "Edited utils.ts +5 -2" },
    { "type": "file-diff", "content": "-console.log(error)\n+console.error('Error:', error)" }
  ]
}
```
