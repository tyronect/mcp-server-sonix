# Feature Research

**Domain:** Production MCP server (internal tooling, remote HTTP transport, TypeScript/Node.js)
**Researched:** 2026-04-09
**Confidence:** MEDIUM — MCP ecosystem is young (spec finalized 2025-03-26); patterns drawn from official registry docs, community guides, and reference implementations. Some claims verified via official sources; testing/observability patterns largely community-sourced.

---

## Context

This is NOT a greenfield MCP server. The server exists, is deployed on Railway, and handles real Sonix.ai workflows for a dev team. The milestone is **production readiness** — reliability, developer confidence, and maintainability. The four open requirements from PROJECT.md are:

1. Automated test suite (unit + integration)
2. Error monitoring and observability (structured logs → external service)
3. README with setup, tool reference, and connection examples
4. npm package publishing for easy installation

This research maps those four requirements onto the broader production MCP ecosystem and adds features the requirements imply but don't explicitly name.

---

## Feature Landscape

### Table Stakes (Team Can't Rely on It Without These)

Features that must exist before the dev team treats this as a reliable tool rather than a prototype.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Unit tests for SonixClient | HTTP client is the integration surface; bugs in error parsing or response handling are invisible without tests | MEDIUM | Mock `fetch`, test error mapping, test response parsing. Vitest recommended over Jest for ESM/TypeScript native support. |
| Unit tests for tool handlers | Tools are the user-facing contract; Zod validation, error propagation, and argument handling need coverage | MEDIUM | Test each tool: valid input, invalid input, API error cases. No subprocess needed — test handlers directly. |
| Integration tests for HTTP session lifecycle | Session create → tool call → session expire is the critical path; untested per CONCERNS.md | HIGH | Spin up server in-process, test full MCP handshake. Use `@modelcontextprotocol/sdk` InMemoryTransport or HTTP against local server. |
| Differentiated error types in tools | Currently all errors return generic `errorResult`. Clients can't distinguish retry-able from permanent failures. | MEDIUM | Map HTTP 4xx/5xx to user-facing error types: AuthError, NotFoundError, RateLimitError, ServerError. Return retry guidance. |
| README with connection instructions | Any dev connecting a new MCP client (Claude Desktop, Cursor, custom agent) needs exact config syntax | LOW | Include: transport options, Authorization header format, Claude Desktop JSON config example, Railway URL. |
| Tool reference documentation | Devs need to know what tools exist, what parameters they take, and what they return | LOW | Can be auto-generated from Zod schemas or manually maintained as a table in README. |
| Structured logs forwarded to external service | Current logs go to stdout only; on Railway this means they vanish on redeploy. Need searchable, persistent logs. | MEDIUM | Forward Railway stdout to Datadog, Logtail, or BetterStack. Structured JSON already emitted; just needs a drain. |
| Enhanced /health endpoint | Current `/health` returns `{status: "ok"}` unconditionally. Load balancer can't distinguish "up but broken" from "healthy". | LOW | Add: session count vs MAX_SESSIONS, memory usage %, last successful Sonix API contact. |

### Differentiators (Valuable for DX, Not Blocking)

Features that distinguish a well-maintained internal tool from a minimally-working one.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Request ID tracing in logs | Correlate a user's tool call through session init → tool execution → Sonix API call in a single search | MEDIUM | Generate UUID per request, attach to all log entries for that request. Critical for debugging "why did my request hang?" questions. |
| CI/CD pipeline (GitHub Actions) | Tests run on every push; broken builds blocked before Railway deploys | LOW | `test → build → docker push → deploy`. Railway supports GitHub Actions deploys. |
| npm package publishing | Devs can install via `npx mcp-server-sonix` or add to Claude Desktop config with package name instead of a URL | MEDIUM | `package.json` already has `bin` and `files` fields. Add `mcpName` field, publish to npm, optionally register with MCP Registry (preview). |
| Zod schemas for Sonix API responses | Currently `Promise<unknown>` throughout. Named types catch API contract changes at parse time, not at stringify time. | MEDIUM | Start with the three most-called shapes: MediaList, TranscriptJSON, MediaDetail. Use Zod `.parse()` with fallback to raw data. |
| Load test baseline | Establishes whether the current 100-session / 60-req-min config is right for actual usage patterns | MEDIUM | Use k6 or autocannon. Document results. Answers "should MAX_SESSIONS be 20 or 200?" |
| Slow-request logging | Flag tool calls that take >5s. Makes Sonix API latency visible in production. | LOW | Middleware: record start time, log `{duration_ms, tool, session_id}` after response. |
| MCP Inspector smoke test script | Quick "is the server healthy right now?" check that exercises a real tool call | LOW | Shell script or npm script that runs `mcp-inspector` against the Railway URL with a test key. Useful in runbooks. |

