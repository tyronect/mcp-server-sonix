# Roadmap: MCP Server for Sonix.ai — Production Readiness

**Created:** 2026-04-10
**Phases:** 4
**Granularity:** Coarse
**Coverage:** 17/17 v1 requirements mapped ✓

## Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Foundation | Codebase is hardened and testable | FOUN-01, FOUN-02, FOUN-03, FOUN-04, OBSV-01 | 4 |
| 2 | Test Suite | All tools and HTTP session lifecycle covered by automated tests | TEST-01, TEST-02, TEST-03, TEST-04, TEST-05 | 4 |
| 3 | Observability | Production deployment has meaningful visibility | OBSV-02, OBSV-03, OBSV-04 | 3 |
| 4 | Documentation + CI | Dev team can find, connect to, and trust the server | DOCS-01, DOCS-02, DOCS-03, DOCS-04 | 4 |

## Phase Details

### Phase 1: Foundation

**Goal:** Codebase is hardened and testable — typed errors, structured logger, exported internals, pinned dependencies.

**Requirements:**
- FOUN-01: Pin MCP SDK to exact version
- FOUN-02: Typed error classes in SonixClient
- FOUN-03: Export createServer from index.ts
- FOUN-04: Export result helpers from tools.ts
- OBSV-01: Pino structured logger replaces hand-rolled log()

**Success Criteria:**
1. `npm test` does not fail due to missing exports — `createServer` and result helpers are importable
2. SonixClient throws `AuthError`, `NotFoundError`, `RateLimitError`, or `ServerError` — never bare `Error`
3. Server logs structured JSON to stderr via Pino, not hand-rolled console output
4. MCP SDK version in package.json is pinned to exact version (no `^` or `~`)

---

### Phase 2: Test Suite

**Goal:** All tools and HTTP session lifecycle covered by automated tests with real API fixtures.

**Requirements:**
- TEST-01: SonixClient unit tests (error mapping, timeouts, size limits)
- TEST-02: Tool handler unit tests (all 12 tools, Zod validation)
- TEST-03: MCP protocol integration tests (InMemoryTransport)
- TEST-04: HTTP integration tests (supertest — sessions, rate limiting, eviction)
- TEST-05: Real Sonix API response fixtures captured

**Success Criteria:**
1. `npm test` runs and all tests pass with no skipped suites
2. SonixClient unit tests cover 401, 404, 429, 500 responses using real API fixtures
3. All 12 tool handlers tested for valid input, Zod rejection, and error propagation
4. HTTP session lifecycle (init, auth, rate limit, capacity, eviction) covered by supertest with fake timers

---

### Phase 3: Observability

**Goal:** Production deployment has meaningful visibility — health checks, log drain, request tracing.

**Requirements:**
- OBSV-02: Enhanced /health endpoint (session count, memory, uptime)
- OBSV-03: External log drain for Railway
- OBSV-04: Request ID tracing in all log lines

**Success Criteria:**
1. `GET /health` returns session count, memory usage, and uptime
2. Server logs appear in external log drain within seconds of a request
3. Every log line for a given MCP request includes the same request ID

---

### Phase 4: Documentation + CI

**Goal:** Dev team can find, connect to, and trust the server.

**Requirements:**
- DOCS-01: README with setup instructions
- DOCS-02: MCP client connection config examples (Claude Desktop, Cursor)
- DOCS-03: Tool reference table (all 12 tools)
- DOCS-04: GitHub Actions CI workflow

**Success Criteria:**
1. New developer can copy mcpServers JSON from README and connect without further help
2. README tool reference lists all 12 tools with parameters and descriptions
3. Push to main triggers GitHub Actions CI and tests run automatically
4. README environment variable reference is complete and accurate

---

## Phase Ordering Rationale

- **Phase 1 → Phase 2**: Typed errors and exports are prerequisites for meaningful tests
- **Phase 2 → Phase 3**: No value in observability alerts on unverified code
- **Phase 3 → Phase 4**: Knowing server behavior (via logs/health) informs accurate documentation
- OBSV-01 (pino) is in Phase 1 because it's foundational — used by all subsequent phases

---
*Roadmap created: 2026-04-10*
