# Stack Research

**Domain:** TypeScript MCP server — production readiness (testing, monitoring, docs, publishing)
**Researched:** 2026-04-09
**Confidence:** MEDIUM (testing and monitoring verified via multiple sources; some version numbers from npm search results not official docs)

## Recommended Stack

### Testing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| vitest | ^4.1.4 | Test runner | Native TypeScript/ESM support, no transpile step, 10x faster than Jest; actively maintained (v4 released Oct 2025). Standard choice for TypeScript projects in 2025+. |
| @modelcontextprotocol/sdk | ^1.29.0 (already installed) | `InMemoryTransport.createLinkedPair()` for integration tests | Official SDK provides linked in-memory client/server transport pair — the correct way to test MCP tools without subprocess or network overhead. No extra dependency needed. |
| @vitest/coverage-v8 | ^4.1.4 | Coverage reporting | V8 native coverage, no instrumentation overhead. Ships with vitest. Use `--coverage` flag. |

**Testing pattern for this project:**

Unit tests: Test `SonixClient` methods by mocking `fetch` with `vi.fn()`.
Integration tests: Wire `McpServer` to a test `Client` via `InMemoryTransport.createLinkedPair()`, call tools via the client, assert on tool responses. This verifies the full MCP protocol path without spawning subprocesses.

```typescript
// Integration test pattern
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await server.connect(serverTransport)
const client = new Client({ name: 'test', version: '1.0.0' }, {})
await client.connect(clientTransport)
const result = await client.callTool({ name: 'list_media', arguments: {} })
```

### Monitoring and Observability

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| pino | ^10.3.1 | Structured JSON logger (replaces current ad-hoc logging) | Fastest Node.js logger, JSON-first output, minimal overhead. The server already does audit logging — pino standardizes and enhances it. Pairs with external log services via transports. |
| pino-http | ^10.x | HTTP request/response logging middleware | Adds `req.log` to every Express request with trace ID correlation. One-line integration with Express 5. |
| @logtail/pino | latest | Pino transport to ship logs to Better Stack (Logtail) | Railway stdout logs have no search or retention. Better Stack (formerly Logtail) is the standard lightweight choice for Railway deployments. Free tier covers this project's scale. |

**What NOT to add for monitoring:**
- OpenTelemetry distributed tracing — overkill for a single-instance MCP server with no microservices. Add only if the deployment grows to multiple services.
- Sentry (error tracking) — adds weight; Better Stack's alert-on-log-pattern covers the use case. Revisit if error volume makes it justified.
- Datadog / New Relic — expensive, agent-heavy, wrong scale for this project.

### npm Publishing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| tsup | ^8.5.1 | Build/bundle for npm publish | esbuild-powered, outputs both ESM and CJS from one config, auto-generates `.d.ts` declaration files. Zero-config for most cases. Current project uses `tsc` only — tsup is needed for clean dual-format npm packaging. |
| publint | latest | Pre-publish validation | Lints `package.json` exports/main/types fields, catches format mismatches before they reach consumers. Run in `prepublishOnly` script. |

**Publishing `package.json` pattern:**
```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "npm run build && npx publint"
  }
}
```

**Note on MCP server npm publishing:** This project is an MCP server (run as a subprocess or HTTP endpoint), not a library. Publishing to npm is for `npx`-based installation convenience, not API consumption. Use `bin` field in `package.json` to expose the server entry point. ESM-only output is sufficient — no need for dual CJS/ESM if targeting Node.js 22+.

### Documentation

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| (none — write README.md manually) | — | User-facing docs | MCP servers are not libraries. TypeDoc generates API docs for library consumers. The actual documentation need here is: setup instructions, tool reference table, connection examples for Claude Desktop / Cursor. A well-structured README.md serves this better than generated API docs. |

**What NOT to add:**
- TypeDoc — generates documentation from TypeScript types, useful for libraries. An MCP server's public interface is its tool list, not its TypeScript exports. A README with a tool reference table is more useful.
- Docusaurus / VitePress — documentation sites are overkill for internal dev tooling.
- Storybook — frontend only, irrelevant.

