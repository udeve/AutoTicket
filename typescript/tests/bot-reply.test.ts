import { describe, expect, it } from "vitest";
import {
  formatErrorReply,
  formatLogsReply,
  formatPm2ActionReply,
  formatTaskFinishedReply,
  formatTaskStartedReply
} from "../src/core/bot/bot-reply.js";

describe("bot reply formatters", () => {
  it("task started mentions force only when forced", () => {
    expect(formatTaskStartedReply("daily", false)).toContain("每日任务");
    expect(formatTaskStartedReply("exchange", false)).not.toContain("强制");
    expect(formatTaskStartedReply("daily", true)).toContain("强制");
  });

  it("task finished reflects success/failure and detail", () => {
    expect(formatTaskFinishedReply("daily", true, "")).toContain("执行完成");
    expect(formatTaskFinishedReply("exchange", false, "超时")).toContain("执行失败");
    expect(formatTaskFinishedReply("exchange", false, "超时")).toContain("超时");
  });

  it("pm2 action reply labels the action", () => {
    expect(formatPm2ActionReply("restart", "ok")).toContain("重启");
    expect(formatPm2ActionReply("stop", "ok")).toContain("停止");
    expect(formatPm2ActionReply("start", "ok")).toContain("启动");
  });

  it("logs reply includes the line count", () => {
    expect(formatLogsReply("line1\nline2", 30)).toContain("30 行");
  });

  it("error reply includes the message", () => {
    expect(formatErrorReply("boom")).toContain("boom");
  });

  it("truncates overly long output", () => {
    const long = "x".repeat(20_000);
    const reply = formatLogsReply(long, 5);
    expect(reply.length).toBeLessThan(long.length);
    expect(reply).toContain("已截断");
  });
});
