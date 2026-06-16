import { request } from "undici";

export interface DingTalkReplyOptions {
  /** 钉钉 robotCode（一般等于 AppKey）。 */
  robotCode?: string;
  /** 预留：若 sessionWebhook 仍需签名则按钉钉自定义机器人方式 HMAC 签名（默认不签）。 */
  clientSecret?: string;
}

/**
 * 通过入站消息携带的 sessionWebhook 回复。
 * sessionWebhook 自带鉴权与 TTL，通常无需额外签名；如线上发现需要，再启用 clientSecret 签名。
 */
export class DingTalkReplyClient {
  constructor(private readonly options: DingTalkReplyOptions) {}

  async reply(sessionWebhook: string, text: string): Promise<boolean> {
    if (!sessionWebhook) return false;
    try {
      const response = await request(sessionWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: text }, at: {} })
      });
      await response.body.text();
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    }
  }
}
