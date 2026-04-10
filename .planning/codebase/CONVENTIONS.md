# Coding Conventions

**Analysis Date:** 2026-04-09

## Naming Patterns

**Files:**
- Kebab-case: `sonix-client.ts`, `mcp-server-sonix`
- PascalCase for exported classes: `SonixClient`
- Shebang on executable entry point: `#!/usr/bin/env node` in `src/index.ts`

**Functions:**
- camelCase for all function and method names: `listMedia()`, `getTranscript()`, `verifySession()`, `handleSessionRequest()`
- Async functions not specifically distinguished: async functions use same camelCase pattern as sync
- Helper functions: prefixed descriptively: `extractApiKey()`, `sessionHash()`, `textResult()`, `errorResult()`

**Variables:**
- camelCase for local and module variables: `const apiKey`, `const sessions`, `const apiKey`
- SCREAMING_SNAKE_CASE for constants: `REQUEST_TIMEOUT_MS`, `MAX_RESPONSE_BYTES`, `SESSION_TTL_MS`, `BASE_URL`, `MAX_SESSIONS`
- ACCEPT_HEADERS, CORS_ORIGIN - constants follow SCREAMING_SNAKE_CASE pattern

**Types:**
- PascalCase for interfaces and type aliases: `Session`, `ToolResult`, `RequestInit`, `Record<string, string>`
- Type imports use `type` keyword: `import type { McpServer }`, `import type { SonixClient }`

## Code Style

**Formatting:**
- TypeScript 5.8.0 via `tsc` - no explicit formatter configured, relying on tsconfig
- Line breaks: functions separated by blank lines, logical sections in code marked with comment blocks
- Block comments mark major sections: `// --- Structured logging ---`, `// --- Server factory ---`, `// --- Stdio mode ---`

**Linting:**
- No ESLint or Prettier configuration found
- TypeScript strict mode enabled in `tsconfig.json`
  - `"strict": true` enforces all strict type-checking options
  - `"skipLibCheck": true` skips type checking of declaration files
  - `"declaration": true` generates .d.ts files

**Indentation:**
- 2 spaces (inferred from source code)
- Consistent indentation in nested blocks

## Import Organization

**Order:**
1. Node.js built-in modules (`node:crypto`, `node:os`)
2. Third-party packages (`@modelcontextprotocol/sdk`, `express`, `zod`)
3. Local imports (relative paths like `./sonix-client.js`, `./tools.js`)

**Path Aliases:**
- `.js` extensions used in ES module imports (`import ... from "./sonix-client.js"`)
- No path aliases configured - all imports use full relative paths
- Top-level constants typically imported at module scope

**Example from `src/index.ts`:**
```typescript
import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import { SonixClient } from "./sonix-client.js";
import { registerTools } from "./tools.js";
```

## Error Handling

**Patterns:**
- Error objects caught generically as `unknown` and converted to strings: `catch (err: unknown) { ... String(err) }`
- Try-catch blocks wrap entire functions, not individual statements
- Error extraction with fallbacks: attempts JSON parse first, then text, then statusText

**Error Result Pattern from `src/tools.ts`:**
```typescript
function errorResult(error: unknown): ToolResult {
  const message =
    error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
```

**HTTP Error Handling:**
- Response status codes checked explicitly: `if (!res.ok)`
- Error responses parsed from multiple possible fields: `.error`, `.message`, or full body stringified
- Size limits enforced: responses above MAX_RESPONSE_BYTES throw errors during streaming

**Session/Auth Errors:**
- Returns `null` from verification functions on error, caller handles null check
- Logs auth failures with context: `log("auth_failure", { ip: req.ip, reason: "invalid_key" })`
- Client-facing error messages provided separately from logging

## Logging

**Framework:** `console.log` with structured JSON format

**Patterns:**
- All logs output as JSON with timestamp and event name: `{ ts: new Date().toISOString(), event, ...data }`
- Event names use snake_case: `server_started`, `session_created`, `auth_failure`, `handler_error`, `session_evicted`
- Context data passed as object with relevant fields: `{ ip, reason }`, `{ port, maxSessions }`
- Sensitive data handling: session IDs hashed with SHA256 for logging: `sessionHash(sid)`

**Usage in `src/index.ts`:**
```typescript
function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

// Example calls
log("server_started", { port, maxSessions: MAX_SESSIONS });
log("auth_failure", { ip: req.ip, reason: "missing_key" });
```

## Comments

**When to Comment:**
- Section dividers marked with `// --- Section Name ---` to visually separate major code blocks
- Inline comments explain non-obvious behavior: complexity rationale, design decisions
- Comments precede relevant code blocks

**Comment Examples from `src/sonix-client.ts`:**
```typescript
// Methods return Promise<unknown> because responses are passed straight to
// JSON.stringify in the tools layer. Add typed interfaces here if the codebase
// grows or tools need to branch on response fields.

// Reads the response body with a size limit to prevent OOM from large transcripts.
// Uses streaming rather than res.arrayBuffer() so we can abort mid-stream for
// responses that lack a Content-Length header (common with chunked transfer).
```

## Function Design

**Size:** Functions are typically 10-50 lines, with longer functions documenting their purpose
- Tool registration functions shorter (5-10 lines with schema)
- Server request handlers 20-40 lines

**Parameters:**
- Object destructuring for optional parameters: `{ page, status, folder_id } = {}`
- Type annotations required for function signatures
- Defaults provided via optional operator: `{ page?: number }`

**Return Values:**
- Explicit return types declared: `Promise<unknown>`, `Promise<Response>`, `ToolResult`
- Async functions always return Promise
- Functions that don't return omit explicit return type (implicit `undefined`)

**Example from `src/tools.ts`:**
```typescript
server.tool(
  "list_media",
  "List all media files in your Sonix account with pagination.",
  {
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Page number (default: 1, 100 items per page)"),
    // ... more params
  },
  async ({ page, status, folder_id }) => {
    try {
      const data = await client.listMedia({ page, status, folder_id });
      return jsonResult(data);
    } catch (error) {
      return errorResult(error);
    }
  }
);
```

## Module Design

**Exports:**
- Named exports for functions and classes: `export function registerTools()`, `export class SonixClient`
- Single export per file is common (SonixClient is the only export from its file)
- Type exports use `export type` keyword

**Module Organization:**
- Clear separation: `sonix-client.ts` handles HTTP/API logic, `tools.ts` handles MCP tool registration
- Constants at module scope (top of file)
- Helper functions declared before main function they support

**Barrel Files:**
- Not used in this project - direct imports from specific files
- Three source files: `index.ts` (entry point/server), `sonix-client.ts` (API client), `tools.ts` (tool definitions)

## Zod Schema Patterns

**Validation:**
- Zod schemas used for MCP tool parameter validation: `z.string()`, `z.number()`, `z.enum()`
- `.optional()` and `.describe()` chaining for self-documenting schemas
- `.default()` for optional parameters with fallbacks: `.default("text")`
- `.int()` and `.min()` for numeric constraints

**Example from `src/tools.ts`:**
```typescript
{
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Page number (default: 1, 100 items per page)"),
  format: z
    .enum(["text", "json", "srt", "vtt"])
    .default("text")
    .describe("Transcript format: text (plain), json (word-level timestamps)...")
}
```

## Async/Await Patterns

**Promise Handling:**
- `.catch()` used for error handling in interval callbacks: `session.transport.close().catch((err: unknown) => {})`
- `async/await` preferred in function bodies
- Promise constructor used only when needed for control flow: session init limiter promise handling

---

*Convention analysis: 2026-04-09*
