import type { AppConfig } from "../config/config.schema.js";
import type { DingTalkNotifierOptions } from "./dingtalk.notifier.js";
import { DingTalkNotifier } from "./dingtalk.notifier.js";
import type { ServerChanNotifierOptions } from "./serverchan.notifier.js";
import { ServerChanNotifier } from "./serverchan.notifier.js";
import type { Notifier } from "./notifier.js";

export type NotificationProviderId = keyof AppConfig["notifications"];

export interface NotificationField {
  key: string;
  label: string;
  secret?: boolean;
}

export interface NotificationProvider<TConfig extends { enabled: boolean } = { enabled: boolean }> {
  id: NotificationProviderId;
  name: string;
  fields: NotificationField[];
  create(config: TConfig): Notifier;
  validate(config: TConfig): string | null;
}

const dingtalkProvider: NotificationProvider<DingTalkNotifierOptions> = {
  id: "dingtalk",
  name: "钉钉",
  fields: [
    { key: "webhook", label: "Webhook", secret: true },
    { key: "secret", label: "Secret", secret: true }
  ],
  create: (config) => new DingTalkNotifier(config),
  validate: (config) => config.webhook && config.secret ? null : "请先填写钉钉 Webhook 和 Secret，再启用通知。"
};

const serverChanProvider: NotificationProvider<ServerChanNotifierOptions> = {
  id: "serverChan",
  name: "Server酱",
  fields: [
    { key: "uid", label: "UID" },
    { key: "sendKey", label: "SendKey", secret: true },
    { key: "tags", label: "Tags" }
  ],
  create: (config) => new ServerChanNotifier(config),
  validate: (config) => config.uid && config.sendKey ? null : "请先填写 Server酱 UID 和 SendKey，再启用通知。"
};

export const notificationProviders = [
  dingtalkProvider,
  serverChanProvider
] as const;

export const notificationProviderList: NotificationProvider[] = [
  {
    ...dingtalkProvider,
    create: (config) => dingtalkProvider.create(config as DingTalkNotifierOptions),
    validate: (config) => dingtalkProvider.validate(config as DingTalkNotifierOptions)
  },
  {
    ...serverChanProvider,
    create: (config) => serverChanProvider.create(config as ServerChanNotifierOptions),
    validate: (config) => serverChanProvider.validate(config as ServerChanNotifierOptions)
  }
];

export function getNotificationProvider(id: string): NotificationProvider | undefined {
  return notificationProviderList.find((provider) => provider.id === id);
}
