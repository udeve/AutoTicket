#!/usr/bin/env node
import { Command } from "commander";
import { ApiClient } from "../core/http/api-client.js";
import { AuthService } from "../core/services/auth.service.js";
import { ExchangeService } from "../core/services/exchange.service.js";
import { formatDailyWorkflowSummary, summarizeDailyWorkflow, TaskService } from "../core/services/task.service.js";
import { ExchangeScheduler, formatExchangeRunSummary, summarizeExchangeRun } from "../core/scheduler/exchange-scheduler.js";
import { createNotifier } from "../core/notifier/app.notifier.js";
import { ConfigRepository, DEFAULT_CONFIG_PATH } from "../core/config/config.repository.js";
import type { LoginResponse } from "../core/services/auth.service.js";
import { startWebServer } from "../web/server.js";
import { formatTaskStatusSummary, statePathForConfig, summarizeTaskRuns, TaskStateRepository, todayKey } from "../core/state/task-state.repository.js";
import { formatDailySchedulePlan, ScheduleService, type ScheduledTaskType, tomorrowKey, withScheduleLogTimestamp } from "../core/schedule/schedule.service.js";
import { logsPm2Bot, logsPm2Schedule, restartPm2Bot, restartPm2Schedule, startPm2Bot, startPm2Schedule, statusPm2Bot, statusPm2Schedule, stopPm2Bot, stopPm2Schedule } from "../core/schedule/pm2-manager.js";
import { redactSensitive, redactUserForDisplay } from "../core/utils/redaction.js";

const program = new Command();

program.name("autoticket").description("High-performance AutoTicket CLI").version("2.0.0");

program
  .command("users")
  .description("List configured users")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const config = await repo.load();
    console.log(JSON.stringify(config.users.map((user) => redactUserForDisplay(user)), null, 2));
  });

const userCommand = program.command("user").description("User queries");

userCommand
  .command("status")
  .description("Query configured user session and integral status")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .requiredOption("-u, --user <id>", "user id in config")
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const user = await repo.getUser(options.user);
    const client = new ApiClient();
    try {
      const result = await new AuthService(client).queryUserInfo(user.loginName, user.sesId);
      console.log(JSON.stringify(redactSensitive({
        user: redactUserForDisplay(user),
        status: result.data ?? result.envelope
      }), null, 2));
    } finally {
      await client.close();
    }
  });

const userScheduleCommand = userCommand.command("schedule").description("User-level schedule settings");

userScheduleCommand
  .command("show")
  .description("Show user-level schedule configuration")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .requiredOption("-u, --user <id>", "user id in config")
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const config = await repo.load();
    const user = await repo.getUser(options.user);
    const dailyEnabled = user.schedule?.daily?.enabled ?? config.schedule.daily.enabled;
    const exchangeEnabled = user.schedule?.exchange?.enabled ?? config.schedule.exchange.enabled;
    const exchangeId = user.schedule?.exchange?.exchangeId ?? config.schedule.exchange.exchangeId ?? config.exchange.exchangeId;
    const weekdays = user.schedule?.exchange?.weekdays ?? config.schedule.exchange.weekdays;
    const maxTicketCount = user.schedule?.exchange?.maxTicketCount ?? config.schedule.exchange.maxTicketCount;
    console.log(JSON.stringify({
      user: redactUserForDisplay(user),
      schedule: {
        daily: {
          enabled: dailyEnabled,
          source: user.schedule?.daily?.enabled !== undefined ? "user" : "global"
        },
        exchange: {
          enabled: exchangeEnabled,
          exchangeId,
          weekdays,
          maxTicketCount,
          source: user.schedule?.exchange?.enabled !== undefined || user.schedule?.exchange?.exchangeId !== undefined || user.schedule?.exchange?.weekdays !== undefined || user.schedule?.exchange?.maxTicketCount !== undefined ? "user" : "global"
        }
      }
    }, null, 2));
  });

