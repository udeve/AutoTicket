import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { formatExchangeAmount, formatExchangeStartTime } from "../exchange/options.js";
import { redactSensitive, redactText } from "../utils/redaction.js";

export const DEFAULT_STATE_PATH = "config/autoticket.state.json";

const TaskRunStatusSchema = z.enum(["success", "failure"]);
const TaskRunTypeSchema = z.enum(["daily", "exchange"]);
const DailyRandomTimeSchema = z.object({
  date: z.string(),
  userId: z.string().default("__global__"),
  rangeStartHour: z.number().int().min(0).max(23),
  rangeEndHour: z.number().int().min(0).max(23),
  time: z.string()
});

export const TaskRunRecordSchema = z.object({
  id: z.string(),
  date: z.string(),
  userId: z.string(),
  task: TaskRunTypeSchema,
  status: TaskRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string(),
  message: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  summary: z.unknown().optional()
});

export const TaskStateSchema = z.object({
  runs: z.array(TaskRunRecordSchema).default([]),
  dailyRandomTimes: z.array(DailyRandomTimeSchema).default([])
});

export type TaskRunType = z.infer<typeof TaskRunTypeSchema>;
export type TaskRunStatus = z.infer<typeof TaskRunStatusSchema>;
export type TaskRunRecord = z.infer<typeof TaskRunRecordSchema>;
export type DailyRandomTimeRecord = z.infer<typeof DailyRandomTimeSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type TaskStatusSummary = Record<string, { daily?: TaskRunRecord; exchange?: TaskRunRecord }>;
export type ExchangeRunMeta = {
  exchangeId?: string;
  startAt?: string;
  concurrency?: number;
  intervalMs?: number;
  maxAttempts?: number;
};

export interface TaskStatusFormatOptions {
  exchangeDefaults?: ExchangeRunMeta;
}

export function statePathForConfig(configPath: string): string {
  if (configPath.endsWith(".json")) {
    return configPath.replace(/\.json$/i, ".state.json");
  }
  return `${configPath}.state.json`;
}

