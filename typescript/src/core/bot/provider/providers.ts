import type { AppConfig } from "../../config/config.schema.js";
import type { BotProvider } from "./bot.provider.js";
import { dingtalkBotProvider } from "./dingtalk/dingtalk.provider.js";
import { serverChanBotProvider } from "./serverchan/serverchan-bot.provider.js";

/**
 * 所有已注册的通道。新增通道：在这里 push 一行即可。
 */
export const botProviders: readonly BotProvider[] = [dingtalkBotProvider, serverChanBotProvider];

export function activeBotProviders(config: AppConfig): readonly BotProvider[] {
  return botProviders.filter((provider) => provider.isEnabled(config));
}
