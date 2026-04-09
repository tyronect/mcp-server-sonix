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

const apiKey = process.env.SONIX_API_KEY;
if (!apiKey) {
  console.error(
    "Error: SONIX_API_KEY environment variable is required.\n" +
      "Get your API key from https://my.sonix.ai/api"
  );
  process.exit(1);
}

const client = new SonixClient(apiKey);

function createServer(): McpServer {
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
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sonix MCP Server running on stdio");
}

async function startHttp() {
  const port = parseInt(process.env.PORT || "3000", 10);
  const app = express();
  app.use(express.json());

  // Store transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res, req.body);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => { transports.set(sid, transport); },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({ error: "Invalid request: missing session ID or not an initialize request" });
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "Invalid or missing session ID" });
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
    } else {
      res.status(400).json({ error: "Invalid or missing session ID" });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "mcp-server-sonix" });
  });

  app.listen(port, () => {
    console.log(`Sonix MCP Server running on http://0.0.0.0:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http") {
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
