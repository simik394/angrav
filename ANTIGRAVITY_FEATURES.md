# Antigravity Agent Management Features

To effectively manage development tasks performed by Antigravity agents, the following automation handles (Playwright interactions) are required to ensure efficiency, observability, and control.

## 1. Session Management
*Efficiency Requirement:* Prevent context pollution and ensure clean slates for new tasks.
- **Start New Conversation:**
  - **Handle:** Click button with `[data-tooltip-id="new-conversation-tooltip"]`.
  - **Purpose:** Reset context immediately without restarting the IDE.
- **Get Conversation History:**
  - **Handle:** Iterate through `div.bg-ide-chat-background` rows.
  - **Purpose:** Audit the full interaction log to ensure the agent isn't going in circles.

## 2. Context Injection (Input)
*Efficiency Requirement:* Feed the agent necessary files precisely without manual typing.
- **Add File Context (`@file`):**
  - **Handle:** Type `@` in the chat input -> Wait for popup -> Type filename -> Select from list.
  - **Alternative:** Drag & Drop files into the chat area (simulated via Playwright input files).
- **Add Image/Docs:**
  - **Handle:** "Add context" button (Plus icon) -> Select "Images" or "Docs".

## 3. State Monitoring (Observability)
*Efficiency Requirement:* Know exactly when to intervene or read output, avoiding fixed waits.
- **Is Thinking/Processing:**
  - **Handle:** Detect if the "Stop Generating" button is visible OR if the "Thought" section is actively updating (streaming).
  - **Handle:** Check input field state (often `read-only` or `contenteditable="false"` during processing).
- **Is Error State:**
  - **Handle:** Detect red error toasts or "Request failed" messages in the chat stream.

## 4. Output Extraction (Data Structure)
*Efficiency Requirement:* Parse results programmatically (e.g., to save code to a file directly) rather than reading text.
- **Extract Code Blocks:**
  - **Handle:** Locate `pre > code` blocks within the response `div.prose`.
  - **Metadata:** Extract language type (e.g., `bash`, `typescript`) from the block header.
- **Extract Reasoning (Thoughts):**
  - **Handle:** Already implemented (`button:has-text("Thought")`). Essential for debugging agent logic errors.

## 5. Review & Execution (Control)
*Efficiency Requirement:* Verify and apply changes safely.
- **Apply Code Changes:**
  - **Handle:** Click "Apply" or "Save to File" button often found on code blocks in AI IDEs.
- **Reject/Undo:**
  - **Handle:** Click "Undo" button (seen as `lucide-undo2` icon in the dump) to revert a bad agent action.
- **Terminal Output Reading:**
  - **Handle:** Read content of `.xterm-screen` or `xterm-helper-textarea` to verify if the agent's executed commands (e.g., tests) passed or failed.

## 6. Model Configuration
- **Switch Model:**
  - **Handle:** Click Model Dropdown (e.g., "Claude Opus 4.5") -> Select cheaper/faster model for simple tasks (Efficiency).
- **Switch Conversation mode:**
  - **Handle:** Click the dropdown (actually rollup) located right on the left side of the model one. there are options "planning" and "fast". 
  you should chose the one appropriate to your current situation.
