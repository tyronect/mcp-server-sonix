# MCP Server for Sonix.ai

## What This Is

An MCP (Model Context Protocol) server that lets AI agents interact with Sonix.ai's transcription API. Built as internal tooling for Cadence Translate's dev team to pull transcripts, monitor uploads, trigger translations, and manage the Sonix pipeline through AI agents. Deployed on Railway with per-user API key authentication.

## Core Value

Dev team can automate Sonix transcription workflows through AI agents — pulling transcripts, managing files, and triggering translations without manual Sonix UI interaction.

## Requirements

### Validated

- ✓ List, search, get, upload, update, and delete media files — existing
- ✓ Retrieve transcripts in text, JSON, SRT, and VTT formats — existing
- ✓ Create and retrieve translated transcripts — existing
- ✓ Generate AI summaries of transcriptions — existing
- ✓ List and create folders for media organization — existing
- ✓ Dual transport: stdio (local) and Streamable HTTP (remote) — existing
- ✓ Per-user API key auth via Authorization header — existing
- ✓ Session management with TTL, eviction, and capacity limits — existing
- ✓ Rate limiting (global + init) and CORS configuration — existing
- ✓ API key validation before session allocation — existing
- ✓ Structured JSON audit logging — existing
- ✓ 10MB response size limit to prevent OOM — existing
- ✓ Deployed on Railway with Dockerfile — existing

### Active

- [ ] Automated test suite (unit + integration)
- [ ] Error monitoring and observability (structured logs → external service)
- [ ] README with setup instructions, tool reference, and connection examples
- [ ] npm package publishing for easy installation

### Out of Scope

- Browser-based UI — this is an MCP server, not a web app
- Sonix webhook receiver — would require persistent state and separate infrastructure
- File upload from local disk — MCP tools receive JSON params, not binary; URL-based upload is the correct approach

## Context

- Cadence Translate uses Sonix.ai for transcription across client folders (TA Associates, GLG, Dialectica, etc.)
- Editor-specific folders have restricted transcript access — this is a Sonix permission setting, not an MCP server issue
- The "Completed File" and "Home" folders are fully accessible via API
- The server has been through 3 rounds of security review and hardening
- Dev team (not the whole company) will connect MCP clients to this server

## Constraints

- **API**: Sonix API v1 — no search-specific endpoint confirmed, using `?search=` param on `/media`
- **Transport**: MCP SDK v1.29 — Streamable HTTP transport, not the older SSE transport
- **Runtime**: Node.js 22.15, TypeScript, Express 5
- **Deployment**: Railway (Docker), single instance, in-memory sessions (lost on restart)
- **Auth**: Sonix Bearer tokens only — no OAuth, no API key management layer

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Per-session SonixClient | Each user's API key is isolated; no shared credentials | ✓ Good |
| In-memory sessions | Simple, no persistence needed for stateless tool calls | ✓ Good — acceptable for current scale |
| Express 5 | Latest stable, async error handling built-in | — Pending (relatively new) |
| No env var fallback in HTTP mode | Prevents shared-key abuse on public deployment | ✓ Good |
| 30min session TTL | Balances resource usage with reconnection friction | — Pending |

---
*Last updated: 2026-04-10 after initialization*