userScheduleCommand
  .command("set")
  .description("Set user-level schedule configuration")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .requiredOption("-u, --user <id>", "user id in config")
  .option("--daily-enabled <boolean>", "enable/disable daily task (true/false)")
  .option("--exchange-enabled <boolean>", "enable/disable exchange task (true/false)")
  .option("--exchange-id <id>", "exchange coupon id")
  .option("--weekdays <days>", "weekdays to run exchange, comma-separated (0=Sun,1=Mon,...,6=Sat), e.g. 1,3,5")
  .option("--max-ticket-count <n>", "maximum number of coupons to hold, 0 or unset for unlimited", Number)
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const config = await repo.load();
    const user = await repo.getUser(options.user);
    const updatedSchedule = { ...(user.schedule ?? {}) };
    if (options.dailyEnabled !== undefined) {
      updatedSchedule.daily = {
        ...(updatedSchedule.daily ?? {}),
        enabled: parseBoolean(options.dailyEnabled)
      };
    }
    if (options.exchangeEnabled !== undefined) {
      updatedSchedule.exchange = {
        ...(updatedSchedule.exchange ?? {}),
        enabled: parseBoolean(options.exchangeEnabled)
      };
    }
    if (options.exchangeId !== undefined) {
      updatedSchedule.exchange = {
        ...(updatedSchedule.exchange ?? {}),
        exchangeId: options.exchangeId
      };
    }
    if (options.weekdays !== undefined) {
      const weekdays = options.weekdays
        .split(",")
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n) && n >= 0 && n <= 6);
      updatedSchedule.exchange = {
        ...(updatedSchedule.exchange ?? {}),
        weekdays
      };
    }
    if (options.maxTicketCount !== undefined) {
      updatedSchedule.exchange = {
        ...(updatedSchedule.exchange ?? {}),
        maxTicketCount: options.maxTicketCount > 0 ? options.maxTicketCount : undefined
      };
    }
    const updatedUser = { ...user, schedule: updatedSchedule };
    await repo.upsertUser(updatedUser);
    console.log(`用户 ${options.user} 的定时任务配置已更新。`);
  });

userScheduleCommand
  .command("reset")
  .description("Reset user-level schedule configuration (use global defaults)")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .requiredOption("-u, --user <id>", "user id in config")
  .option("--daily", "reset daily task settings only")
  .option("--exchange", "reset exchange task settings only")
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const user = await repo.getUser(options.user);
    if (!user.schedule) {
      console.log(`用户 ${options.user} 没有自定义定时任务配置，无需重置。`);
      return;
    }
    const updatedSchedule = { ...user.schedule };
    if (options.daily) {
      delete updatedSchedule.daily;
    }
    if (options.exchange) {
      delete updatedSchedule.exchange;
    }
    if (!options.daily && !options.exchange) {
      delete updatedSchedule.daily;
      delete updatedSchedule.exchange;
    }
    const hasAny = Object.keys(updatedSchedule).length > 0;
    const updatedUser = hasAny ? { ...user, schedule: updatedSchedule } : { ...user };
    if (!hasAny) {
      delete (updatedUser as { schedule?: unknown }).schedule;
    }
    await repo.upsertUser(updatedUser);
    console.log(`用户 ${options.user} 的定时任务配置已重置为全局默认。`);
  });

program
  .command("state")
  .description("Show saved task execution state")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("-u, --user <id>", "filter by user id")
  .option("--date <date>", "date, YYYY-MM-DD", todayKey())
  .action(async (options) => {
    const stateRepo = new TaskStateRepository(statePathForConfig(options.config));
    const state = await stateRepo.load();
    const runs = state.runs.filter((run) =>
      (!options.user || run.userId === options.user) &&
      (!options.date || run.date === options.date)
    );
    const config = await new ConfigRepository(options.config).load();
    const users = options.user ? config.users.filter((user) => user.id === options.user) : config.users;
    console.log(formatTaskStatusSummary(users, summarizeTaskRuns(runs), options.date, { exchangeDefaults: config.exchange }));
  });

