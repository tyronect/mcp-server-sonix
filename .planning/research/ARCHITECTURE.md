# Architecture Research

**Domain:** TypeScript MCP server — testing, monitoring, documentation layer
**Researched:** 2026-04-09
**Confidence:** HIGH

## Standard Architecture

### System Overview

The existing server has a clean four-layer architecture. The production readiness milestone adds a horizontal cross-cutting layer without restructuring the existing code.

```
┌─────────────────────────────────────────────────────────────────┐
│                   NEW: Cross-Cutting Layer                       │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────────┐    │
│  │  Tests   │  │  Pino Logger   │  │  README / Docs       │    │
│  │(Vitest)  │  │  (replaces     │  │  (tool reference,    │    │
│  │          │  │   raw log())   │  │   setup guide)       │    │
│  └────┬─────┘  └───────┬────────┘  └──────────────────────┘    │
├───────┼─────────────────┼───────────────────────────────────────┤
│       │        EXISTING: Server Layers                          │
│  ┌────┴──────────────────┴──────────────────────────────────┐   │
│  │  Transport Layer  (src/index.ts)                          │   │
│  │  Express, session map, rate limiting, CORS, eviction      │   │
│  ├───────────────────────────────────────────────────────────┤   │
│  │  Server/Session Layer  (src/index.ts)                     │   │
│  │  McpServer factory, session lifecycle, API key verify     │   │
│  ├───────────────────────────────────────────────────────────┤   │
│  │  Tool Layer  (src/tools.ts)                               │   │
│  │  Tool registration, Zod schemas, result formatters        │   │
│  ├───────────────────────────────────────────────────────────┤   │
│  │  API Client Layer  (src/sonix-client.ts)                  │   │
│  │  HTTP to Sonix API, auth, timeout, size limits            │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Unit tests | Verify SonixClient methods in isolation | Vitest + `vi.stubGlobal('fetch', ...)` |
| Integration tests | Verify MCP protocol flow end-to-end | Vitest + `InMemoryTransport.createLinkedPair()` |
| Pino logger | Replace custom `log()` with structured JSON | `pino` package, `destination(2)` for stderr |
| README | Install, configure, connect, tool reference | Markdown with Claude Desktop / Cursor examples |

## Recommended Project Structure

```
src/
├── index.ts            # unchanged — transport + session layer
├── tools.ts            # unchanged — tool registration
├── sonix-client.ts     # unchanged — API client
└── logger.ts           # NEW — pino instance, replaces log() calls

test/
├── sonix-client.test.ts  # unit tests for SonixClient
├── tools.test.ts         # unit tests for result formatters + tool schemas
├── server.test.ts        # integration tests via InMemoryTransport
└── http.test.ts          # integration tests for Express endpoints

README.md               # project root
docs/
└── tools.md            # (optional) auto-generated or hand-written tool reference
```

### Structure Rationale

- **test/ at project root:** Vitest convention; keeps src/ clean; no confusion with compiled output in dist/
- **logger.ts as separate module:** Allows both src/ and test/ to import a single configured Pino instance; avoids re-configuring in every file
- **docs/ optional:** Only needed if README grows too large; for a 3-file server, a well-organized README is sufficient
- **No new src/ subdirectories:** The server is 3 files; adding src/utils/, src/middleware/ etc. is premature for this scope

## Architectural Patterns

### Pattern 1: InMemoryTransport for MCP Integration Tests

**What:** The MCP SDK exposes `InMemoryTransport.createLinkedPair()` which returns a matched client/server transport pair that communicate in memory. No HTTP port, no subprocess.

**When to use:** Testing that the correct tool handlers fire, that tool parameters are validated, and that error responses are properly returned as MCP ToolResults. This is the right layer for end-to-end MCP protocol testing.

**Trade-offs:** Tests the full MCP protocol path (serialization, tool dispatch, response format) without touching the Express/session layer. Fast, deterministic, no port conflicts in CI.

**Example:**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("list_media tool returns JSON", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(new SonixClient("test-key")); // factory from index.ts
  await server.connect(serverTransport);
  
  const client = new Client({ name: "test", version: "1.0" }, {});
  await client.connect(clientTransport);
  
  const result = await client.callTool({ name: "list_media", arguments: {} });
  expect(result.isError).toBeFalsy();
});
```

