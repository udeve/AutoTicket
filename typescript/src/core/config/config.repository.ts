import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AppConfig, UserConfig } from "./config.schema.js";
import { AppConfigSchema, findUser } from "./config.schema.js";

export const DEFAULT_CONFIG_PATH = "config/autoticket.json";

export function createDefaultConfig(): AppConfig {
  return AppConfigSchema.parse({});
}

export class ConfigRepository {
  readonly path: string;

  constructor(path = DEFAULT_CONFIG_PATH) {
    this.path = path;
  }

  async load(): Promise<AppConfig> {
    try {
      const text = await readFile(this.path, "utf8");
      const parsed = JSON.parse(text);
      const normalized = AppConfigSchema.parse(parsed);
      // 老文件可能缺少新顶层段（如 bot）。补齐默认值后若与磁盘内容不一致则回写，
      // 使配置文件随 schema 演进自更新；幂等，只在首次缺段时写一次。
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        await this.save(normalized);
      }
      return normalized;
    } catch (error) {
      if (isNotFound(error)) {
        const config = createDefaultConfig();
        await this.save(config);
        return config;
      }
      throw error;
    }
  }

  async save(config: AppConfig): Promise<void> {
    const normalized = AppConfigSchema.parse(config);
    await mkdir(dirname(resolve(this.path)), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }

  async getUser(userId: string): Promise<UserConfig> {
    return findUser(await this.load(), userId);
  }

  async upsertUser(user: UserConfig): Promise<AppConfig> {
    const config = await this.load();
    const index = config.users.findIndex((item) => item.id === user.id);
    if (index >= 0) {
      config.users[index] = { ...config.users[index], ...user };
    } else {
      config.users.push(user);
    }
    await this.save(config);
    return config;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
