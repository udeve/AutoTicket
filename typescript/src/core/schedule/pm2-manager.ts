import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const PM2_APP_NAME = "autoticket-schedule";
export const PM2_BOT_APP_NAME = "autoticket-bot";

export interface Pm2CommandOptions {
  configPath: string;
  cwd?: string;
}

interface Pm2AppStartOptions {
  appName: string;
  /** `dist/cli/index.js` 之后的子命令与参数，如 ["schedule", "run", "--config", path]。 */
  args: string[];
  cwd?: string;
}

/** 通用：用 PM2 以给定名字启动 CLI 子命令。schedule 与 bot 共用。 */
async function startPm2App(options: Pm2AppStartOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const cliPath = resolve(cwd, "dist/cli/index.js");
  return runPm2(["start", cliPath, "--name", options.appName, "--", ...options.args], cwd);
}

export async function startPm2Schedule(options: Pm2CommandOptions): Promise<string> {
  return startPm2App({
    appName: PM2_APP_NAME,
    args: ["schedule", "run", "--config", options.configPath],
    cwd: options.cwd
  });
}

export async function startPm2Bot(options: Pm2CommandOptions): Promise<string> {
  return startPm2App({
    appName: PM2_BOT_APP_NAME,
    args: ["bot", "run", "--config", options.configPath],
    cwd: options.cwd
  });
}

export async function stopPm2Schedule(cwd = process.cwd()): Promise<string> {
  return runPm2(["delete", PM2_APP_NAME], cwd);
}

export async function restartPm2Schedule(options: Pm2CommandOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  await runPm2(["delete", PM2_APP_NAME], cwd).catch(() => undefined);
  return startPm2Schedule({ ...options, cwd });
}

export async function statusPm2Schedule(cwd = process.cwd()): Promise<string> {
  return runPm2(["status", PM2_APP_NAME], cwd);
}

export async function logsPm2Schedule(lines: number, cwd = process.cwd()): Promise<string> {
  return runPm2(["logs", PM2_APP_NAME, "--lines", String(lines), "--nostream"], cwd);
}

export async function stopPm2Bot(cwd = process.cwd()): Promise<string> {
  return runPm2(["delete", PM2_BOT_APP_NAME], cwd);
}

export async function restartPm2Bot(options: Pm2CommandOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  await runPm2(["delete", PM2_BOT_APP_NAME], cwd).catch(() => undefined);
  return startPm2Bot({ ...options, cwd });
}

export async function statusPm2Bot(cwd = process.cwd()): Promise<string> {
  return runPm2(["status", PM2_BOT_APP_NAME], cwd);
}

export async function logsPm2Bot(lines: number, cwd = process.cwd()): Promise<string> {
  return runPm2(["logs", PM2_BOT_APP_NAME, "--lines", String(lines), "--nostream"], cwd);
}

async function runPm2(args: string[], cwd: string): Promise<string> {
  const direct = await run(resolvePm2Command(cwd), args, cwd);
  if (direct.code === 0) return direct.output;

  const output = direct.output.trim();
  if (isPm2Missing(output)) {
    throw new Error("未检测到 PM2。请先运行: npm install -g pm2");
  }
  throw new Error(output || `PM2 command failed: ${direct.code}`);
}

function resolvePm2Command(cwd: string): string {
  if (process.platform !== "win32") return "pm2";
  const candidates = [
    join(cwd, "node_modules", ".bin", "pm2.cmd"),
    process.env.APPDATA ? join(process.env.APPDATA, "npm", "pm2.cmd") : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "pnpm", "pm2.cmd") : undefined
  ].filter((item): item is string => Boolean(item));
  return candidates.find((candidate) => existsSync(candidate)) ?? "pm2";
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveResult) => {
    const child = process.platform === "win32"
      ? spawn(quoteWindowsCommand([command, ...args]), { cwd, shell: true })
      : spawn(command, args, { cwd, shell: false });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolveResult({ code: 1, output: `${output.trim()}\nPM2 command timed out.`.trim() });
    }, 5000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolveResult({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolveResult({ code, output: output.trim() });
    });
  });
}

function quoteWindowsCommand(parts: string[]): string {
  return parts.map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value: string): string {
  if (!/[ \t\n\v"&|<>^]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
}

function isPm2Missing(output: string): boolean {
  return output.includes("could not determine executable") ||
    output.includes("not recognized") ||
    output.includes("不是内部或外部命令") ||
    output.includes("�����ڲ����ⲿ����") ||
    output.includes("Cannot find module") ||
    output.includes("ENOENT") ||
    output.includes("EINVAL");
}
