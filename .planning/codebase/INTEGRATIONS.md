# External Integrations

**Analysis Date:** 2026-04-09

## APIs & External Services

**Sonix.ai Transcription:**
- Service: Sonix.ai (https://api.sonix.ai/v1)
- Purpose: Audio/video transcription, translation, summarization, and media management
- SDK/Client: Custom HTTP client in `src/sonix-client.ts` (fetch-based)
- Auth: Bearer token via `Authorization: Bearer {SONIX_API_KEY}` header
- Request timeout: 30 seconds
- Max response size: 10 MB (enforced with streaming reader in `readBody()`)

**Media Upload (Indirect):**
- Clients submit publicly accessible URLs to Sonix for transcription
- No direct file upload to MCP server — Sonix fetches from client-provided URLs
- Callback webhooks: Optional `callback_url` parameter for transcription completion notifications

## Authentication & Identity

**Auth Provider:** Sonix.ai (Custom API Key)
- Implementation: Bearer token authentication
- Flow:
  1. Client provides API key via `Authorization: Bearer {key}` header
  2. HTTP mode validates key against Sonix API before allocating session resources
  3. Session key stored in-memory with API key verification on each request
  4. Stdio mode uses environment variable `SONIX_API_KEY` directly

**Session Management (HTTP mode only):**
- Session ID: UUID generated per initialize request
- Storage: In-memory Map<string, Session> with 30-minute TTL
- Session eviction: Runs every 60 seconds, removes idle sessions
- Re-auth: API key must match session key on every POST/GET/DELETE request

## Data Flow

**HTTP Mode Initialization:**
1. Client sends initialize request with `Authorization: Bearer {API_KEY}` header
2. Server validates key against Sonix.ai API (calls `listMedia()` to verify)
3. On success: Server creates session, returns session ID in `Mcp-Session-Id` header
4. Client stores session ID, includes in subsequent requests

**Tool Execution Flow:**
1. Client sends POST `/mcp` with JSON-RPC 2.0 tool call
2. Session verified via `mcp-session-id` header + API key match
3. Tool handler calls `SonixClient` method
4. Response formatted as JSON and returned to client

**Error Handling:**
- HTTP errors from Sonix API parsed as JSON or text
- Response size limits enforced (10 MB max)
- Request timeouts: 30 seconds
- Rate limiting: Global 60 req/min per IP; 5 new sessions/min per IP

## Rate Limiting & Resilience

**HTTP Endpoints:**
- Global limiter: 60 requests/minute per IP across all `/mcp` routes
- Init limiter: 5 new sessions/minute per IP (applied only to initialize requests)
- Uses `express-rate-limit` with draft-7 RateLimit headers

**Session Cleanup:**
- Idle sessions evicted after 30 minutes
- Max concurrent sessions: 100 (configurable via `MAX_SESSIONS` env var)
- Returns 503 if server at capacity

## Webhooks & Callbacks

**Incoming:**
- None. Server is read-only for MCP protocol (tool exposure only, no webhook receivers)

**Outgoing:**
- Sonix callback_url: Optional webhook parameter in `upload_media()` tool
- Sonix.ai can POST to client-provided URL when transcription completes
- Client must provide a publicly accessible URL

## Monitoring & Observability

**Logging:**
- Structured JSON logs to stderr/stdout
- Fields: `ts` (ISO 8601), `event`, custom data (ip, error, session hash, etc.)
- Events logged:
  - `server_started` - HTTP server listening
  - `session_created` - New HTTP session initialized
  - `session_evicted` - Idle session removed
  - `session_closed` - Client closed session
  - `session_rejected` - New session rejected (capacity/auth)
  - `auth_failure` - Authentication failures with reason
  - `handler_error` - Unhandled exceptions in endpoints

**Health Check:**
- `GET /health` - Returns `{"status": "ok"}` (no auth required)

**Error Tracking:**
- No external error tracking service (Sentry, etc.)
- Errors logged as JSON events

## Environment Configuration

**Required env vars:**
- `SONIX_API_KEY` - Sonix.ai API key (https://my.sonix.ai/api)

**Optional env vars:**
- `TRANSPORT` - "stdio" (default) or "http"
- `PORT` - HTTP server port (default: 3000)
- `MAX_SESSIONS` - Max concurrent sessions (default: 100)
- `CORS_ORIGIN` - CORS origin whitelist (default: empty string, CORS disabled)

**Secrets location:**
- `.env` file (local development, not committed)
- Docker: Pass via `docker run -e SONIX_API_KEY=...` or `.env` file
- Cloud: Use platform's secrets manager (Railway, Vercel, etc.)

## Data Storage

**Databases:** None

**File Storage:** None

**Caching:** None

**In-Memory State (HTTP mode only):**
- Session map with API key, transport, and server instance
- Evicted after 30-minute idle timeout

## CI/CD & Deployment

**Hosting:**
- Self-hosted: Docker, Node.js process manager, or cloud platform
- Not deployed to Vercel or similar (uses stdio mode for claude-in-cursor)

**Build Process:**
- TypeScript compilation: `npm run build` → `dist/index.js`
- Docker multi-stage: Build TS, copy dist to slim image
- Output: Standalone Node.js executable at `dist/index.js` with `#!/usr/bin/env node` shebang

**No CI/CD Pipeline Detected:**
- No GitHub Actions, GitLab CI, Jenkins, etc.
- Manual build and deployment assumed

---

*Integration audit: 2026-04-09*
