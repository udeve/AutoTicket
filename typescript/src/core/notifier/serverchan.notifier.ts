import { request } from "undici";
import type { Notifier } from "./notifier.js";

export interface ServerChanNotifierOptions {
  enabled: boolean;
  uid: string;
  sendKey: string;
  tags?: string;
}

export class ServerChanNotifier implements Notifier {
  constructor(private readonly options: ServerChanNotifierOptions) {}

  async notify(message: string): Promise<boolean> {
    if (!this.options.enabled) return true;
    if (!this.options.uid || !this.options.sendKey) return false;

    const url = `https://${this.options.uid}.push.ft07.com/send/${this.options.sendKey}.send`;
    try {
      const response = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formatServerChanMessage(message, this.options.tags))
      });
      await response.body.text();
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    }
  }
}

export function formatServerChanMessage(message: string, tags?: string): Record<string, string> {
  const [titleLine = "AutoTicket 通知", ...rest] = message.split(/\r?\n/);
  const desp = rest.length ? rest.join("\n") : message;
  return {
    title: titleLine.slice(0, 80),
    desp,
    short: firstNonEmptyLine(rest) ?? titleLine,
    ...(tags ? { tags } : {})
  };
}

function firstNonEmptyLine(lines: string[]): string | undefined {
  return lines.map((line) => line.trim()).find(Boolean)?.slice(0, 80);
}
