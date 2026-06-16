import type { AppConfig } from "../../../config/config.schema.js";
import type { BotLogger, BotMessage } from "../../bot.types.js";
import type { BotProvider, BotProviderRuntime } from "../bot.provider.js";
import { DingTalkReplyClient } from "./dingtalk-reply.client.js";
import { DingTalkStreamClient, type StreamMessagePayload } from "./dingtalk-stream.client.js";

/**
 * 钉钉 Stream 通道。把钉钉原始报文映射成归一化 BotMessage（reply 闭包携带 sessionWebhook），
 * 从而让 BotService 与钉钉细节解耦。
 */
export const dingtalkBotProvider: BotProvider = {
  id: "dingtalk",
  configKey: "dingtalk",
  isEnabled: (config) => config.bot.dingtalk.enabled,

  create({ config, onMessage, logger }): BotProviderRuntime {
    const channelConfig = config.bot.dingtalk;
    const replyClient = new DingTalkReplyClient({ robotCode: channelConfig.robotCode });

    const client = new DingTalkStreamClient({
      clientId: channelConfig.clientId,
      clientSecret: channelConfig.clientSecret,
      logger,
      onMessage: async (payload: StreamMessagePayload) => {
        const message: BotMessage = {
          text: payload.text,
          senderId: payload.senderId,
          senderNick: payload.senderNick,
          reply: async (text) => {
            await replyClient.reply(payload.sessionWebhook, text);
          }
        };
        await onMessage(message);
      }
    });

    return {
      start: () => client.start(),
      stop: () => client.stop()
    };
  }
};
