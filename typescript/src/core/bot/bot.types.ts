import type { AppConfig } from "../config/config.schema.js";
import type { TaskStateRepository } from "../state/task-state.repository.js";

/** 与具体通道无关的日志回调。 */
export type BotLogger = (message: string) => void;

/**
 * 归一化的入站消息。由各 provider（钉钉/微信/...）把自家原始报文映射成它，
 * BotService 因此与具体通道解耦。`reply` 是携带了回址（如钉钉 sessionWebhook）的闭包。
 */
export interface BotMessage {
  readonly text: string;
  readonly senderId: string;
  readonly senderNick?: string;
  reply(text: string): Promise<void>;
}

/** 命令处理器执行时的上下文。 */
export interface BotCommandContext {
  readonly config: AppConfig;
  readonly configPath: string;
  readonly stateRepo: TaskStateRepository;
  readonly logger: BotLogger;
  /** 处理过程中的中间回复（如「已开始执行」）。最终返回值会被作为收尾回复发出。 */
  reply(text: string): Promise<void>;
}

/** 命令调用：命令关键词之后的原始 token。 */
export interface BotCommandInvocation {
  readonly args: readonly string[];
}

/** 一条命令。新增命令只需实现该接口并在 command/index.ts 注册。 */
export interface BotCommandHandler {
  readonly id: string;
  /** 触发关键词，大小写不敏感，支持中英文。 */
  readonly aliases: readonly string[];
  readonly description: string;
  /** 返回收尾回复文本。可先通过 ctx.reply 发送中间进度。 */
  execute(ctx: BotCommandContext, invocation: BotCommandInvocation): Promise<string>;
}