program
  .command("exchange")
  .description("Run coupon exchange scheduler")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .requiredOption("-u, --user <id>", "user id in config")
  .option("--exchange-id <id>", "exchange id")
  .option("--start-at <time>", "target time, HH:mm:ss")
  .option("--concurrency <n>", "parallel request count", Number)
  .option("--interval <ms>", "minimum interval between launching attempts", Number)
  .option("--interval-max <ms>", "maximum randomized interval between launching attempts", Number)
  .option("--max-attempts <n>", "maximum attempts", Number)
  .option("--timeout <ms>", "single exchange request timeout", Number)
  .option("--force", "run even if exchange already ran today")
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const config = await repo.load();
    const user = await repo.getUser(options.user);
    const requestTimeoutMs = options.timeout ?? config.exchange.requestTimeoutMs;
    const client = new ApiClient({ timeoutMs: requestTimeoutMs });
    const exchangeService = new ExchangeService(client);
    const scheduler = new ExchangeScheduler(exchangeService);
    const notifier = createNotifier(config);
    const stateRepo = new TaskStateRepository(statePathForConfig(options.config));
    const startedAt = new Date().toISOString();
    const existingRun = await stateRepo.hasRunToday(options.user, "exchange");
    if (existingRun && !options.force) {
      console.log(`今天已经执行过优惠券兑换：${existingRun.status === "success" ? "成功" : "失败"}${existingRun.message ? ` / ${existingRun.message}` : ""}`);
      console.log("如需重复执行，请加 --force。");
      await client.close();
      return;
    }

    try {
      await client.warmup();
      const exchangeMeta = {
        exchangeId: options.exchangeId ?? config.exchange.exchangeId,
        startAt: options.startAt ?? config.exchange.startAt,
        concurrency: options.concurrency ?? config.exchange.concurrency,
        intervalMs: options.interval ?? config.exchange.intervalMs,
        intervalMaxMs: options.intervalMax ?? config.exchange.intervalMaxMs,
        maxAttempts: options.maxAttempts ?? config.exchange.maxAttempts,
        requestTimeoutMs
      };
      const result = await scheduler.run({
        user,
        ...exchangeMeta,
        stopRules: config.exchange.stopRules
      });

      const summary = summarizeExchangeRun(result);
      await stateRepo.append({
        task: "exchange",
        userId: options.user,
        status: summary.success ? "success" : "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: result.final?.msg ?? "未命中停止条件",
        meta: exchangeMeta,
        summary: { ...summary, raw: result }
      });
      console.log(formatExchangeRunSummary(summary));
      await notifier.notify(`AutoTicket 兑换结束\n用户: ${user.id}\n${formatExchangeRunSummary(summary)}`);
    } catch (error) {
      await stateRepo.append({
        task: "exchange",
        userId: options.user,
        status: "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      await client.close();
    }
  });

program
  .command("daily")
  .description("Run daily login/sign/comment/query workflow")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .requiredOption("-u, --user <id>", "user id in config")
  .option("--delay <ms>", "minimum random delay between daily task steps", Number, 1000)
  .option("--force", "run even if daily task already ran today")
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    const config = await repo.load();
    const user = await repo.getUser(options.user);
    const client = new ApiClient();
    const taskService = new TaskService(client);
    const notifier = createNotifier(config);
    const stateRepo = new TaskStateRepository(statePathForConfig(options.config));
    const startedAt = new Date().toISOString();
    const existingRun = await stateRepo.hasRunToday(options.user, "daily");
    if (existingRun && !options.force) {
      console.log(`今天已经执行过每日任务：${existingRun.status === "success" ? "成功" : "失败"}${existingRun.message ? ` / ${existingRun.message}` : ""}`);
      console.log("如需重复执行，请加 --force。");
      await client.close();
      return;
    }

    try {
      const result = await taskService.runDailyWorkflow(user, { delayMs: options.delay, commentContent: config.schedule.daily.commentContent });
      const summary = summarizeDailyWorkflow(result);
      await stateRepo.append({
        task: "daily",
        userId: options.user,
        status: summary.success ? "success" : "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: summary.message,
        summary: { ...summary, raw: result }
      });
      console.log(formatDailyWorkflowSummary(summary));
      await notifier.notify(`AutoTicket 每日任务完成\n用户: ${user.id}\n${formatDailyWorkflowSummary(summary)}`);
    } catch (error) {
      await stateRepo.append({
        task: "daily",
        userId: options.user,
        status: "failure",
        startedAt,
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      await client.close();
    }
  });

