# Codebase Concerns

**Analysis Date:** 2026-04-09

## Missing Test Coverage

**No automated tests present:**
- What's not tested: All core functionality (API client, tools, session management, rate limiting, authentication)
- Files affected: `src/index.ts`, `src/sonix-client.ts`, `src/tools.ts`
- Risk: Medium - Bugs in session eviction, API key validation, or tool implementations may not be caught until production. No regression protection when refactoring.
- Priority: High - Should implement unit tests for critical paths (API client, session lifecycle, error handling) and integration tests for HTTP server modes
- Testing framework needed: Jest or Vitest are common choices for Node.js/TypeScript projects

## Type Safety Gaps

**Untyped API responses:**
- Issue: `SonixClient` methods return `Promise<unknown>` with a comment explaining responses are "passed straight to JSON.stringify". No type definitions for API response shapes.
- Files: `src/sonix-client.ts` (lines 101, 107, 119, 148, 165, 180, 188, 193, 204)
- Impact: Impossible to validate API contract changes or safely branch on response fields. Tools blindly stringify whatever Sonix returns, including error structures that might differ from expected format.
- Fix approach: Create TypeScript interfaces for major response types (MediaListResponse, MediaDetail, TranscriptionStatus) and parse/validate responses against them. Improves maintainability and catches API contract violations early.

**Type casting in error handling:**
- Issue: Error body extraction uses unsafe type casts without validation (lines 44-45 in `sonix-client.ts`): `(body as Record<string, unknown>).error as string`
- Impact: If API response structure changes or is malformed, casting silently succeeds but extracts wrong field
- Fix: Use Zod schemas to validate and parse error responses before extracting message

## Error Handling Fragility

**Silent error suppression in tools layer:**
- Issue: All tool handlers in `src/tools.ts` catch errors generically with `return errorResult(error)`. No differentiation between user errors (invalid media_id), rate limits, or internal API failures
- Files: `src/tools.ts` (lines 56-58, 72-74, 116-118, 138-140, 162-164, 178-180, 207-209, 249-251, 265-267, 281-283, 304-306, 327-329)
- Impact: Clients can't distinguish recoverable errors (retry) from permanent failures (invalid input). No alerting on API degradation.
- Fix approach: Parse error response structure, map HTTP status codes to user-facing error types (ValidationError, AuthError, NotFoundError, RateLimitError, ServerError), and return appropriate messages with retry guidance

**Unhandled async rejections in HTTP mode:**
- Issue: Session eviction loop (line 141 in `src/index.ts`) catches `.close()` errors but session cleanup may fail silently if other operations raise uncaught promises
- Files: `src/index.ts` (line 141-152)
- Impact: Memory leak if sessions aren't properly cleaned up; orphaned transports could accumulate over days
- Fix: Add comprehensive error logging and monitoring for session lifecycle. Implement session cleanup metrics/alerts.

## Security Concerns

**API key validation only at session init:**
- Issue: API key is validated once against Sonix API at session creation (line 222 in `src/index.ts`), then cached in session. If Sonix revokes/rotates a key, the server won't know until next init
- Files: `src/index.ts` (lines 203-227)
- Impact: Compromised/revoked API keys remain usable until session TTL expires (30 min)
- Recommendation: Implement API key rotation detection. Consider shorter TTLs or per-request validation. Add metrics on auth failures by IP.

**Session replay vulnerability:**
- Issue: Clients must send `mcp-session-id` header and Authorization header in every request. If client caches authorization header, accidental replay to same session works
- Files: `src/index.ts` (lines 160-179)
- Impact: If client-side auth header gets leaked or cached in logs, attacker can reuse it for 30 minutes
- Recommendation: Use non-Bearer token schemes (e.g., signed timestamps) or implement nonce validation. Document that auth headers should never be cached.

