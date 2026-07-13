#!/usr/bin/env node
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { ConfigRepository, DEFAULT_CONFIG_PATH } from "../core/config/config.repository.js";
import type { AppConfig, UserConfig } from "../core/config/config.schema.js";
import { formatWeekdays, WEEKDAY_DISPLAY_ORDER, WEEKDAY_LABELS } from "../core/config/config.schema.js";
import { ApiClient } from "../core/http/api-client.js";
import { AuthService, type LoginResponse } from "../core/services/auth.service.js";
import { formatDailyWorkflowSummary, summarizeDailyWorkflow, TaskService, type DailyWorkflowStepResult } from "../core/services/task.service.js";
import { ExchangeService } from "../core/services/exchange.service.js";
import { ExchangeScheduler, formatExchangeRunSummary, summarizeExchangeRun, type ExchangeSchedulerRunResult } from "../core/scheduler/exchange-scheduler.js";
import { EXCHANGE_AMOUNT_OPTIONS, EXCHANGE_START_TIME_OPTIONS, formatExchangeAmount, formatExchangeStartTime, normalizeTimeToSecond } from "../core/exchange/options.js";
import { createNotifier } from "../core/notifier/app.notifier.js";
import { getNotificationProvider, notificationProviderList, type NotificationProviderId } from "../core/notifier/providers.js";
import { formatRunState, formatTaskExecutionLog, formatTaskStatusSummary, statePathForConfig, summarizeTaskRuns, TaskStateRepository, todayKey } from "../core/state/task-state.repository.js";
import { formatDailySchedulePlan, ScheduleService, tomorrowKey, withScheduleLogTimestamp } from "../core/schedule/schedule.service.js";
import { logsPm2Schedule, PM2_APP_NAME, restartPm2Schedule, startPm2Schedule, statusPm2Schedule, stopPm2Schedule } from "../core/schedule/pm2-manager.js";
import { redactSensitive, redactText } from "../core/utils/redaction.js";
import { startWebServer } from "../web/server.js";
import { Frame } from "./components/Frame.js";
import { InfoRow } from "./components/InfoRow.js";
import { Menu } from "./components/Menu.js";
import { TextPrompt } from "./components/TextPrompt.js";

type Screen = "home" | "login" | "direct" | "sms" | "password" | "users" | "status" | "state" | "daily" | "exchange" | "confirmDaily" | "confirmExchange" | "settings" | "amount" | "startTime" | "schedule" | "scheduleUsers" | "scheduleUserList" | "scheduleUserSettings" | "scheduleUserExchangeAmount" | "scheduleUserExchangeWeekdays" | "scheduleDaily" | "scheduleDailyTime" | "scheduleDailyRangeStart" | "scheduleDailyRangeEnd" | "scheduleExchange" | "scheduleExchangeTimes" | "scheduleExchangeWeekdays" | "notifications" | "notificationProvider" | "web" | "summary" | "message";
type FieldKey = "userId" | "loginName" | "sesId" | "phone" | "imgUniCode" | "captcha" | "smsCode" | "password" | "exchangeId" | "startAt" | "concurrency" | "intervalMs" | "intervalMaxMs" | "maxAttempts" | "requestTimeoutMs" | "scheduleDailyTime" | "scheduleDailyDelayMs" | "scheduleDailyCommentContent" | "scheduleExchangeConcurrency" | "scheduleExchangeIntervalMs" | "scheduleExchangeIntervalMaxMs" | "scheduleExchangeMaxAttempts" | "scheduleExchangeRequestTimeoutMs" | `notification:${NotificationProviderId}:${string}`;
type LoginScreen = "direct" | "sms" | "password";
const parentScreen: Partial<Record<Screen, Screen>> = {
  login: "home",
  direct: "login",
  sms: "login",
  password: "login",
  users: "home",
  status: "home",
  state: "home",
  daily: "home",
  exchange: "home",
  confirmDaily: "daily",
  confirmExchange: "exchange",
  settings: "home",
  amount: "settings",
  startTime: "settings",
  schedule: "home",
  scheduleUsers: "schedule",
  scheduleUserList: "scheduleUsers",
  scheduleUserSettings: "scheduleUserList",
  scheduleUserExchangeAmount: "scheduleUserSettings",
  scheduleUserExchangeWeekdays: "scheduleUserSettings",
  scheduleDaily: "schedule",
  scheduleDailyTime: "scheduleDaily",
  scheduleDailyRangeStart: "scheduleDaily",
  scheduleDailyRangeEnd: "scheduleDaily",
  scheduleExchange: "schedule",
  scheduleExchangeTimes: "scheduleExchange",
  scheduleExchangeWeekdays: "scheduleExchange",
  notifications: "home",
  notificationProvider: "notifications",
  web: "home",
  summary: "home",
  message: "home"
};

const repo = new ConfigRepository(DEFAULT_CONFIG_PATH);
const stateRepo = new TaskStateRepository(statePathForConfig(DEFAULT_CONFIG_PATH));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, value: String(hour) }));

