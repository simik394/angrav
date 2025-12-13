# Lessons Learned - Antigravity Automation

## Feature: Agent Prompt Submission
**Date:** 2025-12-12

### 1. Electron Page Selection
- **Issue:** Connecting to `browser.contexts()[0].pages()[0]` often returns a background page (e.g., `workbench-jetski-agent.html`) instead of the visible UI (`workbench.html`).
- **Solution:** Iterate through `context.pages()` and filter by URL or Title to find the main window.
  ```typescript
  const page = context.pages().find(p => p.url().includes('workbench.html'));
  ```

### 2. VS Code Webviews & IFrames
- **Issue:** UI elements contributed by extensions (like the Agent chat) usually reside inside Webviews, which are rendered as `<iframe>` elements.
- **Solution:** Use `page.frames()` to locate the specific frame (e.g., `cascade-panel.html`) and interact with elements inside it.
  ```typescript
  const agentFrame = page.frames().find(f => f.url().includes('cascade-panel.html'));
  agentFrame.locator(...)
  ```

### 3. Robust Selectors
- **Issue:** Standard CSS classes in VS Code are often generic or minified.
- **Solution:** Rely on accessibility attributes (`aria-label`, `role`) and functional attributes (`contenteditable="true"`, `data-lexical-editor="true"`).

### 4. Asserting Async Actions
- **Issue:** Asserting that an input is empty (`toBeEmpty()`) failed because the input became `read-only` (disabled) immediately after sending, causing the check to fail or be flaky.
- **Solution:** Verify the *outcome* of the action, such as the message appearing in the chat history log, which is a positive confirmation of success.

### 5. Debugging "Blind"
- **Issue:** When running automated tests without a visible head (or as a CLI agent), understanding why a selector fails is hard.
- **Solution:** Dump the full HTML of the page or frame to a file (`fs.writeFileSync('dump.html', await page.content())`) and inspect it offline to find correct attributes.

### 6. Reading Complex Chat Structures
- **Issue:** Chat messages are often separate sibling containers (User Row, Agent Row) rather than nested.
- **Solution:** Find the target user message (e.g., by text), traverse up to its row container, and then use `following-sibling` to find the Agent's response container.
  ```typescript
  userMessageRow.locator('xpath=following-sibling::div[contains(@class, "flex flex-col")]')
  ```

### 7. Interacting with Collapsible Elements
- **Issue:** Agent "Thoughts" are hidden in a collapsible section.
- **Solution:** Check for the existence of the toggle button (`button:has-text("Thought")`), click it, and wait for the content (`.prose`) to become visible before reading.
### 8. State Monitoring
- **Issue:** Input field (`[contenteditable="true"]`) becomes `disabled` or `read-only` during agent generation, but standard `toBeDisabled()` checks might be flaky if it toggles quickly.
- **Solution:** Combine checking for the "Stop Generating" button visibility (primary indicator of activity) with input editability.

### 9. Input Field Attributes
- **Observation:** The main chat input in Antigravity has attributes `contenteditable="true"` AND `data-lexical-editor="true"`. Using both makes the selector more robust against other inputs.
