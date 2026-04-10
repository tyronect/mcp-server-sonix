import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// zod v4 API via subpath export (available since zod@3.24), required by MCP SDK for Standard Schema
import * as z from "zod/v4";
import type { SonixClient } from "./sonix-client.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function errorResult(error: unknown): ToolResult {
  const message =
    error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

export function registerTools(server: McpServer, client: SonixClient) {
  // --- Media Tools ---

  server.tool(
    "list_media",
    "List all media files in your Sonix account with pagination. Returns media IDs, names, statuses, and metadata.",
    {
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Page number (default: 1, 100 items per page)"),
      status: z
        .string()
        .optional()
        .describe(
          "Filter by status: 'completed', 'transcribing', 'failed', etc."
        ),
      folder_id: z
        .string()
        .optional()
        .describe("Filter by folder ID"),
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

  server.tool(
    "get_media",
    "Get details and transcription status of a specific media file.",
    {
      media_id: z.string().describe("The Sonix media ID"),
    },
    async ({ media_id }) => {
      try {
        const data = await client.getMedia(media_id);
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "upload_media",
    "Submit a publicly accessible URL for transcription. Transcription happens asynchronously — use get_media to check status.",
    {
      file_url: z
        .string()
        .describe("Publicly accessible URL of the audio/video file"),
      language: z
        .string()
        .describe("Language code, e.g. 'en' for English, 'es' for Spanish"),
      name: z
        .string()
        .optional()
        .describe("Display name for the media"),
      folder_id: z
        .string()
        .optional()
        .describe("Folder ID to organize the media into"),
      keywords: z
        .string()
        .optional()
        .describe("Comma-separated keywords to improve transcription accuracy"),
      callback_url: z
        .string()
        .optional()
        .describe("Webhook URL to notify when transcription completes"),
    },
    async ({ file_url, language, name, folder_id, keywords, callback_url }) => {
      try {
        const data = await client.uploadMedia({
          file_url,
          language,
          name,
          folder_id,
          keywords,
          callback_url,
        });
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_transcript",
    "Retrieve a completed transcript in various formats. The media must have status 'completed'.",
    {
      media_id: z.string().describe("The Sonix media ID"),
      format: z
        .enum(["text", "json", "srt", "vtt"])
        .default("text")
        .describe(
          "Transcript format: text (plain), json (word-level timestamps), srt (subtitles), vtt (web subtitles)"
        ),
    },
    async ({ media_id, format }) => {
      try {
        const text = await client.getTranscript(media_id, format);
        return textResult(text);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "search_media",
    "Search media files by name or content.",
    {
      query: z
        .string()
        .describe("Search query to filter media by name or content"),
      page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      status: z.string().optional().describe("Filter by status"),
    },
    async ({ query, page, status }) => {
      try {
        const data = await client.searchMedia({
          search: query,
          page,
          status,
        });
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "delete_media",
    "Permanently delete a media file. This cannot be undone.",
    {
      media_id: z.string().describe("The Sonix media ID to delete"),
    },
    async ({ media_id }) => {
      try {
        await client.deleteMedia(media_id);
        return textResult(`Media ${media_id} deleted successfully.`);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "update_media",
    "Update metadata on a media file (name, label, folder).",
    {
      media_id: z.string().describe("The Sonix media ID"),
      name: z.string().optional().describe("New display name"),
      custom_label: z
        .string()
        .optional()
        .describe("Custom label for the media"),
      folder_id: z
        .string()
        .optional()
        .describe("Move to a different folder by ID"),
    },
    async ({ media_id, name, custom_label, folder_id }) => {
      try {
        const data = await client.updateMedia(media_id, {
          name,
          custom_label,
          folder_id,
        });
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "summarize_media",
    "Generate an AI summary of a completed transcription. Returns the summarization result or job ID if still processing.",
    {
      media_id: z
        .string()
        .describe("The Sonix media ID (must be completed)"),
      subtype: z
        .enum([
          "summary",
          "chapters",
          "sentiment",
          "thematic",
          "topic",
          "entity",
          "custom",
        ])
        .default("summary")
        .describe("Type of summarization to generate"),
      prompt: z
        .string()
        .optional()
        .describe("Custom prompt for 'custom' subtype summarization"),
      sentence_count: z
        .number()
        .optional()
        .describe("Target number of sentences for the summary"),
    },
    async ({ media_id, subtype, prompt, sentence_count }) => {
      try {
        const data = await client.createSummarization(media_id, {
          subtype,
          prompt,
          sentence_count,
        });
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Folder Tools ---

  server.tool(
    "list_folders",
    "List all folders in your Sonix account.",
    {},
    async () => {
      try {
        const data = await client.listFolders();
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "create_folder",
    "Create a new folder to organize media files.",
    {
      name: z.string().describe("Name for the new folder"),
    },
    async ({ name }) => {
      try {
        const data = await client.createFolder(name);
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Translation Tools ---

  server.tool(
    "translate_transcript",
    "Create a translation of a completed transcript into another language. Translation happens asynchronously.",
    {
      media_id: z
        .string()
        .describe("The Sonix media ID (must be completed)"),
      language: z
        .string()
        .describe("Target language code, e.g. 'es' for Spanish, 'fr' for French"),
    },
    async ({ media_id, language }) => {
      try {
        const data = await client.translateTranscript(media_id, language);
        return jsonResult(data);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_translation",
    "Retrieve a translated transcript in various formats.",
    {
      media_id: z.string().describe("The Sonix media ID"),
      language: z
        .string()
        .describe("Language code of the translation to retrieve"),
      format: z
        .enum(["text", "json", "srt", "vtt"])
        .default("text")
        .describe("Output format"),
    },
    async ({ media_id, language, format }) => {
      try {
        const text = await client.getTranslation(media_id, language, format);
        return textResult(text);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
