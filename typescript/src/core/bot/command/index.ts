import type { BotCommandHandler } from "../bot.types.js";
import { createHelpCommand } from "./help.command.js";
import { statusCommand } from "./status.command.js";
import { dailyCommand, exchangeCommand } from "./task.command.js";
import { logsCommand, restartCommand, startCommand, stopCommand } from "./pm2.command.js";

export { resolveBotCommand } from "./command.registry.js";
export type { ResolvedCommand } from "./command.registry.js";
export { parseForce } from "./task.command.js";
export { DEFAULT_LOG_LINES, MAX_LOG_LINES, parseLogLines } from "./pm2.command.js";

/**
 * 组装命令清单。新增命令：实现 BotCommandHandler 并在此数组中加一行。
 * help 命令接收完整清单以便自描述，因此放在最后构建。
 */
export function createBotCommands(): readonly BotCommandHandler[] {
  const commands: BotCommandHandler[] = [
    statusCommand,
    dailyCommand,
    exchangeCommand,
    restartCommand,
    stopCommand,
    startCommand,
    logsCommand
  ];
  return [...commands, createHelpCommand(commands)];
}
