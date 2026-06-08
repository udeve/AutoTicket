import { describe, expect, it } from "vitest";
import { formatDailyWorkflowSummary, randomDelayMs, summarizeDailyWorkflow, TaskService, type DailyWorkflowResult, type TaskResponse } from "../src/core/services/task.service.js";

describe("task service summaries", () => {
  it("summarizes daily workflow steps for display", () => {
    const result: DailyWorkflowResult = {
      integralBefore: { result: "0", msg: "查询成功", remain_integral: "10" },
      dailyLogin: { result: "0", msg: "登录成功" },
      signins: [
        { result: "0", msg: "签到成功" },
        { result: "0", msg: "签到成功" },
        { result: "0", msg: "签到成功" }
      ],
      comment: { result: "0", msg: "评论成功" },
      query: { result: "0", msg: "积分查询成功", remain_integral: "16" },
      steps: [
        { key: "dailyLogin", label: "登录签到", success: true, result: "0", msg: "登录成功" },
        { key: "signin1", label: "签到 1/3", success: true, result: "0", msg: "签到成功" },
        { key: "signin2", label: "签到 2/3", success: true, result: "0", msg: "签到成功" },
        { key: "signin3", label: "签到 3/3", success: true, result: "0", msg: "签到成功" },
        { key: "comment", label: "发表评论", success: true, result: "0", msg: "评论成功", details: ["内容: 点赞"] },
        { key: "query", label: "积分查询", success: true, result: "0", msg: "积分查询成功", details: ["积分: 10 -> 16"] }
      ]
    };

    const summary = summarizeDailyWorkflow(result);
    const text = formatDailyWorkflowSummary(summary);
    expect(summary.success).toBe(true);
    expect(text).toContain("[成功] 签到 1/3: 签到成功");
    expect(text).toContain("[成功] 发表评论: 评论成功（内容: 点赞）");
    expect(text).toContain("[成功] 积分查询: 积分查询成功（积分: 10 -> 16）");
  });

  it("treats daily point limit as completed", async () => {
    const responses: TaskResponse[] = [
      { result: "0", msg: "查询成功", remain_integral: "16" },
      { result: "110077", msg: "该积分规则当日已到积分上限次数" },
      { result: "110077", msg: "该积分规则当日已到积分上限次数" },
      { result: "110077", msg: "该积分规则当日已到积分上限次数" },
      { result: "110077", msg: "该积分规则当日已到积分上限次数" },
      { result: "0", msg: "留言成功" },
      { result: "0", msg: "查询成功", remain_integral: "16" }
    ];
    const client = {
      postEncrypted: async () => ({ data: responses.shift() })
    };
    const result = await new TaskService(client as never).runDailyWorkflow({ id: "u1", loginName: "u1", sesId: "s1" }, { delayMs: 0 });

    expect(summarizeDailyWorkflow(result).success).toBe(true);
    expect(result.steps.slice(0, 4).every((step) => step.success)).toBe(true);
  });

  it("delays after daily login and each signin before the next task", async () => {
    const responses: TaskResponse[] = [
      { result: "0", msg: "查询成功", remain_integral: "16" },
      { result: "0", msg: "登录成功" },
      { result: "0", msg: "签到成功" },
      { result: "0", msg: "签到成功" },
      { result: "0", msg: "签到成功" },
      { result: "0", msg: "留言成功" },
      { result: "0", msg: "查询成功", remain_integral: "20" }
    ];
    const delays: Array<{ delayMs: number; nextLabel: string }> = [];
    const client = {
      postEncrypted: async () => ({ data: responses.shift() })
    };

    await new TaskService(client as never).runDailyWorkflow({ id: "u1", loginName: "u1", sesId: "s1" }, {
      delayMs: 1,
      delayMaxMs: 1,
      onDelay: (delayMs, nextLabel) => delays.push({ delayMs, nextLabel })
    });

    expect(delays).toEqual([
      { delayMs: 1, nextLabel: "签到 1/3" },
      { delayMs: 1, nextLabel: "签到 2/3" },
      { delayMs: 1, nextLabel: "签到 3/3" },
      { delayMs: 1, nextLabel: "发表评论" }
    ]);
  });

  it("uses configured comment content in the daily workflow", async () => {
    const requests: Array<{ related_id?: string; content?: string }> = [];
    const responses: TaskResponse[] = [
      { result: "0", msg: "查询成功", remain_integral: "16" },
      { result: "0", msg: "登录成功" },
      { result: "0", msg: "签到成功" },
      { result: "0", msg: "签到成功" },
      { result: "0", msg: "签到成功" },
      { result: "0", msg: "留言成功" },
      { result: "0", msg: "查询成功", remain_integral: "20" }
    ];
    const client = {
      postEncrypted: async (_endpoint: string, payload: { related_id?: string; content?: string }) => {
        requests.push(payload);
        return { data: responses.shift() };
      }
    };

    const result = await new TaskService(client as never).runDailyWorkflow({ id: "u1", loginName: "u1", sesId: "s1" }, {
      delayMs: 0,
      commentContent: "学习打卡"
    });

    expect(result.steps.find((step) => step.key === "comment")?.details).toEqual(["内容: 学习打卡"]);
    expect(requests.find((payload) => payload.related_id === "1232")?.content).toBe("学习打卡");
  });

  it("generates random daily step delay inside inclusive range", () => {
    for (let i = 0; i < 50; i += 1) {
      const delay = randomDelayMs(1000, 2000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });
});
