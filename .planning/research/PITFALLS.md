# Pitfalls Research

**Domain:** MCP server production-readiness — TypeScript, tests, monitoring, npm publishing
**Researched:** 2026-04-09
**Confidence:** HIGH (most pitfalls grounded in CONCERNS.md codebase analysis + verified community patterns)

---

## Critical Pitfalls

### Pitfall 1: Testing the Wrong Transport Layer

**What goes wrong:**
Tests are written against stdio transport because it's simpler (no HTTP setup needed), but the production deployment uses Streamable HTTP. The test suite passes while the actual HTTP session lifecycle — init, Mcp-Session-Id header propagation, status code contract (202 for notifications, not 200), and concurrent session handling — is never exercised. Bugs in the HTTP path only appear in production.

**Why it happens:**
MCP SDK's in-process Client/Server pair works without any HTTP setup, making it tempting for unit tests. Developers test what's easy to instantiate, not what runs in production.

**How to avoid:**
- Write integration tests that spin up the actual Express HTTP server on a random port using `supertest` or `node:http`
- Test the full request cycle: POST to `/mcp` with `Authorization` header → get `Mcp-Session-Id` from response → use it in subsequent requests
- Include at least one concurrent-session test (3-5 parallel sessions) to catch race conditions in session map writes
- Keep stdio unit tests for pure logic (tool schemas, result formatters, `SonixClient` methods) but never treat them as a substitute for HTTP integration coverage

**Warning signs:**
- Test suite has no `supertest` or HTTP client dependency
- No test creates a session and then makes a second request using that session ID
- Rate limiting and session eviction are only tested via unit mocks, not actual HTTP responses

**Phase to address:** Testing phase (first active milestone item)

---

### Pitfall 2: Publishing to npm Without a Working `bin` Entry

**What goes wrong:**
The package is published but `npx @your-scope/mcp-sonix` silently fails or runs nothing. Root causes: missing `#!/usr/bin/env node` shebang in `dist/index.js`, the `bin` field in `package.json` pointing at `src/index.ts` instead of `dist/index.js`, or the `files` array omitting `dist/` so the compiled output isn't included in the tarball at all.

**Why it happens:**
The current build already has `chmod +x dist/index.js` in the build step, but publishing introduces a new failure surface: the tarball is assembled from `files`, not from the local filesystem, so forgetting to list `dist/` means users get an empty package. The `bin` field is also easy to set once during initial setup and never validated again after directory restructuring.

**How to avoid:**
- Add `"files": ["dist/", "README.md"]` to `package.json`
- Confirm `bin` points to `dist/index.js`, not `src/index.ts`
- Verify shebang: first line of `dist/index.js` (after build) must be `#!/usr/bin/env node`
- Run `npm pack --dry-run` before every publish and inspect the file list — this is the single most reliable pre-publish check
- Add `"prepublishOnly": "npm run build && npm test"` to enforce build + test before publish

**Warning signs:**
- No `files` field in `package.json` (npm will include everything except `.npmignore` entries, including `.env` files and source maps)
- `npm pack --dry-run` output doesn't show `dist/index.js`
- `bin` field references a `.ts` file

**Phase to address:** npm publishing phase

---

### Pitfall 3: Mocking Sonix API Responses That Don't Reflect Reality

**What goes wrong:**
`SonixClient` tests use hand-crafted mock responses based on assumptions about the Sonix API shape. Those assumptions are wrong (or drift over time), so tests pass but the production code fails when it encounters the real response structure — particularly for the JSON transcript format (`getTranscript`) and the ambiguous `searchMedia` vs `listMedia` endpoint (documented as a known issue in CONCERNS.md).

**Why it happens:**
The codebase has `Promise<unknown>` return types on all `SonixClient` methods — there are no TypeScript interfaces for API responses. Without a schema, test authors invent fixture shapes that may not match what Sonix actually returns.

**How to avoid:**
- Before writing tests, capture real Sonix API responses for each endpoint using the dev API key; save them as JSON fixture files in `test/fixtures/`
- Use those fixtures as the basis for mock responses, not invented shapes
- For the JSON transcript format specifically, capture a real example before writing `getTranscript` tests — this is the highest-risk method per CONCERNS.md
- Add Zod schemas for the response types you care about (transcript JSON, media list) and validate fixtures against them so the schemas double as documentation of the real API contract

**Warning signs:**
- Test fixtures contain field names that can't be verified against actual API docs or captured responses
- `getTranscript` tests don't cover the JSON format branch
- All mock data is invented inline in test files rather than loaded from fixture files

**Phase to address:** Testing phase

---

### Pitfall 4: Session Lifecycle Not Covered by Tests — Memory Leak Ships to Production