function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState<AppConfig>();
  const [screen, setScreen] = useState<Screen>("home");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({ userId: "default" });
  const [loginDraft, setLoginDraft] = useState<Record<string, string>>({ userId: "default" });
  const [prompt, setPrompt] = useState<{ key: FieldKey; label: string; mask?: string; initialValue?: string }>();
  const [activeIndexes, setActiveIndexes] = useState<Partial<Record<Screen, number>>>({});
  const [restoreIndexes, setRestoreIndexes] = useState<Partial<Record<Screen, number>>>({});
  const [currentIntegral, setCurrentIntegral] = useState<string>("未查询");
  const [selectedNotificationProviderId, setSelectedNotificationProviderId] = useState<NotificationProviderId>("dingtalk");
  const [selectedScheduleUserId, setSelectedScheduleUserId] = useState<string>("");

  useEffect(() => {
    void reloadConfig();
  }, []);

  useInput((input, key) => {
    if (screen === "message" && !busy && key.return) navigateBack();
    if (key.escape && screen !== "home" && !prompt) navigateBack();
    if (key.ctrl && input === "c") exit();
  });

  async function reloadConfig() {
    setConfig(await repo.load());
  }

  const currentUser = useMemo(() => {
    if (!config?.users.length) return undefined;
    return config.users.find((user) => user.id === fields.userId) ?? config.users[0];
  }, [config, fields.userId]);

  useEffect(() => {
    void refreshCurrentIntegral();
  }, [currentUser?.id]);

  function updateField(key: FieldKey, value: string) {
    setFields((old) => ({ ...old, [key]: value }));
  }

  function setActiveIndex(screenId: Screen, index: number) {
    setActiveIndexes((old) => ({ ...old, [screenId]: index }));
  }

  function initialIndex(screenId: Screen, fallback = 0) {
    return activeIndexes[screenId] ?? restoreIndexes[screenId] ?? fallback;
  }

  function navigate(nextScreen: Screen) {
    setRestoreIndexes((old) => {
      const next = { ...old, [screen]: activeIndexes[screen] ?? 0 };
      delete next[nextScreen];
      return next;
    });
    setScreen(nextScreen);
  }

  function navigateBack() {
    const parent = parentScreen[screen] ?? "home";
    setRestoreIndexes((old) => {
      const next = { ...old, [parent]: activeIndexes[parent] ?? old[parent] ?? 0 };
      delete next[screen];
      return next;
    });
    setScreen(parent);
  }

  function openPrompt(nextPrompt: { key: FieldKey; label: string; mask?: string; initialValue?: string }) {
    setRestoreIndexes((old) => ({ ...old, [screen]: activeIndexes[screen] ?? old[screen] ?? 0 }));
    setPrompt(nextPrompt);
  }

  function updateLoginDraft(key: FieldKey, value: string) {
    setLoginDraft((old) => ({ ...old, [key]: value }));
  }

  function openLoginScreen(nextScreen: LoginScreen) {
    setLoginDraft({ userId: fields.userId || currentUser?.id || "default" });
    navigate(nextScreen);
  }

  function clearLoginDraft(userId = fields.userId || currentUser?.id || "default") {
    setLoginDraft({ userId });
  }

  async function runTask(label: string, task: () => Promise<unknown>) {
    setBusy(true);
    setMessage(`${label}执行中...`);
    setScreen("message");
    try {
      const result = await task();
      const text = formatTaskResult(result);
      setMessage(text ? `${label}完成\n${text}` : `${label}完成`);
      await reloadConfig();
    } catch (error) {
      setMessage(`${label}失败\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDirectLogin() {
    const userId = loginDraft.userId || "default";
    if (!loginDraft.loginName || !loginDraft.sesId) {
      setMessage("LOGIN_NAME 和 SES_ID 都必须填写。");
      setScreen("message");
      return;
    }
    await repo.upsertUser({ id: userId, loginName: loginDraft.loginName, userId: loginDraft.loginName, sesId: loginDraft.sesId });
    await reloadConfig();
    updateField("userId", userId);
    clearLoginDraft(userId);
    setMessage(`已保存直接登录用户: ${userId}`);
    setScreen("message");
  }

  async function updateExchangeConfig(key: "exchangeId" | "startAt" | "concurrency" | "intervalMs" | "intervalMaxMs" | "maxAttempts" | "requestTimeoutMs", value: string) {
    if (!config) return;
    const numericKeys = new Set(["concurrency", "intervalMs", "intervalMaxMs", "maxAttempts", "requestTimeoutMs"]);
    let parsed: string | number = value;
    if (numericKeys.has(key)) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < 0 || !Number.isInteger(numberValue)) {
        setMessage(`${key} 必须是非负整数。`);
        setScreen("message");
        return;
      }
      if ((key === "concurrency" || key === "maxAttempts" || key === "requestTimeoutMs") && numberValue <= 0) {
        setMessage(`${key} 必须大于 0。`);
        setScreen("message");
        return;
      }
      if (key === "intervalMaxMs" && numberValue < config.exchange.intervalMs) {
        setMessage("兑换间隔上限必须大于或等于间隔下限。");
        setScreen("message");
        return;
      }
      if (key === "intervalMs" && config.exchange.intervalMaxMs !== undefined && numberValue > config.exchange.intervalMaxMs) {
        setMessage("兑换间隔下限不能大于间隔上限。");
        setScreen("message");
        return;
      }
      parsed = numberValue;
    }
    const nextConfig = {
      ...config,
      exchange: {
        ...config.exchange,
        [key]: parsed
      }
    };
    await repo.save(nextConfig);
    setConfig(nextConfig);
    if (key === "exchangeId") navigateBack();
  }

  async function updateNotificationConfig(providerId: NotificationProviderId, key: string, value: boolean | string) {
    if (!config) return;
    const provider = getNotificationProvider(providerId);
    if (!provider) return;
    const providerConfig = config.notifications[providerId];
    if (key === "enabled" && value === true) {
      const validationMessage = provider.validate(providerConfig);
      if (validationMessage) {
        setMessage(validationMessage);
        setScreen("message");
        return;
      }
    }
    const nextConfig = {
      ...config,
      notifications: {
        ...config.notifications,
        [providerId]: {
          ...providerConfig,
          [key]: value
        }
      }
    };
    if (key !== "enabled") {
      nextConfig.notifications[providerId].enabled = false;
    }
    await repo.save(nextConfig);
    setConfig(nextConfig);
  }

  function openNotificationProvider(providerId: NotificationProviderId) {
    setSelectedNotificationProviderId(providerId);
    navigate("notificationProvider");
  }

  function openNotificationPrompt(providerId: NotificationProviderId, fieldKey: string, label: string, secret?: boolean, initialValue?: string) {
    openPrompt({ key: `notification:${providerId}:${fieldKey}`, label, mask: secret ? "*" : undefined, initialValue });
  }

  function parseNotificationPromptKey(key: FieldKey): { providerId: NotificationProviderId; fieldKey: string } | undefined {
    if (!key.startsWith("notification:")) return undefined;
    const [, providerId, fieldKey] = key.split(":");
    if (!getNotificationProvider(providerId) || !fieldKey) return undefined;
    return { providerId: providerId as NotificationProviderId, fieldKey };
  }

  async function saveConfig(nextConfig: AppConfig) {
    await repo.save(nextConfig);
    setConfig(nextConfig);
  }

  async function updateScheduleConfig(updater: (config: AppConfig) => AppConfig) {
    if (!config) return;
    await saveConfig(updater(config));
  }

  async function updateScheduleUserConfig(userId: string, updater: (user: UserConfig) => UserConfig) {
    if (!config) return;
    const user = config.users.find((item) => item.id === userId);
    if (!user) return;
    const updatedUser = updater(user);
    const nextUsers = config.users.map((item) => item.id === userId ? updatedUser : item);
    await saveConfig({ ...config, users: nextUsers });
  }

  async function updateScheduleDailyValue(key: "time" | "delayMs", value: string) {
    if (!config) return;
    const normalizedTime = key === "time" ? normalizeScheduleTime(value) : value;
    if (key === "time" && !normalizedTime) return;
    const parsed = key === "delayMs" ? parseNonNegativeInteger(value) : normalizedTime;
    if (parsed === undefined) return;
    await updateScheduleConfig((old) => ({
      ...old,
      schedule: {
        ...old.schedule,
        daily: {
          ...old.schedule.daily,
          [key]: parsed
        }
      }
    }));
  }

  async function updateScheduleDailyCommentContent(value: string) {
    const content = value.trim();
    if (!content) {
      setMessage("每日任务留言内容不能为空。");
      setScreen("message");
      return;
    }
    await updateScheduleConfig((old) => ({
      ...old,
      schedule: {
        ...old.schedule,
        daily: {
          ...old.schedule.daily,
          commentContent: content
        }
      }
    }));
  }

  function normalizeScheduleTime(value: string): string | undefined {
    const trimmed = value.trim();
    const short = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (short) {
      const hour = Number(short[1]);
      const minute = Number(short[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    }
    const full = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(trimmed);
    if (full) {
      const hour = Number(full[1]);
      const minute = Number(full[2]);
      const second = Number(full[3]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
      }
    }
    setMessage("每日任务固定时间格式应为 HH:mm:ss，例如 08:30:00。");
    setScreen("message");
    return undefined;
  }

  async function updateScheduleDailyHour(key: "rangeStartHour" | "rangeEndHour", value: string) {
    if (!config) return;
    const hour = Number(value);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
    const nextStart = key === "rangeStartHour" ? hour : config.schedule.daily.rangeStartHour;
    const nextEnd = key === "rangeEndHour" ? hour : config.schedule.daily.rangeEndHour;
    if (nextEnd <= nextStart) {
      setMessage("时间区间无效：结束小时必须晚于开始小时。");
      setScreen("message");
      return;
    }
    await updateScheduleConfig((old) => {
      const daily = { ...old.schedule.daily, [key]: hour };
      return { ...old, schedule: { ...old.schedule, daily } };
    });
    navigateBack();
  }

  async function updateScheduleExchangeValue(key: "concurrency" | "intervalMs" | "intervalMaxMs" | "maxAttempts" | "requestTimeoutMs", value: string) {
    const parsed = parseNonNegativeInteger(value);
    if (parsed === undefined) return;
    if ((key === "concurrency" || key === "maxAttempts" || key === "requestTimeoutMs") && parsed <= 0) {
      setMessage(`${key === "concurrency" ? "最大并发数" : key === "maxAttempts" ? "最大尝试次数" : "请求超时"}必须大于 0。`);
      setScreen("message");
      return;
    }
    if (key === "intervalMaxMs" && parsed < (config?.schedule.exchange.intervalMs ?? 0)) {
      setMessage("定时兑换间隔上限必须大于或等于间隔下限。");
      setScreen("message");
      return;
    }
    if (key === "intervalMs" && config?.schedule.exchange.intervalMaxMs !== undefined && parsed > config.schedule.exchange.intervalMaxMs) {
      setMessage("定时兑换间隔下限不能大于间隔上限。");
      setScreen("message");
      return;
    }
    await updateScheduleConfig((old) => ({
      ...old,
      schedule: {
        ...old.schedule,
        exchange: {
          ...old.schedule.exchange,
          [key]: parsed
        }
      }
    }));
  }

  function parseNonNegativeInteger(value: string): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      setMessage("请输入非负整数。");
      setScreen("message");
      return undefined;
    }
    return parsed;
  }

  function toggleScheduleUser(userId: string) {
    if (!config) return;
    const selected = new Set(config.schedule.users);
    if (selected.has(userId)) selected.delete(userId);
    else selected.add(userId);
    void updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, users: [...selected] } }));
  }

  function toggleScheduleExchangeTime(time: string) {
    if (!config) return;
    const selected = new Set(config.schedule.exchange.times);
    if (selected.has(time)) selected.delete(time);
    else selected.add(time);
    void updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, exchange: { ...old.schedule.exchange, times: [...selected] } } }));
  }

  function updateScheduleExchangeWeekdays(weekdays: number[]) {
    if (!config) return;
    void updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, exchange: { ...old.schedule.exchange, weekdays } } }));
  }

  async function startScheduleRunner() {
    if (!config) return;
    await runTask("定时任务", async () => {
      await new ScheduleService({
        config,
        stateRepo,
        logger: withScheduleLogTimestamp((line) => setMessage((old) => `${old}\n${line}`))
      }).runForever();
      return "定时任务已结束。";
    });
  }

  async function runPm2Task(label: string, task: () => Promise<string>) {
    await runTask(label, task);
  }

  async function testNotification(providerId: NotificationProviderId) {
    if (!config) return;
    const provider = getNotificationProvider(providerId);
    if (!provider) return;
    const providerConfig = config.notifications[providerId];
    const validationMessage = provider.validate(providerConfig);
    if (validationMessage) {
      setMessage(validationMessage.replace("再启用通知", "再发送测试消息"));
      setScreen("message");
      return;
    }
    setBusy(true);
    setMessage(`${provider.name}测试消息发送中...`);
    setScreen("message");
    try {
      const ok = await provider.create({ ...providerConfig, enabled: true }).notify(`AutoTicket ${provider.name}通知测试\n时间: ${new Date().toLocaleString()}`);
      setMessage(ok ? `${provider.name}测试消息发送成功。` : `${provider.name}测试消息发送失败，请检查配置或网络。`);
    } catch (error) {
      setMessage(`${provider.name}测试消息发送失败\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function queryCurrentUserStatus() {
    if (!currentUser) {
      setMessage("请先登录或选择用户。");
      setScreen("message");
      return;
    }
    await runTask("用户状态查询", async () => withClient(async (client) => {
      const result = await new AuthService(client).queryUserInfo(currentUser.loginName, currentUser.sesId);
      return {
        user: {
          id: redactText(currentUser.id),
          name: currentUser.name ? redactText(currentUser.name) : currentUser.name,
          loginName: redactText(currentUser.loginName),
          hasSession: Boolean(currentUser.sesId)
        },
        status: redactSensitive(result.data ?? result.envelope)
      };
    }));
  }

  async function refreshCurrentIntegral() {
    if (!currentUser) {
      setCurrentIntegral("未配置");
      return;
    }
    setCurrentIntegral("查询中...");
    try {
      const result = await withClient((client) => new AuthService(client).queryUserInfo(currentUser.loginName, currentUser.sesId));
      const data = result.data ?? result.envelope;
      const value = data.remain_integral ?? data.total_integral;
      setCurrentIntegral(value === undefined || value === null || value === "" ? "未返回" : String(value));
    } catch {
      setCurrentIntegral("查询失败");
    }
  }

  async function showTaskState(kind: "status" | "log", scope: "all" | "current") {
    const state = await stateRepo.load();
    const date = todayKey();
    const users = scope === "current" && currentUser ? [currentUser] : config?.users ?? [];
    const userIds = new Set(users.map((user) => user.id));
    const runs = state.runs.filter((run) => run.date === date && userIds.has(run.userId));
    const summary = summarizeTaskRuns(runs);
    setMessage(kind === "status" ? formatTaskStatusSummary(users, summary, date, { exchangeDefaults: config?.exchange }) : formatTaskExecutionLog(users, summary, date));
    setScreen("message");
  }

  async function openTaskRun(screenId: "daily" | "exchange") {
    if (!currentUser) {
      setMessage("请先登录或选择用户。");
      setScreen("message");
      return;
    }
    const existingRun = await stateRepo.hasRunToday(currentUser.id, screenId);
    if (existingRun) {
      setMessage(`${screenId === "daily" ? "每日任务" : "优惠券兑换"}今天已经执行过：${formatRunState(existingRun)}`);
      navigate(screenId === "daily" ? "confirmDaily" : "confirmExchange");
      return;
    }
    navigate(screenId);
  }

  async function saveLoginResult(userId: string, data: LoginResponse | undefined) {
    if (!data || data.result !== "0") throw new Error("登录未成功，未写入配置。");
    const loginName = data.login_name ?? data.user_id;
    const sesId = data.ses_id;
    if (!loginName || !sesId) throw new Error("登录响应缺少 login_name 或 ses_id。");
    await repo.upsertUser({ id: userId, loginName, userId: data.user_id ?? loginName, sesId, name: data.name });
  }

  if (!config) {
    return (
      <Frame title="AutoTicket 控制台">
        <Text color="cyan"><Spinner type="dots" /> 正在加载配置...</Text>
      </Frame>
    );
  }

  if (prompt) {
    return (
      <Frame title="AutoTicket 输入" footer="Enter 确认 / Esc 返回">
        <TextPrompt
          key={`${prompt.key}:${prompt.initialValue ?? ""}`}
          label={prompt.label}
          mask={prompt.mask}
          initialValue={prompt.initialValue}
          onCancel={() => setPrompt(undefined)}
          onSubmit={(value) => {
            const notificationPrompt = parseNotificationPromptKey(prompt.key);
            const notificationField = notificationPrompt ? getNotificationProvider(notificationPrompt.providerId)?.fields.find((field) => field.key === notificationPrompt.fieldKey) : undefined;
            if (value.trim() === "" && notificationField?.key !== "tags") {
              setMessage(`${prompt.label}不能为空。`);
              setPrompt(undefined);
              setScreen("message");
              return;
            }
            if (screen === "direct" || screen === "sms" || screen === "password") {
              updateLoginDraft(prompt.key, value);
            } else {
              if (["concurrency", "intervalMs", "intervalMaxMs", "maxAttempts", "requestTimeoutMs"].includes(prompt.key)) {
                void updateExchangeConfig(prompt.key as "concurrency" | "intervalMs" | "intervalMaxMs" | "maxAttempts" | "requestTimeoutMs", value);
              } else if (notificationPrompt) {
                void updateNotificationConfig(notificationPrompt.providerId, notificationPrompt.fieldKey, value);
              } else if (prompt.key === "scheduleDailyTime") {
                void updateScheduleDailyValue("time", value);
              } else if (prompt.key === "scheduleDailyDelayMs") {
                void updateScheduleDailyValue("delayMs", value);
              } else if (prompt.key === "scheduleDailyCommentContent") {
                void updateScheduleDailyCommentContent(value);
              } else if (prompt.key === "scheduleExchangeConcurrency") {
                void updateScheduleExchangeValue("concurrency", value);
              } else if (prompt.key === "scheduleExchangeIntervalMs") {
                void updateScheduleExchangeValue("intervalMs", value);
              } else if (prompt.key === "scheduleExchangeIntervalMaxMs") {
                void updateScheduleExchangeValue("intervalMaxMs", value);
              } else if (prompt.key === "scheduleExchangeMaxAttempts") {
                void updateScheduleExchangeValue("maxAttempts", value);
              } else if (prompt.key === "scheduleExchangeRequestTimeoutMs") {
                void updateScheduleExchangeValue("requestTimeoutMs", value);
              } else {
                updateField(prompt.key, value);
              }
            }
            setPrompt(undefined);
          }}
        />
      </Frame>
    );
  }

  return (
    <Frame title="AutoTicket 控制台" subtitle={`配置: ${DEFAULT_CONFIG_PATH}`} footer="↑/↓ 选择  Enter 确认  Esc 返回  Ctrl+C 退出">
      <Header config={config} currentUser={currentUser} currentIntegral={currentIntegral} />
      {screen === "home" && <Home initialIndex={initialIndex("home")} onHighlight={(index) => setActiveIndex("home", index)} navigate={navigate} openTaskRun={(screenId) => void openTaskRun(screenId)} exit={exit} />}
      {screen === "login" && <LoginMenu initialIndex={initialIndex("login")} onHighlight={(index) => setActiveIndex("login", index)} openLoginScreen={openLoginScreen} navigateBack={navigateBack} />}
      {screen === "direct" && <DirectLogin initialIndex={initialIndex("direct")} onHighlight={(index) => setActiveIndex("direct", index)} fields={loginDraft} setPrompt={openPrompt} onSave={() => void saveDirectLogin()} navigateBack={navigateBack} />}
      {screen === "sms" && <SmsLogin initialIndex={initialIndex("sms")} onHighlight={(index) => setActiveIndex("sms", index)} fields={loginDraft} setPrompt={openPrompt} runTask={runTask} saveLoginResult={saveLoginResult} navigateBack={navigateBack} clearLoginDraft={clearLoginDraft} updateField={updateField} />}
      {screen === "password" && <PasswordLogin initialIndex={initialIndex("password")} onHighlight={(index) => setActiveIndex("password", index)} fields={loginDraft} setPrompt={openPrompt} runTask={runTask} saveLoginResult={saveLoginResult} navigateBack={navigateBack} clearLoginDraft={clearLoginDraft} updateField={updateField} />}
      {screen === "users" && <Users initialIndex={initialIndex("users", currentUser ? Math.max(0, config.users.findIndex((user) => user.id === currentUser.id)) : 0)} onHighlight={(index) => setActiveIndex("users", index)} users={config.users} currentUser={currentUser} updateField={updateField} navigateBack={navigateBack} />}
      {screen === "status" && <UserStatus initialIndex={initialIndex("status")} onHighlight={(index) => setActiveIndex("status", index)} currentUser={currentUser} queryCurrentUserStatus={() => void queryCurrentUserStatus()} navigateBack={navigateBack} />}
      {screen === "state" && <TaskStateView initialIndex={initialIndex("state")} onHighlight={(index) => setActiveIndex("state", index)} showTaskState={(kind) => void showTaskState(kind, "all")} navigateBack={navigateBack} />}
      {screen === "daily" && <Daily initialIndex={initialIndex("daily")} onHighlight={(index) => setActiveIndex("daily", index)} currentUser={currentUser} config={config} runTask={runTask} updateMessage={setMessage} navigateBack={navigateBack} />}
      {screen === "exchange" && <Exchange initialIndex={initialIndex("exchange")} onHighlight={(index) => setActiveIndex("exchange", index)} currentUser={currentUser} config={config} runTask={runTask} navigateBack={navigateBack} />}
      {screen === "confirmDaily" && <ConfirmRun initialIndex={initialIndex("confirmDaily")} onHighlight={(index) => setActiveIndex("confirmDaily", index)} message={message} onConfirm={() => navigate("daily")} navigateBack={navigateBack} />}
      {screen === "confirmExchange" && <ConfirmRun initialIndex={initialIndex("confirmExchange")} onHighlight={(index) => setActiveIndex("confirmExchange", index)} message={message} onConfirm={() => navigate("exchange")} navigateBack={navigateBack} />}
      {screen === "settings" && <ExchangeSettings initialIndex={initialIndex("settings")} onHighlight={(index) => setActiveIndex("settings", index)} config={config} setPrompt={openPrompt} navigate={navigate} navigateBack={navigateBack} />}
      {screen === "amount" && <ExchangeAmount initialIndex={initialIndex("amount", Math.max(0, EXCHANGE_AMOUNT_OPTIONS.findIndex((option) => option.id === config.exchange.exchangeId)))} onHighlight={(index) => setActiveIndex("amount", index)} exchangeId={config.exchange.exchangeId} updateExchangeConfig={(value) => void updateExchangeConfig("exchangeId", value)} navigateBack={navigateBack} />}
      {screen === "startTime" && <ExchangeStartTime initialIndex={initialIndex("startTime", Math.max(0, EXCHANGE_START_TIME_OPTIONS.findIndex((option) => normalizeTimeToSecond(option.value) === normalizeTimeToSecond(config.exchange.startAt))))} onHighlight={(index) => setActiveIndex("startTime", index)} startAt={config.exchange.startAt} updateExchangeConfig={(value) => void updateExchangeConfig("startAt", value)} navigateBack={navigateBack} />}
      {screen === "schedule" && <ScheduleSettings initialIndex={initialIndex("schedule")} onHighlight={(index) => setActiveIndex("schedule", index)} config={config} setPrompt={openPrompt} navigate={navigate} updateScheduleConfig={(updater) => void updateScheduleConfig(updater)} startScheduleRunner={() => void startScheduleRunner()} runPm2Task={(label, task) => void runPm2Task(label, task)} navigateBack={navigateBack} />}
      {screen === "scheduleUsers" && <ScheduleUsers initialIndex={initialIndex("scheduleUsers")} onHighlight={(index) => setActiveIndex("scheduleUsers", index)} config={config} toggleUser={toggleScheduleUser} updateScheduleConfig={(updater) => void updateScheduleConfig(updater)} navigate={navigate} navigateBack={navigateBack} />}
      {screen === "scheduleUserList" && <ScheduleUserList initialIndex={initialIndex("scheduleUserList")} onHighlight={(index) => setActiveIndex("scheduleUserList", index)} config={config} selectUser={(userId) => { setSelectedScheduleUserId(userId); navigate("scheduleUserSettings"); }} navigateBack={navigateBack} />}
      {screen === "scheduleUserSettings" && <ScheduleUserSettings initialIndex={initialIndex("scheduleUserSettings")} onHighlight={(index) => setActiveIndex("scheduleUserSettings", index)} config={config} userId={selectedScheduleUserId} navigate={navigate} updateScheduleUserConfig={(updater) => void updateScheduleUserConfig(selectedScheduleUserId, updater)} navigateBack={navigateBack} />}
      {screen === "scheduleUserExchangeAmount" && <ScheduleUserExchangeAmount initialIndex={initialIndex("scheduleUserExchangeAmount", Math.max(0, EXCHANGE_AMOUNT_OPTIONS.findIndex((option) => option.id === ((config.users.find((u) => u.id === selectedScheduleUserId)?.schedule?.exchange?.exchangeId) ?? config.exchange.exchangeId))))} onHighlight={(index) => setActiveIndex("scheduleUserExchangeAmount", index)} config={config} userId={selectedScheduleUserId} updateScheduleUserConfig={(updater) => void updateScheduleUserConfig(selectedScheduleUserId, updater)} navigateBack={navigateBack} />}
      {screen === "scheduleUserExchangeWeekdays" && <ScheduleUserExchangeWeekdays initialIndex={initialIndex("scheduleUserExchangeWeekdays")} onHighlight={(index) => setActiveIndex("scheduleUserExchangeWeekdays", index)} config={config} userId={selectedScheduleUserId} updateScheduleUserConfig={(updater) => void updateScheduleUserConfig(selectedScheduleUserId, updater)} navigateBack={navigateBack} />}
      {screen === "scheduleDaily" && <ScheduleDailySettings initialIndex={initialIndex("scheduleDaily")} onHighlight={(index) => setActiveIndex("scheduleDaily", index)} config={config} setPrompt={openPrompt} navigate={navigate} updateScheduleConfig={(updater) => void updateScheduleConfig(updater)} navigateBack={navigateBack} />}
      {screen === "scheduleDailyTime" && <ScheduleDailyTime initialIndex={initialIndex("scheduleDailyTime")} onHighlight={(index) => setActiveIndex("scheduleDailyTime", index)} time={config.schedule.daily.time} setPrompt={openPrompt} navigateBack={navigateBack} />}
      {screen === "scheduleDailyRangeStart" && <ScheduleHourSelect initialIndex={initialIndex("scheduleDailyRangeStart", config.schedule.daily.rangeStartHour)} onHighlight={(index) => setActiveIndex("scheduleDailyRangeStart", index)} title="开始小时" currentHour={config.schedule.daily.rangeStartHour} updateHour={(value) => void updateScheduleDailyHour("rangeStartHour", value)} navigateBack={navigateBack} />}
      {screen === "scheduleDailyRangeEnd" && <ScheduleHourSelect initialIndex={initialIndex("scheduleDailyRangeEnd", config.schedule.daily.rangeEndHour)} onHighlight={(index) => setActiveIndex("scheduleDailyRangeEnd", index)} title="结束小时" currentHour={config.schedule.daily.rangeEndHour} updateHour={(value) => void updateScheduleDailyHour("rangeEndHour", value)} navigateBack={navigateBack} />}
      {screen === "scheduleExchange" && <ScheduleExchangeSettings initialIndex={initialIndex("scheduleExchange")} onHighlight={(index) => setActiveIndex("scheduleExchange", index)} config={config} setPrompt={openPrompt} navigate={navigate} updateScheduleConfig={(updater) => void updateScheduleConfig(updater)} navigateBack={navigateBack} />}
      {screen === "scheduleExchangeTimes" && <ScheduleExchangeTimes initialIndex={initialIndex("scheduleExchangeTimes")} onHighlight={(index) => setActiveIndex("scheduleExchangeTimes", index)} config={config} toggleTime={toggleScheduleExchangeTime} navigateBack={navigateBack} />}
      {screen === "scheduleExchangeWeekdays" && <ScheduleExchangeWeekdays initialIndex={initialIndex("scheduleExchangeWeekdays")} onHighlight={(index) => setActiveIndex("scheduleExchangeWeekdays", index)} config={config} setWeekdays={(weekdays) => void updateScheduleExchangeWeekdays(weekdays)} navigateBack={navigateBack} />}
      {screen === "notifications" && <NotificationList initialIndex={initialIndex("notifications")} onHighlight={(index) => setActiveIndex("notifications", index)} config={config} openProvider={openNotificationProvider} navigateBack={navigateBack} />}
      {screen === "notificationProvider" && <NotificationSettings initialIndex={initialIndex("notificationProvider")} onHighlight={(index) => setActiveIndex("notificationProvider", index)} config={config} providerId={selectedNotificationProviderId} setPrompt={openNotificationPrompt} updateNotificationConfig={(key, value) => void updateNotificationConfig(selectedNotificationProviderId, key, value)} testNotification={() => void testNotification(selectedNotificationProviderId)} navigateBack={navigateBack} />}
      {screen === "web" && <WebUi initialIndex={initialIndex("web")} onHighlight={(index) => setActiveIndex("web", index)} runTask={runTask} navigateBack={navigateBack} />}
      {screen === "summary" && <Summary config={config} />}
      {screen === "message" && <Box flexDirection="column" marginTop={1}>{busy ? <Text color="cyan"><Spinner type="dots" /> {message}</Text> : <><Text>{message}</Text><Text color="gray">Enter 返回主菜单 / Esc 返回</Text></>}</Box>}
    </Frame>
  );
}

function Header({ config, currentUser, currentIntegral }: { config: AppConfig; currentUser?: UserConfig; currentIntegral: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <InfoRow label="当前用户" value={currentUser ? `${redactText(currentUser.id)}${currentUser.name ? ` / ${redactText(currentUser.name)}` : ""}` : "未配置"} color={currentUser ? "green" : "yellow"} />
      <InfoRow label="会话状态" value={currentUser?.sesId ? "已保存" : "未保存"} color={currentUser?.sesId ? "green" : "yellow"} />
      <InfoRow label="当前积分" value={currentIntegral} color={currentIntegral === "查询失败" ? "yellow" : "cyan"} />
      <InfoRow label="兑换配置" value={`面额=${formatExchangeAmount(config.exchange.exchangeId)} 时间=${formatExchangeStartTime(config.exchange.startAt)} 并发=${config.exchange.concurrency} 间隔=${formatIntervalRange(config.exchange.intervalMs, config.exchange.intervalMaxMs)} 最大=${config.exchange.maxAttempts}`} />
      <InfoRow label="定时任务" value={formatScheduleHeader(config)} color={config.schedule.enabled ? "green" : "gray"} />
      <InfoRow label="消息通知" value={formatNotificationHeader(config)} color={hasEnabledNotification(config) ? "green" : "gray"} />
    </Box>
  );
}

type MenuNavProps = {
  initialIndex: number;
  onHighlight: (index: number) => void;
};

function Home({ initialIndex, onHighlight, navigate, openTaskRun, exit }: MenuNavProps & { navigate: (screen: Screen) => void; openTaskRun: (screen: "daily" | "exchange") => void; exit: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[
    { label: "账号", value: "__account", disabled: true },
    { label: "  登录 / 更新会话", value: "login" },
    { label: "  用户管理", value: "users" },
    { label: "当前用户", value: "__current", disabled: true },
    { label: "  状态 / 积分", value: "status" },
    { label: "  执行每日任务", value: "daily" },
    { label: "  优惠券兑换", value: "exchange" },
    { label: "全局", value: "__global", disabled: true },
    { label: "  查看任务状态", value: "state" },
    { label: "  兑换参数设置", value: "settings" },
    { label: "  定时任务设置", value: "schedule" },
    { label: "  消息通知设置", value: "notifications" },
    { label: "  打开 WebUI", value: "web" },
    { label: "  查看配置摘要", value: "summary" },
    { label: "退出", value: "exit" }
  ]} onSelect={(item) => item.value === "exit" ? exit() : item.value === "daily" || item.value === "exchange" ? openTaskRun(item.value) : navigate(item.value as Screen)} />;
}

function LoginMenu({ initialIndex, onHighlight, openLoginScreen, navigateBack }: MenuNavProps & { openLoginScreen: (screen: LoginScreen) => void; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: "LOGIN_NAME + SES_ID 直接登录", value: "direct" }, { label: "短信验证码登录", value: "sms" }, { label: "密码 + 图形验证码登录", value: "password" }, { label: "返回", value: "home" }]} onSelect={(item) => item.value === "home" ? navigateBack() : openLoginScreen(item.value as LoginScreen)} />;
}

