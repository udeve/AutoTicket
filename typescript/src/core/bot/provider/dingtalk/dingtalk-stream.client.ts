import { request } from "undici";
import type { BotLogger } from "../../bot.types.js";

/** 从钉钉报文中提取的归一化消息。 */
export interface StreamMessagePayload {
  readonly text: string;
  readonly senderId: string;
  readonly senderNick?: string;
  readonly conversationId?: string;
  readonly sessionWebhook: string;
  readonly msgId: string;
  readonly raw: unknown;
}

export interface DingTalkStreamClientOptions {
  clientId: string;
  clientSecret: string;
  onMessage: (payload: StreamMessagePayload) => Promise<void>;
  logger?: BotLogger;
  /** 测试桩注入点；默认用 Node 22+ 全局 WebSocket。 */
  socketFactory?: (url: string) => WebSocket;
}

// ── 钉钉 Stream (dingservice) 协议常量 ────────────────────────────────
// 注意：以下 code 与帧结构依据钉钉开放平台 Stream 协议；接入时如与当前文档不符，
// 仅需在此处调整，影响局限在本文件（见 plan 风险 4）。
const GATEWAY_BASE = "https://api.dingtalk.com";
const TOKEN_PATH = "/v1.0/oauth2/accessToken";
const CONNECTION_PATH = "/v1.0/gateway/connections/open";
const TOPIC_BOT_MESSAGE = "bot/messages/get";
const FRAME_CODE_REGISTER = 1000; // 客户端注册 / ACK
const FRAME_CODE_PING = 1001; // 应用层心跳
const FRAME_CODE_DATA = 200; // 服务端下发业务数据

const PING_INTERVAL_MS = 50_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

interface StreamFrame {
  code: number;
  headers?: Record<string, unknown>;
  data?: unknown;
}

/**
 * 钉钉 Stream 客户端：维护一条到钉钉网关的 WSS 出站长连（无需公网 IP），
 * 收到机器人消息后归一化回调，并自动重连。
 */
export class DingTalkStreamClient {
  private readonly logger: BotLogger;
  private readonly socketFactory: (url: string) => WebSocket;
  private running = false;
  private socket: WebSocket | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private attempt = 0;

  constructor(private readonly options: DingTalkStreamClientOptions) {
    this.logger = options.logger ?? (() => undefined);
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.connect();
      } catch (error) {
        this.logger(`dingtalk stream 连接异常: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!this.running) break;
      const delay = computeBackoffMs(this.attempt) + Math.floor(Math.random() * 1000);
      this.attempt += 1;
      this.logger(`dingtalk stream 将在 ${Math.round(delay / 1000)}s 后重连（第 ${this.attempt} 次）。`);
      await sleep(delay);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearPing();
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
  }

  private async connect(): Promise<void> {
    const accessToken = await this.fetchAccessToken();
    const { endpoint, ticket } = await this.openConnection(accessToken);
    await new Promise<void>((resolve, reject) => {
      const socket = this.socketFactory(endpoint);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.attempt = 0;
        this.logger("dingtalk stream WSS 已连接。");
        socket.send(buildRegisterFrame(this.options.clientId, ticket));
        this.startPing();
      });
      socket.addEventListener("message", (event: MessageEvent) => {
        void this.handleRaw(event.data);
      });
      socket.addEventListener("close", () => {
        this.clearPing();
        resolve();
      });
      socket.addEventListener("error", () => {
        this.clearPing();
        reject(new Error("dingtalk stream WSS error"));
      });
    });
  }

  private async handleRaw(raw: unknown): Promise<void> {
    const frame = parseFrame(raw);
    if (!frame || frame.code !== FRAME_CODE_DATA) return;
    const topic = typeof frame.headers?.topic === "string" ? frame.headers.topic : "";
    if (!topic.includes(TOPIC_BOT_MESSAGE)) return;
    const payload = extractStreamPayload(frame.data);
    if (!payload) return;
    try {
      await this.options.onMessage(payload);
    } catch (error) {
      this.logger(`处理 dingtalk 消息异常: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.ack(frame);
  }

  private ack(frame: StreamFrame): void {
    const messageId = frame.headers?.messageId;
    if (typeof messageId !== "string") return;
    try {
      this.socket?.send(buildAckFrame(messageId));
    } catch {
      /* ignore */
    }
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => {
      try {
        this.socket?.send(buildPingFrame());
      } catch {
        /* ignore */
      }
    }, PING_INTERVAL_MS);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private async fetchAccessToken(): Promise<string> {
    const data = await postJson(`${GATEWAY_BASE}${TOKEN_PATH}`, {
      appKey: this.options.clientId,
      appSecret: this.options.clientSecret
    });
    if (typeof data.accessToken !== "string" || !data.accessToken) {
      throw new Error("获取钉钉 accessToken 失败，请检查 clientId/clientSecret。");
    }
    return data.accessToken;
  }

  private async openConnection(accessToken: string): Promise<{ endpoint: string; ticket: string }> {
    const data = await postJson(`${GATEWAY_BASE}${CONNECTION_PATH}`, {
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      grants: [],
      token: accessToken
    });
    if (typeof data.endpoint !== "string" || !data.endpoint) {
      throw new Error("打开钉钉 Stream 连接失败：未返回 endpoint。");
    }
    return { endpoint: data.endpoint, ticket: typeof data.ticket === "string" ? data.ticket : "" };
  }
}

// ── 纯函数（可单测，无 I/O）────────────────────────────────────────────

export function parseFrame(raw: unknown): StreamFrame | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as StreamFrame) : null;
  } catch {
    return null;
  }
}

/** 从机器人消息 data 提取归一化 payload；缺关键字段返回 null。 */
export function extractStreamPayload(data: unknown): StreamMessagePayload | null {
  const obj = typeof data === "string" ? safeParse(data) : data;
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  const text = readStringPath(record, ["text", "content"]) ?? "";
  const sessionWebhook = readString(record, "sessionWebhook");
  const senderId = readString(record, "senderStaffId") ?? readString(record, "senderId");
  const msgId = readString(record, "msgId");
  if (!sessionWebhook || !senderId) return null;
  return {
    text: stripAtMention(text).trim(),
    senderId,
    senderNick: readString(record, "senderNick"),
    conversationId: readString(record, "conversationId"),
    sessionWebhook,
    msgId: msgId ?? "",
    raw: record
  };
}

export function buildRegisterFrame(clientId: string, ticket: string): string {
  return JSON.stringify({
    code: FRAME_CODE_REGISTER,
    headers: { Authorization: ticket },
    data: JSON.stringify({ clientId })
  });
}

export function buildPingFrame(): string {
  return JSON.stringify({ code: FRAME_CODE_PING });
}

export function buildAckFrame(messageId: string): string {
  return JSON.stringify({ code: FRAME_CODE_REGISTER, headers: { messageId }, data: "SUCCESS" });
}

/** 指数退避基础值（不含抖动），单位 ms。纯函数。 */
export function computeBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
}

function stripAtMention(text: string): string {
  const value = text.trim();
  return value.startsWith("@") ? value.replace(/^@\S+\s*/, "") : value;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringPath(record: Record<string, unknown>, path: readonly string[]): string | undefined {
  if (path.length === 1) return readString(record, path[0]);
  const head = record[path[0]];
  return head && typeof head === "object" ? readStringPath(head as Record<string, unknown>, path.slice(1)) : undefined;
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.body.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`钉钉接口返回非 JSON: ${text.slice(0, 200)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
