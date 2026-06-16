import type { AppConfig } from "../config/config.schema.js";
import type { TaskStateRepository } from "../state/task-state.repository.js";
import type { BotCommandContext, BotCommandHandler, BotLogger, BotMessage } from "./bot.types.js";
import { resolveBotCommand } from "./command/index.js";
import { formatErrorReply } from "./bot-reply.js";

export interface BotServiceOptions {
  config: AppConfig;
  configPath: string;
  stateRepo: TaskStateRepository;
  commands: readonly BotCommandHandler[];
  logger: BotLogger;
}

/**
 * 通道无关的命令调度。只认归一化的 BotMessage：白名单校验 → 解析命令 → 执行 → 回复。
 * 新增命令或新增通道都不需要改这里。
 */
export class BotService {
  constructor(private readonly options: BotServiceOptions) {}

  async handleMessage(message: BotMessage): Promise<void> {
    if (!this.isSenderAllowed(message)) return;

    const ctx: BotCommandContext = {
      config: this.options.config,
      configPath: this.options.configPath,
      stateRepo: this.options.stateRepo,
      logger: this.options.logger,
      reply: (text) => message.reply(text)
    };

    const { handler, args } = resolveBotCommand(this.options.commands, message.text);
    const fallback = this.options.commands.find((cmd) => cmd.id === "help");

    try {
      const text = handler
        ? await handler.execute(ctx, { args })
        : fallback
          ? await fallback.execute(ctx, { args: [] })
          : "未知命令";
      await message.reply(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.options.logger(`命令处理异常: ${detail}`);
      await message.reply(formatErrorReply(detail)).catch(() => undefined);
    }
  }

  /** 白名单 fail-closed：空名单拒绝一切；非白名单静默丢弃。 */
  private isSenderAllowed(message: BotMessage): boolean {
    const allowed = this.options.config.bot.security.allowedSenderIds;
    if (allowed.length === 0) {
      this.options.logger("bot 白名单为空，已拒绝命令 (fail-closed)。请在 config.bot.security.allowedSenderIds 配置发送者。");
      return false;
    }
    if (!allowed.includes(message.senderId)) {
      this.options.logger(`拒绝非白名单发送者: ${message.senderId}`);
      return false;
    }
    return true;
  }
}
