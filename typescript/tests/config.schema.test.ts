import { describe, expect, it } from "vitest";
import { AppConfigSchema, findUser } from "../src/core/config/config.schema.js";
import { ConfigRepository } from "../src/core/config/config.repository.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("config schema", () => {
  it("applies defaults", () => {
    const config = AppConfigSchema.parse({});
    expect(config.exchange.exchangeId).toBe("10");
    expect(config.exchange.startAt).toBe("07:00:00");
    expect(config.exchange.concurrency).toBe(1);
    expect(config.exchange.requestTimeoutMs).toBe(5000);
    expect(config.exchange.stopRules).toContainEqual({ match: "每天最多兑换", status: "success" });
    expect(config.exchange.stopRules).toContainEqual({ match: "手慢啦", status: "failure" });
    expect(config.schedule.enabled).toBe(false);
    expect(config.schedule.daily.mode).toBe("fixed");
    expect(config.schedule.daily.rangeStartHour).toBe(8);
    expect(config.schedule.daily.rangeEndHour).toBe(10);
    expect(config.schedule.daily.commentContent).toBe("点赞");
    expect(config.schedule.exchange.times).toEqual(["07:00:00", "11:30:00", "17:00:00"]);
    expect(config.schedule.exchange.intervalMs).toBe(100);
    expect(config.schedule.exchange.maxAttempts).toBe(50);
    expect(config.schedule.exchange.requestTimeoutMs).toBe(5000);
    expect(config.notifications.dingtalk.enabled).toBe(false);
    expect(config.notifications.serverChan.enabled).toBe(false);
    expect(config.notifications.serverChan.uid).toBe("");
    expect(config.notifications.serverChan.sendKey).toBe("");
  });

  it("finds configured users", () => {
    const config = AppConfigSchema.parse({
      users: [{ id: "u1", loginName: "login", sesId: "session" }]
    });
    expect(findUser(config, "u1").loginName).toBe("login");
  });

  it("rejects invalid daily schedule ranges", () => {
    expect(() => AppConfigSchema.parse({
      schedule: {
        daily: {
          rangeStartHour: 8,
          rangeEndHour: 7
        }
      }
    })).toThrow();
  });

  it("rejects invalid exchange interval ranges", () => {
    expect(() => AppConfigSchema.parse({
      exchange: {
        intervalMs: 200,
        intervalMaxMs: 100
      }
    })).toThrow();

    expect(() => AppConfigSchema.parse({
      schedule: {
        exchange: {
          intervalMs: 200,
          intervalMaxMs: 100
        }
      }
    })).toThrow();
  });

  it("creates missing config files and upserts users", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autoticket-"));
    try {
      const repo = new ConfigRepository(join(dir, "autoticket.json"));
      const initial = await repo.load();
      expect(initial.users).toEqual([]);

      await repo.upsertUser({
        id: "u1",
        loginName: "login",
        sesId: "session"
      });
      const user = await repo.getUser("u1");
      expect(user.sesId).toBe("session");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