**What goes wrong:**
The session eviction loop (60-second interval) and MAX_SESSIONS capacity enforcement are the most operationally critical code in the server, and they're the hardest to test. Teams skip these because they require time-based tests or manual load simulation. The result: a subtle eviction bug causes session count to grow unbounded, Railway restarts the container, and sessions are lost — users get unexplained disconnects under load.

**Why it happens:**
Time-based behavior is awkward to test. Developers test the happy path (tool calls work) and defer lifecycle testing. CONCERNS.md explicitly flags this as high-risk but no test infrastructure exists yet.

**How to avoid:**
- Use Vitest's fake timers (`vi.useFakeTimers()`) to advance time in session eviction tests without waiting 30 minutes
- Write a test that creates MAX_SESSIONS sessions, verifies the 503 response on the next attempt, then advances time past TTL and verifies sessions are cleaned up and new sessions are accepted
- Add a test that verifies the eviction interval actually calls `transport.close()` on expired sessions (mock the transport, spy on `.close()`)
- Consider reducing the eviction interval from 60s to something lower (10-30s) during the testing phase — log the change decision

**Warning signs:**
- No test imports or mocks `setInterval`/`Date.now`
- Session map size is never asserted in tests
- No test covers the 503 "session capacity exceeded" path

**Phase to address:** Testing phase

---

### Pitfall 5: Structured Logs Exist but Nobody Is Watching Them

**What goes wrong:**
The server already emits JSON audit logs, but without routing them to an external service, they exist only in Railway's ephemeral log stream. When a production issue occurs (e.g., Sonix API starts returning 500s, or session count spikes), there's no alert — the team finds out when a user reports a problem. The "observability" work item gets treated as "add more console.log statements" rather than "route signals to a place where alerts can fire."

**Why it happens:**
The immediate task looks like "add a monitoring service," but the real work is: define what failure looks like (error rate threshold, session count threshold, p99 latency threshold), then route existing logs to something that can evaluate those thresholds. Teams add services without defining the alert conditions.

**How to avoid:**
- Before choosing a monitoring service, define 3-5 specific alert conditions in writing (e.g., "Sonix API error rate >10% over 5 minutes," "session count >80 of MAX_SESSIONS," "any 5xx from `/mcp` endpoint")
- Use Better Stack (Logtail) or similar structured log ingestion — Railway log drain is the integration point
- Add a request-scoped `requestId` to all log lines so a single failing request can be traced through the log stream
- The existing `/health` endpoint only returns `{status: "ok"}` — extend it to include `sessionCount`, `maxSessions`, and `uptimeSeconds` so Railway health checks reflect actual server state

**Warning signs:**
- Monitoring "phase" is described as "set up Datadog" without alert conditions defined
- `/health` endpoint is not updated as part of observability work
- No `requestId` field in log output

**Phase to address:** Monitoring/observability phase

---

### Pitfall 6: MCP SDK Minor Version Bump Breaks Transport API

**What goes wrong:**
The current `package.json` uses `"@modelcontextprotocol/sdk": "^1.29.0"` (caret range). The MCP SDK is under very active development. A minor version bump (e.g., 1.30.0) changes how `StreamableHTTPServerTransport` is instantiated or how `Mcp-Session-Id` headers are handled. The server silently breaks on next `npm install` in CI or on Railway redeploy.

**Why it happens:**
Caret ranges are the npm default and feel safe. But the MCP SDK is not a stable library — minor versions contain transport API changes. The CONCERNS.md already flags this as a known risk.

**How to avoid:**
- Pin to exact version: `"@modelcontextprotocol/sdk": "1.29.0"` (no caret)
- Before writing integration tests, lock the version and add a comment in `package.json` explaining why
- Add a GitHub Actions job that runs `npm audit` and reviews `@modelcontextprotocol/sdk` CHANGELOG before any version bump is merged

**Warning signs:**
- `package.json` still has caret on `@modelcontextprotocol/sdk` when publishing starts
- No process for reviewing SDK changelog before bumping

**Phase to address:** Testing phase (lock before writing tests against specific SDK behavior)

---

### Pitfall 7: README Connection Examples Are Wrong for the Target Client

**What goes wrong:**
The README documents how to connect using `curl` or generic HTTP examples. The actual users are connecting via Claude Desktop, Cursor, or other MCP client apps that expect a specific JSON config format (e.g., `mcpServers` block with `url` and `headers`). Users follow the README and can't connect. The README also omits the Authorization header format, so users don't know to pass their Sonix API key.

**Why it happens:**
Documentation authors write for what they know how to test (curl), not for how users actually connect. MCP client config syntax is underdocumented and each client has slight variations.

