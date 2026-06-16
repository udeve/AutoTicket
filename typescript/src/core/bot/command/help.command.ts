import type { BotCommandHandler } from "../bot.types.js";

/** help 命令自描述：根据已注册命令动态生成帮助文本，新增命令无需改这里。 */
export function createHelpCommand(commands: readonly BotCommandHandler[]): BotCommandHandler {
  return {
    id: "help",
    aliases: ["help", "帮助", "?", "？"],
    description: "显示可用命令",
    async execute(): Promise<string> {
      const lines = ["可用命令："];
      for (const cmd of commands) {
        lines.push(`• ${cmd.aliases.join(" / ")}：${cmd.description}`);
      }
      lines.push("", "示例：状态 | 每日 force | 兑换 force | 日志 30 | 重启");
      return lines.join("\n");
    }
  };
}
