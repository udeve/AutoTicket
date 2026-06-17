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

// ── 钉钉 Stream 协议常量（依据开放平台协议文档）────────────────────────
// https://open.dingtalk.com/document/direction/stream-mode-protocol-access-description
const GATEWAY_BASE = "https://api.dingtalk.com";
const CONNECTION_PATH = "/v1.0/gateway/connections/open";
const TOPIC_BOT_MESSAGE = "/v1.0/im/bot/messages/get";
const TOPIC_PING = "ping";
const TOPIC_DISCONNECT = "disconnect";
const TYPE_SYSTEM = "SYSTEM";
const TYPE_CALLBACK = "CALLBACK";
const FRAME_CODE_OK = 200; // 客户端响应成功码

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/** 协议帧。入站推送用 type；出站响应用 code。 */
interface StreamFrame {
  type?: string;
  code?: number;
  headers?: Record<string, unknown>;
  data?: unknown;
  specVersion?: string;
  message?: string;
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
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
  }

  private async connect(): Promise<void> {
    // 直接用 clientId + clientSecret 获取 endpoint 和 ticket，无需 accessToken
    const { endpoint, ticket } = await this.openConnection();

    // ticket 作为 URL query 参数传入，这是钉钉 Stream 协议的握手方式
    const url = `${endpoint}?ticket=${encodeURIComponent(ticket)}`;

    await new Promise<void>((resolve, reject) => {
      const socket = this.socketFactory(url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.attempt = 0;
        this.logger("dingtalk stream WSS 已连接。");
        // 连接建立后无需额外注册帧；服务端会主动发 ping，客户端在 handleRaw 里回显。
      });

      socket.addEventListener("message", (event: MessageEvent) => {
        void this.handleRaw(event.data);
      });

      socket.addEventListener("close", () => {
        resolve();
      });

      socket.addEventListener("error", (event) => {
        const detail = (event as ErrorEvent).message ?? JSON.stringify(event);
        reject(new Error(`dingtalk stream WSS error: ${detail}`));
      });
    });
  }

  private async handleRaw(raw: unknown): Promise<void> {
    const frame = parseFrame(raw);
    if (!frame?.headers) return;
    const topic = typeof frame.headers.topic === "string" ? frame.headers.topic : "";
    const messageId = typeof frame.headers.messageId === "string" ? frame.headers.messageId : "";

    // 系统推送：ping 回显 opaque；disconnect 触发重连。均为服务端发起。
    if (frame.type === TYPE_SYSTEM) {
      if (topic === TOPIC_PING) {
        const echo = typeof frame.data === "string" ? frame.data : JSON.stringify(frame.data ?? {});
        this.send(buildResponse(messageId, echo));
      } else if (topic === TOPIC_DISCONNECT) {
        this.logger("dingtalk stream 收到 disconnect，将重连。");
        try {
          this.socket?.close();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // 机器人消息回调
    if (frame.type === TYPE_CALLBACK && topic.includes(TOPIC_BOT_MESSAGE)) {
      const payload = extractStreamPayload(frame.data);
      if (payload) {
        try {
          await this.options.onMessage(payload);
        } catch (error) {
          this.logger(`处理 dingtalk 消息异常: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (messageId) this.send(buildBotAck(messageId));
    }
  }

  private send(frame: string): void {
    try {
      this.socket?.send(frame);
    } catch {
      /* ignore */
    }
  }

  private async openConnection(): Promise<{ endpoint: string; ticket: string }> {
    const data = await postJson(`${GATEWAY_BASE}${CONNECTION_PATH}`, {
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      subscriptions: [{ type: "CALLBACK", topic: "/v1.0/im/bot/messages/get" }],
      ua: "autoticket-stream/1.0.0"
    });
    if (typeof data.endpoint !== "string" || !data.endpoint) {
      throw new Error("打开钉钉 Stream 连接失败：未返回 endpoint。");
    }
    return {
      endpoint: data.endpoint,
      ticket: typeof data.ticket === "string" ? data.ticket : ""
    };
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

/** 客户端响应帧：code 200 + 回传 messageId + contentType + data(JSON 字符串)。 */
export function buildResponse(messageId: string, dataJson: string): string {
  return JSON.stringify({
    code: FRAME_CODE_OK,
    message: "OK",
    headers: { messageId, contentType: "application/json" },
    data: dataJson
  });
}

/** 机器人消息的 ACK：data 固定为 {"response":null}（钉钉服务端暂不使用该字段）。 */
export function buildBotAck(messageId: string): string {
  return buildResponse(messageId, '{"response":null}');
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
