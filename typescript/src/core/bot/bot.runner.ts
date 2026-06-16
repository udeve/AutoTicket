import { ConfigRepository } from "../config/config.repository.js";
import { statePathForConfig, TaskStateRepository } from "../state/task-state.repository.js";
import { withScheduleLogTimestamp } from "../schedule/schedule.service.js";
import { BotService } from "./bot.service.js";
import { createBotCommands } from "./command/index.js";
import { activeBotProviders } from "./provider/providers.js";
import type { BotProviderRuntime } from "./provider/bot.provider.js";

/**
 * CLI `bot run` 的装配入口：加载配置 → 构建 service → 拉起所有已启用通道的 provider。
 * 每条入站消息归一化后交给 BotService 调度。
 */
export async function runBotForever({ configPath }: { configPath: string }): Promise<void> {
  const logger = withScheduleLogTimestamp((message) => console.log(message));
  const config = await new ConfigRepository(configPath).load();

  if (!config.bot.enabled) {
    logger("bot 未启用 (config.bot.enabled = false)。");
    return;
  }
  const providers = activeBotProviders(config);
  if (providers.length === 0) {
    logger("没有启用的 bot provider。请在 config.bot.dingtalk 配置并启用。");
    return;
  }

  const service = new BotService({
    config,
    configPath,
    stateRepo: new TaskStateRepository(statePathForConfig(configPath)),
    commands: createBotCommands(),
    logger
  });

  const runtimes: BotProviderRuntime[] = providers.map((provider) =>
    provider.create({
      config,
      onMessage: (message) => service.handleMessage(message),
      logger
    })
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger("bot 正在关闭…");
    await Promise.allSettled(runtimes.map((runtime) => runtime.stop()));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  logger(`启动 bot 通道: ${providers.map((provider) => provider.id).join(", ")}`);
  await Promise.all(runtimes.map((runtime) => runtime.start()));
}