### Anti-Features (Deliberately Out of Scope)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Prometheus /metrics endpoint | Standard observability pattern, devs will ask for it | Overkill for single-instance Railway deployment; adds dependency (prom-client), requires Prometheus scraper infrastructure. Team has no Prometheus. | Structured JSON logs + log drain to BetterStack or Datadog provides equivalent visibility with zero infra overhead. |
| Distributed tracing (OpenTelemetry) | "Industry standard" for production services | Per-session tool calls are short-lived and single-instance. Trace correlation adds significant complexity (spans, propagation headers, OTLP exporter) for negligible benefit at current scale. | Request IDs in structured logs achieve 95% of the debugging value. Revisit if multi-instance deployment happens. |
| MCP Registry publishing | Makes the server discoverable publicly | This is internal tooling with per-user Sonix API keys. Public registry listing exposes Railway URL and invites unauthorized auth attempts. Docs on the team wiki are sufficient. | npm package (private or scoped) satisfies installability without public exposure. |
| 100% test coverage target | Sounds rigorous | Coverage metrics incentivize testing the wrong things (trivial getters, framework boilerplate). The server has three critical paths; those need deep tests, not coverage theater. | Cover the three critical paths thoroughly: SonixClient HTTP, session lifecycle, tool error handling. |
| Webhook receiver for Sonix events | "Nice to know when transcription finishes" | Requires persistent state, a public inbound URL, and Sonix webhook configuration. Scope creep that doesn't serve the dev team's agentic workflow use case. | Poll transcript status via `get_media` tool, which already exists. |
| Real-time dashboard UI | Visibility into what the server is doing | MCP server is backend-only infrastructure. A dashboard UI is out of scope per PROJECT.md. | Log drain + hosted log viewer (Logtail, BetterStack) provides operational visibility without building custom UI. |

---

## Feature Dependencies

```
[Differentiated error types]
    └──required by──> [Unit tests for tools]  (can't meaningfully test error cases without typed errors)

[Request ID tracing]
    └──enhances──> [Structured logs forwarded externally]  (trace IDs only useful when logs are searchable)

[Zod API response schemas]
    └──enables──> [Unit tests for SonixClient]  (typed responses make mocked test fixtures realistic)
    └──reduces risk in──> [Integration tests]  (parse failures are caught, not silently wrong)

[CI/CD pipeline]
    └──requires──> [Unit tests]  (pipeline is useless without tests to run)
    └──requires──> [Build script]  (already exists: npm run build)

[npm package publishing]
    └──requires──> [README with connection instructions]  (published packages need documentation)
    └──requires──> [CI/CD pipeline]  (automate publish on tagged release)

[Enhanced /health endpoint]
    └──independent──> (can ship any time, no dependencies)

[Slow-request logging]
    └──enhances──> [Structured logs forwarded externally]  (only useful when logs are searchable)
```

### Dependency Notes

- **Differentiated error types required by unit tests:** You cannot write meaningful test assertions like "returns RateLimitError when Sonix returns 429" until the error types exist. Build error taxonomy first, then write tests that assert on it.
- **Zod schemas enable SonixClient tests:** Mocked API responses need to match real shapes. Defining Zod schemas gives you the ground truth for what a valid mock looks like.
- **CI/CD requires tests:** A pipeline that only runs the build step provides false confidence. Tests must exist before CI is worth setting up.
- **npm publishing requires README:** `npm publish` without documentation is hostile to users. README and tool reference must be written first.

---

## MVP Definition

The milestone is production readiness for a dev team that already uses this server. The bar is: team members can debug failures, validate the server is working, and install it without tribal knowledge.

### Launch With (this milestone)

