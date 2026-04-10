const BASE_URL = "https://api.sonix.ai/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

const ACCEPT_HEADERS: Record<string, string> = {
  text: "text/plain",
  json: "application/json",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};

export class SonixClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers as Record<string, string> | undefined),
    };

    const res = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      let message: string;
      try {
        const body = await res.json();
        message =
          (body as Record<string, unknown>).error as string ||
          (body as Record<string, unknown>).message as string ||
          JSON.stringify(body);
      } catch {
        try {
          message = await res.text();
        } catch {
          message = res.statusText || "Unknown error";
        }
      }
      throw new Error(`${res.status}: ${message}`);
    }

    return res;
  }

  private async readBody(res: Response): Promise<string> {
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      throw new Error("Response too large");
    }
    const reader = res.body?.getReader();
    if (!reader) return res.text();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel();
        throw new Error("Response too large (exceeded 10MB limit)");
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
    );
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== ""
    ) as [string, string | number][];
    if (entries.length === 0) return "";
    return "?" + new URLSearchParams(
      entries.map(([k, v]) => [k, String(v)])
    ).toString();
  }

  async listMedia(params: {
    page?: number;
    status?: string;
    folder_id?: string;
  } = {}): Promise<unknown> {
    const query = this.buildQuery(params);
    const res = await this.request(`/media${query}`);
    return res.json();
  }

  async getMedia(id: string): Promise<unknown> {
    const res = await this.request(`/media/${encodeURIComponent(id)}`);
    return res.json();
  }

  async uploadMedia(params: {
    file_url: string;
    language: string;
    name?: string;
    folder_id?: string;
    keywords?: string;
    callback_url?: string;
  }): Promise<unknown> {
    const res = await this.request("/media", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async getTranscript(
    id: string,
    format: "text" | "json" | "srt" | "vtt"
  ): Promise<string> {
    const ext = format === "text" ? "" : `.${format}`;
    const res = await this.request(
      `/media/${encodeURIComponent(id)}/transcript${ext}`,
      { headers: { Accept: ACCEPT_HEADERS[format] } }
    );
    const body = await this.readBody(res);
    if (format === "json") {
      const data = JSON.parse(body);
      return JSON.stringify(data, null, 2);
    }
    return body;
  }

  async searchMedia(params: {
    search: string;
    page?: number;
    status?: string;
  }): Promise<unknown> {
    const query = this.buildQuery(params);
    const res = await this.request(`/media${query}`);
    return res.json();
  }

  async deleteMedia(id: string): Promise<void> {
    await this.request(`/media/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async updateMedia(
    id: string,
    params: {
      name?: string;
      custom_label?: string;
      folder_id?: string;
    }
  ): Promise<unknown> {
    const res = await this.request(`/media/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async createSummarization(
    id: string,
    params: {
      subtype?: string;
      prompt?: string;
      sentence_count?: number;
    }
  ): Promise<unknown> {
    const res = await this.request(
      `/media/${encodeURIComponent(id)}/summarizations`,
      { method: "POST", body: JSON.stringify(params) }
    );
    return res.json();
  }

  async listFolders(): Promise<unknown> {
    const res = await this.request("/folders");
    return res.json();
  }

  async createFolder(name: string): Promise<unknown> {
    const res = await this.request("/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return res.json();
  }

  async translateTranscript(
    id: string,
    language: string
  ): Promise<unknown> {
    const res = await this.request(
      `/media/${encodeURIComponent(id)}/translations`,
      { method: "POST", body: JSON.stringify({ language }) }
    );
    return res.json();
  }

  async getTranslation(
    id: string,
    language: string,
    format: "text" | "json" | "srt" | "vtt" = "text"
  ): Promise<string> {
    const ext = format === "text" ? "" : `.${format}`;
    const res = await this.request(
      `/media/${encodeURIComponent(id)}/translations/${encodeURIComponent(language)}/transcript${ext}`,
      { headers: { Accept: ACCEPT_HEADERS[format] } }
    );
    const body = await this.readBody(res);
    if (format === "json") {
      const data = JSON.parse(body);
      return JSON.stringify(data, null, 2);
    }
    return body;
  }
}
