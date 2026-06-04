import { Agent, request } from "undici";
import { BASE_URL, DEFAULT_HEADERS } from "../constants.js";
import type { ApiEnvelope, ParsedApiResponse, RequestPayload } from "../types.js";
import { buildEncryptedPayload, decryptData2 } from "../crypto/crypto.service.js";

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly agent: Agent;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.headers = { ...DEFAULT_HEADERS, ...options.headers };
    this.agent = new Agent({
      connect: {
        rejectUnauthorized: false,
        timeout: this.timeoutMs
      },
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      pipelining: 1
    });
  }

  async warmup(): Promise<void> {
    try {
      await request(this.baseUrl, {
        method: "HEAD",
        dispatcher: this.agent,
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs
      });
    } catch {
      // Warmup is best effort. Some servers reject HEAD while still establishing useful DNS/TLS state.
    }
  }

  async postEncrypted<T = unknown>(path: string, payload: RequestPayload): Promise<ParsedApiResponse<T>> {
    const totalStart = performance.now();
    const encrypted = buildEncryptedPayload(payload, this.baseUrl);
    const requestStart = performance.now();
    const response = await request(new URL(path, this.baseUrl), {
      method: "POST",
      dispatcher: this.agent,
      body: encrypted,
      headers: {
        ...this.headers,
        "Content-Length": Buffer.byteLength(encrypted).toString()
      },
      bodyTimeout: this.timeoutMs,
      headersTimeout: this.timeoutMs
    });
    const text = await response.body.text();
    const requestMs = performance.now() - requestStart;

    let envelope: ApiEnvelope;
    try {
      envelope = JSON.parse(text) as ApiEnvelope;
    } catch {
      envelope = { result: String(response.statusCode), msg: text };
    }

    let data: T | undefined;
    let rawData2: string | undefined;
    const decryptStart = performance.now();
    if (typeof envelope.data2 === "string") {
      rawData2 = decryptData2(envelope.data2);
      try {
        data = JSON.parse(rawData2) as T;
      } catch {
        data = rawData2 as T;
      }
    }
    const decryptMs = performance.now() - decryptStart;

    return {
      envelope,
      data,
      rawData2,
      statusCode: response.statusCode,
      timings: {
        requestMs,
        decryptMs,
        totalMs: performance.now() - totalStart
      }
    };
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