function DirectLogin({ initialIndex, onHighlight, fields, setPrompt, onSave, navigateBack }: ScreenProps & MenuNavProps & { fields: Record<string, string>; onSave: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: `用户 ID: ${redactText(fields.userId ?? "default")}`, value: "userId" }, { label: `LOGIN_NAME: ${fields.loginName ? redactText(fields.loginName) : "未填写"}`, value: "loginName" }, { label: `SES_ID: ${fields.sesId ? "已填写" : "未填写"}`, value: "sesId" }, { label: "保存为登录用户", value: "save" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "save" ? onSave() : item.value === "back" ? navigateBack() : setPrompt({ key: item.value as FieldKey, label: item.label })} />;
}

type ScreenProps = { setPrompt: (prompt: { key: FieldKey; label: string; mask?: string; initialValue?: string }) => void; navigateBack: () => void };

function SmsLogin({ initialIndex, onHighlight, fields, setPrompt, runTask, saveLoginResult, navigateBack, clearLoginDraft, updateField }: ScreenProps & MenuNavProps & LoginTaskProps) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: `用户 ID: ${redactText(fields.userId ?? "default")}`, value: "userId" }, { label: `手机号: ${fields.phone ? redactText(fields.phone) : "未填写"}`, value: "phone" }, { label: `图形验证码编号: ${fields.imgUniCode ?? "未填写"}`, value: "imgUniCode" }, { label: `图形验证码: ${fields.captcha ?? "未填写"}`, value: "captcha" }, { label: `短信验证码: ${fields.smsCode ?? "未填写"}`, value: "smsCode" }, { label: "发送短信验证码", value: "sendSms" }, { label: "短信登录并保存", value: "login" }, { label: "返回", value: "back" }]} onSelect={(item) => handleSms(item.value, fields, setPrompt, runTask, saveLoginResult, navigateBack, clearLoginDraft, updateField)} />;
}

