import type { BotCommandHandler } from "../bot.types.js";

export interface ResolvedCommand {
  handler?: BotCommandHandler;
  args: string[];
}

/**
 * 把原始文本解析为「命令 + 参数」。纯函数，便于单测。
 * 命令关键词为首个空白分隔 token，大小写不敏感；其余 token 作为 args 交给命令自行解释。
 */
export function resolveBotCommand(commands: readonly BotCommandHandler[], text: string): ResolvedCommand {
  const tokens = (text ?? "").trim().split(/\s+/).filter(Boolean);
  const head = (tokens.shift() ?? "").toLowerCase();
  if (!head) return { args: [] };
  const handler = commands.find((cmd) => cmd.aliases.includes(head));
  return { handler, args: tokens };
}