### Pattern 2: Global Fetch Stubbing for SonixClient Unit Tests

**What:** Vitest's `vi.stubGlobal('fetch', mockFn)` replaces the global `fetch` used by `SonixClient.request()`. No HTTP server needed, no external calls in tests.

**When to use:** Testing SonixClient error handling, response parsing, size limits, timeout behavior, and per-method query building. This is faster and more targeted than integration tests.

**Trade-offs:** Direct, fast, isolated. Cannot detect mismatches between tool handler logic and client behavior — that is what the InMemoryTransport tests catch.

**Example:**
```typescript
import { SonixClient } from "../src/sonix-client.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

test("throws on non-200 response", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
  );
  const client = new SonixClient("key");
  await expect(client.listMedia({})).rejects.toThrow();
});
```

### Pattern 3: Pino as a Drop-In Logger Replacement

**What:** Replace the inline `log()` function with a Pino instance exported from `src/logger.ts`. Pino writes structured JSON natively, integrates with Railway log parsing, and has negligible overhead.

**When to use:** Now — the server already uses structured JSON logging via a hand-rolled `log()`. Pino standardizes the format (level field, time field, pid) and makes log levels configurable via env var.

**Trade-offs:** Adds one dependency (`pino`, ~3.5MB). The payoff is Railway/Betterstack/Datadog-compatible log format without any additional parsing setup. Pino writes to stderr by default which is correct for MCP stdio mode (stdout is the MCP protocol channel).

**Example:**
```typescript
// src/logger.ts
import pino from "pino";
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(2));
```

## Data Flow

### Test Execution Flow

```
Vitest runner
    │
    ├── Unit tests (sonix-client.test.ts, tools.test.ts)
    │       │
    │       └── vi.stubGlobal('fetch') → SonixClient methods → assertions
    │
    └── Integration tests (server.test.ts)
            │
            └── InMemoryTransport.createLinkedPair()
                    │
                    ├── Server side: createServer(mockSonixClient) → connect(serverTransport)
                    └── Client side: Client.connect(clientTransport) → callTool() → assertions
```

### Monitoring Data Flow

```
Request arrives
    │
    ├── Pino log: { event: "session_init", ip, level: "info" }
    │
    ├── Tool execution
    │       └── Pino log: { event: "tool_call", tool, session_hash, level: "info" }
    │
    └── Error path
            └── Pino log: { event: "tool_error", error, level: "error" }

Pino → stderr → Railway log aggregation → (optional) Betterstack / Logtail transport
```

### Build Order (Dependencies Between Components)

The components have the following dependency order for implementation:

1. **logger.ts** — no dependencies; unblocks all other work
2. **Vitest setup** — no functional dependencies; can run in parallel with logger.ts
3. **SonixClient unit tests** — depends on Vitest setup
4. **Tool unit tests** — depends on Vitest setup; tests result formatters (`textResult`, `jsonResult`, `errorResult`) and Zod schema shapes
5. **Integration tests** — depends on Vitest setup + requires `createServer` to be exportable from `index.ts` (minor refactor: extract factory function if not already exported)
6. **README** — no code dependencies; can be written in parallel; benefits from knowing final npm package name
7. **npm publish config** — depends on README existing; requires clean dist/

The only sequential constraint is: Vitest → unit tests → integration tests (you need the runner before you can write tests).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (dev team, <10 users) | Pino to stderr, Railway log viewer. No external log service needed. |
| 10-100 sessions/day | Add pino-betterstack or pino-datadog transport for searchable log history. Still no structural change. |
| >100 concurrent sessions | Replace in-memory session map with Redis; add health check endpoint. Architecture changes, not logging/testing changes. |

### Scaling Priorities

