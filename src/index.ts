#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sonix MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
