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

## Architecture

Two-container Docker setup:
- **`angrav-browser`**: Antigravity IDE + VNC + Chromium (for OAuth)
- **`angrav-worker`**: TypeScript/Playwright automation connecting via CDP

See [[docker_standalone_spec|docker_standalone_spec.md]] for details.

## Features

| Feature | Status | Docs |
|---------|--------|------|
| State Monitoring | ✅ | `src/state.ts` |
| Session Management | ✅ | `src/session.ts` |
| CLI JSON Output | ✅ | `src/cli.ts` |
| Output Extraction | ✅ | `src/extraction.ts` |
| Agent Manager | ✅ | `src/manager.ts` |
| Context Injection | 📋 | `docs/context_injection_spec.md` |
| Model Configuration | 📋 | `docs/model_configuration_spec.md` |
| Review & Execution | 📋 | `docs/review_execution_spec.md` |

## Development

```bash
# Run tests
npm test

# Run against Dockerized Antigravity
BROWSER_CDP_ENDPOINT=http://localhost:9223 npm test
```

## Documentation

- [[wbs|WBS & Feature Prioritization]]
- [[docker_standalone_spec|Docker Standalone Spec]]
- [[LESSONS|Lessons Learned]]
