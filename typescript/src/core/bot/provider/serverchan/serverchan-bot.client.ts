import { request } from "undici";
import type { BotLogger } from "../../bot.types.js";

/** 从 Server酱³ Bot 长轮询提取的归一化消息。 */
export interface ServerChanBotMessage {
  readonly text: string;
  readonly chatId: string | number;
  readonly updateId: number;
}

interface ServerChanBotUpdate {
  update_id: number;
  message?: { message_id?: number; chat_id?: string | number; text?: string };
}

interface ServerChanBotResponse {
  ok: boolean;
  result?: ServerChanBotUpdate[];
}

export interface ServerChanBotClientOptions {
  botToken: string;
  apiBase?: string;
  onMessage: (message: ServerChanBotMessage) => Promise<void>;
  logger?: BotLogger;
  /** 测试桩：替换实际 HTTP 轮询。 */
  fetchUpdates?: (offset: number, timeout: number) => Promise<ServerChanBotResponse>;
}

const DEFAULT_API_BASE = "https://bot-go.apijia.cn";
const POLL_TIMEOUT_SECONDS = 25; // 文档上限 30
const POLL_HTTP_TIMEOUT_MS = 35_000; // 需大于轮询 timeout
const ERROR_BACKOFF_MS = 3_000;

/**
 * Server酱³ Bot 客户端：长轮询 getUpdates 接收上行消息，sendMessage 下行回复。
 * 长轮询由本地主动发起，无需公网 IP / webhook。
 */
export class ServerChanBotClient {
  private readonly logger: BotLogger;
  private readonly apiBase: string;
  private readonly fetchUpdates: (offset: number, timeout: number) => Promise<ServerChanBotResponse>;
  private running = false;
  private offset = 0;

  constructor(private readonly options: ServerChanBotClientOptions) {
    this.logger = options.logger ?? (() => undefined);
    this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
    this.fetchUpdates = options.fetchUpdates ?? ((offset, timeout) => this.doFetch(offset, timeout));
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger("serverchan bot 开始长轮询。");
    while (this.running) {
      try {
        const response = await this.fetchUpdates(this.offset, POLL_TIMEOUT_SECONDS);
        if (!response.ok || !Array.isArray(response.result)) {
          await sleep(ERROR_BACKOFF_MS);
          continue;
        }
        for (const update of response.result) {
          const updateId = getUpdateId(update);
          if (updateId !== null && updateId + 1 > this.offset) {
            this.offset = updateId + 1;
          }
          const message = extractBotUpdate(update);
          if (!message) continue;
          try {
            await this.options.onMessage(message);
          } catch (error) {
            this.logger(`处理 serverchan 消息异常: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        this.logger(`serverchan bot 轮询失败: ${error instanceof Error ? error.message : String(error)}`);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    try {
      const response = await request(`${this.apiBase}/bot/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(this.options.botToken) },
        body: JSON.stringify(buildSendMessageBody(chatId, text)),
        headersTimeout: POLL_HTTP_TIMEOUT_MS,
        bodyTimeout: POLL_HTTP_TIMEOUT_MS
      });
      await response.body.text();
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    }
  }

  private async doFetch(offset: number, timeout: number): Promise<ServerChanBotResponse> {
    const url = `${this.apiBase}/bot/getUpdates?timeout=${timeout}&offset=${offset}`;
    const response = await request(url, {
      method: "GET",
      headers: authHeader(this.options.botToken),
      headersTimeout: POLL_HTTP_TIMEOUT_MS,
      bodyTimeout: POLL_HTTP_TIMEOUT_MS
    });
    const text = await response.body.text();
    try {
      return JSON.parse(text) as ServerChanBotResponse;
    } catch {
      throw new Error(`serverchan bot 返回非 JSON: ${text.slice(0, 200)}`);
    }
  }
}

// ── 纯函数（可单测，无 I/O）────────────────────────────────────────────

/** 取 update_id；缺失/非法返回 null。 */
export function getUpdateId(update: unknown): number | null {
  if (!update || typeof update !== "object") return null;
  const value = (update as Record<string, unknown>).update_id;
  const id = typeof value === "number" ? value : Number(value);
  return Number.isFinite(id) ? id : null;
}

/** 从 update 提取归一化消息；无文本内容（如贴纸）返回 null。 */
export function extractBotUpdate(update: unknown): ServerChanBotMessage | null {
  if (!update || typeof update !== "object") return null;
  const record = update as Record<string, unknown>;
  const updateId = getUpdateId(update);
  if (updateId === null) return null;
  const message = record.message;
  if (!message || typeof message !== "object") return null;
  const messageRecord = message as Record<string, unknown>;
  const text = typeof messageRecord.text === "string" ? messageRecord.text.trim() : "";
  if (!text) return null;
  const chatId = typeof messageRecord.chat_id === "number"
    ? messageRecord.chat_id
    : typeof messageRecord.chat_id === "string"
      ? messageRecord.chat_id
      : "";
  return { text, chatId, updateId };
}

export function buildSendMessageBody(chatId: string, text: string): Record<string, unknown> {
  return { chat_id: toChatId(chatId), text, silent: false };
}

/** 纯数字 uid 转为 number（API 示例用数字 chat_id），其余保持字符串。 */
export function toChatId(uid: string): string | number {
  return /^\d+$/.test(uid) ? Number(uid) : uid;
}

/**
 * 鉴权头。文档未明示 token 传递方式（示例 curl 未带 token），
 * 这里按类 Telegram 惯例用 Authorization: Bearer；若线上鉴权不符，仅改此处即可。
 */
function authHeader(botToken: string): Record<string, string> {
  return botToken ? { Authorization: `Bearer ${botToken}` } : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
