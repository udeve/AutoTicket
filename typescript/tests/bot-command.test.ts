import { describe, expect, it } from "vitest";
import {
  createBotCommands,
  DEFAULT_LOG_LINES,
  MAX_LOG_LINES,
  parseForce,
  parseLogLines,
  resolveBotCommand
} from "../src/core/bot/command/index.js";

describe("bot command registry", () => {
  const commands = createBotCommands();

  it("resolves status by English/Chinese aliases, case-insensitive", () => {
    expect(resolveBotCommand(commands, "status").handler?.id).toBe("status");
    expect(resolveBotCommand(commands, "状态").handler?.id).toBe("status");
    expect(resolveBotCommand(commands, "STATUS").handler?.id).toBe("status");
    expect(resolveBotCommand(commands, "  查询  ").handler?.id).toBe("status");
  });

  it("resolves daily and parses force tokens", () => {
    const forced = resolveBotCommand(commands, "daily force");
    expect(forced.handler?.id).toBe("daily");
    expect(parseForce(forced.args)).toBe(true);

    const cn = resolveBotCommand(commands, "每日 强制");
    expect(cn.handler?.id).toBe("daily");
    expect(parseForce(cn.args)).toBe(true);

    expect(parseForce(resolveBotCommand(commands, "daily").args)).toBe(false);
    expect(parseForce(["--force"])).toBe(true);
    expect(parseForce(["-f"])).toBe(true);
  });

  it("resolves exchange", () => {
    expect(resolveBotCommand(commands, "兑换").handler?.id).toBe("exchange");
    expect(resolveBotCommand(commands, "exchange force").handler?.id).toBe("exchange");
  });

  it("resolves pm2 lifecycle commands", () => {
    expect(resolveBotCommand(commands, "重启").handler?.id).toBe("restart");
    expect(resolveBotCommand(commands, "restart").handler?.id).toBe("restart");
    expect(resolveBotCommand(commands, "停止").handler?.id).toBe("stop");
    expect(resolveBotCommand(commands, "启动").handler?.id).toBe("start");
  });

  it("parses log lines with default and clamp", () => {
    const r = resolveBotCommand(commands, "logs 50");
    expect(r.handler?.id).toBe("logs");
    expect(parseLogLines(r.args)).toBe(50);

    expect(parseLogLines(resolveBotCommand(commands, "日志").args)).toBe(DEFAULT_LOG_LINES);
    expect(parseLogLines(["9999"])).toBe(MAX_LOG_LINES);
    expect(parseLogLines(["-5"])).toBe(1);
    expect(parseLogLines(["abc"])).toBe(DEFAULT_LOG_LINES);
  });

  it("resolves help aliases", () => {
    expect(resolveBotCommand(commands, "help").handler?.id).toBe("help");
    expect(resolveBotCommand(commands, "帮助").handler?.id).toBe("help");
    expect(resolveBotCommand(commands, "？").handler?.id).toBe("help");
  });

  it("returns no handler for unknown / empty input", () => {
    expect(resolveBotCommand(commands, "foobar").handler).toBeUndefined();
    expect(resolveBotCommand(commands, "   ").handler).toBeUndefined();
    expect(resolveBotCommand(commands, "").handler).toBeUndefined();
  });

  it("help command lists every non-help command", async () => {
    const help = commands.find((cmd) => cmd.id === "help");
    const text = await help!.execute({} as never, { args: [] });
    for (const cmd of commands.filter((cmd) => cmd.id !== "help")) {
      expect(text).toContain(cmd.aliases[0]);
    }
    expect(text).toContain("示例");
  });
});