function PasswordLogin({ initialIndex, onHighlight, fields, setPrompt, runTask, saveLoginResult, navigateBack, clearLoginDraft, updateField }: ScreenProps & MenuNavProps & LoginTaskProps) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: `用户 ID: ${redactText(fields.userId ?? "default")}`, value: "userId" }, { label: `手机号: ${fields.phone ? redactText(fields.phone) : "未填写"}`, value: "phone" }, { label: `密码: ${fields.password ? "已填写" : "未填写"}`, value: "password" }, { label: `图形验证码编号: ${fields.imgUniCode ?? "未填写"}`, value: "imgUniCode" }, { label: `图形验证码: ${fields.captcha ?? "未填写"}`, value: "captcha" }, { label: "密码登录并保存", value: "login" }, { label: "返回", value: "back" }]} onSelect={(item) => handlePassword(item.value, fields, setPrompt, runTask, saveLoginResult, navigateBack, clearLoginDraft, updateField)} />;
}

type LoginTaskProps = {
  fields: Record<string, string>;
  runTask: (label: string, task: () => Promise<unknown>) => void;
  saveLoginResult: (userId: string, data: LoginResponse | undefined) => Promise<void>;
  clearLoginDraft: (userId?: string) => void;
  updateField: (key: FieldKey, value: string) => void;
};

