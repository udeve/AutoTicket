import type { BotCommandHandler } from "../bot.types.js";
import { formatTaskStatusSummary, summarizeTaskRuns, todayKey } from "../../state/task-state.repository.js";
import { formatStatusReply } from "../bot-reply.js";

export const statusCommand: BotCommandHandler = {
  id: "status",
  aliases: ["status", "状态", "查询"],
  description: "查询今日执行状态",
  async execute(ctx): Promise<string> {
    const state = await ctx.stateRepo.load();
    const date = todayKey();
    const runs = state.runs.filter((run) => run.date === date);
    const body = formatTaskStatusSummary(ctx.config.users, summarizeTaskRuns(runs), date, {
      exchangeDefaults: ctx.config.exchange
    });
    return formatStatusReply(body);
  }
};
