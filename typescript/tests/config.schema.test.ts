import { describe, expect, it } from "vitest";
import { AppConfigSchema, findUser, isUserDailyEnabled, isUserExchangeEnabled, getUserExchangeId, getUserExchangeWeekdays, isExchangeWeekday, formatWeekdays, resolveUsersForTask } from "../src/core/config/config.schema.js";
import { ConfigRepository } from "../src/core/config/config.repository.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(config.bot.enabled).toBe(false);
    expect(config.bot.dingtalk.enabled).toBe(false);
    expect(config.bot.security.allowedSenderIds).toEqual([]);
    expect(config.bot.nlu.model).toBe("gemma3:4b");
  });

  it("parses and preserves bot config", () => {
    const config = AppConfigSchema.parse({
      bot: {
        enabled: true,
        dingtalk: { enabled: true, clientId: "dingXXX", clientSecret: "secret", robotCode: "dingXXX" },
        security: { allowedSenderIds: ["staffId1"] }
      }
    });
    expect(config.bot.enabled).toBe(true);
    expect(config.bot.dingtalk.clientId).toBe("dingXXX");
    expect(config.bot.security.allowedSenderIds).toEqual(["staffId1"]);
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

  it("writes missing top-level sections into an existing config on load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autoticket-"));
    try {
      const configPath = join(dir, "autoticket.json");
      // 模拟 bot 段出现之前的老配置文件
      await writeFile(configPath, JSON.stringify({ users: [], exchange: { exchangeId: "10" } }), "utf8");

      const repo = new ConfigRepository(configPath);
      const config = await repo.load();
      expect(config.bot).toBeDefined();
      expect(config.bot.enabled).toBe(false);

      // 缺失的 bot 段应被回写到磁盘
      const onDisk = JSON.parse(await readFile(configPath, "utf8")) as { bot?: unknown };
      expect(onDisk.bot).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  describe("user-level schedule config", () => {
    it("parses user schedule config", () => {
      const config = AppConfigSchema.parse({
        users: [
          { id: "u1", loginName: "login", sesId: "session", schedule: { daily: { enabled: true }, exchange: { enabled: false, exchangeId: "20" } } }
        ]
      });
      expect(config.users[0].schedule?.daily?.enabled).toBe(true);
      expect(config.users[0].schedule?.exchange?.enabled).toBe(false);
      expect(config.users[0].schedule?.exchange?.exchangeId).toBe("20");
    });

    it("isUserDailyEnabled falls back to global", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session" }],
        schedule: { daily: { enabled: true } }
      });
      expect(isUserDailyEnabled(config, config.users[0])).toBe(true);
    });

    it("isUserDailyEnabled uses user-level override", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session", schedule: { daily: { enabled: false } } }],
        schedule: { daily: { enabled: true } }
      });
      expect(isUserDailyEnabled(config, config.users[0])).toBe(false);
    });

    it("isUserExchangeEnabled falls back to global", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session" }],
        schedule: { exchange: { enabled: true } }
      });
      expect(isUserExchangeEnabled(config, config.users[0])).toBe(true);
    });

    it("isUserExchangeEnabled uses user-level override", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session", schedule: { exchange: { enabled: false } } }],
        schedule: { exchange: { enabled: true } }
      });
      expect(isUserExchangeEnabled(config, config.users[0])).toBe(false);
    });

    it("getUserExchangeId priority: user > schedule.exchange > exchange", () => {
      const config = AppConfigSchema.parse({
        exchange: { exchangeId: "10" },
        schedule: { exchange: { exchangeId: "15" } },
        users: [{ id: "u1", loginName: "login", sesId: "session", schedule: { exchange: { exchangeId: "20" } } }]
      });
      expect(getUserExchangeId(config, config.users[0])).toBe("20");
    });

    it("getUserExchangeId falls back to schedule.exchange", () => {
      const config = AppConfigSchema.parse({
        exchange: { exchangeId: "10" },
        schedule: { exchange: { exchangeId: "15" } },
        users: [{ id: "u1", loginName: "login", sesId: "session" }]
      });
      expect(getUserExchangeId(config, config.users[0])).toBe("15");
    });

    it("getUserExchangeId falls back to exchange global", () => {
      const config = AppConfigSchema.parse({
        exchange: { exchangeId: "10" },
        users: [{ id: "u1", loginName: "login", sesId: "session" }]
      });
      expect(getUserExchangeId(config, config.users[0])).toBe("10");
    });

    it("resolveUsersForTask filters by daily enabled", () => {
      const config = AppConfigSchema.parse({
        users: [
          { id: "u1", loginName: "login1", sesId: "s1", schedule: { daily: { enabled: true } } },
          { id: "u2", loginName: "login2", sesId: "s2", schedule: { daily: { enabled: false } } },
          { id: "u3", loginName: "login3", sesId: "s3" }
        ],
        schedule: { daily: { enabled: true } }
      });
      const dailyUsers = resolveUsersForTask(config, "daily");
      expect(dailyUsers.map((u) => u.id)).toEqual(["u1", "u3"]);
    });

    it("resolveUsersForTask filters by exchange enabled", () => {
      const config = AppConfigSchema.parse({
        users: [
          { id: "u1", loginName: "login1", sesId: "s1", schedule: { exchange: { enabled: true } } },
          { id: "u2", loginName: "login2", sesId: "s2", schedule: { exchange: { enabled: false } } },
          { id: "u3", loginName: "login3", sesId: "s3" }
        ],
        schedule: { exchange: { enabled: false } }
      });
      const exchangeUsers = resolveUsersForTask(config, "exchange");
      expect(exchangeUsers.map((u) => u.id)).toEqual(["u1"]);
    });

    it("getUserExchangeWeekdays falls back to global", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session" }],
        schedule: { exchange: { weekdays: [1, 2, 3] } }
      });
      expect(getUserExchangeWeekdays(config, config.users[0])).toEqual([1, 2, 3]);
    });

    it("getUserExchangeWeekdays uses user-level override", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session", schedule: { exchange: { weekdays: [4, 5] } } }],
        schedule: { exchange: { weekdays: [1, 2, 3] } }
      });
      expect(getUserExchangeWeekdays(config, config.users[0])).toEqual([4, 5]);
    });

    it("isExchangeWeekday returns true for matching weekday", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session" }],
        schedule: { exchange: { weekdays: [1, 3, 5] } }
      });
      const monday = new Date(2024, 0, 1);
      expect(isExchangeWeekday(config, config.users[0], monday)).toBe(true);
    });

    it("isExchangeWeekday returns false for non-matching weekday", () => {
      const config = AppConfigSchema.parse({
        users: [{ id: "u1", loginName: "login", sesId: "session" }],
        schedule: { exchange: { weekdays: [1, 3, 5] } }
      });
      const sunday = new Date(2023, 11, 31);
      expect(isExchangeWeekday(config, config.users[0], sunday)).toBe(false);
    });

    it("formatWeekdays handles all days", () => {
      expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe("每天");
    });

    it("formatWeekdays handles empty", () => {
      expect(formatWeekdays([])).toBe("不执行");
    });

    it("formatWeekdays formats specific days", () => {
      expect(formatWeekdays([1, 3, 5])).toBe("周一、周三、周五");
    });

    it("resolveUsersForTask respects schedule.users list", () => {
      const config = AppConfigSchema.parse({
        users: [
          { id: "u1", loginName: "login1", sesId: "s1" },
          { id: "u2", loginName: "login2", sesId: "s2" },
          { id: "u3", loginName: "login3", sesId: "s3" }
        ],
        schedule: {
          users: ["u1", "u3"],
          daily: { enabled: true }
        }
      });
      const dailyUsers = resolveUsersForTask(config, "daily");
      expect(dailyUsers.map((u) => u.id)).toEqual(["u1", "u3"]);
    });
  });
});
