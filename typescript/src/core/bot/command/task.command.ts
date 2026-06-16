import type { BotCommandHandler } from "../bot.types.js";
import { ScheduleService, type ScheduledTaskType, withScheduleLogTimestamp } from "../../schedule/schedule.service.js";
import { formatTaskFinishedReply, formatTaskStartedReply } from "../bot-reply.js";

const FORCE_TOKENS = ["force", "强制", "--force", "-f"];

/** 解析是否带强制重跑标记。纯函数，可单测。 */
export function parseForce(args: readonly string[]): boolean {
  return args.some((token) => FORCE_TOKENS.includes(token.toLowerCase()));
}

/**
 * 同进程执行 daily/exchange。runOnce 会为所有已配置用户执行、写状态并经 notifier 推送。
 * 注意：状态写入为无锁读-改-写（与 web server 同量级竞态，详见 plan 风险 1）。
 */
function createRunTaskCommand(
  task: ScheduledTaskType,
  aliases: string[],
  description: string
): BotCommandHandler {
  return {
    id: task,
    aliases,
    description,
    async execute(ctx, invocation): Promise<string> {
      const force = parseForce(invocation.args);
      await ctx.reply(formatTaskStartedReply(task, force));
      const service = new ScheduleService({
        config: ctx.config,
        stateRepo: ctx.stateRepo,
        logger: withScheduleLogTimestamp((message) => ctx.logger(message))
      });
      try {
        await service.runOnce(task, force);
        return formatTaskFinishedReply(task, true, "已触发，详见后续推送与日志");
      } catch (error) {
        return formatTaskFinishedReply(task, false, error instanceof Error ? error.message : String(error));
      }
    }
  };
}

export const dailyCommand = createRunTaskCommand("daily", ["daily", "每日", "签到"], "立即执行每日任务");
export const exchangeCommand = createRunTaskCommand("exchange", ["exchange", "兑换", "券"], "立即执行优惠券兑换");
