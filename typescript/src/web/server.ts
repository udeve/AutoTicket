import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { ApiClient } from "../core/http/api-client.js";
import { AuthService, type LoginResponse } from "../core/services/auth.service.js";
import { ConfigRepository } from "../core/config/config.repository.js";
import { formatDailyWorkflowSummary, summarizeDailyWorkflow, TaskService } from "../core/services/task.service.js";
import { ExchangeService } from "../core/services/exchange.service.js";
import { ExchangeScheduler, formatExchangeRunSummary, summarizeExchangeRun } from "../core/scheduler/exchange-scheduler.js";
import { DingTalkNotifier } from "../core/notifier/dingtalk.notifier.js";
import { formatTaskStatusSummary, statePathForConfig, summarizeTaskRuns, TaskStateRepository, todayKey } from "../core/state/task-state.repository.js";
import { redactSensitive, redactText, redactUserForDisplay } from "../core/utils/redaction.js";

export interface WebServerOptions {
  configPath: string;
  host: string;
  port: number;
}

const staticDirCandidates = [
  join(process.cwd(), "dist"),
  join(process.cwd(), "public")
];

export async function startWebServer(options: WebServerOptions): Promise<void> {
  const repo = new ConfigRepository(options.configPath);
  await repo.load();

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, repo);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });

  console.log(`WebUI 已启动: http://${options.host}:${options.port}`);
  console.log(`配置文件: ${options.configPath}`);
}

