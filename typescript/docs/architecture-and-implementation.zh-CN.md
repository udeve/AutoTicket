# AutoTicket 当前实现架构与实现说明

## 1. 设计目标

当前主线实现采用 **TypeScript + Node.js** 单核心架构，目标是替代原先 Python、旧 JavaScript、uni-app 三套重复实现，形成一套可维护、可测试、适合高性能执行的核心代码。

核心目标包括：

- 统一业务能力：登录、每日任务、优惠券兑换、二维码/地铁券查询、通知。
- 提升执行性能：去除旧 JavaScript 版的子进程解密，使用同进程加解密和 HTTP keep-alive。
- 降低维护成本：所有新功能集中在 `typescript/src/`；旧平台实现仍保留在仓库根目录作为历史参考。
- 保持可测试性：通过 TypeScript 类型检查、Vitest 单元测试和生产构建验证核心路径。

## 2. 总体架构

项目当前采用分层结构：

```text
src/
├─ cli/                       # 命令行入口
├─ web/                       # 本地 WebUI 服务
├─ core/
│  ├─ config/                 # 配置读取与 zod 校验
│  ├─ crypto/                 # 请求加密、签名、data2 解密
│  ├─ http/                   # HTTP 客户端与连接复用
│  ├─ notifier/               # 通知插件
│  ├─ scheduler/              # 兑换调度器
│  ├─ services/               # 业务服务层
│  ├─ utils/                  # 时间等通用工具
│  ├─ constants.ts            # 接口端点和通用常量
│  └─ types.ts                # 核心类型定义
└─ index.ts                   # 核心模块导出
public/                       # WebUI 静态资源
```

旧实现保留在仓库根目录：

```text
AutoTicket.py / gui.py / Login.py / ...
JavaScript_Version/
App_Version/
```

## 3. 模块职责

### 3.1 CLI 层

文件：[src/cli/index.ts](../src/cli/index.ts)

CLI 使用 `commander` 实现，提供五个主命令：

- `login`：登录辅助命令，包括验证码、短信发送、短信登录、密码登录。
- `daily`：执行每日任务流程。
- `exchange`：执行优惠券兑换调度。
- `ui` / `tui`：启动可选中、可交互的终端界面。
- `web`：启动本地 WebUI。
- `schedule`：多用户定时任务、PM2 后台常驻、日志、状态和每日任务计划查看。

CLI 只负责参数解析、配置加载、服务编排和结果输出，不直接实现业务细节。

### 3.2 配置层

文件：[src/core/config/config.schema.ts](../src/core/config/config.schema.ts)

配置使用 `zod` 校验，并通过 `ConfigRepository` 自动创建和更新真实配置文件。当前支持：

- `users`：多用户配置。
- `exchange`：兑换参数配置。
- `notifications`：消息通知配置，包含 `dingtalk`、`serverChan` 等通道。

配置模板：[config/autoticket.example.json](../config/autoticket.example.json)

默认真实配置路径是 `config/autoticket.json`。该文件不存在时会自动生成；短信登录或密码登录成功后，会自动 upsert 用户会话信息。

关键默认值：

- `exchange.exchangeId`: `"10"`，对应兑换面额，`9=2元`、`10=4元`、`11=6元`
- `exchange.startAt`: `"07:00:00"`，TUI/WebUI 通过固定时间选项选择；固定场次沿用旧 Python GUI 的 `07:00`、`11:30`、`17:00`
- `exchange.concurrency`: `1`
- `exchange.intervalMs`: `100`
- `exchange.intervalMaxMs`: 默认不设置；设置后兑换请求发射间隔会在 `intervalMs~intervalMaxMs` 之间随机
- `exchange.maxAttempts`: `50`
- `exchange.requestTimeoutMs`: `5000`
- `exchange.stopRules`: 命中消息后的停止规则，例如 `{ "match": "手慢啦", "status": "failure" }`
- `notifications.dingtalk.enabled`: `false`
- `notifications.serverChan.enabled`: `false`

### 3.3 加解密层

文件：

- [src/core/crypto/crypto.service.ts](../src/core/crypto/crypto.service.ts)
- [src/core/crypto/keys.ts](../src/core/crypto/keys.ts)

该层负责与接口协议相关的加解密逻辑：

- 生成 24 位随机会话密钥。
- 使用 RSA 加密会话密钥，生成 `dec_key`。
- 对敏感字段执行 3DES/ECB/PKCS7 加密。
- 根据接口分支生成签名。
- 使用 RSA + 3DES/CBC 解密响应中的 `data2`。

相比旧 JavaScript 版，当前实现不再通过 `child_process` 调用 `decrypt.js`，而是在同一 Node.js 进程内直接调用 `decryptData2()`，减少进程创建、标准输入输出和临时文件开销。

### 3.4 敏感信息脱敏

文件：[src/core/utils/redaction.ts](../src/core/utils/redaction.ts)

