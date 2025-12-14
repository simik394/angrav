# Antigravity Automation Agent

Playwright-based automation suite for managing and interacting with Antigravity AI agents.

## Quick Start (Docker)

```bash
cd agents/angrav/docker

# Build and start containers
docker compose build
docker compose up -d

# First-time: Connect VNC and log in via Google
vncviewer localhost:5901

# Verify connectivity
docker compose ps                           # Should show (healthy)
curl http://localhost:9223/json/version     # CDP endpoint
```

## CLI Usage

Set `BROWSER_CDP_ENDPOINT=http://localhost:9223` for Docker, or omit for local.

```bash
# Status
angrav status                 # Get agent state
angrav wait                   # Wait for idle

# Sessions
angrav session new            # Start new conversation
angrav session list           # List all sessions
angrav session switch <name>  # Switch by name

# Prompts & Output
angrav prompt "Create hello.py"     # Send prompt
angrav output last                  # Get last response
angrav output code --lang python    # Extract code blocks

# Context Injection (@menu)
angrav context add-file README      # Add file via @file
angrav context add-files a.ts b.ts  # Add multiple files
angrav context add-image img.png    # Upload image (via +)
angrav context add-doc spec.pdf     # Upload document (via +)

# Terminal Management (TUI interactive)
angrav terminal list          # List available terminals
angrav terminal add           # Interactive arrow-key selection
angrav terminal add 1         # By index (for AI agents)
angrav terminal add "npm"     # By name partial match

# Agent Manager
angrav manager list           # List agent tasks
angrav manager approve <id>   # Approve task
angrav manager spawn <ws> <task>  # Spawn new agent
```

**Note:** `terminal add` without argument shows TUI arrow-key selection (humans). AI agents should use index or name.

## Architecture

Two-container Docker setup:
- **`angrav-browser`**: Antigravity IDE + VNC + Chromium (for OAuth)
- **`angrav-worker`**: TypeScript/Playwright automation connecting via CDP

See [[docker_standalone_spec|docker_standalone_spec.md]] for details.

## Features

| Feature | Status | Implementation |
|---------|--------|----------------|
| State Monitoring | ✅ | `src/state.ts` |
| Session Management | ✅ | `src/session.ts` |
| CLI JSON Output | ✅ | `src/cli.ts` |
| Output Extraction | ✅ | `src/extraction.ts` |
| Agent Manager | ✅ | `src/manager.ts` |
| Context Injection | ✅ | `src/context.ts` |
| Terminal Management | ✅ | `src/terminal.ts` |
| Model Configuration | 📋 | Phase 4 |
| Review & Execution | 📋 | Phase 5 |

## Development

```bash
npm install
npm test

# Run against Dockerized Antigravity
BROWSER_CDP_ENDPOINT=http://localhost:9223 npm test
```

## Documentation

- [[wbs|WBS & Feature Prioritization]]
- [[docker_standalone_spec|Docker Standalone Spec]]
- [[context_injection_spec|Context Injection Spec]]
- [[LESSONS|Lessons Learned]]