function handleSms(value: string, fields: Record<string, string>, setPrompt: ScreenProps["setPrompt"], runTask: LoginTaskProps["runTask"], saveLoginResult: LoginTaskProps["saveLoginResult"], navigateBack: () => void, clearLoginDraft: LoginTaskProps["clearLoginDraft"], updateField: LoginTaskProps["updateField"]) {
  if (["userId", "phone", "imgUniCode", "captcha", "smsCode"].includes(value)) setPrompt({ key: value as FieldKey, label: value });
  else if (value === "back") navigateBack();
  else if (value === "sendSms") runTask("发送短信", async () => withClient((client) => new AuthService(client).sendSms({ imgUniCode: fields.imgUniCode }, fields.phone, fields.captcha)));
  else if (value === "login") runTask("短信登录", async () => withClient(async (client) => {
    const result = await new AuthService(client).loginBySms(fields.phone, fields.smsCode);
    const userId = fields.userId ?? "default";
    await saveLoginResult(userId, result.data);
    updateField("userId", userId);
    clearLoginDraft(userId);
    return result;
  }));
}

function handlePassword(value: string, fields: Record<string, string>, setPrompt: ScreenProps["setPrompt"], runTask: LoginTaskProps["runTask"], saveLoginResult: LoginTaskProps["saveLoginResult"], navigateBack: () => void, clearLoginDraft: LoginTaskProps["clearLoginDraft"], updateField: LoginTaskProps["updateField"]) {
  if (["userId", "phone", "password", "imgUniCode", "captcha"].includes(value)) setPrompt({ key: value as FieldKey, label: value, mask: value === "password" ? "*" : undefined });
  else if (value === "back") navigateBack();
  else if (value === "login") runTask("密码登录", async () => withClient(async (client) => {
    const result = await new AuthService(client).loginByPassword({ imgUniCode: fields.imgUniCode }, fields.phone, fields.password, fields.captcha);
    const userId = fields.userId ?? "default";
    await saveLoginResult(userId, result.data);
    updateField("userId", userId);
    clearLoginDraft(userId);
    return result;
  }));
}

function Users({ initialIndex, onHighlight, users, currentUser, updateField, navigateBack }: MenuNavProps & { users: UserConfig[]; currentUser?: UserConfig; updateField: (key: FieldKey, value: string) => void; navigateBack: () => void }) {
  const items = users.length ? users.map((user) => ({ label: `${redactText(user.id)}${user.name ? ` / ${redactText(user.name)}` : ""}  ${redactText(user.loginName)}${currentUser?.id === user.id ? "  当前" : ""}`, value: user.id })) : [{ label: "暂无用户，请先登录", value: "__none" }];
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "返回", value: "__back" }]} onSelect={(item) => { if (item.value === "__back") navigateBack(); else if (item.value !== "__none") { updateField("userId", item.value); navigateBack(); } }} />;
}

function UserStatus({ initialIndex, onHighlight, currentUser, queryCurrentUserStatus, navigateBack }: MenuNavProps & { currentUser?: UserConfig; queryCurrentUserStatus: () => void; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: currentUser ? `查询状态 / 积分: ${currentUser.id}` : "未选择用户", value: "query" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : currentUser ? queryCurrentUserStatus() : undefined} />;
}

function TaskStateView({ initialIndex, onHighlight, showTaskState, navigateBack }: MenuNavProps & { showTaskState: (kind: "status" | "log") => void; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: "查看今日执行状态", value: "status" }, { label: "查看今日执行日志", value: "log" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : showTaskState(item.value as "status" | "log")} />;
}

function ConfirmRun({ initialIndex, onHighlight, message, onConfirm, navigateBack }: MenuNavProps & { message: string; onConfirm: () => void; navigateBack: () => void }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">{message}</Text>
      <Menu
        initialIndex={initialIndex}
        onHighlight={onHighlight}
        items={[{ label: "仍然执行", value: "confirm" }, { label: "取消", value: "cancel" }]}
        onSelect={(item) => item.value === "confirm" ? onConfirm() : navigateBack()}
      />
    </Box>
  );
}

