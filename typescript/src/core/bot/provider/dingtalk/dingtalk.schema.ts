import { z } from "zod";

/**
 * 钉钉 Stream 机器人配置。
 * 需在钉钉开放平台创建「企业内部应用」并启用机器人（Stream 模式）后，
 * 填入 AppKey(clientId)/AppSecret(clientSecret)/robotCode。
 */
export const DingTalkStreamConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().default(""),
  clientSecret: z.string().default(""),
  robotCode: z.string().default("")
});

export type DingTalkStreamConfig = z.infer<typeof DingTalkStreamConfigSchema>;
