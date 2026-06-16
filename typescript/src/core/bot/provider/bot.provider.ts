import type { AppConfig } from "../../config/config.schema.js";
import type { BotLogger, BotMessage } from "../bot.types.js";

/** 一个已就绪的通道运行时。start 通常长期阻塞（含自动重连）。 */
export interface BotProviderRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * 通道 provider 接口。新增通道（Telegram/微信/...）实现它并在
 * provider/providers.ts 注册即可，BotService 无需改动。
 */
export interface BotProvider {
  readonly id: string;
  /** 该 provider 在 config.bot 下的配置键，如 "dingtalk"。 */
  readonly configKey: string;
  isEnabled(config: AppConfig): boolean;
  create(options: {
    config: AppConfig;
    onMessage: (message: BotMessage) => Promise<void>;
    logger: BotLogger;
  }): BotProviderRuntime;
}
