import { describe, expect, it } from "vitest";
import { ExchangeScheduler, formatExchangeRunSummary, summarizeExchangeRun } from "../src/core/scheduler/exchange-scheduler.js";

describe("exchange scheduler", () => {
  it("stops when a configured final message appears", async () => {
    let calls = 0;
    const service = {
      async exchangeOnce() {
        calls += 1;
        return {
          statusCode: 200,
          data: {
            result: calls === 3 ? "0" : "999992",
            msg: calls === 3 ? "兑换成功" : "处理中",
            trcode: "OL41"
          },
          timings: {
            requestMs: 1,
            decryptMs: 1,
            totalMs: 3
          }
        };
      }
    };

    const scheduler = new ExchangeScheduler(service as never);
    const result = await scheduler.run({
      user: { id: "u1", loginName: "login", sesId: "session" },
      exchangeId: "10",
      concurrency: 1,
      intervalMs: 0,
      maxAttempts: 5,
      stopRules: [
        { match: "兑换成功", status: "success" },
        { match: "手慢", status: "failure" }
      ]
    });

    expect(result.attempts).toHaveLength(3);
    expect(result.final?.msg).toBe("兑换成功");
    const summaryText = formatExchangeRunSummary(summarizeExchangeRun(result));
    expect(summarizeExchangeRun(result).success).toBe(true);
    expect(summaryText).toContain("优惠券兑换成功。");
    expect(summaryText).toContain("尝试次数: 3");
    expect(summaryText).toContain("返回消息: 兑换成功");
  });

  it("runs batched attempts with concurrency", async () => {
    const service = {
      async exchangeOnce() {
        return {
          statusCode: 200,
          data: { result: "1", msg: "处理中" },
          timings: {
            requestMs: 1,
            decryptMs: 1,
            totalMs: 3
          }
        };
      }
    };

    const scheduler = new ExchangeScheduler(service as never);
    const result = await scheduler.run({
      user: { id: "u1", loginName: "login", sesId: "session" },
      exchangeId: "10",
      concurrency: 3,
      intervalMs: 0,
      maxAttempts: 5,
      stopRules: [{ match: "兑换成功", status: "success" }]
    });

    expect(result.attempts.map((item) => item.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(result.final).toBeUndefined();
    expect(formatExchangeRunSummary(summarizeExchangeRun(result))).toContain("优惠券兑换未命中停止条件。");
  });

  it("stops on slow message but treats it as failure", async () => {
    const service = {
      async exchangeOnce() {
        return {
          statusCode: 200,
          data: { result: "999992", msg: "手慢啦，优惠券被抢光了" },
          timings: {
            requestMs: 1,
            decryptMs: 1,
            totalMs: 3
          }
        };
      }
    };

    const scheduler = new ExchangeScheduler(service as never);
    const result = await scheduler.run({
      user: { id: "u1", loginName: "login", sesId: "session" },
      exchangeId: "10",
      concurrency: 1,
      intervalMs: 0,
      maxAttempts: 5,
      stopRules: [
        { match: "兑换中", status: "success" },
        { match: "兑换成功", status: "success" },
        { match: "手慢啦", status: "failure" },
        { match: "已达上限", status: "success" }
      ]
    });

    const summary = summarizeExchangeRun(result);
    expect(result.attempts).toHaveLength(1);
    expect(result.final?.msg).toContain("手慢啦");
    expect(summary.success).toBe(false);
    expect(formatExchangeRunSummary(summary)).toContain("优惠券兑换已停止但未成功。");
  });

  it("treats daily exchange limit message as success", async () => {
    const service = {
      async exchangeOnce() {
        return {
          statusCode: 200,
          data: { result: "999992", msg: "对不起，实名用户每天最多兑换1次绿色出行抵扣券" },
          timings: {
            requestMs: 1,
            decryptMs: 1,
            totalMs: 3
          }
        };
      }
    };

    const scheduler = new ExchangeScheduler(service as never);
    const result = await scheduler.run({
      user: { id: "u1", loginName: "login", sesId: "session" },
      exchangeId: "10",
      concurrency: 1,
      intervalMs: 0,
      maxAttempts: 5,
      stopRules: [{ match: "每天最多兑换", status: "success" }]
    });

    const summary = summarizeExchangeRun(result);
    expect(result.attempts).toHaveLength(1);
    expect(result.final?.msg).toContain("每天最多兑换");
    expect(summary.success).toBe(true);
    expect(formatExchangeRunSummary(summary)).toContain("优惠券兑换成功。");
  });
});
