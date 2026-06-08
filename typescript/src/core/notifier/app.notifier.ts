import type { AppConfig } from "../config/config.schema.js";
import { CompositeNotifier, type Notifier } from "./notifier.js";
import { notificationProviderList } from "./providers.js";

export function createNotifier(config: AppConfig): Notifier {
  return new CompositeNotifier(notificationProviderList.map((provider) => provider.create(config.notifications[provider.id])));
}
