# DOM Analysis Notes - Session Management

## Date: 2025-12-27

### Capture 1: main-window_full.html / launchpad_full.html

**Source**: `workbench-jetski-agent.html` (Launchpad)  
**Title**: "Launchpad"

**Observations**:
1. This is NOT the main agent workspace - it's a **Launchpad/Picker window**
2. Shows a quickinput-style dropdown with sections:
   - **Agent Manager** (clickable item, currently focused)
   - **Active** section: "workspace" (`/workspace`)
   - **Recent** section: "project" (`/workspace/project`)

---

### Capture 2: workbench_frame-antigravity.agentPanel.html (459KB)

**Source**: Main workbench iframe containing the Agent Panel (cascade chat)

**Key findings - data attributes**:
| Attribute | Description |
|-----------|-------------|
| `data-past-conversations-toggle="true"` | **Button to show past conversations (history)** |
| `data-tooltip-id="history-tooltip"` | History button tooltip |
| `data-tooltip-id="new-conversation-tooltip"` | New conversation button |
| `data-tooltip-id="close-tooltip"` | Close button |
| `data-tooltip-id="cascade-header-menu"` | Header menu dropdown |

**Critical insight**: 
Sessions/conversations are accessed via `data-past-conversations-toggle` button, NOT via "Agent Manager" window!

**UI Elements found**:
- Model selector (Gemini 3 Pro, Claude Sonnet, etc.)
- Conversation mode (Planning / Fast)
- Mentions, Workflows dropdowns
- Audio recording button
- Submit button

---

## Next Steps

1. **Click `data-past-conversations-toggle` button** to open history panel
2. **Capture history panel DOM** to find conversation list structure
3. **Extract conversation IDs** from that list
4. **Update `listSessions()` implementation** to use correct selectors

---

## Experiment 1: Click History Toggle (2025-12-27 09:12)

**Action**: Clicked `[data-past-conversations-toggle="true"]` button

**Result**: DOM unchanged (same 6761 lines before/after)

**Root cause discovered**:
```html
<a data-tooltip-id="history-tooltip" 
   data-past-conversations-toggle="true" 
   class="... opacity-50 cursor-not-allowed">
   <svg class="lucide lucide-history ...">
```

The button has `cursor-not-allowed` and `opacity-50` = **DISABLED STATE**

**Why disabled?**
- No past conversations exist in this workspace
- OR user not authenticated to cloud sync
- OR fresh container with no history

---

## Next Experiment

Need to:
1. **Create a conversation first** (send a message)
2. **Then check if history toggle becomes enabled**
3. **Or use VNC to visually verify the state**

---

## Key Selectors for Implementation

| Element | Selector |
|---------|----------|
| Agent Panel iframe | `frame[name="antigravity.agentPanel"]` |
| History toggle | `[data-past-conversations-toggle="true"]` |
| New conversation | Look for `[data-tooltip-id="new-conversation-tooltip"]` |
| Close button | `[data-tooltip-id="close-tooltip"]` |
| Input field | `[data-lexical-editor="true"]` |
| Model selector | `#headlessui-popover-button-:r1:` |

## Implementation Strategy

Since sessions = conversations, the flow should be:
1. Connect to browser
2. Find workbench page
3. Get agent panel frame by name `antigravity.agentPanel`
4. Check if history toggle is enabled (no `cursor-not-allowed` class)
5. If enabled, click and capture conversation list
6. Extract conversation IDs from list items

---

## Experiment 2: Agent Manager Window Analysis (2025-12-27 09:27)

**VNC Screenshots captured** → `vnc_agent_manager_1.png`, `vnc_agent_manager_2.png`

**Key finding**: Agent Manager is a **separate window** (`launchpad_page-1.html`, 73KB), not the same as the chat panel iframe.

### Session Element Structure

```html
<div class="flex flex-col gap-0.5" style="padding-left: 30px;">  <!-- Indented under "workspace" -->
  <div class="w-full h-full pr-1.5 mr-1.5">
    <button class="select-none hover:bg-list-hover transition-all cursor-pointer rounded-md py-1.5 flex flex-row items-center justify-between pl-2 pr-1.5 outline-none w-full opacity-80">
      <span class="text-sm grow truncate text-left">Deploying Windmill Scripts</span>
      <div class="flex flex-col items-center shrink-0 mx-2">
        <div class="w-4">
          <svg data-tooltip-id="01b9adb7-1121-47da-a6bf-6268bd2905af" class="lucide lucide-bell-dot">
            <!-- notification bell icon -->
          </svg>
        </div>
      </div>
    </button>
  </div>
</div>
```

### Stable ID Options

| Option | Selector | Stability |
|--------|----------|-----------|
| Session Name | `button > span.text-sm` | ❌ Changes when topic changes |
| Bell Icon Tooltip | `svg[data-tooltip-id]` | ✅ UUID format, likely stable |
| Button Index | `:nth-child(n)` | ❌ Changes when sessions reorder |

**Recommended**: Use `data-tooltip-id` from child SVG as session ID.

### Selectors for Implementation

```javascript
// Find Agent Manager window
const agentManagerPage = pages.find(p => p.url().includes('jetski-agent') && /* has manager content */);

// Or find via page content
const managerPage = pages.find(async p => {
  return await p.locator('text=Workspaces').isVisible();
});

// Get all session buttons under expanded workspace
const sessionButtons = page.locator('div[style*="padding-left: 30px"] button').all();

// Extract session info
for (const btn of await sessionButtons) {
  const name = await btn.locator('span.text-sm').textContent();
  const tooltipId = await btn.locator('svg[data-tooltip-id]').getAttribute('data-tooltip-id');
  sessions.push({ name, id: tooltipId });
}
```

---

## Proposed Implementation Changes

1. **`openAgentManager()`** → Find or open Agent Manager page (not iframe)
2. **`listSessions()`** → Query session buttons under `div[style*="padding-left"]`
3. **`switchSession(id)`** → Click button where child SVG has matching `data-tooltip-id`
