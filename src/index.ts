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

async function startHttp() {
  const port = parseInt(process.env.PORT || "3000", 10);
  const app = express();

  // Fix #2: trust proxy for correct req.ip behind Railway's load balancer
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "1mb" }));

  // CORS — restrictive by default, configurable via CORS_ORIGIN env var
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

  // Rate limiting — global limit for all /mcp requests
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." },
  });

  // Fix #1: init rate limiter as proper middleware on a sub-path
  // Applied only to POST /mcp/init — we route init requests there internally
  const initLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many new sessions. Try again later." },
  });

  app.use("/mcp", globalLimiter);

  const sessions = new Map<string, Session>();

  // Fix #4: evict stale sessions every 1 minute, catch close errors
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

  // Fix #7: use .get() and check for undefined instead of has() + get()!
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

  // Fix #3: wrap all route handlers in try/catch
  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        const session = verifySession(req, res);
        if (!session) return;
        await session.transport.handleRequest(req, res, req.body);
      } else if (isInitializeRequest(req.body)) {
        // Fix #1: apply init rate limit as a proper middleware call that always resolves
        const limited = await new Promise<boolean>((resolve) => {
          initLimiter(req, res, () => resolve(false));
          // If rate limited, express-rate-limit sends 429 and never calls next.
          // Detect this by listening for the response to finish.
          res.on("finish", () => resolve(true));
        });
        if (limited) return;

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

        // Fix #5: validate API key before allocating session
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

  app.get("/mcp", async (req, res) => {
    try {
      const session = verifySession(req, res);
      if (!session) return;
      await session.transport.handleRequest(req, res);
    } catch (err) {
      log("handler_error", { method: "GET", err: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    try {
      const session = verifySession(req, res);
      if (!session) return;
      await session.transport.handleRequest(req, res);
    } catch (err) {
      log("handler_error", { method: "DELETE", err: String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
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
