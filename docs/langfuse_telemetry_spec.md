# Langfuse Telemetry Specification

> **Status**: Proposal  
> **Priority**: Mid-Low  
> **Date**: 2025-12-14

## 1. Overview

Wrap the Antigravity agent with [Langfuse](https://langfuse.com/) for comprehensive telemetry, tracing, and observability of agent operations.

## 2. Problem Statement

- No visibility into agent performance metrics (latency, success rates)
- Difficult to debug complex multi-step agent interactions
- No cost tracking for LLM operations
- Cannot analyze agent behavior patterns over time

## 3. Goals

1. Instrument all agent operations with Langfuse traces
2. Track LLM token usage and estimated costs
3. Enable debugging via detailed trace visualization
4. Capture agent reasoning steps as spans for analysis

## 4. Technical Design

### 4.1 Dependencies

```json
{
  "langfuse": "^3.x"
}
```

### 4.2 Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LANGFUSE_PUBLIC_KEY` | Public API key | Required |
| `LANGFUSE_SECRET_KEY` | Secret API key | Required |
| `LANGFUSE_HOST` | Self-hosted URL | `https://cloud.langfuse.com` |
| `LANGFUSE_ENABLED` | Toggle telemetry | `true` |

### 4.3 Integration Architecture

```typescript
import { Langfuse } from 'langfuse';

interface TelemetryConfig {
    enabled: boolean;
    publicKey?: string;
    secretKey?: string;
    host?: string;
}

class AgentTelemetry {
    private langfuse: Langfuse;
    
    constructor(config: TelemetryConfig) {
        if (config.enabled) {
            this.langfuse = new Langfuse({
                publicKey: config.publicKey,
                secretKey: config.secretKey,
                baseUrl: config.host
            });
        }
    }
    
    startTrace(name: string, metadata?: object): Trace {...}
    startSpan(trace: Trace, name: string): Span {...}
    endSpan(span: Span, output?: any): void {...}
    endTrace(trace: Trace, output?: any): void {...}
}
```

### 4.4 Instrumentation Points

| Operation | Trace/Span | Captured Data |
|-----------|------------|---------------|
| New conversation | Trace | Session ID, timestamp |
| User prompt submission | Span | Input text, context files |
| Agent thinking | Span | Duration, thought content |
| Code block extraction | Span | Language, block count |
| Model switch | Event | Previous/new model |
| Error occurrence | Event | Error type, message |

## 5. CLI Commands

```bash
# Enable/disable telemetry
angrav config set telemetry.enabled true

# View telemetry status
angrav config get telemetry
```

## 6. Privacy Considerations

> [!IMPORTANT]
> Telemetry should be **opt-in** and clearly documented.

- No PII in traces by default
- Option to redact sensitive prompts
- Self-hosted Langfuse support for data sovereignty

## 7. Integration Points

| Existing Code | Integration |
|--------------|-------------|
| `src/cli.ts` | Init telemetry on CLI start |
| `src/session.ts` | Trace per session |
| `src/extraction.ts` | Span per extraction |
| `src/state.ts` | Events for state changes |

---

> 📋 **Work Breakdown**: See [[wbs|wbs.md]] - Langfuse Telemetry (Mid-Low Priority)

