import { randomInt } from "node:crypto";
import type { AppConfig, UserConfig } from "../config/config.schema.js";
import { ApiClient } from "../http/api-client.js";
import { DingTalkNotifier } from "../notifier/dingtalk.notifier.js";
import { ExchangeScheduler, formatExchangeRunSummary, summarizeExchangeRun } from "../scheduler/exchange-scheduler.js";
import { ExchangeService } from "../services/exchange.service.js";
import { formatDailyWorkflowSummary, summarizeDailyWorkflow, TaskService, type DailyWorkflowStepResult } from "../services/task.service.js";
import { TaskStateRepository, todayKey } from "../state/task-state.repository.js";
import { redactText } from "../utils/redaction.js";
import { parseTodayTime, sleep } from "../utils/time.js";

export interface ScheduleServiceOptions {
  config: AppConfig;
  stateRepo: TaskStateRepository;
  logger?: (message: string) => void;
}

export type ScheduledTaskType = "daily" | "exchange";
export type ScheduleLogger = (message: string) => void;
export interface DailySchedulePlanItem {
  userId: string;
  time: string;
  date: string;
  mode: "fixed" | "range";
}
type ScheduleCandidate =
  | { task: "daily"; time: Date; timeText: string; user?: UserConfig }
  | { task: "exchange"; time: Date; timeText: string };

export class ScheduleService {
  private readonly notifier: DingTalkNotifier;
  private readonly logger: (message: string) => void;

  constructor(private readonly options: ScheduleServiceOptions) {
    this.notifier = new DingTalkNotifier(options.config.dingtalk);
    const logger = options.logger ?? (() => undefined);
    this.logger = (message) => logger(redactText(message));
  }

  async runOnce(task: ScheduledTaskType, force = false): Promise<void> {
    const users = this.resolveUsers();
    if (!users.length) {
      this.logger("没有可执行用户。");
      return;
    }

    if (task === "daily") {
      for (const user of users) {
        await this.runDailyForUser(user, force);
      }
      return;
    }

    await Promise.all(users.map((user) => this.runExchangeForUser(user, undefined, force)));
  }

  async runForever(): Promise<void> {
    const config = this.options.config;
    if (!config.schedule.enabled) {
      this.logger("定时任务未启用。");
      return;
    }

    while (true) {
      const next = await this.nextDue();
      if (!next) {
        this.logger("没有启用的定时计划。");
        return;
      }
      this.logger(`下一次执行: ${formatScheduleCandidate(next)}`);
      await sleep(Math.max(0, next.time.getTime() - Date.now()));
      if (next.task === "daily") {
        if (next.user) await this.runDailyForUser(next.user, false);
        else await this.runOnce("daily", false);
      } else {
        await this.runExchangeScheduleAt(next.timeText);
      }
    }
  }

  async previewDailyPlan(date = tomorrowKey()): Promise<DailySchedulePlanItem[]> {
    const daily = this.options.config.schedule.daily;
    const users = this.resolveUsers();
    if (daily.mode === "fixed") {
      const time = normalizeTimeText(daily.time);
      return users.map((user) => ({ userId: user.id, date, time, mode: "fixed" }));
    }
    const items: DailySchedulePlanItem[] = [];
    for (const user of users) {
      const time = await this.getOrCreateDailyRandomTime(user.id, date);
      items.push({ userId: user.id, date, time, mode: "range" });
    }
    return items.sort((a, b) => a.time.localeCompare(b.time));
  }

  private async runExchangeScheduleAt(startAt: string): Promise<void> {
    const users = this.resolveUsers();
    await Promise.all(users.map(async (user) => {
      const latest = await this.options.stateRepo.latestFor(user.id, "exchange", todayKey());
      if (this.options.config.schedule.exchange.stopAfterSuccess && latest?.status === "success") {
        this.logger(`${user.id} 今日兑换已成功，跳过场次 ${startAt}。`);
        return;
      }
      await this.runExchangeForUser(user, startAt, true);
    }));
  }