function Daily({ initialIndex, onHighlight, currentUser, config, runTask, updateMessage, navigateBack }: MenuNavProps & { currentUser?: UserConfig; config: AppConfig; runTask: LoginTaskProps["runTask"]; updateMessage: (message: string) => void; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: currentUser ? `执行每日任务: ${currentUser.id}` : "未选择用户", value: "run" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : currentUser ? runTask("每日任务", async () => {
    const startedAt = new Date().toISOString();
    try {
      const steps: DailyWorkflowStepResult[] = [];
      const result = await withClient((client) => new TaskService(client).runDailyWorkflow(currentUser, {
        commentContent: config.schedule.daily.commentContent,
        onStep: (step) => {
          steps.push(step);
          updateMessage(`每日任务执行中...\n${formatDailyWorkflowSummary({ success: steps.every((item) => item.success), message: "已完成步骤", steps })}`);
        }
      }));
      const summary = summarizeDailyWorkflow(result);
      await stateRepo.append({ task: "daily", userId: currentUser.id, status: summary.success ? "success" : "failure", startedAt, finishedAt: new Date().toISOString(), message: summary.message, summary: { ...summary, raw: result } });
      await createNotifier(config).notify(`AutoTicket 每日任务完成\n用户: ${currentUser.id}\n${formatDailyWorkflowSummary(summary)}`);
      return formatDailyWorkflowSummary(summary);
    } catch (error) {
      await stateRepo.append({ task: "daily", userId: currentUser.id, status: "failure", startedAt, finishedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }) : undefined} />;
}

function Exchange({ initialIndex, onHighlight, currentUser, config, runTask, navigateBack }: MenuNavProps & { currentUser?: UserConfig; config: AppConfig; runTask: LoginTaskProps["runTask"]; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: currentUser ? `开始兑换: ${currentUser.id}` : "未选择用户", value: "run" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : currentUser ? runTask("优惠券兑换", () => withClient(async (client) => {
    const startedAt = new Date().toISOString();
    try {
      await client.warmup();
      const exchangeMeta = { exchangeId: config.exchange.exchangeId, startAt: config.exchange.startAt, concurrency: config.exchange.concurrency, intervalMs: config.exchange.intervalMs, intervalMaxMs: config.exchange.intervalMaxMs, maxAttempts: config.exchange.maxAttempts, requestTimeoutMs: config.exchange.requestTimeoutMs };
      const result = await new ExchangeScheduler(new ExchangeService(client)).run({ user: currentUser, ...exchangeMeta, stopRules: config.exchange.stopRules });
      const summary = summarizeExchangeRun(result);
      await stateRepo.append({ task: "exchange", userId: currentUser.id, status: summary.success ? "success" : "failure", startedAt, finishedAt: new Date().toISOString(), message: result.final?.msg ?? "未命中停止条件", meta: exchangeMeta, summary: { ...summary, raw: result } });
      await createNotifier(config).notify(`AutoTicket 兑换结束\n用户: ${currentUser.id}\n${formatExchangeRunSummary(summary)}`);
      return formatExchangeRunSummary(summary);
    } catch (error) {
      await stateRepo.append({ task: "exchange", userId: currentUser.id, status: "failure", startedAt, finishedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, config.exchange.requestTimeoutMs)) : undefined} />;
}

function ExchangeSettings({ initialIndex, onHighlight, config, setPrompt, navigate, navigateBack }: ScreenProps & MenuNavProps & { config: AppConfig; navigate: (screen: Screen) => void }) {
  const e = config.exchange;
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: `兑换面额: ${formatExchangeAmount(e.exchangeId)}`, value: "amount" }, { label: `开始时间: ${formatExchangeStartTime(e.startAt)}`, value: "startTime" }, { label: `并发数: ${e.concurrency}`, value: "concurrency" }, { label: `间隔下限 ms: ${e.intervalMs}`, value: "intervalMs" }, { label: `间隔上限 ms: ${e.intervalMaxMs ?? e.intervalMs}`, value: "intervalMaxMs" }, { label: `请求超时 ms: ${e.requestTimeoutMs}`, value: "requestTimeoutMs" }, { label: `最大次数: ${e.maxAttempts}`, value: "maxAttempts" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : item.value === "amount" || item.value === "startTime" ? navigate(item.value as Screen) : setPrompt({ key: item.value as FieldKey, label: item.label })} />;
}

function ExchangeAmount({ initialIndex, onHighlight, exchangeId, updateExchangeConfig, navigateBack }: MenuNavProps & { exchangeId: string; updateExchangeConfig: (exchangeId: string) => void; navigateBack: () => void }) {
  const items = EXCHANGE_AMOUNT_OPTIONS.map((option) => ({ label: `${option.label}${option.id === exchangeId ? "  当前" : ""}`, value: option.id }));
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : updateExchangeConfig(item.value)} />;
}

function ExchangeStartTime({ initialIndex, onHighlight, startAt, updateExchangeConfig, navigateBack }: MenuNavProps & { startAt?: string; updateExchangeConfig: (startAt: string) => void; navigateBack: () => void }) {
  const currentStartAt = startAt ? normalizeTimeToSecond(startAt) : undefined;
  const items = EXCHANGE_START_TIME_OPTIONS.map((option) => ({ label: `${option.label}${normalizeTimeToSecond(option.value) === currentStartAt ? "  当前" : ""}`, value: option.value }));
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : updateExchangeConfig(item.value)} />;
}

function ScheduleSettings({
  initialIndex,
  onHighlight,
  config,
  setPrompt,
  navigate,
  updateScheduleConfig,
  startScheduleRunner,
  runPm2Task,
  navigateBack
}: ScreenProps & MenuNavProps & {
  config: AppConfig;
  navigate: (screen: Screen) => void;
  updateScheduleConfig: (updater: (config: AppConfig) => AppConfig) => void;
  startScheduleRunner: () => void;
  runPm2Task: (label: string, task: () => Promise<string>) => void;
}) {
  const schedule = config.schedule;
  const userLabel = schedule.users.length ? schedule.users.join(",") : "全部用户";
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[
    { label: `总开关: ${formatEnabled(schedule.enabled)}`, value: "toggle" },
    { label: `定时任务用户: ${userLabel}`, value: "users" },
    { label: `每日任务设置: ${formatEnabled(schedule.daily.enabled)} / ${formatDailyScheduleLabel(schedule.daily)}`, value: "daily" },
    { label: `优惠券兑换设置: ${formatEnabled(schedule.exchange.enabled)} / ${formatScheduleTimes(schedule.exchange.times)}`, value: "exchange" },
    { label: "查看明日每日时间", value: "dailyPlan" },
    { label: "前台启动定时执行", value: "start" },
    { label: "后台启动 PM2", value: "pm2Start" },
    { label: "重启后台 PM2", value: "pm2Restart" },
    { label: "查看后台状态", value: "pm2Status" },
    { label: "查看后台日志", value: "pm2Logs" },
    { label: "停止后台 PM2", value: "pm2Stop" },
    { label: "返回", value: "back" }
  ]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "users") navigate("scheduleUsers");
    else if (item.value === "daily") navigate("scheduleDaily");
    else if (item.value === "exchange") navigate("scheduleExchange");
    else if (item.value === "dailyPlan") runPm2Task("查看明日每日时间", async () => {
      const date = tomorrowKey();
      const plan = await new ScheduleService({ config, stateRepo }).previewDailyPlan(date);
      return formatDailySchedulePlan(plan, date);
    });
    else if (item.value === "start") startScheduleRunner();
    else if (item.value === "pm2Start") runPm2Task("后台启动 PM2", async () => formatPm2StatusForTui(await startPm2Schedule({ configPath: DEFAULT_CONFIG_PATH })));
    else if (item.value === "pm2Restart") runPm2Task("重启后台 PM2", async () => formatPm2StatusForTui(await restartPm2Schedule({ configPath: DEFAULT_CONFIG_PATH })));
    else if (item.value === "pm2Status") runPm2Task("查看后台状态", async () => formatPm2StatusForTui(await statusPm2Schedule()));
    else if (item.value === "pm2Logs") runPm2Task("查看后台日志", () => logsPm2Schedule(80));
    else if (item.value === "pm2Stop") runPm2Task("停止后台 PM2", () => stopPm2Schedule());
    else if (item.value === "toggle") updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, enabled: !old.schedule.enabled } }));
  }} />;
}

function ScheduleDailySettings({ initialIndex, onHighlight, config, setPrompt, navigate, updateScheduleConfig, navigateBack }: ScreenProps & MenuNavProps & { config: AppConfig; navigate: (screen: Screen) => void; updateScheduleConfig: (updater: (config: AppConfig) => AppConfig) => void }) {
  const daily = config.schedule.daily;
  const timeItems = daily.mode === "fixed"
    ? [{ label: `固定时间: ${formatCompactTime(daily.time)}`, value: "fixedTime" }]
    : [
        { label: `区间开始: ${formatHour(daily.rangeStartHour)}`, value: "rangeStart" },
        { label: `区间结束: ${formatHour(daily.rangeEndHour)}`, value: "rangeEnd" }
      ];
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[
    { label: `每日任务: ${formatEnabled(daily.enabled)}`, value: "toggle" },
    { label: `执行方式: ${daily.mode === "fixed" ? "固定时间" : "时间区间随机"}`, value: "mode" },
    ...timeItems,
    { label: `留言内容: ${daily.commentContent}`, value: "commentContent" },
    { label: `每日任务间隔 ms: ${daily.delayMs}`, value: "delay" },
    { label: "返回", value: "back" }
  ]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "toggle") updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, daily: { ...old.schedule.daily, enabled: !old.schedule.daily.enabled } } }));
    else if (item.value === "mode") updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, daily: { ...old.schedule.daily, mode: old.schedule.daily.mode === "fixed" ? "range" : "fixed" } } }));
    else if (item.value === "fixedTime") navigate("scheduleDailyTime");
    else if (item.value === "rangeStart") navigate("scheduleDailyRangeStart");
    else if (item.value === "rangeEnd") navigate("scheduleDailyRangeEnd");
    else if (item.value === "commentContent") setPrompt({ key: "scheduleDailyCommentContent", label: "每日任务留言内容", initialValue: daily.commentContent });
    else if (item.value === "delay") setPrompt({ key: "scheduleDailyDelayMs", label: "每日任务间隔 ms", initialValue: String(daily.delayMs) });
  }} />;
}

function ScheduleExchangeSettings({ initialIndex, onHighlight, config, setPrompt, navigate, updateScheduleConfig, navigateBack }: ScreenProps & MenuNavProps & { config: AppConfig; navigate: (screen: Screen) => void; updateScheduleConfig: (updater: (config: AppConfig) => AppConfig) => void }) {
  const exchange = config.schedule.exchange;
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[
    { label: `优惠券兑换: ${formatEnabled(exchange.enabled)}`, value: "toggle" },
    { label: `兑换场次: ${formatScheduleTimes(exchange.times)}`, value: "times" },
    { label: `执行周期: ${formatWeekdays(exchange.weekdays)}`, value: "weekdays" },
    { label: `最大并发数: ${exchange.concurrency}`, value: "concurrency" },
    { label: `间隔下限 ms: ${exchange.intervalMs}`, value: "interval" },
    { label: `间隔上限 ms: ${exchange.intervalMaxMs ?? exchange.intervalMs}`, value: "intervalMax" },
    { label: `请求超时 ms: ${exchange.requestTimeoutMs}`, value: "timeout" },
    { label: `最大尝试次数: ${exchange.maxAttempts}`, value: "maxAttempts" },
    { label: `成功后跳过后续场次: ${exchange.stopAfterSuccess ? "是" : "否"}`, value: "stopAfterSuccess" },
    { label: "返回", value: "back" }
  ]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "toggle") updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, exchange: { ...old.schedule.exchange, enabled: !old.schedule.exchange.enabled } } }));
    else if (item.value === "times") navigate("scheduleExchangeTimes");
    else if (item.value === "weekdays") navigate("scheduleExchangeWeekdays");
    else if (item.value === "concurrency") setPrompt({ key: "scheduleExchangeConcurrency", label: "定时兑换最大并发数", initialValue: String(exchange.concurrency) });
    else if (item.value === "interval") setPrompt({ key: "scheduleExchangeIntervalMs", label: "定时兑换请求间隔下限 ms", initialValue: String(exchange.intervalMs) });
    else if (item.value === "intervalMax") setPrompt({ key: "scheduleExchangeIntervalMaxMs", label: "定时兑换请求间隔上限 ms", initialValue: String(exchange.intervalMaxMs ?? exchange.intervalMs) });
    else if (item.value === "timeout") setPrompt({ key: "scheduleExchangeRequestTimeoutMs", label: "定时兑换请求超时 ms", initialValue: String(exchange.requestTimeoutMs) });
    else if (item.value === "maxAttempts") setPrompt({ key: "scheduleExchangeMaxAttempts", label: "定时兑换最大尝试次数", initialValue: String(exchange.maxAttempts) });
    else if (item.value === "stopAfterSuccess") updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, exchange: { ...old.schedule.exchange, stopAfterSuccess: !old.schedule.exchange.stopAfterSuccess } } }));
  }} />;
}

