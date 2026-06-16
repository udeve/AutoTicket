import { z } from "zod";
import { BotConfigSchema } from "../bot/bot.schema.js";

export const DEFAULT_EXCHANGE_STOP_RULES = [
  { match: "兑换中", status: "success" },
  { match: "兑换成功", status: "success" },
  { match: "已达上限", status: "success" },
  { match: "每天最多兑换", status: "success" },
  { match: "手慢啦", status: "failure" }
] as const;

export const ExchangeStopRuleSchema = z.object({
  match: z.string().min(1),
  status: z.enum(["success", "failure"])
});

export const UserConfigSchema = z.object({
  id: z.string().min(1),
  loginName: z.string().min(1),
  userId: z.string().optional(),
  sesId: z.string().min(1),
  name: z.string().optional()
});

export const DingTalkConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhook: z.string().default(""),
  secret: z.string().default("")
});

export const ServerChanConfigSchema = z.object({
  enabled: z.boolean().default(false),
  uid: z.string().default(""),
  sendKey: z.string().default(""),
  tags: z.string().default("")
});

export const NotificationsConfigSchema = z.object({
  dingtalk: DingTalkConfigSchema.default({
    enabled: false,
    webhook: "",
    secret: ""
  }),
  serverChan: ServerChanConfigSchema.default({
    enabled: false,
    uid: "",
    sendKey: "",
    tags: ""
  })
});

export const ScheduleConfigSchema = z.object({
  enabled: z.boolean().default(false),
  users: z.array(z.string()).default([]),
  daily: z.object({
    enabled: z.boolean().default(false),
    mode: z.enum(["fixed", "range"]).default("fixed"),
    time: z.string().default("08:30:00"),
    rangeStartHour: z.number().int().min(0).max(23).default(8),
    rangeEndHour: z.number().int().min(0).max(23).default(10),
    delayMs: z.number().int().nonnegative().default(1000),
    commentContent: z.string().min(1).default("点赞")
  }).refine((daily) => daily.rangeEndHour > daily.rangeStartHour, {
    message: "schedule.daily.rangeEndHour must be greater than rangeStartHour",
    path: ["rangeEndHour"]
  }).default({
    enabled: false,
    mode: "fixed",
    time: "08:30:00",
    rangeStartHour: 8,
    rangeEndHour: 10,
    delayMs: 1000,
    commentContent: "点赞"
  }),
  exchange: z.object({
    enabled: z.boolean().default(false),
    times: z.array(z.string()).default(["07:00:00", "11:30:00", "17:00:00"]),
    exchangeId: z.string().optional(),
    concurrency: z.number().int().positive().default(1),
    intervalMs: z.number().int().nonnegative().default(100),
    intervalMaxMs: z.number().int().nonnegative().optional(),
    maxAttempts: z.number().int().positive().default(50),
    requestTimeoutMs: z.number().int().positive().default(5000),
    stopAfterSuccess: z.boolean().default(true)
  }).refine((exchange) => exchange.intervalMaxMs === undefined || exchange.intervalMaxMs >= exchange.intervalMs, {
    message: "schedule.exchange.intervalMaxMs must be greater than or equal to intervalMs",
    path: ["intervalMaxMs"]
  }).default({
    enabled: false,
    times: ["07:00:00", "11:30:00", "17:00:00"],
    concurrency: 1,
    intervalMs: 100,
    maxAttempts: 50,
    requestTimeoutMs: 5000,
    stopAfterSuccess: true
  })
});

export const AppConfigSchema = z.object({
  users: z.array(UserConfigSchema).default([]),
  exchange: z
    .object({
      exchangeId: z.string().default("10"),
      startAt: z.string().default("07:00:00"),
      concurrency: z.number().int().positive().default(1),
      intervalMs: z.number().int().nonnegative().default(100),
      intervalMaxMs: z.number().int().nonnegative().optional(),
      maxAttempts: z.number().int().positive().default(50),
      requestTimeoutMs: z.number().int().positive().default(5000),
      stopRules: z.array(ExchangeStopRuleSchema).default([...DEFAULT_EXCHANGE_STOP_RULES])
    })
    .refine((exchange) => exchange.intervalMaxMs === undefined || exchange.intervalMaxMs >= exchange.intervalMs, {
      message: "exchange.intervalMaxMs must be greater than or equal to intervalMs",
      path: ["intervalMaxMs"]
    })
    .default({
      exchangeId: "10",
      startAt: "07:00:00",
      concurrency: 1,
      intervalMs: 100,
      maxAttempts: 50,
      requestTimeoutMs: 5000,
      stopRules: [...DEFAULT_EXCHANGE_STOP_RULES]
    }),
  notifications: NotificationsConfigSchema.default({
    dingtalk: {
      enabled: false,
      webhook: "",
      secret: ""
    },
    serverChan: {
      enabled: false,
      uid: "",
      sendKey: "",
      tags: ""
    }
  }),
  schedule: ScheduleConfigSchema.default({
    enabled: false,
    users: [],
    daily: {
      enabled: false,
      mode: "fixed",
      time: "08:30:00",
      rangeStartHour: 8,
      rangeEndHour: 10,
      delayMs: 1000,
      commentContent: "点赞"
    },
    exchange: {
      enabled: false,
      times: ["07:00:00", "11:30:00", "17:00:00"],
      concurrency: 1,
      intervalMs: 100,
      maxAttempts: 50,
      requestTimeoutMs: 5000,
      stopAfterSuccess: true
    }
  }),
  bot: BotConfigSchema.default({
    enabled: false,
    security: { allowedSenderIds: [] },
    nlu: { enabled: false, ollamaUrl: "", model: "gemma3:4b" },
    dingtalk: { enabled: false, clientId: "", clientSecret: "", robotCode: "" }
  })
});

export type { BotConfig } from "../bot/bot.schema.js";

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type UserConfig = z.infer<typeof UserConfigSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

export function findUser(config: AppConfig, userId: string): UserConfig {
  const user = config.users.find((item) => item.id === userId);
  if (!user) {
    throw new Error(`User not found in config: ${userId}`);
  }
  return user;
}
