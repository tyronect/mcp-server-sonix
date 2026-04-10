# Research Summary

**Project:** mcp_sonix — Sonix.ai MCP Server Production Readiness
**Researched:** 2026-04-10
**Confidence:** MEDIUM-HIGH

## Stack

- **Testing:** Vitest 4.1.4 + MCP SDK's `InMemoryTransport.createLinkedPair()` for integration tests + `vi.stubGlobal('fetch')` for SonixClient unit tests. No additional test infrastructure needed.
- **Monitoring:** Pino 10.3.1 — drop-in replacement for existing `log()` function. Better Stack/Logtail for external log drain on Railway.
- **Publishing:** tsup 8.5.1 for npm build, publint for pre-publish validation. ESM-only output via `bin` field.
- **Documentation:** Handwritten README with tool reference table. No TypeDoc — MCP servers expose tools, not a TypeScript API.

## Table Stakes

- Unit tests for SonixClient (mock fetch, error mapping, 4xx/5xx)
- Unit tests for tool handlers (Zod validation, error propagation)
- Integration test for HTTP session lifecycle (init → call → expire)
- Differentiated error types (AuthError, NotFoundError, etc.) — prerequisite for meaningful test assertions
- README with connection instructions for Claude Desktop / Cursor
- Structured logs to external service
- Enhanced /health endpoint

## Watch Out For

1. **Testing wrong transport layer** — InMemoryTransport doesn't cover HTTP session lifecycle. Need supertest for Express layer.
2. **Mock fixtures diverge from real API** — `Promise<unknown>` throughout means test authors invent shapes. Capture real Sonix API responses first.
3. **Session lifecycle untested** — Eviction loop and MAX_SESSIONS are highest-risk untested code. Use fake timers.
4. **MCP SDK caret version** — `^1.29.0` can silently break on redeploy. Pin to exact version.
5. **README examples wrong for MCP clients** — Must document actual `mcpServers` JSON config, not curl examples.

## Suggested Phase Structure

1. **Foundation** — Typed errors + pino logger + Vitest setup + pin SDK version
2. **Test Suite** — Unit tests (SonixClient + tools) + integration tests (InMemoryTransport + supertest HTTP)
3. **Observability** — Enhanced /health, log drain to Better Stack, request ID tracing
4. **Documentation + CI** — README with tested connection examples, GitHub Actions, npm publish config

---
*Research completed: 2026-04-10*
