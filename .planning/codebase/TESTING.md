# Testing Patterns

**Analysis Date:** 2026-04-09

## Test Framework

**Runner:**
- Not configured - No test framework installed
- No Jest, Vitest, or other test runner present in `package.json`

**Assertion Library:**
- Not applicable - No test framework in use

**Run Commands:**
```bash
# Not available - no test configuration
# No test command in package.json scripts
```

## Test File Organization

**Location:**
- No test files found in the codebase
- No `.test.ts`, `.spec.ts` files in `src/` directory
- Project structure contains only source files: `src/index.ts`, `src/tools.ts`, `src/sonix-client.ts`

**Naming:**
- Not applicable - no test files exist

**Structure:**
- Test directory not created

## Current Testing Approach

**Manual Testing:**
- Project is tested via integration with MCP (Model Context Protocol)
- HTTP mode can be tested by sending requests to `/mcp` endpoint
- Stdio mode tested by running the compiled server as subprocess

**Build Verification:**
- TypeScript compilation validates type safety: `npm run build` runs `tsc`
- Strict mode enabled in `tsconfig.json` provides compile-time safety
- No runtime test suite

## Test Coverage

**Requirements:** None enforced - no testing infrastructure

**View Coverage:**
- Not applicable

## Recommended Testing Structure

For future implementation, tests should follow this structure based on code patterns observed:

**Unit Test Areas:**
- `SonixClient` methods (each HTTP method)
- Tool result formatters (`textResult()`, `jsonResult()`, `errorResult()`)
- Query string builder (`buildQuery()`)
- Session management (verification, eviction)

**Integration Test Areas:**
- HTTP server endpoints (`/mcp`, `/health`)
- Rate limiting behavior (init limiter, global limiter)
- Session creation and validation flow
- MCP protocol message handling

**Example Structure for Future Tests:**

```typescript
// test/sonix-client.test.ts
import { SonixClient } from "../src/sonix-client";

describe("SonixClient", () => {
  let client: SonixClient;

  beforeEach(() => {
    client = new SonixClient("test-key");
  });

  describe("listMedia", () => {
    it("should list media with pagination", async () => {
      // Test implementation
    });

    it("should handle empty results", async () => {
      // Test implementation
    });
  });

  describe("getTranscript", () => {
    it("should return text format by default", async () => {
      // Test implementation
    });

    it("should format JSON transcripts with indentation", async () => {
      // Test implementation
    });

    it("should throw on response too large", async () => {
      // Test implementation
    });
  });
});
```

## Error Handling in Code

**Current Pattern:**
- Try-catch wraps entire async operations
- Errors converted to `ToolResult` with error flag set
- No test assertions - manual verification required

**Example from `src/tools.ts`:**
```typescript
async ({ page, status, folder_id }) => {
  try {
    const data = await client.listMedia({ page, status, folder_id });
    return jsonResult(data);
  } catch (error) {
    return errorResult(error);
  }
}
```

## Code Quality Measures (Current)

**TypeScript Strict Mode:**
- Compilation enforces type safety
- No implicit `any` types
- Null/undefined checking required

**Build Process:**
- `npm run build` compiles TypeScript to JavaScript in `dist/`
- `npm run watch` available for development
- Shebang added via chmod: `chmod +x dist/index.js`

**No Runtime Linting:**
- No ESLint configuration
- No Prettier configuration
- Relies on IDE formatting and developer discipline

## Recommended Testing Implementation

If adding test framework, recommend:

**Framework:** Vitest (lightweight, TypeScript-first, ESM support)
- Matches project's ESM (`"type": "module"`) configuration
- Fast execution for MCP server testing
- Native TypeScript support

**Suggested package.json additions:**
```json
{
  "devDependencies": {
    "vitest": "^1.x",
    "@vitest/ui": "^1.x"
  },
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  }
}
```

**Testing Strategy:**

1. **Unit Tests:** Test utility functions and client methods in isolation
   - Mock HTTP responses
   - Test error handling paths
   - Validate schema transformations

2. **Integration Tests:** Test server endpoints with real MCP transport
   - Session creation and cleanup
   - Rate limiting enforcement
   - Auth validation

3. **Type Tests:** Use TypeScript for compile-time validation
   - Verify client method return types
   - Check tool parameter schemas
   - Validate session interface consistency

## Manual Testing Guidance

**HTTP Mode Testing:**
```bash
# Start server in HTTP mode
PORT=3000 TRANSPORT=http npm start

# Create session (initialize request)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SONIX_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'

# Use session (subsequent requests)
curl -X POST http://localhost:3000/mcp \
  -H "Mcp-Session-Id: SESSION_UUID" \
  -H "Authorization: Bearer YOUR_SONIX_API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/list"}'
```

**Stdio Mode Testing:**
```bash
# Run server in stdio mode (default)
SONIX_API_KEY=your-key npm start
# Send JSON-RPC messages to stdin
```

**Rate Limiting Verification:**
```bash
# Test global rate limit (60 req/min)
for i in {1..61}; do
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/mcp
done
# Last request should return 429

# Test init rate limit (5 sessions/min)
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/mcp \
    -H "Authorization: Bearer $KEY" \
    -d '{"method":"initialize",...}'
done
# 6th should return 429
```

---

*Testing analysis: 2026-04-09*