function ScheduleUsers({ initialIndex, onHighlight, config, toggleUser, updateScheduleConfig, navigate, navigateBack }: MenuNavProps & { config: AppConfig; toggleUser: (userId: string) => void; updateScheduleConfig: (updater: (config: AppConfig) => AppConfig) => void; navigate: (screen: Screen) => void; navigateBack: () => void }) {
  const selected = new Set(config.schedule.users);
  const items = config.users.length ? config.users.map((user) => ({
    label: `${selected.has(user.id) ? "[x]" : "[ ]"} ${redactText(user.id)}${user.name ? ` / ${redactText(user.name)}` : ""}`,
    value: user.id
  })) : [{ label: "暂无用户，请先登录", value: "__none" }];
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: config.schedule.users.length ? "切换为全部用户" : "当前为全部用户", value: "__all" }, { label: "按用户设置定时任务", value: "__perUser" }, ...items, { label: "返回", value: "back" }]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "__all") updateScheduleConfig((old) => ({ ...old, schedule: { ...old.schedule, users: [] } }));
    else if (item.value === "__perUser") navigate("scheduleUserList");
    else if (item.value !== "__none") toggleUser(item.value);
  }} />;
}

function ScheduleUserList({ initialIndex, onHighlight, config, selectUser, navigateBack }: MenuNavProps & { config: AppConfig; selectUser: (userId: string) => void; navigateBack: () => void }) {
  const items = config.users.length ? config.users.map((user) => {
    const dailyEnabled = user.schedule?.daily?.enabled;
    const exchangeEnabled = user.schedule?.exchange?.enabled;
    const hasOverride = dailyEnabled !== undefined || exchangeEnabled !== undefined;
    const status = hasOverride
      ? `[日${dailyEnabled === true ? "开" : dailyEnabled === false ? "关" : "承"} 兑${exchangeEnabled === true ? "开" : exchangeEnabled === false ? "关" : "承"}]`
      : "[继承全局]";
    return {
      label: `${status} ${redactText(user.id)}${user.name ? ` / ${redactText(user.name)}` : ""}`,
      value: user.id
    };
  }) : [{ label: "暂无用户，请先登录", value: "__none" }];
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "返回", value: "back" }]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value !== "__none") selectUser(item.value);
  }} />;
}

function ScheduleUserSettings({ initialIndex, onHighlight, config, userId, navigate, updateScheduleUserConfig, navigateBack }: MenuNavProps & { config: AppConfig; userId: string; navigate: (screen: Screen) => void; updateScheduleUserConfig: (updater: (user: UserConfig) => UserConfig) => void; navigateBack: () => void }) {
  const user = config.users.find((item) => item.id === userId);
  if (!user) return <Text color="red">用户不存在</Text>;
  const dailyEnabled = user.schedule?.daily?.enabled;
  const exchangeEnabled = user.schedule?.exchange?.enabled;
  const exchangeId = user.schedule?.exchange?.exchangeId;
  const globalDailyEnabled = config.schedule.daily.enabled;
  const globalExchangeEnabled = config.schedule.exchange.enabled;
  const globalExchangeId = config.schedule.exchange.exchangeId ?? config.exchange.exchangeId;
  const globalWeekdays = config.schedule.exchange.weekdays;
  const userWeekdays = user.schedule?.exchange?.weekdays;
  const dailyLabel = dailyEnabled === undefined ? `继承全局 (${globalDailyEnabled ? "已启用" : "未启用"})` : dailyEnabled ? "已启用" : "已禁用";
  const exchangeLabel = exchangeEnabled === undefined ? `继承全局 (${globalExchangeEnabled ? "已启用" : "未启用"})` : exchangeEnabled ? "已启用" : "已禁用";
  const exchangeIdLabel = exchangeId === undefined ? `继承全局 (${formatExchangeAmount(globalExchangeId)})` : formatExchangeAmount(exchangeId);
  const weekdaysLabel = userWeekdays === undefined ? `继承全局 (${formatWeekdays(globalWeekdays)})` : formatWeekdays(userWeekdays);
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[
    { label: `用户: ${redactText(user.id)}${user.name ? ` / ${redactText(user.name)}` : ""}`, value: "__header" },
    { label: `每日任务: ${dailyLabel}`, value: "daily" },
    { label: `优惠券兑换: ${exchangeLabel}`, value: "exchange" },
    { label: `兑换面额: ${exchangeIdLabel}`, value: "exchangeId" },
    { label: `执行周期: ${weekdaysLabel}`, value: "weekdays" },
    { label: "重置为全局默认", value: "reset" },
    { label: "返回", value: "back" }
  ]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "__header") return;
    else if (item.value === "daily") updateScheduleUserConfig((u) => {
      const current = u.schedule?.daily?.enabled;
      const next = current === undefined ? !globalDailyEnabled : !current;
      return { ...u, schedule: { ...(u.schedule ?? {}), daily: { ...(u.schedule?.daily ?? {}), enabled: next } } };
    });
    else if (item.value === "exchange") updateScheduleUserConfig((u) => {
      const current = u.schedule?.exchange?.enabled;
      const next = current === undefined ? !globalExchangeEnabled : !current;
      return { ...u, schedule: { ...(u.schedule ?? {}), exchange: { ...(u.schedule?.exchange ?? {}), enabled: next } } };
    });
    else if (item.value === "exchangeId") navigate("scheduleUserExchangeAmount");
    else if (item.value === "weekdays") navigate("scheduleUserExchangeWeekdays");
    else if (item.value === "reset") updateScheduleUserConfig((u) => {
      const { schedule, ...rest } = u;
      return rest as UserConfig;
    });
  }} />;
}

function ScheduleUserExchangeAmount({ initialIndex, onHighlight, config, userId, updateScheduleUserConfig, navigateBack }: MenuNavProps & { config: AppConfig; userId: string; updateScheduleUserConfig: (updater: (user: UserConfig) => UserConfig) => void; navigateBack: () => void }) {
  const user = config.users.find((item) => item.id === userId);
  const currentExchangeId = user?.schedule?.exchange?.exchangeId;
  const items = EXCHANGE_AMOUNT_OPTIONS.map((option) => ({
    label: `${option.label}${option.id === currentExchangeId ? "  当前" : ""}`,
    value: option.id
  }));
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "重置为全局默认", value: "__reset" }, { label: "返回", value: "back" }]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "__reset") updateScheduleUserConfig((u) => ({
      ...u,
      schedule: {
        ...(u.schedule ?? {}),
        exchange: {
          ...(u.schedule?.exchange ?? {}),
          exchangeId: undefined
        }
      }
    }));
    else updateScheduleUserConfig((u) => ({
      ...u,
      schedule: {
        ...(u.schedule ?? {}),
        exchange: {
          ...(u.schedule?.exchange ?? {}),
          exchangeId: item.value
        }
      }
    }));
  }} />;
}

function ScheduleUserExchangeWeekdays({ initialIndex, onHighlight, config, userId, updateScheduleUserConfig, navigateBack }: MenuNavProps & { config: AppConfig; userId: string; updateScheduleUserConfig: (updater: (user: UserConfig) => UserConfig) => void; navigateBack: () => void }) {
  const user = config.users.find((item) => item.id === userId);
  const currentWeekdays = user?.schedule?.exchange?.weekdays;
  const displayWeekdays = currentWeekdays ?? config.schedule.exchange.weekdays;
  const selected = new Set(displayWeekdays);
  const items = WEEKDAY_DISPLAY_ORDER.map((day) => ({ label: `${selected.has(day) ? "[x]" : "[ ]"} ${WEEKDAY_LABELS[day]}`, value: String(day) }));
  const setWeekdays = (weekdays: number[]) => {
    updateScheduleUserConfig((u) => ({
      ...u,
      schedule: {
        ...(u.schedule ?? {}),
        exchange: {
          ...(u.schedule?.exchange ?? {}),
          weekdays
        }
      }
    }));
  };
  const toggle = (weekday: number) => {
    const current = new Set(displayWeekdays);
    if (current.has(weekday)) {
      current.delete(weekday);
    } else {
      current.add(weekday);
    }
    setWeekdays([...current]);
  };
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "全选", value: "__all" }, { label: "清空", value: "__none" }, { label: "重置为全局默认", value: "__reset" }, { label: "返回", value: "back" }]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "__all") setWeekdays([0, 1, 2, 3, 4, 5, 6]);
    else if (item.value === "__none") setWeekdays([]);
    else if (item.value === "__reset") updateScheduleUserConfig((u) => {
      const { weekdays, ...rest } = u.schedule?.exchange ?? {};
      return {
        ...u,
        schedule: {
          ...(u.schedule ?? {}),
          exchange: rest
        }
      };
    });
    else toggle(Number(item.value));
  }} />;
}

function ScheduleDailyTime({ initialIndex, onHighlight, time, setPrompt, navigateBack }: MenuNavProps & { time: string; setPrompt: ScreenProps["setPrompt"]; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: `自定义固定时间: ${formatCompactTime(time)}`, value: "custom" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : setPrompt({ key: "scheduleDailyTime", label: "每日任务固定时间 HH:mm:ss", initialValue: formatCompactTime(time) })} />;
}

