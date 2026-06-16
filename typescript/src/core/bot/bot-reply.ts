/** 纯回复格式化函数。I/O 由调用方（provider 的 reply）负责。 */

const REPLY_MAX_BYTES = 18_000;

export function formatStatusReply(body: string): string {
  return truncate(body);
}

export function formatTaskStartedReply(task: "daily" | "exchange", force: boolean): string {
  const name = task === "daily" ? "每日任务" : "优惠券兑换";
  return `开始执行 ${name}${force ? "（强制重跑）" : ""}，完成后会再次回复。`;
}

export function formatTaskFinishedReply(task: "daily" | "exchange", ok: boolean, detail: string): string {
  const name = task === "daily" ? "每日任务" : "优惠券兑换";
  const status = ok ? "执行完成" : "执行失败";
  return detail ? `${name}${status}：${detail}` : `${name}${status}。`;
}

export function formatPm2ActionReply(action: "restart" | "stop" | "start", output: string): string {
  const label = action === "restart" ? "重启" : action === "stop" ? "停止" : "启动";
  return `调度进程${label}操作完成。\n${truncate(output)}`;
}

export function formatLogsReply(output: string, lines: number): string {
  return `最近 ${lines} 行日志：\n${truncate(output)}`;
}

export function formatErrorReply(message: string): string {
  return `命令执行出错：${message}`;
}

/** 钉钉单条文本消息有长度上限，统一在出口截断。 */
function truncate(text: string): string {
  const value = (text ?? "").trim();
  if (value.length <= REPLY_MAX_BYTES) return value;
  return `${value.slice(-REPLY_MAX_BYTES)}\n…(已截断)`;
}