脱敏工具在状态落盘和界面输出前统一处理敏感字段和值，包括手机号、身份证号、银行卡号、`LOGIN_NAME`、`SES_ID`、密码、Token、钉钉 Webhook / Secret、Server酱 SendKey。`TaskStateRepository` 在 `save()` 前会脱敏状态内容，读取旧状态文件时也会自动回写脱敏版本，避免 `config/autoticket.state.json` 长期保留历史明文响应。

### 3.5 HTTP 客户端层

文件：[src/core/http/api-client.ts](../src/core/http/api-client.ts)

HTTP 客户端使用 `undici`：

- 使用 `Agent` 进行连接复用。
- 设置 keep-alive 参数。
- 提供 `warmup()`，在兑换前做尽力预热。
- 提供 `postEncrypted()`，统一完成请求加密、POST 请求、响应解析和 `data2` 解密。

返回结构包含：

- 原始响应 envelope。
- 解密后的 `data`。
- HTTP 状态码。
- 请求、解密和总耗时。

### 3.6 业务服务层

目录：[src/core/services](../src/core/services)

当前服务包括：

- `AuthService`：图形验证码、短信发送、短信登录、密码登录、用户信息查询。
- `TaskService`：每日登录签到、3 次签到、评论、积分查询、完整每日任务流程。
- `ExchangeService`：构建兑换请求并执行单次兑换。
- `QrService`：绿色出行码 token、访问记录、地铁优惠券查询。

服务层只负责业务参数和接口端点，不关心 CLI 参数、不关心通知、不关心调度策略。

注意：`QrService` 当前属于核心服务能力，尚未暴露为 CLI/TUI/WebUI 的用户入口；后续如果需要查询二维码或地铁优惠券，可在入口层复用该服务补充命令或页面。

### 3.7 兑换调度器

文件：[src/core/scheduler/exchange-scheduler.ts](../src/core/scheduler/exchange-scheduler.ts)

兑换调度器负责高性能兑换执行：

- 支持指定开始时间 `startAt`。
- 支持滚动并发 `concurrency`，限制同时在飞的最大请求数。
- 支持发射间隔 `intervalMs~intervalMaxMs`，每次按区间随机产生等待时间，不会因为某个请求超时而阻塞后续请求发起。
- 支持最大尝试次数 `maxAttempts`。
- 支持停止规则 `stopRules`，命中后停止发起新请求；只要本轮任意尝试命中过成功规则，最终状态就是成功。
- 支持每次尝试的流水回调，用于 PM2 日志展示兑换过程。

调度器不直接构造 HTTP 请求，而是调用 `ExchangeService.exchangeOnce()`。这样调度逻辑和接口逻辑保持分离。

### 3.8 通知层

文件：

- [src/core/notifier/notifier.ts](../src/core/notifier/notifier.ts)
- [src/core/notifier/dingtalk.notifier.ts](../src/core/notifier/dingtalk.notifier.ts)
- [src/core/notifier/serverchan.notifier.ts](../src/core/notifier/serverchan.notifier.ts)
- [src/core/notifier/app.notifier.ts](../src/core/notifier/app.notifier.ts)
- [src/core/notifier/providers.ts](../src/core/notifier/providers.ts)

通知使用插件化设计：

- `Notifier` 定义统一通知接口。
- `NullNotifier` 可作为空实现。
- `CompositeNotifier` 聚合多个通知通道。
- `NotificationProvider` 定义通道名称、配置字段、校验逻辑和 Notifier 创建逻辑。
- `notificationProviderList` 是通知通道注册表，`createNotifier()` 会遍历注册表创建聚合通知器。
- `DingTalkNotifier` 实现钉钉机器人通知。
- `ServerChanNotifier` 实现 Server酱³ 通知。

通知不会参与核心请求逻辑；CLI、WebUI、TUI 都在任务结束后调用通知插件，因此通知失败不会影响兑换或每日任务本身。TUI 的消息通知设置页由 provider 注册表自动渲染，额外提供测试消息入口，用于验证钉钉 Webhook / Secret、Server酱 UID / SendKey 和网络是否可用。

## 4. 核心流程

### 4.1 兑换流程

```text
CLI / WebUI / TUI exchange
  -> 读取配置
  -> 查找用户
  -> 初始化 ApiClient
  -> warmup()
  -> ExchangeScheduler.run()
      -> ExchangeService.exchangeOnce()
          -> buildPayload()
          -> ApiClient.postEncrypted()
              -> buildEncryptedPayload()
              -> POST
              -> decryptData2()
      -> 判断 stopRules
  -> 输出结果
  -> 消息通知
  -> client.close()
```

### 4.2 每日任务流程

```text
CLI / WebUI / TUI daily
  -> 读取配置
  -> 查找用户
  -> TaskService.runDailyWorkflow()
      -> dailyLogin(type=1)
      -> random delay
      -> signin(type=5) x 3
          -> each signin 后 random delay
      -> comment(related_id="1232", content=schedule.daily.commentContent)
      -> queryIntegral()
  -> 输出结果
  -> 消息通知
```

