import { z } from "zod";

/**
 * Server酱³ Bot 配置（需 Server酱³ 1.1.0+ 内测版客户端）。
 * - botToken：Bot 管理界面里的【Bot Token】，调用 sendMessage/getUpdates 的凭证。
 * - uid：Server酱³ 的 uid，即 Bot 接口的 chat_id。
 */
export const ServerChanBotConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(""),
  uid: z.string().default("")
});

export type ServerChanBotConfig = z.infer<typeof ServerChanBotConfigSchema>;
