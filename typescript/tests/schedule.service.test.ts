import { describe, expect, it } from "vitest";
import { formatDailySchedulePlan, randomShardIndexes, randomTimeTextInRange, randomTimeTextInShard, formatScheduleLogTimestamp, nextDailyOccurrence, nextOccurrence, ScheduleService, tomorrowKey, withScheduleLogTimestamp } from "../src/core/schedule/schedule.service.js";
import { createDefaultConfig } from "../src/core/config/config.repository.js";
import { TaskStateRepository, type TaskState } from "../src/core/state/task-state.repository.js";

describe("schedule service", () => {
  it("calculates next occurrence today", () => {
    const next = nextOccurrence("11:30:00", new Date("2026-06-03T07:00:00.000+08:00"));
    expect(next.getHours()).toBe(11);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(3);
  });

  it("rolls next occurrence to tomorrow", () => {
    const next = nextOccurrence("07:00:00", new Date("2026-06-03T18:00:00.000+08:00"));
    expect(next.getHours()).toBe(7);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(4);
  });

  it("calculates random daily occurrence inside selected hour range", () => {
    const cache = new Map<string, string>();
    const next = nextDailyOccurrence({
      mode: "range",
      time: "08:30:00",
      rangeStartHour: 8,
      rangeEndHour: 10
    }, cache, new Date("2026-06-03T07:00:00.000+08:00"));
    expect(next.getHours()).toBeGreaterThanOrEqual(8);
    expect(next.getHours()).toBeLessThan(10);
    expect(next.getDate()).toBe(3);
  });

  it("reuses cached random daily occurrence for the same date and range", () => {
    const cache = new Map<string, string>();
    const daily = {
      mode: "range" as const,
      time: "08:30:00",
      rangeStartHour: 8,
      rangeEndHour: 10
    };
    const first = nextDailyOccurrence(daily, cache, new Date("2026-06-03T07:00:00.000+08:00"));
    const second = nextDailyOccurrence(daily, cache, new Date("2026-06-03T07:30:00.000+08:00"));
    expect(second.getTime()).toBe(first.getTime());
  });

  it("generates crypto random time text inside selected range", () => {
    const time = randomTimeTextInRange(6, 7);
    expect(time).toMatch(/^06:\d{2}:\d{2}$/);
  });

  it("generates random time text inside a selected shard", () => {
    for (let i = 0; i < 30; i += 1) {
      const first = randomTimeTextInShard(6, 7, 0, 2);
      const second = randomTimeTextInShard(6, 7, 1, 2);
      expect(first).toMatch(/^06:([0-2]\d):\d{2}$/);
      expect(second).toMatch(/^06:([3-5]\d):\d{2}$/);
    }
  });

  it("randomizes which account gets which daily shard", () => {
    const indexes = randomShardIndexes([{ id: "u1" }, { id: "u2" }, { id: "u3" }]);
    expect([...indexes.keys()].sort()).toEqual(["u1", "u2", "u3"]);
    expect([...indexes.values()].sort()).toEqual([0, 1, 2]);
  });

  it("previews multi-user random daily plan with one saved time per shard", async () => {
    const config = createDefaultConfig();
    config.users = [
      { id: "u1", loginName: "u1", sesId: "s1" },
      { id: "u2", loginName: "u2", sesId: "s2" }
    ];
    config.schedule.daily.mode = "range";
    config.schedule.daily.rangeStartHour = 6;
    config.schedule.daily.rangeEndHour = 7;
    const stateRepo = new TaskStateRepository();
    let state: TaskState = { runs: [], dailyRandomTimes: [] };
    stateRepo.load = async () => state;
    stateRepo.save = async (next) => {
      state = next;
    };

    const plan = await new ScheduleService({ config, stateRepo }).previewDailyPlan("2026-06-06");
    const minutes = plan.map((item) => Number(item.time.slice(3, 5))).sort((a, b) => a - b);
    expect(plan).toHaveLength(2);
    expect(minutes[0]).toBeGreaterThanOrEqual(0);
    expect(minutes[0]).toBeLessThan(30);
    expect(minutes[1]).toBeGreaterThanOrEqual(30);
    expect(minutes[1]).toBeLessThan(60);
  });

  it("formats schedule log timestamp", () => {
    expect(formatScheduleLogTimestamp(new Date("2026-06-04T09:35:12.000+08:00"))).toBe("2026-06-04 09:35:12");
  });

  it("formats daily schedule plan", () => {
    expect(tomorrowKey(new Date("2026-06-04T09:35:12.000+08:00"))).toBe("2026-06-05");
    const text = formatDailySchedulePlan([{ userId: "u1", date: "2026-06-05", time: "06:30:00", mode: "range" }], "2026-06-05");
    expect(text).toContain("2026-06-05 每日任务执行时间");
    expect(text).toContain("u1: 06:30:00");
  });

  it("prefixes every schedule log line with timestamp", () => {
    const lines: string[] = [];
    withScheduleLogTimestamp((message) => lines.push(message))("第一行\n第二行");
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] 第一行\n\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] 第二行$/);
  });
});