const schedule = program.command("schedule").description("Run multi-user scheduled tasks");

schedule
  .command("once")
  .description("Run a scheduled task once for configured users")
  .argument("<task>", "daily or exchange")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("--force", "run even if task already ran today")
  .action(async (task: string, options) => {
    if (task !== "daily" && task !== "exchange") throw new Error("task must be daily or exchange");
    const config = await new ConfigRepository(options.config).load();
    await new ScheduleService({
      config,
      stateRepo: new TaskStateRepository(statePathForConfig(options.config)),
      logger: withScheduleLogTimestamp((message) => console.log(message))
    }).runOnce(task as ScheduledTaskType, options.force);
  });

schedule
  .command("run")
  .description("Run enabled schedules forever")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    const config = await new ConfigRepository(options.config).load();
    await new ScheduleService({
      config,
      stateRepo: new TaskStateRepository(statePathForConfig(options.config)),
      logger: withScheduleLogTimestamp((message) => console.log(message))
    }).runForever();
  });

schedule
  .command("start")
  .description("Start schedule runner in PM2")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    console.log(await startPm2Schedule({ configPath: options.config }));
  });

schedule
  .command("stop")
  .description("Stop schedule runner in PM2")
  .action(async () => {
    console.log(await stopPm2Schedule());
  });

schedule
  .command("restart")
  .description("Restart schedule runner in PM2")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    console.log(await restartPm2Schedule({ configPath: options.config }));
  });

schedule
  .command("status")
  .description("Show PM2 schedule runner status")
  .action(async () => {
    console.log(await statusPm2Schedule());
  });

schedule
  .command("logs")
  .description("Show PM2 schedule runner logs")
  .option("--lines <n>", "log lines", Number, 80)
  .action(async (options) => {
    console.log(await logsPm2Schedule(options.lines));
  });

schedule
  .command("daily-plan")
  .description("Show daily task schedule times for a date")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("--date <date>", "date to preview, YYYY-MM-DD", tomorrowKey())
  .action(async (options) => {
    const config = await new ConfigRepository(options.config).load();
    const service = new ScheduleService({
      config,
      stateRepo: new TaskStateRepository(statePathForConfig(options.config))
    });
    console.log(formatDailySchedulePlan(await service.previewDailyPlan(options.date), options.date));
  });

const login = program.command("login").description("Login helpers");

login
  .command("direct")
  .description("Save LOGIN_NAME and SES_ID directly")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("-u, --user <id>", "user id to save", "default")
  .requiredOption("--login-name <loginName>", "LOGIN_NAME")
  .requiredOption("--ses-id <sesId>", "SES_ID")
  .action(async (options) => {
    const repo = new ConfigRepository(options.config);
    await repo.upsertUser({
      id: options.user,
      loginName: options.loginName,
      userId: options.loginName,
      sesId: options.sesId
    });
    console.log(`登录信息已保存到 ${options.config}，用户 ID: ${options.user}`);
  });

login
  .command("captcha")
  .description("Fetch image captcha data")
  .action(async () => {
    const client = new ApiClient();
    try {
      const auth = new AuthService(client);
      const result = await auth.getCaptcha();
      console.log(JSON.stringify(redactSensitive(result.data ?? result.envelope), null, 2));
    } finally {
      await client.close();
    }
  });

login
  .command("send-sms")
  .description("Send SMS verification code")
  .requiredOption("--phone <phone>", "phone number")
  .requiredOption("--img-uni-code <code>", "captcha imgUniCode")
  .requiredOption("--captcha <code>", "captcha code")
  .action(async (options) => {
    const client = new ApiClient();
    try {
      const auth = new AuthService(client);
      const result = await auth.sendSms({ imgUniCode: options.imgUniCode }, options.phone, options.captcha);
      console.log(JSON.stringify(redactSensitive(result.data ?? result.envelope), null, 2));
    } finally {
      await client.close();
    }
  });