**CORS misconfiguration risk:**
- Issue: CORS is disabled by default (line 105: `corsOrigin = process.env.CORS_ORIGIN || ""`). If operator sets a wildcard or permissive value, session takeover becomes easier
- Files: `src/index.ts` (lines 104-114)
- Impact: Low risk if defaults are respected, but misconfiguration is easy
- Recommendation: Validate CORS_ORIGIN at startup (reject wildcards, require https://, validate against allowlist). Document best practices.

## Performance Bottlenecks

**Session validation on every request:**
- Issue: Every request calls `verifySession()` which does:
  1. Extract header
  2. Look up session in map
  3. Validate API key matches
  4. Update lastActivity timestamp
- Files: `src/index.ts` (lines 160-179)
- Cause: Maps are O(1) but per-request overhead compounds at scale
- Improvement: For high throughput (>1000 req/sec), consider memcached session store or JWT tokens with HMAC validation (no lookup needed)

**Unbound memory growth in session map:**
- Issue: MAX_SESSIONS defaults to 100 (line 73). If 100 concurrent sessions reach idle timeout, eviction happens 1 minute later. During spikes, could accumulate abandoned transports.
- Files: `src/index.ts` (lines 72-73, 141-152)
- Cause: `setInterval` cleanup runs every 60 seconds; slow eviction of dead sessions
- Improvement: Consider more aggressive cleanup (every 10-30 seconds) or lazy cleanup on new session creation if at capacity

**Large transcript buffering:**
- Issue: `readBody()` in `sonix-client.ts` (lines 63-85) buffers entire response in memory as array of chunks, then concatenates. For 10MB transcripts this is fine, but if limit increases or buffering doubles (intermediate array + Buffer), OOM risk
- Files: `src/sonix-client.ts` (lines 63-85)
- Cause: Streaming response into memory before returning
- Improvement: For transcript endpoints, consider chunked streaming response to client, or implement backpressure-aware buffering with disk spillover for >5MB responses

## Fragile Areas

**Session transport coupling:**
- Files: `src/index.ts` (lines 66-70, 230-244)
- Why fragile: Each session holds a `StreamableHTTPServerTransport` instance created dynamically. If MCP SDK changes transport API (method signatures, event names), session setup breaks.
- Safe modification: Wrap transport creation in a factory function with version checking. Add integration tests that verify session handshake works end-to-end.
- Test coverage: No tests verify transport lifecycle (init → request handling → close)

**Tool argument parsing:**
- Files: `src/tools.ts` (all tools use Zod schemas)
- Why fragile: Tools define Zod schemas inline. If schema changes (e.g., add required field to summarize_media), clients using old calls will fail without clear migration path.
- Safe modification: When adding/changing fields, support both old and new names for 2 releases. Add changelog documenting breaking changes.
- Test coverage: No tests verify Zod validation rejects invalid inputs or coerces correctly

**Rate limit state shared across app:**
- Files: `src/index.ts` (lines 117-134)
- Why fragile: `express-rate-limit` uses in-memory store (default). If server restarts, rate limit counters reset. In multi-instance deployments, each server enforces limits independently.
- Safe modification: For production multi-instance, use Redis store for rate limiting. Add integration test that verifies rate limit enforcement.

## Dependency Risk

**express-rate-limit reliance on default store:**
- Package: `express-rate-limit@^8.3.2`
- Risk: Default in-memory store doesn't persist across restarts or sync across instances. Undetectable in single-instance deployment but breaks silently if load balancer adds replicas
- Impact: Each server independently allows 60 req/min per IP. Multiplied by N instances = N×60 effective limit. DDoS protection degrades.
- Migration plan: Integrate Redis store (`npm install redis`), configure in production. Test with multi-instance docker-compose setup.

**MCP SDK version pinning:**
- Package: `@modelcontextprotocol/sdk@^1.29.0`
- Risk: Caret range (`^`) allows minor/patch updates. MCP SDK is under active development; breaking changes in transport API possible in minor versions.
- Recommendation: Lock to exact version (`1.29.0`) for stability until MCP SDK reaches 2.0. Add pre-commit hook to review SDK changelog before minor bumps.

**No dependency updates process:**
- Issue: package-lock.json exists but no renovate/dependabot config. No automated alerts for security patches in dependencies.
- Impact: Vulnerabilities in express, zod, or MCP SDK could go unpatched for months
- Fix: Add GitHub Actions workflow or Dependabot to auto-create PRs for dependency updates. Require human review before merging.

## Scaling Limits

**HTTP mode session capacity fixed at startup:**
- Current: MAX_SESSIONS defaults to 100, set via env var
- Limit: Each session holds a `StreamableHTTPServerTransport` + `McpServer` instance in memory. At 100 sessions, rough estimate: 100 × 5-10MB = 500MB-1GB memory overhead
- Scaling path: Need memory profiling to determine per-session cost. If app reaches >80% capacity, auto-restart or gracefully deny new sessions with 503. For true elastic scaling, implement distributed session store (Redis) with shared transport layer.

**Single stdio mode doesn't scale:**
- Current: `TRANSPORT=stdio` runs single process handling one client at a time
- Limit: CPU-bound operations (transcript formatting, summarization) block other clients
- Scaling path: For production, always use `TRANSPORT=http` with reverse proxy (nginx). Run multiple instances behind load balancer.

## Missing Observability

**Logging lacks operational context:**
- Issue: Structured logs (lines 17-19, 88, etc. in `index.ts`) output event name and data but no request tracing, slow query detection, or performance metrics
- Impact: Hard to debug customer issues ("why did my request hang?") without access to timing data or request flow
- Recommendation: Add request ID to all logs. Track request duration (time from POST to response). Log slow requests (>5s). Add Prometheus metrics for request latency percentiles.

**No health check beyond /health endpoint:**
- Issue: `/health` (line 259) only returns `{status: "ok"}`. Doesn't check Sonix API connectivity, session store health, or memory usage.
- Impact: Load balancer thinks server is up even if Sonix API is down or sessions are leaking memory
- Fix: Implement deeper health checks: test Sonix API with lightweight call, check session map size against MAX_SESSIONS, report memory usage percentile

## Known Issues

**searchMedia API endpoint ambiguous:**
- Issue: `searchMedia()` in `sonix-client.ts` (line 149) builds query string for `/media` endpoint with `search` parameter. But `listMedia()` (line 102) also hits `/media` endpoint. Unclear if these are the same endpoint or if search has different semantics.
- Files: `src/sonix-client.ts` (lines 97-105, 144-152)
- Trigger: Call `search_media` tool with a query. If Sonix API expects different endpoint or parameter names, request fails with unclear error
- Workaround: Check Sonix API docs to confirm `/media?search=...` is correct. If not, implement separate endpoint.
- Fix: Add comments clarifying which Sonix API endpoints each method calls. Add integration tests hitting real Sonix sandbox API (with separate test key).

**Untyped JSON.parse in transcript formatting:**
- Issue: `getTranscript()` (line 138 in `sonix-client.ts`) and `getTranslation()` (line 224) both parse JSON without schema validation: `const data = JSON.parse(body)`. If response structure changes, downstream code breaks silently or crashes with cryptic error.
- Files: `src/sonix-client.ts` (lines 138, 224)
- Trigger: Sonix changes JSON structure (e.g., adds extra wrapper, renames fields)
- Workaround: None - caller gets malformed data
- Fix: Add Zod schemas for transcript JSON format, validate before formatting

## Test Coverage Gaps

**Critical paths untested:**
- What's not tested: Session lifecycle (create → use → timeout), rate limit enforcement, API key validation, error recovery, tool parameter validation
- Files: `src/index.ts` (session management), `src/sonix-client.ts` (HTTP client), `src/tools.ts` (tool definitions)
- Risk: High - Bugs in session eviction could cause memory leaks in production; broken rate limiting could cause DDoS; invalid tool parameters could be passed to Sonix API
- Priority: High - Add Jest suite with:
  - Unit tests for SonixClient (mock fetch, test error handling, test response parsing)
  - Unit tests for tools (test Zod validation, test error cases)
  - Integration tests for HTTP server (test session flow, test rate limiting, test concurrent requests)
  - Load tests (spin up 50 concurrent sessions, verify eviction works, check memory usage)

---

*Concerns audit: 2026-04-09*
