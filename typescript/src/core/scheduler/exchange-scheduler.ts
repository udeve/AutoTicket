import type { ExchangeAttemptResult, ExchangeSchedulerOptions, ExchangeStopRule } from "../types.js";
import { parseTodayTime, sleep, waitUntil } from "../utils/time.js";
import { ExchangeService, type ExchangeResponse } from "../services/exchange.service.js";

export interface ExchangeSchedulerRunResult {
  attempts: ExchangeAttemptResult<ExchangeResponse>[];
  final?: ExchangeAttemptResult<ExchangeResponse>;
}

export interface ExchangeRunSummary {
  success: boolean;
  message: string;
  attempts: number;
  finalAttempt?: number;
  statusCode?: number;
  timingMs?: number;
  result?: string;
  msg?: string;
  error?: string;
}

export class ExchangeScheduler {
  constructor(private readonly exchangeService: ExchangeService) {}

  async run(options: ExchangeSchedulerOptions): Promise<ExchangeSchedulerRunResult> {
    if (options.startAt) {
      await waitUntil(parseTodayTime(options.startAt));
    }

    const attempts: ExchangeAttemptResult<ExchangeResponse>[] = [];
    let nextAttempt = 1;
    let final: ExchangeAttemptResult<ExchangeResponse> | undefined;

    while (!final && nextAttempt <= options.maxAttempts) {
      const batchSize = Math.min(options.concurrency, options.maxAttempts - nextAttempt + 1);
      const batch = Array.from({ length: batchSize }, (_, index) => this.runAttempt(options, nextAttempt + index));
      const results = await Promise.all(batch);
      attempts.push(...results);
      for (const result of results) options.onAttempt?.(result);
      final = results.find((result) => result.isFinal);
      nextAttempt += batchSize;

      if (!final && nextAttempt <= options.maxAttempts && options.intervalMs > 0) {
        await sleep(options.intervalMs);
      }
    }

    return { attempts, final };
  }

  private async runAttempt(options: ExchangeSchedulerOptions, attempt: number): Promise<ExchangeAttemptResult<ExchangeResponse>> {
    const start = performance.now();
    try {
      const response = await this.exchangeService.exchangeOnce(options);
      const data = response.data;
      const msg = typeof data?.msg === "string" ? data.msg : undefined;
      const totalMs = performance.now() - start;
      const stopRule = findMatchedStopRule(msg, options.stopRules);

      return {
        attempt,
        statusCode: response.statusCode,
        data,
        msg,
        finalStatus: stopRule?.status,
        isFinal: Boolean(stopRule),
        isError: response.statusCode < 200 || response.statusCode >= 300,
        timing: {
          attempt,
          encryptMs: Math.max(0, totalMs - response.timings.requestMs - response.timings.decryptMs),
          requestMs: response.timings.requestMs,
          decryptMs: response.timings.decryptMs,
          totalMs
        }
      };
    } catch (error) {
      const totalMs = performance.now() - start;
      return {
        attempt,
        statusCode: 0,
        isFinal: false,
        isError: true,
        error: error instanceof Error ? error.message : String(error),
        timing: {
          attempt,
          encryptMs: 0,
          requestMs: totalMs,
          decryptMs: 0,
          totalMs
        }
      };
    }
  }
}

export function summarizeExchangeRun(result: ExchangeSchedulerRunResult): ExchangeRunSummary {
  const final = result.final;
  const last = final ?? result.attempts.at(-1);
  const success = final?.finalStatus === "success";
  return {
    success,
    message: final ? success ? "优惠券兑换成功。" : "优惠券兑换已停止但未成功。" : "优惠券兑换未命中停止条件。",
    attempts: result.attempts.length,
    finalAttempt: last?.attempt,
    statusCode: last?.statusCode,
    timingMs: last ? Math.round(last.timing.totalMs) : undefined,
    result: last?.data?.result,
    msg: last?.msg,
    error: last?.error
  };
}

function findMatchedStopRule(msg: string | undefined, rules: ExchangeStopRule[]): ExchangeStopRule | undefined {
  return msg ? rules.find((rule) => msg.includes(rule.match)) : undefined;
}

export function formatExchangeRunSummary(summary: ExchangeRunSummary): string {
  const lines = [
    summary.message,
    `尝试次数: ${summary.attempts}`
  ];
  if (summary.finalAttempt !== undefined) lines.push(`结束轮次: 第 ${summary.finalAttempt} 次`);
  if (summary.msg) lines.push(`返回消息: ${summary.msg}`);
  if (summary.result) lines.push(`返回码: ${summary.result}`);
  if (summary.statusCode !== undefined) lines.push(`HTTP 状态: ${summary.statusCode}`);
  if (summary.timingMs !== undefined) lines.push(`最后耗时: ${summary.timingMs}ms`);
  if (summary.error) lines.push(`错误: ${summary.error}`);
  return lines.join("\n");
}