### Development Tools (already present or to add)

| Tool | Purpose | Notes |
|------|---------|-------|
| @types/node ^22 | Already installed | No change needed |
| tsx | Fast TS execution for scripts | Already available via Node.js 22 `--import tsx` or `ts-node` alternative. Not required if tests run via vitest. |

## Installation

```bash
# Testing
npm install -D vitest @vitest/coverage-v8

# Monitoring (production dependencies — needed at runtime for log shipping)
npm install pino pino-http @logtail/pino

# Publishing toolchain (dev — build and validate)
npm install -D tsup publint
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| vitest | Jest | Only if the project already has heavy Jest investment (mocks, custom matchers). Jest 29+ now supports ESM but requires more config. For a greenfield test suite, vitest wins. |
| pino | winston | Winston is more configurable and has a larger plugin ecosystem. Use it if the team is already standardized on it or needs multi-transport fan-out with complex transforms. |
| tsup | tsc (current) | `tsc` is fine for simple CJS-only builds. Use tsup only when dual-format output (ESM + CJS) or tree-shaking is needed for npm packaging. |
| Better Stack / Logtail | Papertrail, Datadog Logs, Axiom | Axiom is excellent and has a generous free tier — strong alternative. Papertrail is simpler but lacks structured log queries. Datadog is powerful but expensive for small deployments. |
| README.md (manual) | TypeDoc | TypeDoc only if this becomes a library that other developers import as a module. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Jest | Requires Babel or `ts-jest` transform for TypeScript/ESM; slower than vitest; more config overhead for this project's Node 22/TS 5.8 stack | vitest |
| OpenTelemetry (for this milestone) | Adds 5+ packages, requires OTEL collector config, overkill for a single-instance server without distributed tracing needs | pino + Better Stack |
| TypeDoc | Wrong tool for the job — generates API reference docs from types, not usage guides for an MCP server | Hand-written README with tool reference table |
| rollup / webpack / esbuild directly | More config than tsup for the same output; tsup wraps esbuild with sensible defaults | tsup |
| `npm version` + manual publish | Error-prone; misses pre-publish validation | tsup build + publint + `npm publish` in a documented release checklist or CI step |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| vitest ^4.1.4 | Node.js 22+ | Vitest 4 requires Node.js 18+; fine on this project's Node 22.15 |
| pino ^10.3.1 | Node.js 18+ | Pino 10 requires Node.js 18+; compatible with Node 22 |
| tsup ^8.5.1 | TypeScript 5.x | tsup 8 uses esbuild 0.24+, fully compatible with TS 5.8 |
| @modelcontextprotocol/sdk ^1.29.0 | Already installed | `InMemoryTransport` has been available since SDK 1.x; no version bump needed for testing |

## Sources

- [MCPcat — Unit Testing MCP Servers](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/) — InMemoryTransport pattern, Vitest recommendation
- [modelcontextprotocol/typescript-sdk — inMemory.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/inMemory.ts) — Official SDK in-memory transport implementation
- [vitest 4.1 release blog](https://main.vitest.dev/blog/vitest-4-1) — Version confirmation
- [vitest npm page](https://www.npmjs.com/package/vitest) — Latest stable 4.1.4 (April 2026)
- [pino npm page](https://www.npmjs.com/package/pino) — Latest stable 10.3.1 (February 2026)
- [tsup npm page + libraries.io](https://libraries.io/npm/tsup) — Latest stable 8.5.1 (November 2025)
- [Better Stack — Pino guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) — Railway + Logtail integration
- [publint.dev](https://publint.dev/) — Pre-publish validation tool
- [2ality — Publishing ESM-based npm packages with TypeScript (2025)](https://2ality.com/2025/02/typescript-esm-packages.html) — ESM publish patterns
- [TypeScript in 2025: ESM and CJS npm publishing](https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing) — Module format considerations

---
*Stack research for: TypeScript MCP server production readiness*
*Researched: 2026-04-09*
