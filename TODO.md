---
status: In Progress
---
# Angrav Automation Tasks

## Core
- [x] Create functionality specifications
- [x] Implement Core Infrastructure (core.ts, cli.ts)
- [x] Implement State Monitoring (state.ts)
- [x] Implement CLI JSON Output (output.ts, --json flag)

## Features
- [x] **Session Management**
  - [x] Implement `startNewConversation`
  - [x] Implement `getConversationHistory`
  - [x] Add CLI commands
- [ ] **Context Injection**
  - [ ] Implement `addFileContext` (`@file`)
  - [ ] Implement image upload
- [x] **Agent Manager**
  - [x] Implement `openAgentManager`
  - [x] Implement `listAgentTasks`
  - [x] Implement `approveTask` / `rejectTask`
- [x] **Output Extraction**
  - [x] Implement code block extraction
  - [x] Implement thought extraction
- [ ] **Review & Execution**
  - [ ] Implement `applyCode` and `undo`
- [ ] **Model Configuration**
  - [ ] Implement model switching

## Testing
- [x] Unit/Integration test for State Monitoring
- [ ] Test Session Management
- [ ] Test Context Injection
