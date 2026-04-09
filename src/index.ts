#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { SonixClient } from "./sonix-client.js";
import { registerTools } from "./tools.js";

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

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function startHttp() {
  const port = parseInt(process.env.PORT || "3000", 10);
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const sessions = new Map<string, Session>();

  // Evict stale sessions every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        session.transport.close();
        sessions.delete(sid);
        console.log(`Session ${sid} evicted (idle ${SESSION_TTL_MS / 1000}s)`);
      }
    }
  }, 5 * 60 * 1000);

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const authHeader = req.headers.authorization;
      const apiKey =
        authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : process.env.SONIX_API_KEY;

      if (!apiKey) {
        res.status(401).json({
          error:
            "Missing API key. Provide via Authorization: Bearer <key> header, " +
            "or set SONIX_API_KEY on the server.",
        });
        return;
      }

      const client = new SonixClient(apiKey);
      const server = createServer(client);
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          sessions.set(sid, { transport, server, lastActivity: Date.now() });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          console.log(`Session ${transport.sessionId} closed`);
        }
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({ error: "Invalid request: missing session ID or not an initialize request" });
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "Invalid or missing session ID" });
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "Invalid or missing session ID" });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "mcp-server-sonix",
      activeSessions: sessions.size,
    });
  });

  app.listen(port, () => {
    console.log(`Sonix MCP Server running on http://0.0.0.0:${port}/mcp`);
  });
}

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
