const BASE_URL = "https://api.sonix.ai/v1";

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
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
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
        message = res.statusText;
      }
      throw new Error(`${res.status}: ${message}`);
    }

    return res;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined
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
    const res = await this.request(`/media/${id}`);
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
    const res = await this.request(`/media/${id}/transcript${ext}`, {
      headers: format === "text" ? { Accept: "text/plain" } : {},
    });
    if (format === "json") {
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    return res.text();
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
    await this.request(`/media/${id}`, { method: "DELETE" });
  }

  async updateMedia(
    id: string,
    params: {
      name?: string;
      custom_label?: string;
      folder_id?: string;
    }
  ): Promise<unknown> {
    const res = await this.request(`/media/${id}`, {
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
    const res = await this.request(`/media/${id}/summarizations`, {
      method: "POST",
      body: JSON.stringify(params),
    });
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
    const res = await this.request(`/media/${id}/translations`, {
      method: "POST",
      body: JSON.stringify({ language }),
    });
    return res.json();
  }

  async getTranslation(
    id: string,
    language: string,
    format: "text" | "json" | "srt" | "vtt" = "text"
  ): Promise<string> {
    const ext = format === "text" ? "" : `.${format}`;
    const res = await this.request(
      `/media/${id}/translations/${language}/transcript${ext}`,
      { headers: format === "text" ? { Accept: "text/plain" } : {} }
    );
    if (format === "json") {
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    return res.text();
  }
}
