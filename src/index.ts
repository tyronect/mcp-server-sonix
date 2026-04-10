#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import rateLimit from "express-rate-limit";
import { SonixClient } from "./sonix-client.js";
import { registerTools } from "./tools.js";

// --- Structured logging ---

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

function sessionHash(sid: string): string {
  return createHash("sha256").update(sid).digest("hex").slice(0, 8);
}

// --- Server factory ---

function createServer(client: SonixClient): McpServer {
  const server = new McpServer(
    { name: "mcp-server-sonix", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Sonix.ai transcription service. Use list_media or search_media to find files. " +
        "Use get_media to check transcription status. Use get_transcript to retrieve completed transcripts. " +
        "Use upload_media to submit URLs for transcription (async — check status with get_media). " +
        "Use list_folders/create_folder to organize media. " +
        "Use translate_transcript/get_translation for multilingual transcripts.",
    }
  );
  registerTools(server, client);
  return server;
}

// --- Stdio mode ---

async function startStdio() {
  const apiKey = process.env.SONIX_API_KEY;
  if (!apiKey) {
    console.error(
      "Error: SONIX_API_KEY environment variable is required for stdio mode.\n" +
        "Get your API key from https://my.sonix.ai/api"
    );
    process.exit(1);
  }

  const client = new SonixClient(apiKey);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sonix MCP Server running on stdio");
}

// --- HTTP mode ---

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  apiKey: string;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "100", 10);

// Shared handler for GET/DELETE — both just verify session and forward to transport
async function handleSessionRequest(
  method: string,
  sessions: Map<string, Session>,
  verifySession: (req: express.Request, res: express.Response) => Session | null,
  req: express.Request,
  res: express.Response
) {
  try {
    const session = verifySession(req, res);
    if (!session) return;
    await session.transport.handleRequest(req, res);
  } catch (err) {
    log("handler_error", { method, err: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

async function startHttp() {
  const port = parseInt(process.env.PORT || "3000", 10);
  const app = express();

  // Required behind Railway's load balancer so req.ip reflects the real client
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(express.json({ limit: "1mb" }));

  // CORS — blocked by default, set CORS_ORIGIN env var to allow specific origins
  const corsOrigin = process.env.CORS_ORIGIN || "";
  app.use((_req, res, next) => {
    if (corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    next();
  });
  app.options("/mcp", (_req, res) => res.status(204).end());

  // 60 requests/min per IP across all /mcp routes
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." },
  });

  // 5 new sessions/min per IP — simple counter, not express-rate-limit middleware
  // (express-rate-limit's middleware pattern doesn't work reliably when invoked
  // manually inside a route handler — it sets headers but may not block requests)
  const initAttempts = new Map<string, { count: number; resetAt: number }>();
  const INIT_WINDOW_MS = 60 * 1000;
  const INIT_LIMIT = 5;

  function checkInitRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = initAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      initAttempts.set(ip, { count: 1, resetAt: now + INIT_WINDOW_MS });
      return true;
    }
    entry.count++;
    return entry.count <= INIT_LIMIT;
  }

  // Clean up stale init rate limit entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of initAttempts) {
      if (now > entry.resetAt) initAttempts.delete(ip);
    }
  }, 5 * 60 * 1000);

  app.use("/mcp", globalLimiter);

  const sessions = new Map<string, Session>();

  // Evict idle sessions every minute. Catches transport.close() errors
  // to prevent the eviction loop from dying on a bad session.
  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        session.transport.close().catch((err: unknown) => {
          log("session_evict_error", { err: String(err) });
        });
        sessions.delete(sid);
        log("session_evicted", { remaining: sessions.size });
      }
    }
  }, 60 * 1000);

  function extractApiKey(req: express.Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return undefined;
    return authHeader.slice(7);
  }

  function verifySession(req: express.Request, res: express.Response): Session | null {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return null;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return null;
    }
    const apiKey = extractApiKey(req);
    if (apiKey !== session.apiKey) {
      log("auth_failure", { ip: req.ip });
      res.status(401).json({ error: "Unauthorized: API key does not match session" });
      return null;
    }
    session.lastActivity = Date.now();
    return session;
  }

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        const session = verifySession(req, res);
        if (!session) return;
        await session.transport.handleRequest(req, res, req.body);
      } else if (isInitializeRequest(req.body)) {
        // Rate limit session creation per IP
        const clientIp = req.ip || "unknown";
        if (!checkInitRateLimit(clientIp)) {
          log("rate_limited", { ip: clientIp, reason: "init_limit" });
          res.status(429).json({ error: "Too many new sessions. Try again later." });
          return;
        }

        const apiKey = extractApiKey(req);

        if (!apiKey) {
          log("auth_failure", { ip: req.ip, reason: "missing_key" });
          res.status(401).json({
            error: "Missing API key. Provide via Authorization: Bearer <key> header.",
          });
          return;
        }

        if (sessions.size >= MAX_SESSIONS) {
          log("session_rejected", { ip: req.ip, reason: "at_capacity" });
          res.status(503).json({ error: "Server at capacity. Try again later." });
          return;
        }

        // Validate API key against Sonix before allocating session resources
        const client = new SonixClient(apiKey);
        try {
          await client.listMedia({ page: 1 });
        } catch {
          log("auth_failure", { ip: req.ip, reason: "invalid_key" });
          res.status(401).json({ error: "Invalid API key." });
          return;
        }

        const server = createServer(client);
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport, server, apiKey, lastActivity: Date.now() });
            log("session_created", { ip: req.ip, sh: sessionHash(sid), total: sessions.size });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            log("session_closed", { remaining: sessions.size });
          }
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ error: "Invalid request: missing session ID or not an initialize request" });
      }
    } catch (err) {
      log("handler_error", { method: "POST", err: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", (req, res) => handleSessionRequest("GET", sessions, verifySession, req, res));
  app.delete("/mcp", (req, res) => handleSessionRequest("DELETE", sessions, verifySession, req, res));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Global error handler — prevents stack trace leaks from malformed JSON, oversized bodies, etc.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log("express_error", { err: String(err) });
    if (!res.headersSent) {
      res.status(400).json({ error: "Bad request" });
    }
  });

  app.listen(port, () => {
    log("server_started", { port, maxSessions: MAX_SESSIONS });
  });
}

// --- Entry point ---

const mode = process.env.TRANSPORT || "stdio";

if (mode === "http") {
  startHttp().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
} else {
  startStdio().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
