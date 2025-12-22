# Windmill Advanced Queue Integration

This directory contains Windmill scripts for orchestrating browser-based agents with:
- **Non-blocking execution** (workers freed immediately)
- **Anti-detection** (human-like input serialization)
- **Resource efficiency** (tab pooling and recycling)

## Architecture

```
                     WINDMILL SERVER (OCI)
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ┌───────────┐     ┌───────────┐     ┌───────────┐
    │  input.ts │     │  input.ts │     │  input.ts │
    │  (rsrch)  │     │  (angrav) │     │  (rsrch)  │
    └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
          │                 │                 │
          │  Human Lock (Redis Mutex - ONE AT A TIME)
          │                 │                 │
          ▼                 ▼                 ▼
    ┌─────────────────────────────────────────────┐
    │              BROWSER CONTAINER              │
    │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐        │
    │  │Tab 1│  │Tab 2│  │Tab 3│  │Tab 4│  POOL  │
    │  └─────┘  └─────┘  └─────┘  └─────┘        │
    │                                             │
    │  MutationObserver detects completion →      │
    │  Calls Webhook → Triggers output.ts         │
    └─────────────────────────────────────────────┘
          │                 │
          ▼                 ▼
    ┌───────────┐     ┌───────────┐
    │ output.ts │     │ output.ts │
    │  (rsrch)  │     │  (angrav) │
    └───────────┘     └───────────┘
```

## Scripts

### Shared Utilities (`agents/shared/`)

| Script | Purpose |
|--------|---------|
| `human-lock.ts` | Redis mutex ensuring one input at a time across ALL agents |
| `tab-pool.ts` | Tab management: busy flags, MAX_TABS limit, recycling |
| `warmup.ts` | Pre-loads tabs at container start |

### Per-Agent Scripts

| Agent | Script | Phase | Purpose |
|-------|--------|-------|---------|
| rsrch | `input.ts` | 1 | Submit query, inject webhook, disconnect |
| rsrch | `output.ts` | 2 | Scrape result when webhook fires |
| angrav | `input.ts` | 1 | Submit task, inject webhook, disconnect |
| angrav | `output.ts` | 2 | Extract response when webhook fires |

## Setup

### 1. Configure Environment

```bash
cd agents/angrav/docker
cp .env.example .env
# Add:
# REDIS_URL=redis://falkordb:6379  (or your Redis host)
# WINDMILL_OUTPUT_WEBHOOK=http://your-windmill/api/...
```

### 2. Start Services

```bash
docker compose up -d
```

### 3. Run Warmup (Optional)

```bash
# Pre-load tabs for faster first execution
npx ts-node agents/shared/warmup.ts
```

### 4. Deploy Scripts to Windmill

In Windmill UI, create scripts at:
- `f/rsrch/input` → copy from `rsrch/windmill/input.ts`
- `f/rsrch/output` → copy from `rsrch/windmill/output.ts`
- `f/angrav/input` → copy from `angrav/windmill/input.ts`
- `f/angrav/output` → copy from `angrav/windmill/output.ts`

### 5. Configure Webhooks

For each `output` script, create a webhook trigger in Windmill that the `input` script will call.

## Usage

### Submit a Query (Non-blocking)

```typescript
// From another Windmill script or external call:
const result = await wmill.runScript('f/rsrch/input', {
  query: "What is the latest research on X?",
  deep_research: true
});
// Returns immediately: { tabId: "...", status: "submitted" }
```

### Result Delivery

The `output.ts` script is automatically triggered when the browser detects completion.
Results are returned to Windmill's job system.

## Key Concepts

### Human Lock
Only ONE input action (click/type) happens at a time across ALL agents.
This prevents bot detection (impossible for human to type in two places simultaneously).

```typescript
await withHumanHands(async () => {
  await page.bringToFront();
  await page.click('textarea');
  await humanType(page, query); // Random delays between keystrokes
});
```

### Tab Pool
- MAX_TABS = 5 (configurable in `tab-pool.ts`)
- Tabs marked `__BUSY` cannot be stolen by other jobs
- Recycling via UI click (not `page.goto()`) avoids full reload

### Webhook Callback
Instead of blocking while AI generates, we:
1. Inject a MutationObserver into the page
2. Observer detects completion (e.g., "Copy" button appears)
3. Observer calls Windmill webhook with tabId
4. Webhook triggers `output.ts` to scrape result
