import { createHmac } from "node:crypto";
import { request } from "undici";
import type { Notifier } from "./notifier.js";

export interface DingTalkNotifierOptions {
  enabled: boolean;
  webhook: string;
  secret: string;
}

export class DingTalkNotifier implements Notifier {
  constructor(private readonly options: DingTalkNotifierOptions) {}

  async notify(message: string): Promise<boolean> {
    if (!this.options.enabled) return true;
    if (!this.options.webhook || !this.options.secret) return false;

    const timestamp = Date.now();
    const sign = createHmac("sha256", this.options.secret)
      .update(`${timestamp}\n${this.options.secret}`)
      .digest("base64");
    const url = `${this.options.webhook}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

    try {
      const response = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: message }
        })
      });
      await response.body.text();
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    }
  }
}
