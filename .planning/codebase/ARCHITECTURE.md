# Architecture

**Analysis Date:** 2026-04-09

## Pattern Overview

**Overall:** Dual-transport MCP (Model Context Protocol) server with stateless HTTP support and fallback stdio transport.

**Key Characteristics:**
- MCP SDK-compliant server providing tools for Sonix.ai transcription API
- HTTP transport with session management, rate limiting, and API key validation
- Stdio transport for local development and simple integrations
- Three-layer separation: transport → server/session → API client → external service
- Stateless design where HTTP sessions are ephemeral (30-minute TTL)

## Layers

**Transport Layer:**
- Purpose: Handle communication protocol abstraction (HTTP vs stdio)
- Location: `src/index.ts` (lines 44-267)
- Contains: Express app setup, session management, rate limiting, CORS configuration
- Depends on: `@modelcontextprotocol/sdk` (stdio and HTTP transports), Express
- Used by: Entry point; routes all client requests

**Session Layer:**
- Purpose: Track per-client MCP sessions with API key validation and activity monitoring
- Location: `src/index.ts` (lines 65-70, 95-266)
- Contains: Session lifecycle management, timeout eviction, API key verification
- Depends on: StreamableHTTPServerTransport, McpServer instances
- Used by: HTTP transport handlers to maintain stateful conversations with clients

**Server Layer:**
- Purpose: Instantiate and configure MCP server with capabilities and tool registration
- Location: `src/index.ts` (lines 27-42), `src/tools.ts` (lines 28-332)
- Contains: McpServer initialization, tool definitions with Zod schemas
- Depends on: SonixClient, tool registration functions
- Used by: HTTP/stdio transports to handle tool execution requests

**API Client Layer:**
- Purpose: Encapsulate all HTTP interactions with Sonix.ai API, handle errors and response parsing
- Location: `src/sonix-client.ts` (lines 15-229)
- Contains: Individual method per API endpoint, request/response handling, size limits
- Depends on: native fetch API, AbortSignal
- Used by: Tool handlers to perform actual transcription operations

## Data Flow

**HTTP Session Initialization:**

1. Client sends `POST /mcp` with `Authorization: Bearer <api-key>` header (no session ID)
2. Express rate limiter checks init limit (5 new sessions/min per IP)
3. API key extracted and validated via `SonixClient.listMedia()` call
4. On success: new `McpServer`, `StreamableHTTPServerTransport`, and `Session` created
5. Server connects to transport, transport generates UUID session ID
6. Session stored in memory map, session ID returned to client in response
7. Client uses session ID in `Mcp-Session-Id` header for subsequent requests

**Tool Execution Flow:**

1. Client sends `POST /mcp` with valid session ID and API key header
2. `verifySession()` checks session exists and API key matches stored session
3. `transport.handleRequest()` deserializes MCP protocol message
4. Server routes to appropriate tool handler based on tool name
5. Tool handler calls corresponding `SonixClient` method with user parameters
6. `SonixClient.request()` sends HTTP to Sonix API with timeout and size limits
7. Response parsed, formatted as MCP ToolResult (text or JSON)
8. Result serialized back to client via transport

**Session Eviction:**

1. Every 60 seconds, eviction loop checks `lastActivity` timestamp
2. Sessions idle >30 minutes are closed and removed from map
3. Transport.close() errors caught to prevent eviction loop failure

**State Management:**

- Client authentication: Bearer token verified once at session init, stored in `Session.apiKey`
- Session state: Map<sessionId, Session> held in memory across requests
- No persistent state: sessions lost on server restart (appropriate for stateless HTTP service)
- Activity tracking: `lastActivity` updated on every request to track usage for eviction

## Key Abstractions

**McpServer (from SDK):**
- Purpose: Implements MCP protocol specification, routes tool calls to handlers
- Examples: `src/index.ts` line 28, `src/tools.ts` line 28
- Pattern: Server.tool() registers handler; SDK handles request deserialization and response serialization

**SonixClient:**
- Purpose: Isolate Sonix.ai HTTP API details from tool layer; provide consistent error handling
- Examples: `src/sonix-client.ts` (entire file)
- Pattern: Private `request()` method with auth/timeout/size-limit logic; public methods match API endpoints

**ToolResult (union type):**
- Purpose: Standardize success/error response format for all tools
- Examples: `src/tools.ts` lines 6-26
- Pattern: Union of `{ content: [...], isError?: true }` for errors; `{ content: [...] }` for success

**Session (TypeScript interface):**
- Purpose: Bundle transport, server, auth, and activity data for HTTP session tracking
- Location: `src/index.ts` lines 65-70
- Pattern: Maps session ID → session object; transport generates ID on init

## Entry Points

**stdio Mode (default):**
- Location: `src/index.ts` lines 46-61
- Triggers: `TRANSPORT !== 'http'` or unset (line 270)
- Responsibilities: Validate API key from env var, create SonixClient, start server on stdio transport
- Use case: Local CLI usage, debugging, simple integrations

**HTTP Mode:**
- Location: `src/index.ts` lines 95-266
- Triggers: `TRANSPORT=http`
- Responsibilities: Initialize Express, configure transports (regular + rate limiting), manage sessions, start listener
- Use case: Hosted service, multi-client access, Railway/Vercel deployment

**Server Instance (`createServer`):**
- Location: `src/index.ts` lines 27-42
- Purpose: Factory function to create configured McpServer with tool registration
- Called by: Both stdio and HTTP modes; once per session in HTTP

## Error Handling

**Strategy:** Error messages surface to client; logs structured JSON; invalid auth rejected before consuming resources.

**Patterns:**

- **API errors**: `SonixClient.request()` (lines 22-58) catches non-200 responses, parses JSON/text error message, throws Error
- **Tool handler errors**: Wrapped in try/catch, returned as ToolResult with `isError: true` (lines 11-18 in tools.ts)
- **Session errors**: Verification checks return null and 400/401 status (lines 160-179); transport.close() errors caught to prevent cascade (line 145)
- **Size limit errors**: Streaming response reader checks Content-Length header and aborts mid-stream if >10MB (lines 63-85 in sonix-client.ts)
- **Timeout errors**: AbortSignal.timeout(30s) on all Sonix API calls ensures no request hangs indefinitely

## Cross-Cutting Concerns

**Logging:** Structured JSON logging to stderr/stdout (via `log()` function, lines 17-19) includes timestamp, event name, and contextual fields (ip, session hash, error, etc.)

**Validation:** Zod schemas on every tool parameter (src/tools.ts); invalid input rejected by SDK before handler called

**Authentication:** Bearer token in Authorization header, validated at session init against actual API; re-verified on every subsequent request

**Rate Limiting:** Global limiter (60 req/min per IP across all /mcp routes) + init limiter (5 new sessions/min per IP); prevents abuse of API key validation endpoint

**CORS:** Configurable via CORS_ORIGIN env var; blocked by default; applies to /mcp routes only

**Resource Management:** Session timeout (30 min), response size limit (10MB), request timeout (30s), max concurrent sessions (configurable, default 100)

---

*Architecture analysis: 2026-04-09*