每日任务步骤之间不是并发执行。登录签到后、每次签到后都会随机等待一段时间再进入下一项；默认下限 `delayMs=1000`，上限自动为 `delayMs + 1000`，即默认 `1000~2000ms`。

评论步骤当前使用固定文章 ID `related_id=1232`。留言内容来自 `schedule.daily.commentContent`，默认是 `点赞`，可以在 TUI 的每日任务设置中修改。

### 4.3 登录流程

当前 CLI 提供四类登录辅助能力：

```text
login direct
login captcha
login send-sms
login sms
login password
```

`login direct` 支持 `LOGIN_NAME + SES_ID` 直接保存，并在 TUI 登录菜单中放在首位。

登录结果会输出到终端；当接口返回成功且包含 `login_name` 和 `ses_id` 时，CLI/WebUI 会自动写入 `config/autoticket.json` 或用户通过 `--config` 指定的配置文件。

### 4.4 WebUI 流程

```text
CLI web
  -> startWebServer()
  -> 自动加载或创建配置文件
  -> 提供静态页面
  -> 提供 /api/config、/api/state、/api/user/status、/api/login/*、/api/daily、/api/exchange
  -> 页面调用 API
  -> 服务层执行任务
  -> 登录成功自动保存配置
```

### 4.5 TUI 流程

```text
CLI ui / tui
  -> 加载或创建 config/autoticket.json
  -> 渲染 Ink 交互菜单
  -> 用户通过方向键选择登录、用户、每日任务、兑换、参数设置、通知或 WebUI
  -> 参数和通知设置直接保存到配置文件
  -> 每日任务 / 兑换任务完成后按通知通道启用状态决定是否通知
```

TUI 导航只记忆返回目标：从上级进入下级时会记住上级选中项，返回上级时恢复；重新进入子菜单时使用默认选中项。例如用户管理默认选中当前用户，兑换面额默认选中当前配置面额。

### 4.6 定时任务流程

```text
CLI schedule run / PM2
  -> ScheduleService.runForever()
  -> 计算下一次候选任务
      -> 每日任务固定时间
      -> 每日任务随机区间，按账号分别生成并保存随机时间
      -> 优惠券兑换固定场次
  -> 等待到目标时间
  -> 执行对应用户或场次
  -> 写入 config/autoticket.state.json
  -> 输出 PM2 可捕获的流水日志
```

每日任务随机时间精确到秒，按账号分别生成。多账号场景采用“账号片段随机分配 + 片内随机”：先随机打乱账号对应片段，再在各自片段内生成具体秒数，避免纯独立随机导致多个账号时间过近。同一天同一账号同一时间区间只生成一次，保存在状态文件中；`schedule daily-plan` 和 TUI 的 `查看明日每日时间` 可以提前生成并查看。

PM2 管理由 [src/core/schedule/pm2-manager.ts](../src/core/schedule/pm2-manager.ts) 负责。`schedule restart` 会先删除旧的 `autoticket-schedule` 进程记录，再按当前目录重新启动，避免项目目录迁移后继续复用旧脚本路径。

## 5. 性能设计点

当前实现相对旧版的主要性能改进：

- 使用 TypeScript 单核心，避免三套逻辑分散。
- `data2` 解密在同一进程内完成，移除子进程和临时文件。
- 使用 `undici` 连接池和 keep-alive。
- 请求、解密、总耗时均保留在返回结果中，便于后续性能分析。
- 兑换调度器支持并发、间隔和停止规则，避免无限无边界循环。
- 定时任务输出流水日志，包含下一次执行、每日任务步骤、兑换尝试和任务完成摘要。
- 钉钉 / Server酱通知在任务结束后执行，不阻塞单次请求路径。
- TUI 支持按通知 provider 自动渲染配置表单、启用校验和测试消息发送。
- 登录成功自动保存配置，减少手工复制 `login_name` / `ses_id` 的操作风险。

## 6. 测试与验证

当前验证命令：

```bash
pnpm check
```

它会依次执行：

```text
pnpm typecheck
pnpm test
pnpm build
```

当前测试覆盖：

- 加密基础函数。
- 加密请求载荷形态。
- 配置默认值和用户查找。
- 配置文件缺失时自动创建。
- 用户配置 upsert。
- 兑换调度器停止规则，包括“手慢啦”停止但失败。
- 兑换调度器并发批次编号。
- 定时任务随机时间、日志时间戳和状态文件记录。

注意：这些是本地类型、单元和构建验证。真实接口调用需要用户提供有效账号、验证码、`ses_id` 和网络环境后执行。

## 7. 后续扩展建议

建议优先扩展方向：

- 增加真实接口的可选集成测试。
- 增加任务日志文件输出。
- 增加更多通知插件：新增 provider 文件并注册到 `notificationProviderList` 即可复用 CLI/TUI/WebUI/定时任务的统一通知链路。
- 增加本地 Web 管理面板。
- 对兑换调度增加更细的性能统计报表。
