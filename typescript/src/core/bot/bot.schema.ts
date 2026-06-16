import { z } from "zod";
import { DingTalkStreamConfigSchema } from "./provider/dingtalk/dingtalk.schema.js";

/** 安全白名单：留空时 fail-closed（拒绝所有命令）。senderId 由各 provider 归一化填入。 */
export const BotSecurityConfigSchema = z.object({
  allowedSenderIds: z.array(z.string()).default([])
});

/** 第二层（可选）自然语言解析的占位配置；本次不实现，仅预留扩展位。 */
export const BotNluConfigSchema = z.object({
  enabled: z.boolean().default(false),
  ollamaUrl: z.string().default(""),
  model: z.string().default("gemma3:4b")
});

/**
 * Bot 顶层配置。新增通道时：在此追加一个 `<channel>: XxxConfigSchema.default({...})`，
 * 并在 provider/providers.ts 注册对应 provider。
 */
export const BotConfigSchema = z.object({
  enabled: z.boolean().default(false),
  security: BotSecurityConfigSchema.default({ allowedSenderIds: [] }),
  nlu: BotNluConfigSchema.default({ enabled: false, ollamaUrl: "", model: "gemma3:4b" }),
  dingtalk: DingTalkStreamConfigSchema.default({ enabled: false, clientId: "", clientSecret: "", robotCode: "" })
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