export function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class TaskStateRepository {
  constructor(readonly path = DEFAULT_STATE_PATH) {}

  async load(): Promise<TaskState> {
    try {
      const text = await readFile(this.path, "utf8");
      const parsed = TaskStateSchema.parse(JSON.parse(text));
      const sanitized = TaskStateSchema.parse(redactSensitive(parsed));
      if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
        await this.save(sanitized);
      }
      return sanitized;
    } catch (error) {
      if (isNotFound(error)) return TaskStateSchema.parse({});
      throw error;
    }
  }

  async save(state: TaskState): Promise<void> {
    const normalized = TaskStateSchema.parse(state);
    await mkdir(dirname(resolve(this.path)), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(redactSensitive(normalized), null, 2)}\n`, "utf8");
  }

  async append(record: Omit<TaskRunRecord, "id" | "date"> & { date?: string }): Promise<TaskRunRecord> {
    const state = await this.load();
    const nextRecord: TaskRunRecord = {
      ...record,
      id: `${record.task}-${record.userId}-${Date.now()}`,
      date: record.date ?? todayKey()
    };
    state.runs.push(nextRecord);
    await this.save(state);
    return nextRecord;
  }

  async latestFor(userId: string, task: TaskRunType, date = todayKey()): Promise<TaskRunRecord | undefined> {
    const state = await this.load();
    return [...state.runs].reverse().find((run) => run.userId === userId && run.task === task && run.date === date);
  }

  async hasRunToday(userId: string, task: TaskRunType): Promise<TaskRunRecord | undefined> {
    return this.latestFor(userId, task, todayKey());
  }

  async getDailyRandomTime(userId: string, date: string, rangeStartHour: number, rangeEndHour: number): Promise<DailyRandomTimeRecord | undefined> {
    const state = await this.load();
    return state.dailyRandomTimes.find((item) =>
      item.userId === userId &&
      item.date === date &&
      item.rangeStartHour === rangeStartHour &&
      item.rangeEndHour === rangeEndHour
    );
  }

  async saveDailyRandomTime(record: DailyRandomTimeRecord): Promise<DailyRandomTimeRecord> {
    const state = await this.load();
    state.dailyRandomTimes = state.dailyRandomTimes.filter((item) =>
      item.userId !== record.userId ||
      item.date !== record.date ||
      item.rangeStartHour !== record.rangeStartHour ||
      item.rangeEndHour !== record.rangeEndHour
    );
    state.dailyRandomTimes.push(record);
    await this.save(state);
    return record;
  }
}

export function summarizeTaskRuns(runs: TaskRunRecord[]): TaskStatusSummary {
  const latest = new Map<string, { daily?: TaskRunRecord; exchange?: TaskRunRecord }>();
  for (const run of runs) {
    const entry = latest.get(run.userId) ?? {};
    if (run.task === "daily") entry.daily = run;
    if (run.task === "exchange") entry.exchange = run;
    latest.set(run.userId, entry);
  }
  return Object.fromEntries(latest);
}

export function formatTaskStatusSummary(users: Array<{ id: string; name?: string }>, summary: TaskStatusSummary, date = todayKey(), options: TaskStatusFormatOptions = {}): string {
  const lines = [`${date} 执行状态`];
  for (const user of users) {
    const item = summary[user.id] ?? {};
    const displayName = formatUserDisplayName(user);
    lines.push(`${displayName}`);
    lines.push(`  每日任务: ${formatRunState(item.daily, undefined, "status")}`);
    lines.push(`  优惠券兑换: ${formatRunState(item.exchange, options.exchangeDefaults, "status")}`);
  }
  if (users.length === 0) lines.push("暂无用户。");
  return lines.join("\n");
}

export function formatTaskExecutionLog(users: Array<{ id: string; name?: string }>, summary: TaskStatusSummary, date = todayKey()): string {
  const lines = [`${date} 执行日志`];
  for (const user of users) {
    const item = summary[user.id] ?? {};
    const displayName = formatUserDisplayName(user);
    lines.push(`${displayName}`);
    lines.push(...formatRunLog("每日任务", item.daily));
    lines.push(...formatRunLog("优惠券兑换", item.exchange));
  }
  if (users.length === 0) lines.push("暂无用户。");
  return lines.join("\n");
}

function formatUserDisplayName(user: { id: string; name?: string }): string {
  const id = redactText(user.id);
  const name = user.name ? redactText(user.name) : undefined;
  return name ? `${id} / ${name}` : id;
}

export function formatRunState(run: TaskRunRecord | undefined, fallbackExchangeMeta?: ExchangeRunMeta, mode: "status" | "detail" = "detail"): string {
  if (!run) {
    if (mode === "status") return "PEND";
    const details = formatExchangeRunMeta(fallbackExchangeMeta);
    return `未执行${details ? details.replace(" / ", " / 当前配置: ") : ""}`;
  }
  if (mode === "status") {
    const details = run.task === "exchange" ? formatExchangeRunMeta(run.meta).replace(/^ \/ /, " ") : "";
    return `${formatRunStatusCode(run)}${details}`;
  }
  const status = formatRunStatus(run);
  const details = run.task === "exchange" ? formatExchangeRunMeta(run.meta) : mode === "detail" ? formatDailyRunDetails(run.summary) : "";
  return `已执行 / ${status}${details}${run.message ? ` / ${run.message}` : ""}`;
}

function formatRunStatusCode(run: TaskRunRecord): string {
  return formatRunStatus(run) === "失败" ? "FAIL" : "SUCC";
}

function formatRunStatus(run: TaskRunRecord): string {
  if (run.status === "success") return "成功";
  if (run.task === "daily" && isDailySummary(run.summary) && isPointLimitOnly(run.summary.steps)) return "完成";
  return "失败";
}

function formatExchangeRunMeta(meta: Record<string, unknown> | ExchangeRunMeta | undefined): string {
  if (!meta) return "";
  const exchangeId = typeof meta.exchangeId === "string" ? meta.exchangeId : undefined;
  const amount = exchangeId ? formatExchangeAmount(exchangeId) : undefined;
  const items = [
    amount,
    typeof meta.startAt === "string" && meta.startAt ? formatExchangeStartTime(meta.startAt) : undefined,
    typeof meta.concurrency === "number" && meta.concurrency > 1 ? `并发${meta.concurrency}` : undefined,
    typeof meta.maxAttempts === "number" && meta.maxAttempts > 1 ? `最多${meta.maxAttempts}次` : undefined
  ].filter(Boolean);
  return items.length ? ` / ${items.join(" ")}` : "";
}

function formatRunLog(label: string, run: TaskRunRecord | undefined): string[] {
  if (!run) return [`  ${label}: 未执行`];
  if (run.task === "daily") return formatDailyRunLog(run);
  return formatExchangeRunLog(run);
}

function formatDailyRunLog(run: TaskRunRecord): string[] {
  const lines = [`  每日任务日志:`];
  if (!isDailySummary(run.summary)) {
    lines.push(`    ${run.message ?? "无详细日志"}`);
    return lines;
  }
  for (const step of run.summary.steps) {
    const status = step.success ? "成功" : isPointLimitMessage(step.msg) ? "完成" : "失败";
    const details = step.details?.length ? `（${step.details.join("，")}）` : "";
    lines.push(`    ${step.label}: ${status}${step.msg ? ` / ${step.msg}` : ""}${details}`);
  }
  return lines;
}

function formatExchangeRunLog(run: TaskRunRecord): string[] {
  const lines = [`  优惠券兑换日志:`];
  lines.push(`    状态: ${formatRunStatus(run)}${run.message ? ` / ${run.message}` : ""}`);
  const meta = formatExchangeRunMeta(run.meta).replace(/^ \/ /, "");
  if (meta) lines.push(`    参数: ${meta}`);
  const summary = isExchangeSummary(run.summary) ? run.summary : undefined;
  if (summary?.attempts !== undefined) lines.push(`    尝试次数: ${summary.attempts}`);
  if (summary?.finalAttempt !== undefined) lines.push(`    结束轮次: 第 ${summary.finalAttempt} 次`);
  if (summary?.timingMs !== undefined) lines.push(`    最后耗时: ${summary.timingMs}ms`);
  return lines;
}

function formatDailyRunDetails(summary: unknown): string {
  if (!isDailySummary(summary)) return "";
  const parts: string[] = [];
  const failures = summary.steps.filter((step) => !step.success);
  if (failures.length && isPointLimitOnly(summary.steps)) {
    parts.push("积分已达上限");
  } else if (failures.length) {
    parts.push(`失败项=${failures.map((step) => step.label).join(",")}`);
  }

  const comment = summary.steps.find((step) => step.label === "发表评论");
  const commentContent = comment?.details?.find((detail) => detail.startsWith("内容: "))?.replace("内容: ", "");
  if (commentContent) parts.push(`评论=${commentContent}`);

  const query = summary.steps.find((step) => step.label === "积分查询");
  const integral = query?.details?.find((detail) => detail.startsWith("积分: "))?.replace("积分: ", "");
  if (integral) parts.push(`积分=${integral}`);

  return parts.length ? ` / ${parts.join(" ")}` : "";
}

function isPointLimitOnly(steps: Array<{ success: boolean; msg?: string }>): boolean {
  const failures = steps.filter((step) => !step.success);
  return failures.length > 0 && failures.every((step) => isPointLimitMessage(step.msg));
}

function isPointLimitMessage(msg: string | undefined): boolean {
  return Boolean(msg?.includes("当日已到积分上限次数"));
}

function isDailySummary(value: unknown): value is { steps: Array<{ label: string; success: boolean; msg?: string; details?: string[] }> } {
  if (typeof value !== "object" || value === null || !("steps" in value)) return false;
  const steps = (value as { steps?: unknown }).steps;
  return Array.isArray(steps) && steps.every((step) =>
    typeof step === "object" &&
    step !== null &&
    typeof (step as { label?: unknown }).label === "string" &&
    typeof (step as { success?: unknown }).success === "boolean" &&
    (!("msg" in step) || typeof (step as { msg?: unknown }).msg === "string") &&
    (!("details" in step) || (Array.isArray((step as { details?: unknown }).details) && (step as { details?: unknown[] }).details?.every((item) => typeof item === "string")))
  );
}

function isExchangeSummary(value: unknown): value is { attempts?: number; finalAttempt?: number; timingMs?: number } {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
