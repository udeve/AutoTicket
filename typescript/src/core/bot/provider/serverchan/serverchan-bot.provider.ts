import type { AppConfig } from "../../../config/config.schema.js";
import type { BotLogger, BotMessage } from "../../bot.types.js";
import type { BotProvider, BotProviderRuntime } from "../bot.provider.js";
import { ServerChanBotClient, type ServerChanBotMessage } from "./serverchan-bot.client.js";

/**
 * Server酱³ Bot 通道（长轮询）。把 Server酱³ 的 update 映射成归一化 BotMessage，
 * reply 走 Bot 的 sendMessage。senderId 用 chat_id（即 uid），白名单里填你的 uid。
 */
export const serverChanBotProvider: BotProvider = {
  id: "serverChan",
  configKey: "serverChan",
  isEnabled: (config) => config.bot.serverChan.enabled,

  create({ config, onMessage, logger }): BotProviderRuntime {
    const channelConfig = config.bot.serverChan;
    const client = new ServerChanBotClient({
      botToken: channelConfig.botToken,
      logger,
      onMessage: async (message: ServerChanBotMessage) => {
        const normalized: BotMessage = {
          text: message.text,
          senderId: String(message.chatId),
          reply: async (text) => {
            await client.sendMessage(channelConfig.uid, text);
          }
        };
        await onMessage(normalized);
      }
    });

    return {
      start: () => client.start(),
      stop: () => client.stop()
    };
  }
};