login
  .command("sms")
  .description("Login by SMS code")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("-u, --user <id>", "user id to save", "default")
  .requiredOption("--phone <phone>", "phone number")
  .requiredOption("--code <code>", "SMS code")
  .action(async (options) => {
    const client = new ApiClient();
    try {
      const auth = new AuthService(client);
      const result = await auth.loginBySms(options.phone, options.code);
      console.log(JSON.stringify(redactSensitive(result.data ?? result.envelope), null, 2));
      await saveLoginResult(options.config, options.user, result.data);
    } finally {
      await client.close();
    }
  });

login
  .command("password")
  .description("Login by password and image captcha")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("-u, --user <id>", "user id to save", "default")
  .requiredOption("--phone <phone>", "phone number")
  .requiredOption("--password <password>", "password")
  .requiredOption("--img-uni-code <code>", "captcha imgUniCode")
  .requiredOption("--captcha <code>", "captcha code")
  .action(async (options) => {
    const client = new ApiClient();
    try {
      const auth = new AuthService(client);
      const result = await auth.loginByPassword(
        { imgUniCode: options.imgUniCode },
        options.phone,
        options.password,
        options.captcha
      );
      console.log(JSON.stringify(redactSensitive(result.data ?? result.envelope), null, 2));
      await saveLoginResult(options.config, options.user, result.data);
    } finally {
      await client.close();
    }
  });

program
  .command("ui")
  .alias("tui")
  .description("Start interactive terminal UI")
  .action(async () => {
    await import("../tui/index.js");
  });

program
  .command("web")
  .description("Start local Web UI")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("--host <host>", "host", "127.0.0.1")
  .option("--port <port>", "port", Number, 3210)
  .action(async (options) => {
    await startWebServer({
      configPath: options.config,
      host: options.host,
      port: options.port
    });
  });

const bot = program.command("bot").description("DingTalk Stream 远程控制");

bot
  .command("run")
  .description("Run DingTalk Stream bot forever")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    const { runBotForever } = await import("../core/bot/bot.runner.js");
    await runBotForever({ configPath: options.config });
  });

bot
  .command("start")
  .description("Start bot runner in PM2")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    console.log(await startPm2Bot({ configPath: options.config }));
  });

bot
  .command("stop")
  .description("Stop bot runner in PM2")
  .action(async () => {
    console.log(await stopPm2Bot());
  });

bot
  .command("restart")
  .description("Restart bot runner in PM2")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (options) => {
    console.log(await restartPm2Bot({ configPath: options.config }));
  });

bot
  .command("status")
  .description("Show PM2 bot runner status")
  .action(async () => {
    console.log(await statusPm2Bot());
  });

bot
  .command("logs")
  .description("Show PM2 bot runner logs")
  .option("--lines <n>", "log lines", Number, 80)
  .action(async (options) => {
    console.log(await logsPm2Bot(options.lines));
  });

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function saveLoginResult(configPath: string, userId: string, data: LoginResponse | undefined): Promise<void> {
  if (!data || data.result !== "0") {
    console.log("登录未成功，未写入配置文件。");
    return;
  }

  const loginName = data.login_name ?? data.user_id;
  const sesId = data.ses_id;
  if (!loginName || !sesId) {
    console.log("登录响应缺少 login_name 或 ses_id，未写入配置文件。");
    return;
  }

  const repo = new ConfigRepository(configPath);
  await repo.upsertUser({
    id: userId,
    loginName,
    userId: data.user_id ?? loginName,
    sesId,
    name: data.name
  });
  console.log(`登录信息已保存到 ${configPath}，用户 ID: ${userId}`);
}

function parseBoolean(value: string | boolean): boolean {
  if (typeof value === "boolean") return value;
  const lower = value.toLowerCase().trim();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  throw new Error(`Invalid boolean value: ${value}`);
}
