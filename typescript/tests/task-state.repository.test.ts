import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatTaskExecutionLog, formatTaskStatusSummary, statePathForConfig, summarizeTaskRuns, TaskStateRepository, todayKey, type TaskRunRecord } from "../src/core/state/task-state.repository.js";

describe("task state repository", () => {
  it("derives state path from config path", () => {
    expect(statePathForConfig("config/autoticket.json")).toBe("config/autoticket.state.json");
    expect(statePathForConfig("config/custom")).toBe("config/custom.state.json");
  });

  it("appends and finds latest daily state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autoticket-state-"));
    try {
      const repo = new TaskStateRepository(join(dir, "state.json"));
      await repo.append({
        task: "daily",
        userId: "u1",
        status: "success",
        startedAt: "2026-06-03T00:00:00.000Z",
        finishedAt: "2026-06-03T00:00:01.000Z",
        message: "ok",
        summary: { ok: true }
      });

      const latest = await repo.latestFor("u1", "daily", todayKey());
      expect(latest?.status).toBe("success");
      expect(latest?.summary).toEqual({ ok: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists daily random schedule time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autoticket-state-"));
    try {
      const repo = new TaskStateRepository(join(dir, "state.json"));
      await repo.saveDailyRandomTime({
        date: "2026-06-04",
        userId: "u1",
        rangeStartHour: 6,
        rangeEndHour: 7,
        time: "06:37:22"
      });

      const saved = await repo.getDailyRandomTime("u1", "2026-06-04", 6, 7);
      expect(saved?.time).toBe("06:37:22");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("formats concise status summary", () => {
    const runs: TaskRunRecord[] = [{
      id: "r1",
      date: "2026-06-03",
      userId: "u1",
      task: "daily",
      status: "success",
      startedAt: "2026-06-03T00:00:00.000Z",
      finishedAt: "2026-06-03T00:00:01.000Z",
      message: "每日任务全部执行成功。"
    }];

    const text = formatTaskStatusSummary([{ id: "u1", name: "Alice" }], summarizeTaskRuns(runs), "2026-06-03");
    expect(text).toContain("u1 / Alice");
    expect(text).toContain("每日任务: SUCC");
    expect(text).toContain("优惠券兑换: PEND");
  });

  it("formats compact status and separate execution log", () => {
    const runs: TaskRunRecord[] = [{
      id: "r1",
      date: "2026-06-03",
      userId: "u1",
      task: "daily",
      status: "failure",
      startedAt: "2026-06-03T00:00:00.000Z",
      finishedAt: "2026-06-03T00:00:01.000Z",
      message: "每日任务存在失败步骤。",
      summary: {
        success: false,
        steps: [
          { label: "登录签到", success: false, msg: "该积分规则当日已到积分上限次数" },
          { label: "发表评论", success: true, msg: "留言成功", details: ["内容: 好"] },
          { label: "积分查询", success: true, msg: "查询成功", details: ["积分: 844 -> 844"] }
        ]
      }
    }];

    const text = formatTaskStatusSummary([{ id: "u1" }], summarizeTaskRuns(runs), "2026-06-03", {
      exchangeDefaults: {
        exchangeId: "10",
        startAt: "07:00:00",
        concurrency: 5,
        intervalMs: 50,
        maxAttempts: 100
      }
    });
    expect(text).toContain("每日任务: SUCC");
    expect(text).toContain("优惠券兑换: PEND");
    expect(text).not.toContain("发表评论");

    const log = formatTaskExecutionLog([{ id: "u1" }], summarizeTaskRuns(runs), "2026-06-03");
    expect(log).toContain("2026-06-03 执行日志");
    expect(log).toContain("登录签到: 完成 / 该积分规则当日已到积分上限次数");
    expect(log).toContain("发表评论: 成功 / 留言成功（内容: 好）");
    expect(log).toContain("积分查询: 成功 / 查询成功（积分: 844 -> 844）");
  });

  it("formats exchange status with amount and timing metadata", () => {
    const runs: TaskRunRecord[] = [{
      id: "r1",
      date: "2026-06-03",
      userId: "u1",
      task: "exchange",
      status: "success",
      startedAt: "2026-06-03T00:00:00.000Z",
      finishedAt: "2026-06-03T00:00:01.000Z",
      message: "兑换成功",
      meta: {
        exchangeId: "10",
        startAt: "07:00:00",
        concurrency: 5,
        intervalMs: 50,
        maxAttempts: 100
      }
    }];

    const text = formatTaskStatusSummary([{ id: "u1" }], summarizeTaskRuns(runs), "2026-06-03");
    expect(text).toContain("优惠券兑换: SUCC 4元 07:00 并发5 间隔50ms 最多100次");
  });
});