async function route(req: IncomingMessage, res: ServerResponse, repo: ConfigRepository): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname.startsWith("/assets/")) {
    await serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, res);
    return;
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = await repo.load();
    sendJson(res, 200, redactSensitive({
      ...config,
      users: config.users.map((user) => redactUserForDisplay(user))
    }));
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const state = await new TaskStateRepository(statePathForConfig(repo.path)).load();
    const date = url.searchParams.get("date") ?? todayKey();
    const userId = url.searchParams.get("userId");
    const runs = state.runs.filter((run) => run.date === date && (!userId || run.userId === userId));
    const config = await repo.load();
    const users = userId ? config.users.filter((user) => user.id === userId) : config.users;
    sendJson(res, 200, { date, text: formatTaskStatusSummary(users, summarizeTaskRuns(runs), date, { exchangeDefaults: config.exchange }), today: summarizeTaskRuns(runs) });
    return;
  }

  if (url.pathname === "/api/user/status" && req.method === "GET") {
    const user = await repo.getUser(url.searchParams.get("userId") ?? "");
    await withClient(res, async (client) => {
      const result = await new AuthService(client).queryUserInfo(user.loginName, user.sesId);
      const status = result.data ?? result.envelope ?? {};
      return {
        text: formatUserStatusText(user, status),
        user: redactUserForDisplay({
          id: user.id,
          name: user.name,
          loginName: user.loginName,
          sesId: user.sesId
        }),
        status: redactSensitive(status)
      };
    });
    return;
  }

  if (url.pathname === "/api/login/captcha" && req.method === "POST") {
    await withClient(res, async (client) => new AuthService(client).getCaptcha());
    return;
  }

  if (url.pathname === "/api/login/send-sms" && req.method === "POST") {
    const body = await readJson(req);
    await withClient(res, async (client) =>
      new AuthService(client).sendSms({ imgUniCode: stringField(body, "imgUniCode") }, stringField(body, "phone"), stringField(body, "captcha"))
    );
    return;
  }

  if (url.pathname === "/api/login/sms" && req.method === "POST") {
    const body = await readJson(req);
    await withClient(res, async (client) => {
      const result = await new AuthService(client).loginBySms(stringField(body, "phone"), stringField(body, "code"));
      await persistLogin(repo, stringField(body, "userId", "default"), result.data);
      return result;
    });
    return;
  }

  if (url.pathname === "/api/login/password" && req.method === "POST") {
    const body = await readJson(req);
    await withClient(res, async (client) => {
      const result = await new AuthService(client).loginByPassword(
        { imgUniCode: stringField(body, "imgUniCode") },
        stringField(body, "phone"),
        stringField(body, "password"),
        stringField(body, "captcha")
      );
      await persistLogin(repo, stringField(body, "userId", "default"), result.data);
      return result;
    });
    return;
  }

  if (url.pathname === "/api/daily" && req.method === "POST") {
    const body = await readJson(req);
    const config = await repo.load();
    const user = await repo.getUser(stringField(body, "userId"));
    const stateRepo = new TaskStateRepository(statePathForConfig(repo.path));
    const existingRun = await stateRepo.hasRunToday(user.id, "daily");
    if (existingRun && !booleanField(body, "force", false)) {
      sendJson(res, 409, { duplicate: true, task: "daily", message: `今天已经执行过每日任务：${existingRun.status === "success" ? "成功" : "失败"}${existingRun.message ? ` / ${existingRun.message}` : ""}` });
      return;
    }
    const startedAt = new Date().toISOString();
    await withClient(res, async (client) => {
      try {
        const result = await new TaskService(client).runDailyWorkflow(user, numberField(body, "delayMs", 1000));
        const summary = summarizeDailyWorkflow(result);
        await stateRepo.append({
          task: "daily",
          userId: user.id,
          status: summary.success ? "success" : "failure",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: summary.message,
          summary: { ...summary, raw: result }
        });
        await new DingTalkNotifier(config.dingtalk).notify(`AutoTicket 每日任务完成\n用户: ${user.id}\n${formatDailyWorkflowSummary(summary)}`);
        return { summary, data: redactSensitive(result) };
      } catch (error) {
        await stateRepo.append({
          task: "daily",
          userId: user.id,
          status: "failure",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    });
    return;
  }

  if (url.pathname === "/api/exchange" && req.method === "POST") {
    const body = await readJson(req);
    const config = await repo.load();
    const user = await repo.getUser(stringField(body, "userId"));
    const stateRepo = new TaskStateRepository(statePathForConfig(repo.path));
    const existingRun = await stateRepo.hasRunToday(user.id, "exchange");
    if (existingRun && !booleanField(body, "force", false)) {
      sendJson(res, 409, { duplicate: true, task: "exchange", message: `今天已经执行过优惠券兑换：${existingRun.status === "success" ? "成功" : "失败"}${existingRun.message ? ` / ${existingRun.message}` : ""}` });
      return;
    }
    const startedAt = new Date().toISOString();
    await withClient(res, async (client) => {
      try {
        await client.warmup();
        const scheduler = new ExchangeScheduler(new ExchangeService(client));
        const exchangeMeta = {
          exchangeId: stringField(body, "exchangeId", config.exchange.exchangeId),
          startAt: optionalStringField(body, "startAt") ?? config.exchange.startAt,
          concurrency: numberField(body, "concurrency", config.exchange.concurrency),
          intervalMs: numberField(body, "intervalMs", config.exchange.intervalMs),
          maxAttempts: numberField(body, "maxAttempts", config.exchange.maxAttempts)
        };
        const result = await scheduler.run({
          user,
          ...exchangeMeta,
          stopRules: config.exchange.stopRules
        });
        const summary = summarizeExchangeRun(result);
        await stateRepo.append({
          task: "exchange",
          userId: user.id,
          status: summary.success ? "success" : "failure",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: result.final?.msg ?? "未命中停止条件",
          meta: exchangeMeta,
          summary: { ...summary, raw: result }
        });
        await new DingTalkNotifier(config.dingtalk).notify(`AutoTicket 兑换结束\n用户: ${user.id}\n${formatExchangeRunSummary(summary)}`);
        return { summary, text: formatExchangeRunSummary(summary), data: redactSensitive(result) };
      } catch (error) {
        await stateRepo.append({
          task: "exchange",
          userId: user.id,
          status: "failure",
          startedAt,
          finishedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function withClient(res: ServerResponse, fn: (client: ApiClient) => Promise<unknown>): Promise<void> {
  const client = new ApiClient();
  try {
    const result = await fn(client);
    sendJson(res, 200, result);
  } finally {
    await client.close();
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const normalized = pathname.replace(/^\/+/, "");
  const publicDir = await resolvePublicDir();
  const filePath = join(publicDir, normalized);
  const data = await readFile(filePath);
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(data);
}

async function resolvePublicDir(): Promise<string> {
  for (const dir of staticDirCandidates) {
    if (await exists(join(dir, "index.html"))) {
      return dir;
    }
  }
  return staticDirCandidates[0];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html;charset=utf-8";
    case ".css":
      return "text/css;charset=utf-8";
    case ".js":
      return "application/javascript;charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json;charset=utf-8" });
  res.end(JSON.stringify(redactSensitive(data), null, 2));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function persistLogin(repo: ConfigRepository, userId: string, data: LoginResponse | undefined): Promise<void> {
  if (!data || data.result !== "0") return;
  const loginName = data.login_name ?? data.user_id;
  const sesId = data.ses_id;
  if (!loginName || !sesId) return;
  await repo.upsertUser({
    id: userId,
    loginName,
    userId: data.user_id ?? loginName,
    sesId,
    name: data.name
  });
}

function stringField(data: Record<string, unknown>, key: string, fallback?: string): string {
  const value = data[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing field: ${key}`);
}

function optionalStringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) return Number(value);
  return fallback;
}

function booleanField(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  return typeof value === "boolean" ? value : fallback;
}

function formatUserStatusText(user: { id: string; name?: string }, status: Record<string, unknown>): string {
  const integral = status.remain_integral ?? status.total_integral ?? "未返回";
  const message = typeof status.msg === "string" ? status.msg : "查询完成";
  const id = redactText(user.id);
  const name = user.name ? `${id} / ${redactText(user.name)}` : id;
  return `${name}\n状态: ${message}\n积分: ${integral}`;
}