**How to avoid:**
- Include a tested connection example for at least Claude Desktop and one other common client (Cursor or Windsurf)
- Show the exact JSON config block users need to paste, including the `Authorization: Bearer <sonix-api-key>` header field
- Test the connection example against the actual deployed Railway URL before publishing the README
- Document what error users will see if they omit the Authorization header vs if they use a wrong API key

**Warning signs:**
- README only shows curl examples
- No mention of which MCP clients are supported
- Authorization header format not spelled out in connection instructions

**Phase to address:** Documentation phase

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `Promise<unknown>` return types on all `SonixClient` methods | Faster initial build, no need to define response schemas | Impossible to write meaningful tests without inventing fixture shapes; API contract drift is invisible | Never — add Zod schemas or TS interfaces before writing tests |
| Generic `catch (error) { return errorResult(error) }` in all tools | Simple error handling | Clients can't distinguish retryable (rate limit, network) from permanent (invalid ID, auth) errors; no alerting surface for API degradation | Never for production — map HTTP status codes to typed errors |
| In-memory rate limit store (`express-rate-limit` default) | Zero configuration | On Railway redeploy, counters reset; if Railway ever runs two instances, limits are per-instance not global | Acceptable while single-instance; migrate to Redis store before any scale-out |
| Session TTL of 30 minutes with 60s eviction interval | Conservative reconnect friction | Dead sessions accumulate for up to 60s after TTL; under spike load, orphaned transports hold memory | Reduce eviction interval to 10-15s as part of observability work |
| No `prepublishOnly` build gate | Publish directly from current build | Publishing stale `dist/` if developer forgot to rebuild; tests never gate publish | Never — add `"prepublishOnly": "npm run build && npm test"` before first publish |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Sonix API (test fixtures) | Writing mock responses based on guessed field names | Capture real API responses as JSON fixtures before writing any `SonixClient` tests |
| Sonix `searchMedia` | Assuming `?search=` on `/media` works identically to `listMedia` — documented ambiguity in CONCERNS.md | Verify against Sonix API docs and add an integration test with a real test API key before shipping search tool |
| MCP SDK transport | Using caret `^` version range in production | Pin exact version; review changelog before any bump |
| Railway log drain | Assuming logs are persisted and searchable | Set up log drain to external service (Better Stack/Logtail) before relying on logs for incident response |
| npm publish | Not running `npm pack --dry-run` before publish | Always pack-dry-run and inspect file list; verify `dist/` is included and no `.env` or secrets are present |
| MCP client config (Claude Desktop, Cursor) | Documenting curl examples, not client config JSON | Write and test actual `mcpServers` config block for each target client |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Large transcript buffering (full response in memory) | OOM kill on Railway when retrieving large transcripts | The 10MB limit exists; keep it enforced; add a test that verifies the limit throws before OOM | Single request returning >10MB; or if limit is accidentally raised |
| 60s eviction interval with 100-session capacity | Session count slowly climbs; new users get 503 under moderate load | Reduce interval to 10-15s; add session count to `/health`; alert at 80% capacity | >80 concurrent active sessions |
| Per-request session validation (O(1) Map lookup, but still overhead) | Not a problem at current scale | No action needed until >500 req/sec; document threshold | >500 req/sec sustained (Railway single instance won't reach this) |
| In-memory rate limit counters reset on redeploy | Rate limit protection disappears briefly after each Railway deployment | Acceptable for current scale; document known limitation in ops runbook | Multi-instance or frequent deploys under attack |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key logged in plain text during error handling | Sonix API key exposed in Railway logs, accessible to anyone with Railway dashboard access | Audit all log statements before deploying observability tooling; scrub `Authorization` header value from request logs |
| `npm publish` including `.env` file | Secret credentials published to npm registry | Add `dist/` to `files` field (allowlist) — allowlist approach is safer than `.npmignore` denylist; run `npm pack --dry-run` before every publish |
| Publishing without 2FA on npm account | Package hijacking if npm credentials are compromised | Enable npm 2FA for publish operations; use `npm publish --otp` in CI or use an npm automation token scoped to this package only |
| No `npm audit` in CI | Known vulnerabilities in `express`, `zod`, or MCP SDK ship to users who install via npm | Add `npm audit --audit-level=high` to CI pipeline |
| CORS_ORIGIN wildcard in documentation examples | If docs show `CORS_ORIGIN=*` as a "quick start" example, operators copy it | Never show wildcard in docs; show `CORS_ORIGIN=https://yourapp.example.com` and explain the risk of wildcards |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Error message says "Request failed" with no actionable detail | User doesn't know if they should retry, check their API key, or report a bug | Map Sonix HTTP status codes to user-facing messages: 401 → "Invalid Sonix API key — check your Authorization header", 404 → "Media file not found", 429 → "Sonix API rate limit reached — retry in 60s" |
| Session expiry gives no warning before it happens | Mid-workflow disconnect with no indication the session expired | Document 30-minute TTL prominently in README; consider adding session age to tool response metadata so clients can surface a warning |
| Tool error response is a string, not structured | AI agents can't parse error type to decide retry vs abort | Return structured error objects with `type`, `message`, and `retryable` fields |

---

## "Looks Done But Isn't" Checklist

- [ ] **npm package:** `npm pack --dry-run` shows `dist/index.js` — verify the binary is in the tarball
- [ ] **npm package:** `#!/usr/bin/env node` is the first line of `dist/index.js` — verify shebang survives TypeScript compilation
- [ ] **Tests:** Session lifecycle test exists (create → use → TTL expiry → cleanup) — verify with fake timers, not just mocks
- [ ] **Tests:** Rate limiting returns 429 on the actual HTTP endpoint — verify with supertest, not just unit mocks
- [ ] **Monitoring:** `/health` returns session count and memory info — verify it's more than `{status: "ok"}`
- [ ] **Monitoring:** Railway log drain is configured and logs appear in external service — verify before declaring observability "done"
- [ ] **Docs:** Connection example has been tested against the live Railway URL — verify with Claude Desktop or target MCP client, not just curl
- [ ] **Docs:** Authorization header format is documented with a concrete example — verify it's not described abstractly
- [ ] **Security:** `npm publish --dry-run` output contains no `.env`, no `src/`, no credential files

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Published package missing `dist/` (empty publish) | LOW | Patch version bump (`npm version patch`), rebuild, republish; notify users via npm deprecation on bad version |
| Published package contains `.env` with secrets | HIGH | Immediately `npm unpublish @scope/pkg@bad-version`; rotate all exposed credentials; re-publish clean version; disclose to affected users |
| MCP SDK minor bump breaks transport | MEDIUM | Pin to last known-good version; write a failing test that reproduces the break; fix against new SDK API; re-release |
| Session eviction bug causes memory leak in production | MEDIUM | Railway restarts container automatically (OOM kill); short-term: reduce MAX_SESSIONS via env var; long-term: fix eviction logic with tests |
| Test fixtures diverge from real Sonix API | MEDIUM | Re-capture real API responses; update fixtures; re-run test suite; if tool behavior changed, bump minor version |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Testing wrong transport layer | Testing phase | Integration test suite includes HTTP session create → use → expire flow |
| npm publish with broken bin/missing dist | npm publishing phase | `npm pack --dry-run` check in CI before publish |
| Fictional mock fixtures | Testing phase | Fixture files sourced from captured real Sonix API responses |
| Session lifecycle not tested | Testing phase | Fake-timer tests cover eviction, capacity limit, and 503 response |
| Logs exist but nobody watches | Monitoring phase | Railway log drain configured; at least one alert rule defined and triggered in staging |
| MCP SDK caret version | Testing phase (before writing transport tests) | `package.json` uses exact version, no caret |
| README wrong for MCP clients | Documentation phase | Tested connection example in README with at least one real MCP client |

---

## Sources

- Codebase CONCERNS.md analysis (2026-04-09) — direct audit of this project's risks — HIGH confidence
- [Unit Testing MCP Servers — MCPcat](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/) — in-process testing patterns
- [MCP Integration Testing — MCPcat](https://mcpcat.io/guides/integration-tests-mcp-flows/) — E2E HTTP transport test patterns
- [Performance Testing MCP Servers in Kubernetes — DEV Community](https://dev.to/stacklok/performance-testing-mcp-servers-in-kubernetes-transport-choice-is-the-make-or-break-decision-for-1ffb) — stdio vs HTTP concurrency failure data
- [MCP Servers in Production — systemprompt.io](https://systemprompt.io/guides/mcp-servers-production-deployment) — production deployment patterns
- [Solution for MCP Connection Issues with NVM/NPM — Medium](https://chanmeng666.medium.com/solution-for-mcp-servers-connection-issues-with-nvm-npm-5529b905e54a) — npx PATH issues
- [TypeScript and NPM package.json exports — Velopen](https://www.velopen.com/blog/typescript-npm-package-json-exports/) — package.json exports field configuration
- [How to publish binaries on npm — Sentry Engineering](https://sentry.engineering/blog/publishing-binaries-on-npm) — shebang, chmod, bin field pitfalls
- [npm prepublish vs prepublishOnly — Ivan Akulov](https://iamakulov.com/notes/npm-4-prepublish/) — lifecycle hook correctness
- [Best Node.js Monitoring Tools 2026 — Better Stack](https://betterstack.com/community/comparisons/nodejs-application-monitoring-tools/) — monitoring service options

---

*Pitfalls research for: MCP server production-readiness (TypeScript, Vitest, monitoring, npm)*
*Researched: 2026-04-09*