  private async runDailyForUser(user: UserConfig, force: boolean): Promise<void> {
    const existingRun = await this.options.stateRepo.hasRunToday(user.id, "daily");
    if (existingRun && !force) {
      this.logger(`${user.id} 今日每日任务已执行，跳过。`);
      return;
    }

    const client = new ApiClient();
    const startedAt = new Date().toISOString();
    try {
      this.logger(`${user.id} 每日任务开始。`);
      const result = await new TaskService(client).runDailyWorkflow(user, {
        delayMs: this.options.config.schedule.daily.delayMs,
        onStep: (step) => this.logger(formatDailyStepLog(user.id, step)),
        onDelay: (delayMs, nextLabel) => this.logger(`${user.id} 随机等待 ${delayMs}ms 后执行 ${nextLabel}。`)
      });
      const summary = summarizeDailyWorkflow(result);
      await this.options.stateRepo.append({
        task: "daily",
        userId: user.id,
        status: summary.success ? "success" : "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: summary.message,
        summary: { ...summary, raw: result }
      });
      const text = formatDailyWorkflowSummary(summary);
      this.logger(`${user.id} 每日任务完成\n${text}`);
      await this.notifier.notify(`AutoTicket 每日任务完成\n用户: ${user.id}\n${text}`);
    } catch (error) {
      await this.options.stateRepo.append({
        task: "daily",
        userId: user.id,
        status: "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      await client.close();
    }
  }

  private async runExchangeForUser(user: UserConfig, startAt: string | undefined, force: boolean): Promise<void> {
    const existingRun = await this.options.stateRepo.hasRunToday(user.id, "exchange");
    if (existingRun?.status === "success" && !force) {
      this.logger(`${user.id} 今日兑换已成功，跳过。`);
      return;
    }

    const client = new ApiClient();
    const startedAt = new Date().toISOString();
    const exchangeMeta = {
      exchangeId: this.options.config.schedule.exchange.exchangeId ?? this.options.config.exchange.exchangeId,
      startAt: startAt ?? this.options.config.exchange.startAt,
      concurrency: this.options.config.schedule.exchange.concurrency ?? this.options.config.exchange.concurrency,
      intervalMs: this.options.config.schedule.exchange.intervalMs ?? this.options.config.exchange.intervalMs,
      maxAttempts: this.options.config.schedule.exchange.maxAttempts ?? this.options.config.exchange.maxAttempts
    };
    try {
      this.logger(`${user.id} 优惠券兑换开始: 面额=${exchangeMeta.exchangeId} 开始=${exchangeMeta.startAt} 并发=${exchangeMeta.concurrency} 间隔=${exchangeMeta.intervalMs}ms 最大=${exchangeMeta.maxAttempts}`);
      await client.warmup();
      const result = await new ExchangeScheduler(new ExchangeService(client)).run({
        user,
        ...exchangeMeta,
        stopRules: this.options.config.exchange.stopRules,
        onAttempt: (attempt) => this.logger(formatExchangeAttemptLog(user.id, attempt))
      });
      const summary = summarizeExchangeRun(result);
      await this.options.stateRepo.append({
        task: "exchange",
        userId: user.id,
        status: summary.success ? "success" : "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: result.final?.msg ?? "未命中停止条件",
        meta: exchangeMeta,
        summary: { ...summary, raw: result }
      });
      const text = formatExchangeRunSummary(summary);
      this.logger(`${user.id} 优惠券兑换完成\n${text}`);
      await this.notifier.notify(`AutoTicket 兑换结束\n用户: ${user.id}\n${text}`);
    } catch (error) {
      await this.options.stateRepo.append({
        task: "exchange",
        userId: user.id,
        status: "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        meta: exchangeMeta
      });
      throw error;
    } finally {
      await client.close();
    }
  }

  private resolveUsers(): UserConfig[] {
    const configured = this.options.config.schedule.users;
    if (!configured.length) return this.options.config.users;
    const selected = new Set(configured);
    return this.options.config.users.filter((user) => selected.has(user.id));
  }

  private async nextDue(): Promise<ScheduleCandidate | undefined> {
    const candidates: ScheduleCandidate[] = [];
    if (this.options.config.schedule.daily.enabled) {
      const dailyCandidates = await this.nextDailyCandidates();
      candidates.push(...dailyCandidates);
    }
    if (this.options.config.schedule.exchange.enabled) {
      for (const timeText of this.options.config.schedule.exchange.times) {
        candidates.push({ task: "exchange", time: nextOccurrence(timeText), timeText });
      }
    }
    return candidates.sort((a, b) => a.time.getTime() - b.time.getTime())[0];
  }

  private async nextDailyCandidates(now = new Date()): Promise<Array<Extract<ScheduleCandidate, { task: "daily" }>>> {
    const daily = this.options.config.schedule.daily;
    if (daily.mode === "fixed") {
      const time = nextOccurrence(daily.time, now);
      return [{ task: "daily", time, timeText: formatTimeText(time) }];
    }
    const candidates: Array<Extract<ScheduleCandidate, { task: "daily" }>> = [];
    for (const user of this.resolveUsers()) {
      const existingRun = await this.options.stateRepo.hasRunToday(user.id, "daily");
      const time = existingRun ? await this.dailyRandomTimeForDate(user.id, tomorrowKey(now), now) : await this.nextDailyTimeForUser(user, now);
      candidates.push({ task: "daily", time, timeText: formatTimeText(time), user });
    }
    return candidates;
  }

  private async nextDailyTimeForUser(user: UserConfig, now = new Date()): Promise<Date> {
    const today = await this.dailyRandomTimeForDate(user.id, todayKey(now), now);
    if (today.getTime() > now.getTime()) return today;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.dailyRandomTimeForDate(user.id, todayKey(tomorrow), tomorrow);
  }

  private async dailyRandomTimeForDate(userId: string, dateKey: string, base: Date): Promise<Date> {
    const time = await this.getOrCreateDailyRandomTime(userId, dateKey);
    this.logger(`${dateKey} ${userId} 每日任务随机时间: ${time}`);
    return parseDailyRandomTime(dateKey, time, base);
  }

  private async getOrCreateDailyRandomTime(userId: string, dateKey: string): Promise<string> {
    const daily = this.options.config.schedule.daily;
    const saved = await this.options.stateRepo.getDailyRandomTime(userId, dateKey, daily.rangeStartHour, daily.rangeEndHour);
    if (saved) return normalizeTimeText(saved.time);
    const time = randomTimeTextInRange(daily.rangeStartHour, daily.rangeEndHour);
    await this.options.stateRepo.saveDailyRandomTime({
      date: dateKey,
      userId,
      rangeStartHour: daily.rangeStartHour,
      rangeEndHour: daily.rangeEndHour,
      time
    });
    return time;
  }
}

export function nextOccurrence(timeText: string, now = new Date()): Date {
  const today = parseTodayTime(timeText, now);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

export function nextDailyOccurrence(
  daily: { mode: "fixed" | "range"; time: string; rangeStartHour: number; rangeEndHour: number },
  cache = new Map<string, string>(),
  now = new Date()
): Date {
  if (daily.mode === "fixed") return nextOccurrence(daily.time, now);
  const today = randomTimeInRange(todayKey(now), daily.rangeStartHour, daily.rangeEndHour, cache, now);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return randomTimeInRange(todayKey(tomorrow), daily.rangeStartHour, daily.rangeEndHour, cache, tomorrow);
}

export function formatDailySchedulePlan(items: DailySchedulePlanItem[], date = tomorrowKey()): string {
  const lines = [`${date} 每日任务执行时间`];
  if (!items.length) {
    lines.push("暂无用户。");
    return lines.join("\n");
  }
  for (const item of items) {
    lines.push(`${item.userId}: ${item.time}`);
  }
  return lines.join("\n");
}

function formatScheduleCandidate(candidate: ScheduleCandidate): string {
  const user = candidate.task === "daily" && candidate.user ? ` 用户=${candidate.user.id}` : "";
  return `${candidate.task}${user} ${candidate.time.toLocaleString()}`;
}

function formatDailyStepLog(userId: string, step: DailyWorkflowStepResult): string {
  const status = step.success ? "成功" : "失败";
  const details = step.details?.length ? ` ${step.details.join(" ")}` : "";
  return `${userId} 每日任务步骤: ${step.label} ${status}${step.msg ? ` / ${step.msg}` : ""}${details}`;
}

function formatExchangeAttemptLog(userId: string, attempt: { attempt: number; statusCode: number; msg?: string; error?: string; timing: { totalMs: number }; isFinal: boolean }): string {
  const result = attempt.error ? `错误=${attempt.error}` : `消息=${attempt.msg ?? "无"}`;
  const final = attempt.isFinal ? " 命中停止条件" : "";
  return `${userId} 兑换尝试 #${attempt.attempt}: HTTP=${attempt.statusCode} ${result} 耗时=${Math.round(attempt.timing.totalMs)}ms${final}`;
}

export function tomorrowKey(now = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return todayKey(tomorrow);
}

function normalizeTimeText(time: string): string {
  return time.replace(/\.(\d{1,3})$/, "");
}

function randomTimeInRange(dateKey: string, startHour: number, endHour: number, cache: Map<string, string>, base: Date): Date {
  const key = `${dateKey}-${startHour}-${endHour}`;
  const cached = cache.get(key);
  const time = cached ?? randomTimeTextInRange(startHour, endHour);
  if (!cached) cache.set(key, time);
  return parseDailyRandomTime(dateKey, time, base);
}

export function randomTimeTextInRange(startHour: number, endHour: number): string {
  if (endHour <= startHour) {
    throw new Error("Invalid daily time range: end hour must be greater than start hour.");
  }
  const totalSeconds = startHour * 60 * 60 + randomInt((endHour - startHour) * 60 * 60);
  const hour = Math.floor(totalSeconds / (60 * 60));
  const minute = Math.floor(totalSeconds / 60) % 60;
  const second = totalSeconds % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function parseDailyRandomTime(dateKey: string, timeText: string, base: Date): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [timePart, msPart = "000"] = timeText.split(".");
  const [hour, minute, second] = timePart.split(":").map(Number);
  const date = new Date(base);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, Number(msPart.padEnd(3, "0")));
  return date;
}

function formatTimeText(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

export function withScheduleLogTimestamp(logger: ScheduleLogger): ScheduleLogger {
  return (message) => {
    const timestamp = formatScheduleLogTimestamp(new Date());
    logger(redactText(message).split(/\r?\n/).map((line) => `[${timestamp}] ${line}`).join("\n"));
  };
}

export function formatScheduleLogTimestamp(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}
