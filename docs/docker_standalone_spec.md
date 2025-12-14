# Standalone Antigravity Docker Container

> **Status**: Proposal  
> **Date**: 2025-12-14  
> **Goal**: Fully self-contained AutoAgrav container (Antigravity + automation in one)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Docker Container                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │                     Xvfb :99                        │  │
│  │    ┌────────────────────────────────────────────┐  │  │
│  │    │         Antigravity IDE (Electron)         │  │  │
│  │    │       └── Cascade Agent Panel              │  │  │
│  │    │             CDP @ localhost:9222           │  │  │
│  │    └────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                           ↓ CDP                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │             angrav automation (Playwright)          │  │
│  │   - SessionRegistry                                 │  │
│  │   - executeParallel / fanOut                        │  │
│  │   - Reads /workspace/tasks/*.json                   │  │
│  │   - Writes /workspace/output/*.json                 │  │
│  └────────────────────────────────────────────────────┘  │
│                           ↓                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Optional: x11vnc @ :5900 (for debugging)           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
          ↕                              ↕
   /workspace (mounted)           VNC port (optional)
```

## Components

| Component | Purpose |
|-----------|---------|
| `Xvfb` | Virtual X11 display for headless Electron |
| `Antigravity` | The AI IDE (Electron app) |
| `angrav` | Our automation library (TypeScript/Playwright) |
| `supervisord` | Process manager (starts all services) |
| `x11vnc` | Optional VNC for visual debugging |

## Interface

**Input (mounted volume):**
```
/workspace/
├── tasks/
│   ├── task-001.json   # { "prompt": "...", "context": [...] }
│   └── task-002.json
├── .antigravity/       # Auth/settings (optional mount)
└── project/            # Actual codebase to work on
```

**Output:**
```
/workspace/output/
├── task-001-result.json   # { "response": ..., "codeBlocks": [...] }
└── task-001-result.json
```

## Dockerfile Skeleton

```dockerfile
FROM node:20-bookworm

# X11 dependencies
RUN apt-get update && apt-get install -y \
    xvfb x11vnc xdotool \
    libx11-xcb1 libxcb-dri3-0 libxtst6 libnss3 \
    libatk-bridge2.0-0 libgtk-3-0 libxss1 libasound2 \
    supervisor wget curl unzip

# Install Antigravity (from .deb or AppImage)
COPY antigravity.deb /tmp/
RUN dpkg -i /tmp/antigravity.deb || apt-get -f install -y

# Install angrav automation
COPY angrav/ /opt/angrav
WORKDIR /opt/angrav
RUN npm install

# Supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/

# Entrypoint
COPY entrypoint.sh /
RUN chmod +x /entrypoint.sh

EXPOSE 9222 5900

ENTRYPOINT ["/entrypoint.sh"]
```

## Supervisord Config

```ini
[supervisord]
nodaemon=true

[program:xvfb]
command=Xvfb :99 -screen 0 1920x1080x24
autorestart=true

[program:antigravity]
command=/usr/bin/antigravity --remote-debugging-port=9222
environment=DISPLAY=":99"
autorestart=true

[program:vnc]
command=x11vnc -display :99 -forever -rfbport 5900
autorestart=true

[program:angrav-worker]
command=node /opt/angrav/worker.js
environment=DISPLAY=":99"
autorestart=true
startretries=5
startsecs=10
```

## Task Worker (worker.js concept)

```typescript
// Watches /workspace/tasks/ for new task files
// Executes each via angrav automation
// Writes results to /workspace/output/

import chokidar from 'chokidar';
import { connectToApp } from './src/core';
import { sendPrompt } from './src/prompt';
import { extractResponse } from './src/extraction';
import { waitForIdle } from './src/state';

const watcher = chokidar.watch('/workspace/tasks/*.json');

watcher.on('add', async (path) => {
    const task = JSON.parse(fs.readFileSync(path));
    const { context, page } = await connectToApp();
    
    const frame = await getAgentFrame(page);
    await sendPrompt(frame, page, task.prompt);
    await waitForIdle(frame);
    
    const response = await extractResponse(frame);
    
    fs.writeFileSync(
        path.replace('/tasks/', '/output/').replace('.json', '-result.json'),
        JSON.stringify(response, null, 2)
    );
});
```

## Pros/Cons

| Pros | Cons |
|------|------|
| ✅ Fully isolated | ❌ Larger image (~2GB+) |
| ✅ No external dependencies | ❌ Antigravity licensing unclear |
| ✅ Can scale horizontally | ❌ Auth token management |
| ✅ CI/CD friendly | ❌ Debug harder without VNC |

## Auth Token Strategy

**Recommended approach: Persistent Volume**

```
┌─────────────────────────────────────────┐
│ First Run (via VNC)                      │
│ 1. Connect: vncviewer localhost:5900     │
│ 2. Log in to Windsurf in GUI             │
│ 3. Session saved to mounted volume       │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ Subsequent Runs                          │
│ - Auth persists in angrav-config volume │
│ - No VNC needed unless re-auth required │
└─────────────────────────────────────────┘
```

**Volume mount:**
```yaml
volumes:
  - angrav-config:/home/angrav/.config/Windsurf
```

## Implementation Status

| File | Status |
|------|--------|
| `docker/Dockerfile` | ✅ Created |
| `docker/supervisord.conf` | ✅ Created |
| `docker/entrypoint.sh` | ✅ Created |
| `docker/worker.ts` | ✅ Created |
| `docker/docker-compose.yml` | ✅ Created |

## Quick Start

```bash
# Build
cd docker && docker-compose build

# Start
docker-compose up -d

# First-time: Connect VNC and log in
vncviewer localhost:5900

# Submit task
echo '{"prompt": "Create hello.py"}' > workspace/tasks/task-001.json

# Check result
cat workspace/output/task-001-result.json
```