function ScheduleHourSelect({ initialIndex, onHighlight, title, currentHour, updateHour, navigateBack }: MenuNavProps & { title: string; currentHour: number; updateHour: (hour: string) => void; navigateBack: () => void }) {
  const items = HOUR_OPTIONS.map((option) => ({ label: `${option.label}${Number(option.value) === currentHour ? "  当前" : ""}`, value: option.value }));
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : updateHour(item.value)} />;
}

function ScheduleExchangeTimes({ initialIndex, onHighlight, config, toggleTime, navigateBack }: MenuNavProps & { config: AppConfig; toggleTime: (time: string) => void; navigateBack: () => void }) {
  const selected = new Set(config.schedule.exchange.times);
  const items = EXCHANGE_START_TIME_OPTIONS.map((option) => ({ label: `${selected.has(option.value) ? "[x]" : "[ ]"} ${option.label}`, value: option.value }));
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : toggleTime(item.value)} />;
}

function ScheduleExchangeWeekdays({ initialIndex, onHighlight, config, setWeekdays, navigateBack }: MenuNavProps & { config: AppConfig; setWeekdays: (weekdays: number[]) => void; navigateBack: () => void }) {
  const selected = new Set(config.schedule.exchange.weekdays);
  const items = WEEKDAY_DISPLAY_ORDER.map((day) => ({ label: `${selected.has(day) ? "[x]" : "[ ]"} ${WEEKDAY_LABELS[day]}`, value: String(day) }));
  const toggle = (weekday: number) => {
    const current = new Set(config.schedule.exchange.weekdays);
    if (current.has(weekday)) {
      current.delete(weekday);
    } else {
      current.add(weekday);
    }
    setWeekdays([...current]);
  };
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[...items, { label: "全选", value: "__all" }, { label: "清空", value: "__none" }, { label: "返回", value: "back" }]} onSelect={(item) => {
    if (item.value === "back") navigateBack();
    else if (item.value === "__all") setWeekdays([0, 1, 2, 3, 4, 5, 6]);
    else if (item.value === "__none") setWeekdays([]);
    else toggle(Number(item.value));
  }} />;
}

function formatScheduleTimes(times: string[]): string {
  return times.length ? times.map((time) => formatExchangeStartTime(time)).join(",") : "未选择";
}

function formatIntervalRange(intervalMs: number, intervalMaxMs?: number): string {
  return intervalMaxMs !== undefined && intervalMaxMs !== intervalMs ? `${intervalMs}-${intervalMaxMs}ms` : `${intervalMs}ms`;
}

function formatDailyScheduleLabel(daily: AppConfig["schedule"]["daily"]): string {
  return daily.mode === "fixed" ? `固定 ${formatCompactTime(daily.time)}` : `随机 ${formatHour(daily.rangeStartHour)}-${formatHour(daily.rangeEndHour)}`;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatEnabled(enabled: boolean): string {
  return enabled ? "\u001b[32m已启用\u001b[0m" : "\u001b[90m未启用\u001b[0m";
}

function formatCompactTime(time: string): string {
  const match = /^(\d{2}:\d{2}:\d{2})/.exec(time);
  return match?.[1] ?? time;
}

function formatScheduleHeader(config: AppConfig): string {
  const schedule = config.schedule;
  if (!schedule.enabled) return "未启用";
  const parts = [
    schedule.daily.enabled ? `每日:${formatDailyScheduleLabel(schedule.daily)}` : undefined,
    schedule.exchange.enabled ? `兑换:${formatScheduleTimes(schedule.exchange.times)}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "已启用 / 无任务";
}

function hasEnabledNotification(config: AppConfig): boolean {
  return notificationProviderList.some((provider) => config.notifications[provider.id].enabled);
}

function formatNotificationHeader(config: AppConfig): string {
  const enabled = notificationProviderList.filter((provider) => config.notifications[provider.id].enabled).map((provider) => provider.name);
  return enabled.length ? enabled.join(" / ") : "未启用";
}

function formatNotificationFieldValue(value: unknown, secret?: boolean): string {
  if (value === undefined || value === null || value === "") return "未填写";
  if (secret) return "已填写";
  return redactText(String(value));
}

function NotificationList({ initialIndex, onHighlight, config, openProvider, navigateBack }: MenuNavProps & { config: AppConfig; openProvider: (providerId: NotificationProviderId) => void; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[
    ...notificationProviderList.map((provider) => ({ label: `${provider.name}: ${config.notifications[provider.id].enabled ? "已启用" : "未启用"}`, value: provider.id })),
    { label: "返回", value: "back" }
  ]} onSelect={(item) => item.value === "back" ? navigateBack() : openProvider(item.value as NotificationProviderId)} />;
}

function NotificationSettings({
  initialIndex,
  onHighlight,
  config,
  providerId,
  setPrompt,
  updateNotificationConfig,
  testNotification,
  navigateBack
}: MenuNavProps & {
  config: AppConfig;
  providerId: NotificationProviderId;
  setPrompt: (providerId: NotificationProviderId, fieldKey: string, label: string, secret?: boolean, initialValue?: string) => void;
  updateNotificationConfig: (key: string, value: boolean | string) => void;
  testNotification: () => void;
  navigateBack: () => void;
}) {
  const provider = getNotificationProvider(providerId);
  if (!provider) return <Text color="red">未知通知通道</Text>;
  const providerConfig = config.notifications[providerId] as Record<string, unknown> & { enabled: boolean };
  return (
    <Menu
      initialIndex={initialIndex}
      onHighlight={onHighlight}
      items={[
        { label: `通知状态: ${providerConfig.enabled ? "已启用" : "未启用"}`, value: "toggle" },
        ...provider.fields.map((field) => ({ label: `${field.label}: ${formatNotificationFieldValue(providerConfig[field.key], field.secret)}`, value: field.key })),
        { label: "发送测试消息", value: "test" },
        { label: "返回", value: "back" }
      ]}
      onSelect={(item) => {
        if (item.value === "back") navigateBack();
        else if (item.value === "toggle") updateNotificationConfig("enabled", !providerConfig.enabled);
        else if (item.value === "test") testNotification();
        else {
          const field = provider.fields.find((candidate) => candidate.key === item.value);
          if (field) setPrompt(providerId, field.key, `${provider.name} ${field.label}`, field.secret, String(providerConfig[field.key] ?? ""));
        }
      }}
    />
  );
}

function WebUi({ initialIndex, onHighlight, runTask, navigateBack }: MenuNavProps & { runTask: LoginTaskProps["runTask"]; navigateBack: () => void }) {
  return <Menu initialIndex={initialIndex} onHighlight={onHighlight} items={[{ label: "启动 WebUI: http://127.0.0.1:3210", value: "run" }, { label: "返回", value: "back" }]} onSelect={(item) => item.value === "back" ? navigateBack() : runTask("WebUI", async () => {
    await startWebServer({ configPath: DEFAULT_CONFIG_PATH, host: "127.0.0.1", port: 3210 });
    return "WebUI 已启动: http://127.0.0.1:3210";
  })} />;
}

function Summary({ config }: { config: AppConfig }) {
  return <Box flexDirection="column"><Text color="cyan">配置摘要</Text><Text>{JSON.stringify(redactSensitive(config), null, 2)}</Text></Box>;
}

async function withClient<T>(fn: (client: ApiClient) => Promise<T>, timeoutMs?: number): Promise<T> {
  const client = new ApiClient(timeoutMs ? { timeoutMs } : {});
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function formatTaskResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  if (hasTextResult(result)) return result.text;
  if (isExchangeRunResult(result)) return formatExchangeRunSummary(summarizeExchangeRun(result));
  return JSON.stringify(redactSensitive(result), null, 2);
}

function formatPm2StatusForTui(output: string): string {
  const plainOutput = stripAnsi(output);
  const lines = plainOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const appLine = lines.find((line) => line.includes(PM2_APP_NAME));
  if (!appLine) {
    if (plainOutput.includes("empty") || plainOutput.includes("not found") || plainOutput.includes("errored")) return "后台任务: 未运行";
    return plainOutput;
  }

  const cells = appLine
    .split("│")
    .map((cell) => cell.trim())
    .filter(Boolean);
  const [
    id,
    name,
    namespace,
    version,
    mode,
    pid,
    uptime,
    restarts,
    status,
    cpu,
    memory,
    user,
    watching
  ] = cells;

  return [
    `后台任务: ${formatPm2StatusLabel(status)}`,
    `名称: ${name || PM2_APP_NAME}`,
    `PID: ${pid || "-"}`,
    `运行时间: ${uptime || "-"}`,
    `重启次数: ${restarts || "0"}`,
    `CPU: ${cpu || "-"}`,
    `内存: ${memory || "-"}`,
    `监听文件: ${formatPm2WatchingLabel(watching)}`,
    namespace && namespace !== "default" ? `命名空间: ${namespace}` : undefined,
    version ? `版本: ${version}` : undefined,
    mode ? `模式: ${mode}` : undefined,
    id ? `PM2 ID: ${id}` : undefined,
    user ? `用户: ${user}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function formatPm2StatusLabel(status?: string): string {
  if (status === "online") return "运行中";
  if (status === "stopped") return "已停止";
  if (status === "errored") return "异常";
  return status || "未知";
}

function formatPm2WatchingLabel(watching?: string): string {
  if (watching === "enabled") return "开启";
  if (watching === "disabled") return "关闭";
  return watching || "-";
}

function hasTextResult(result: unknown): result is { text: string } {
  return typeof result === "object" && result !== null && "text" in result && typeof (result as { text?: unknown }).text === "string";
}

function isExchangeRunResult(result: unknown): result is ExchangeSchedulerRunResult {
  return typeof result === "object" && result !== null && "attempts" in result && Array.isArray((result as { attempts?: unknown }).attempts);
}

render(<App />);
