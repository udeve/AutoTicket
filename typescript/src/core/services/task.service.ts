import { CHANNEL, DAILY_TASK_APP_VER_NO, ENDPOINTS } from "../constants.js";
import type { RequestPayload, SessionUser } from "../types.js";
import { nowTs, sleep } from "../utils/time.js";
import { ApiClient } from "../http/api-client.js";

export interface TaskResponse {
  result?: string;
  msg?: string;
  trcode?: string;
  [key: string]: unknown;
}

export interface DailyWorkflowResult {
  integralBefore?: TaskResponse;
  dailyLogin: TaskResponse | undefined;
  signins: Array<TaskResponse | undefined>;
  comment: TaskResponse | undefined;
  query: TaskResponse | undefined;
  steps: DailyWorkflowStepResult[];
}

export interface DailyWorkflowStepResult {
  key: "dailyLogin" | "signin1" | "signin2" | "signin3" | "comment" | "query";
  label: string;
  success: boolean;
  msg?: string;
  result?: string;
  details?: string[];
}

export interface DailyWorkflowSummary {
  success: boolean;
  message: string;
  steps: DailyWorkflowStepResult[];
}

export interface DailyWorkflowOptions {
  delayMs?: number;
  commentContent?: string;
  includeIntegralSnapshot?: boolean;
  onStep?: (step: DailyWorkflowStepResult) => void;
  onDelay?: (delayMs: number, nextLabel: string) => void;
}

export class TaskService {
  constructor(private readonly client: ApiClient) {}

  private common(user: SessionUser): RequestPayload {
    return {
      channel: CHANNEL,
      app_ver_no: DAILY_TASK_APP_VER_NO,
      timestamp: nowTs(),
      login_name: user.loginName,
      ses_id: user.sesId
    };
  }

  async dailyLogin(user: SessionUser) {
    const response = await this.client.postEncrypted<TaskResponse>(ENDPOINTS.dailyLogin, {
      ...this.common(user),
      type: "1"
    });
    return response.data;
  }

  async signin(user: SessionUser) {
    const response = await this.client.postEncrypted<TaskResponse>(ENDPOINTS.signin, {
      ...this.common(user),
      timestamp: nowTs(),
      type: "5"
    });
    return response.data;
  }

  async comment(user: SessionUser, content = "好") {
    const response = await this.client.postEncrypted<TaskResponse>(ENDPOINTS.comment, {
      ...this.common(user),
      timestamp: nowTs(),
      related_id: "1232",
      content_type: "1",
      oper_type: "0",
      suffix: "png",
      content
    });
    return response.data;
  }

  async queryIntegral(user: SessionUser) {
    const response = await this.client.postEncrypted<TaskResponse>(ENDPOINTS.query, {
      ...this.common(user),
      timestamp: nowTs()
    });
    return response.data;
  }

  async runDailyWorkflow(user: SessionUser, options: DailyWorkflowOptions | number = 1000): Promise<DailyWorkflowResult> {
    const delayMs = typeof options === "number" ? options : options.delayMs ?? 1000;
    const commentContent = typeof options === "number" ? "好" : options.commentContent ?? "好";
    const includeIntegralSnapshot = typeof options === "number" ? true : options.includeIntegralSnapshot ?? true;
    const onStep = typeof options === "number" ? undefined : options.onStep;
    const onDelay = typeof options === "number" ? undefined : options.onDelay;
    const steps: DailyWorkflowStepResult[] = [];
    const pushStep = (key: DailyWorkflowStepResult["key"], label: string, response: TaskResponse | undefined, details?: string[]) => {
      const step = toDailyStep(key, label, response, details);
      steps.push(step);
      onStep?.(step);
    };

    const integralBefore = includeIntegralSnapshot ? await this.queryIntegral(user) : undefined;
    const dailyLogin = await this.dailyLogin(user);
    pushStep("dailyLogin", "登录签到", dailyLogin);
    const signins: Array<TaskResponse | undefined> = [];
    for (let i = 0; i < 3; i += 1) {
      const signin = await this.signin(user);
      signins.push(signin);
      pushStep(`signin${i + 1}` as DailyWorkflowStepResult["key"], `签到 ${i + 1}/3`, signin);
      if (i < 2 && delayMs > 0) {
        onDelay?.(delayMs, `签到 ${i + 2}/3`);
        await sleep(delayMs);
      }
    }
    const comment = await this.comment(user, commentContent);
    pushStep("comment", "发表评论", comment, [`内容: ${commentContent}`]);
    const query = await this.queryIntegral(user);
    pushStep("query", "积分查询", query, [formatIntegralChange(integralBefore, query)]);
    return { integralBefore, dailyLogin, signins, comment, query, steps };
  }
}

export function summarizeDailyWorkflow(result: DailyWorkflowResult): DailyWorkflowSummary {
  const success = result.steps.every((step) => step.success);
  return {
    success,
    message: success ? "每日任务全部执行成功。" : "每日任务存在失败步骤。",
    steps: result.steps
  };
}

export function formatDailyWorkflowSummary(summary: DailyWorkflowSummary): string {
  const lines = [
    summary.message,
    ...summary.steps.map((step) => {
      const details = step.details?.length ? `（${step.details.join("，")}）` : "";
      return `${step.success ? "[成功]" : "[失败]"} ${step.label}${step.msg ? `: ${step.msg}` : ""}${details}`;
    })
  ];
  return lines.join("\n");
}

function toDailyStep(key: DailyWorkflowStepResult["key"], label: string, response: TaskResponse | undefined, details?: string[]): DailyWorkflowStepResult {
  return {
    key,
    label,
    success: isSuccessfulDailyResponse(response),
    result: response?.result,
    msg: response?.msg,
    details
  };
}

function isSuccessfulDailyResponse(response: TaskResponse | undefined): boolean {
  if (response?.result === "0") return true;
  return typeof response?.msg === "string" && response.msg.includes("当日已到积分上限次数");
}

function formatIntegralChange(before: TaskResponse | undefined, after: TaskResponse | undefined): string {
  return `积分: ${formatIntegralValue(before)} -> ${formatIntegralValue(after)}`;
}

function formatIntegralValue(response: TaskResponse | undefined): string {
  const value = response?.remain_integral ?? response?.total_integral;
  return value === undefined || value === null || value === "" ? "未返回" : String(value);
}