- [ ] Unit tests for SonixClient (mock fetch, test error mapping, test 4xx/5xx handling) — catches the highest-risk bugs silently present per CONCERNS.md
- [ ] Unit tests for tool handlers (Zod validation paths, error propagation) — validates the user-facing contract
- [ ] Integration test for HTTP session lifecycle (init → call → expire) — covers the one scenario that would cause a production incident
- [ ] Differentiated error types (AuthError, NotFoundError, RateLimitError, ServerError) — prerequisite for meaningful test assertions AND better agent UX
- [ ] README with connection instructions and tool reference — unblocks new team members connecting MCP clients
- [ ] Structured logs forwarded to external service — makes the deployed server debuggable without Railway console access
- [ ] Enhanced /health endpoint (session count, memory, Sonix API reachability) — required for Railway to detect "up but broken" state

### Add After Core Tests Pass (v1.x)

- [ ] Request ID tracing in logs — add once external log drain exists; trace IDs without searchable logs are useless
- [ ] CI/CD pipeline (GitHub Actions) — add once there are tests worth running in CI
- [ ] Slow-request logging — add alongside CI; low effort, high operational value
- [ ] Zod schemas for Sonix API responses — add incrementally alongside tests; start with MediaList and TranscriptJSON

### Future Consideration (v2+)

- [ ] npm package publishing — useful if team grows or server is used from more than a few MCP clients; requires stable API first
- [ ] Load test baseline — worth doing before any multi-instance deployment decision
- [ ] MCP Inspector smoke test script — nice runbook addition; defer until the above are done

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Unit tests: SonixClient | HIGH — catches silent bugs in production | MEDIUM | P1 |
| Unit tests: tool handlers | HIGH — validates user-facing contract | MEDIUM | P1 |
| Integration test: session lifecycle | HIGH — prevents production incident | HIGH | P1 |
| Differentiated error types | HIGH — required by tests AND better UX | MEDIUM | P1 |
| README + tool reference | HIGH — unblocks team adoption | LOW | P1 |
| Structured logs → external service | HIGH — required to debug the deployed server | MEDIUM | P1 |
| Enhanced /health endpoint | MEDIUM — improves Railway reliability detection | LOW | P1 |
| Request ID tracing | MEDIUM — debugging quality-of-life | LOW | P2 |
| CI/CD pipeline | MEDIUM — prevents regression on future changes | LOW | P2 |
| Slow-request logging | MEDIUM — surfaces Sonix API latency | LOW | P2 |
| Zod API response schemas | MEDIUM — type safety, catches contract changes | MEDIUM | P2 |
| npm package publishing | LOW — convenience, team is small | MEDIUM | P3 |
| Load test baseline | LOW — useful pre-scaling, not urgent | MEDIUM | P3 |
| MCP Inspector smoke test | LOW — runbook nicety | LOW | P3 |

**Priority key:**
- P1: Required for this milestone — team can't reliably use the server without it
- P2: Should be in this milestone — high value, low cost, builds on P1 work
- P3: Future milestone — useful but not blocking production readiness

---

## Sources

- [MCP Registry Quickstart — official publish flow](https://modelcontextprotocol.io/registry/quickstart) — HIGH confidence
- [MCP Best Practices: Architecture & Implementation Guide](https://modelcontextprotocol.info/docs/best-practices/) — MEDIUM confidence (community site, not official Anthropic)
- [Unit Testing MCP Servers — MCPcat](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/) — MEDIUM confidence (community)
- [Designing MCP Servers for Observability — DreamFactory](https://blog.dreamfactory.com/designing-mcp-servers-for-observability) — MEDIUM confidence (community, well-sourced)
- [MCP Server Observability — Zeo](https://zeo.org/resources/blog/mcp-server-observability-monitoring-testing-performance-metrics) — MEDIUM confidence (community)
- [15 Best Practices for Production MCP Servers — The New Stack](https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/) — MEDIUM confidence (couldn't fetch full content)
- [Automate MCP Testing with Testcontainers and GitHub Actions — Arm Learning](https://learn.arm.com/learning-paths/cross-platform/automate-mcp-with-testcontainers/github-actions-ci/) — MEDIUM confidence
- CONCERNS.md — HIGH confidence (primary source, direct codebase analysis)
- PROJECT.md — HIGH confidence (primary source, team requirements)

---

*Feature research for: MCP server production readiness (Sonix.ai)*
*Researched: 2026-04-09*
