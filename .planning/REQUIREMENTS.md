# Requirements: MCP Server for Sonix.ai

**Defined:** 2026-04-10
**Core Value:** Dev team can reliably automate Sonix transcription workflows through AI agents

## v1 Requirements

### Foundation

- [ ] **FOUN-01**: MCP SDK pinned to exact version (no caret range) to prevent silent breakage on redeploy
- [ ] **FOUN-02**: Typed error classes (AuthError, NotFoundError, RateLimitError, ServerError) replace generic Error throws in SonixClient
- [ ] **FOUN-03**: `createServer` exported from index.ts for integration test access
- [ ] **FOUN-04**: `textResult`, `jsonResult`, `errorResult` helpers exported from tools.ts for unit test access

### Testing

- [ ] **TEST-01**: Unit tests for SonixClient covering successful responses, 401/404/429/500 error mapping, timeout handling, and response size limit enforcement
- [ ] **TEST-02**: Unit tests for all 12 tool handlers covering valid input, Zod validation rejection, and error propagation from SonixClient
- [ ] **TEST-03**: Integration tests via MCP SDK InMemoryTransport covering tool discovery (tools/list) and tool execution round-trip
- [ ] **TEST-04**: HTTP integration tests via supertest covering session init with valid/invalid API key, session auth verification, rate limiting (429), capacity limit (503), and session eviction with fake timers
- [ ] **TEST-05**: Real Sonix API response fixtures captured and stored in test/fixtures/ for SonixClient tests

### Observability

- [ ] **OBSV-01**: Pino structured logger replaces hand-rolled log() function across all files, writing JSON to stderr
- [ ] **OBSV-02**: Enhanced /health endpoint returns session count, memory usage, and uptime (behind optional auth)
- [ ] **OBSV-03**: External log drain configured for Railway deployment (Better Stack, Logtail, or Axiom)
- [ ] **OBSV-04**: Request ID generated per MCP request and included in all log lines for traceability

### Documentation

- [ ] **DOCS-01**: README with installation, environment variable reference, and build/run instructions
- [ ] **DOCS-02**: README includes tested Claude Desktop and Cursor mcpServers JSON config blocks for both stdio and HTTP modes
- [ ] **DOCS-03**: README includes tool reference table with all 12 tools, their parameters, and descriptions
- [ ] **DOCS-04**: GitHub Actions CI workflow running tests on push/PR to main

## v2 Requirements

### Quality

- **QUAL-01**: Zod schemas for Sonix API response types (start with MediaList, TranscriptJSON)
- **QUAL-02**: Load test baseline for HTTP mode under concurrent sessions
- **QUAL-03**: npm package publishing (tsup build, publint, registry listing)

### Observability

- **OBSV-05**: Slow-request alerting for tool calls exceeding 5 seconds
- **OBSV-06**: Alert conditions defined and configured in log drain service

## Out of Scope

| Feature | Reason |
|---------|--------|
| Browser-based UI | MCP server, not a web app |
| Sonix webhook receiver | Requires persistent state and separate infrastructure |
| OpenTelemetry / Prometheus | Over-engineering for single-instance Railway deployment |
| TypeDoc generation | MCP servers expose tools, not a TypeScript API |
| npm publish execution | Deferred to v2 — requires stable API and CI first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | — | Pending |
| FOUN-02 | — | Pending |
| FOUN-03 | — | Pending |
| FOUN-04 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |
| TEST-04 | — | Pending |
| TEST-05 | — | Pending |
| OBSV-01 | — | Pending |
| OBSV-02 | — | Pending |
| OBSV-03 | — | Pending |
| OBSV-04 | — | Pending |
| DOCS-01 | — | Pending |
| DOCS-02 | — | Pending |
| DOCS-03 | — | Pending |
| DOCS-04 | — | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 0
- Unmapped: 17 ⚠️

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-04-10 after initial definition*