1. **First bottleneck:** Session memory (in-memory map). Already acknowledged in PROJECT.md as acceptable. Tests that verify session eviction help catch regressions if this is ever changed.
2. **Second bottleneck:** Sonix API rate limits. SonixClient has no retry logic. Tests should document this behavior, not fix it in this milestone.

## Anti-Patterns

### Anti-Pattern 1: Testing Through the Express HTTP Layer in Unit Tests

**What people do:** Spin up a real Express server with `supertest` and send HTTP requests to test MCP tool behavior.

**Why it's wrong:** Tests tool logic through HTTP parsing, session management, rate limiting, and MCP protocol layers simultaneously. Slow, brittle, and fails for reasons unrelated to the tool being tested.

**Do this instead:** Use `InMemoryTransport.createLinkedPair()` for MCP tool tests. Use `supertest` only for the narrow tests of the HTTP session init endpoint, rate limiting, and CORS headers — behavior that genuinely lives in the Express layer.

### Anti-Pattern 2: Replacing the Existing log() Calls with a Full Observability Stack

**What people do:** Add OpenTelemetry, distributed tracing, metrics endpoints, and health dashboards.

**Why it's wrong:** This is a single-instance, internal tooling server with a dev team audience. The complexity of a full observability stack exceeds the operational needs.

**Do this instead:** Pino with structured JSON to stderr. Railway captures it. Add a Betterstack/Logtail pino transport only if log search becomes needed. Defer until pain is felt.

### Anti-Pattern 3: Writing Tests That Hit the Real Sonix API

**What people do:** Write integration tests that make real HTTP calls to Sonix.ai to verify tool behavior.

**Why it's wrong:** Tests are slow, flaky (network-dependent), consume Sonix API quota, and cannot run in CI without secrets.

**Do this instead:** Mock fetch in unit tests; use InMemoryTransport with a mock SonixClient in integration tests. Keep real API calls out of the test suite entirely.

### Anti-Pattern 4: Over-Structuring the README

**What people do:** Split documentation across multiple files (CONTRIBUTING.md, docs/api.md, docs/deployment.md, docs/tools.md) before anyone needs to find something.

**Why it's wrong:** For a 3-file server, one well-organized README is easier to maintain and faster to scan.

**Do this instead:** One README with clear sections: install, configure, connect (Claude Desktop / Cursor example), tool reference table, deploy. Add docs/ only when the README exceeds ~500 lines.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Sonix.ai API | Mocked via `vi.stubGlobal('fetch', ...)` in tests | Never hit real API in tests |
| Railway logging | Pino JSON to stderr; Railway parses JSON fields | Structured JSON log support confirmed |
| npm registry | `npm publish` with `files: ["dist"]` and `bin` entry | Shebang required on dist/index.js |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| test/ ↔ src/sonix-client.ts | Direct import; fetch mocked | No refactor needed |
| test/ ↔ src/index.ts | Import `createServer` factory; must be exported | Verify `createServer` is exported; if not, trivial export to add |
| test/ ↔ src/tools.ts | Import `textResult`, `jsonResult`, `errorResult` helper functions; must be exported | Verify helpers are exported |
| src/logger.ts ↔ src/index.ts | Import `log` from `./logger.js` | Replaces inline `log()` at lines 17-19 of index.ts |

## Sources

- MCPcat testing guide: https://mcpcat.io/guides/writing-unit-tests-mcp-servers/
- MCP TypeScript SDK (InMemoryTransport): https://github.com/modelcontextprotocol/typescript-sdk
- Creati.ai MCP e2e testing example: https://creati.ai/mcp/mcp-server-e2e-testing-example/
- Pino logger documentation: https://github.com/pinojs/pino
- Railway structured JSON log support: https://station.railway.com/feedback/structured-json-log-support-with-field-p-dbb69860
- Vitest vs Jest 2026 comparison: https://dev.to/whoffagents/vitest-vs-jest-for-nextjs-in-2026-setup-speed-and-when-to-switch-224a
- MCP npm publishing patterns: https://modelcontextprotocol.info/tools/registry/publishing/

---
*Architecture research for: TypeScript MCP server — production readiness (tests, monitoring, docs)*
*Researched: 2026-04-09*
