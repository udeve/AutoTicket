# AutoTicket TypeScript Core

The current implementation lives in the repository `typescript/` directory and centers on a single TypeScript/Node.js core. The Python GUI, uni-app app, and old JavaScript scripts remain in the repository root as historical implementations; new feature work should land in `typescript/src/`.

> 中文主文档见 `README.md`、`docs/architecture-and-implementation.zh-CN.md` 和 `docs/user-manual.zh-CN.md`。本文件保留为迁移摘要。

## Architecture

- `src/core/crypto`: request encryption, signing, and in-process `data2` decryption.
- `src/core/http`: `undici` client with keep-alive and best-effort warmup.
- `src/core/services`: auth, daily tasks, exchange, and QR/coupon services.
- `src/core/scheduler`: high-performance exchange scheduling.
- `src/core/config`: zod-validated multi-user config.
- `src/core/notifier`: notifier plugins such as DingTalk.
- `src/core/schedule`: multi-user scheduled daily/exchange tasks and PM2 helpers.
- `src/cli`: command-line entry points.

## Historical Implementations

- Root Python files such as `AutoTicket.py`, `gui.py`, and `Login.py`: former Python desktop/script implementation.
- `JavaScript_Version`: former Node.js scripts.
- `App_Version`: former uni-app implementation.

## Validation

Use:

```bash
cd typescript
pnpm check
```

This runs type checking, unit tests, and production build.

## CLI Examples

```bash
pnpm build
node dist/cli/index.js login captcha
node dist/cli/index.js daily --config config/autoticket.example.json --user user1
node dist/cli/index.js exchange --config config/autoticket.example.json --user user1 --concurrency 5 --interval 50 --max-attempts 100
node dist/cli/index.js schedule daily-plan
node dist/cli/index.js schedule status
```
