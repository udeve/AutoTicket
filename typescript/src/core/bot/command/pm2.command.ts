import type { BotCommandHandler } from "../bot.types.js";
import {
  logsPm2Schedule,
  restartPm2Schedule,
  startPm2Schedule,
  stopPm2Schedule
} from "../../schedule/pm2-manager.js";
import { formatLogsReply, formatPm2ActionReply } from "../bot-reply.js";

export const DEFAULT_LOG_LINES = 20;
export const MAX_LOG_LINES = 200;

/** 解析日志行数，默认 20，clamp 到 [1, 200]。纯函数，可单测。 */
export function parseLogLines(args: readonly string[]): number {
  const value = Number(args[0]);
  if (!Number.isFinite(value)) return DEFAULT_LOG_LINES;
  return Math.min(MAX_LOG_LINES, Math.max(1, Math.floor(value)));
}

// 这些命令控制的是「定时调度」PM2 进程（即被远程控制的本地后台程序）。

export const restartCommand: BotCommandHandler = {
  id: "restart",
  aliases: ["restart", "重启"],
  description: "重启定时调度进程 (PM2)",
  async execute(ctx): Promise<string> {
    return formatPm2ActionReply("restart", await restartPm2Schedule({ configPath: ctx.configPath }));
  }
};

export const stopCommand: BotCommandHandler = {
  id: "stop",
  aliases: ["stop", "停止"],
  description: "停止定时调度进程 (PM2)",
  async execute(): Promise<string> {
    return formatPm2ActionReply("stop", await stopPm2Schedule());
  }
};

export const startCommand: BotCommandHandler = {
  id: "start",
  aliases: ["start", "启动"],
  description: "启动定时调度进程 (PM2)",
  async execute(ctx): Promise<string> {
    return formatPm2ActionReply("start", await startPm2Schedule({ configPath: ctx.configPath }));
  }
};

export const logsCommand: BotCommandHandler = {
  id: "logs",
  aliases: ["logs", "日志"],
  description: "查看定时调度日志 (PM2)",
  async execute(ctx, invocation): Promise<string> {
    const lines = parseLogLines(invocation.args);
    return formatLogsReply(await logsPm2Schedule(lines), lines);
  }
};
