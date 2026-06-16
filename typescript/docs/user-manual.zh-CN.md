# AutoTicket 用户使用手册

## 1. 简介

AutoTicket 当前推荐使用 **TypeScript + Node.js 高性能版本**。它提供命令行、交互式 TUI 和本地 WebUI，可执行登录辅助、每日任务、优惠券兑换和消息通知。

旧 Python 图形界面、旧 JavaScript 脚本和 uni-app 小程序仍保留在仓库根目录。新版本是 `typescript/` 目录内的独立 TypeScript 项目，本文档中的命令默认都在 `typescript/` 目录中执行。

## 2. 环境要求

- Node.js 20 或更高版本。
- pnpm。
- 可以访问目标接口的网络环境。

查看版本：

```bash
node --version
pnpm --version
```

## 3. 安装依赖与构建

在 `typescript/` 目录执行：

```bash
pnpm run bootstrap
pnpm run build:all
pnpm run install:cli
```

`pnpm run bootstrap` 用于首次安装依赖。`pnpm run build:all` 会执行类型检查、单元测试和构建。如果全部通过，说明本地程序状态正常。`pnpm run install:cli` 会在构建通过后执行 `npm link`，把当前项目注册成本机命令，之后可以用 `autoticket xxx` 代替 `node dist/cli/index.js xxx`。

如果本机 `npm link` 不可用，也可以先执行：

```bash
pnpm setup
pnpm link --global
```

然后重新打开终端，再使用 `autoticket --help` 验证命令是否可用。

建议仍然在 `typescript/` 目录中运行 `autoticket`，这样默认配置会写入 `typescript/config/autoticket.json`。如果在其他目录运行，请显式传入 `--config`。

## 4. 自动配置文件

程序默认使用：

```text
config/autoticket.json
```

你不需要手动复制模板或手动填写登录字段。首次运行需要配置的命令时，如果该文件不存在，程序会自动创建默认配置。短信登录或密码登录成功后，程序会自动保存或更新用户的 `login_name`、`user_id`、`ses_id`。

配置结构示例：

```json
{
  "users": [
    {
      "id": "user1",
      "loginName": "登录成功后自动写入",
      "userId": "登录成功后自动写入",
      "sesId": "登录成功后自动写入",
      "name": "可选备注"
    }
  ],
  "exchange": {
    "exchangeId": "10",
    "startAt": "07:00:00",
    "concurrency": 5,
    "intervalMs": 50,
    "intervalMaxMs": 150,
    "maxAttempts": 100,
    "requestTimeoutMs": 3000,
    "stopRules": [
      { "match": "兑换中", "status": "success" },
      { "match": "兑换成功", "status": "success" },
      { "match": "已达上限", "status": "success" },
      { "match": "每天最多兑换", "status": "success" },
      { "match": "手慢啦", "status": "failure" }
    ]
  },
  "notifications": {
    "dingtalk": {
      "enabled": false,
      "webhook": "",
      "secret": ""
    },
    "serverChan": {
      "enabled": false,
      "uid": "",
      "sendKey": "",
      "tags": ""
    }
  },
  "schedule": {
    "enabled": false,
    "users": [],
    "daily": {
      "enabled": false,
      "mode": "fixed",
      "time": "08:30:00",
      "rangeStartHour": 8,
      "rangeEndHour": 10,
      "delayMs": 1000,
      "commentContent": "点赞"
    },
    "exchange": {
      "enabled": false,
      "times": ["07:00:00", "11:30:00", "17:00:00"],
      "concurrency": 1,
      "intervalMs": 100,
      "intervalMaxMs": 100,
      "maxAttempts": 50,
      "requestTimeoutMs": 5000,
      "stopAfterSuccess": true
    }
  }
}
```

`config/autoticket.json` 已加入忽略规则，不建议提交真实账号和会话信息。

## 5. 打开 WebUI

先构建：

```bash
pnpm build
```

启动本地 WebUI：

```bash
autoticket web
```

浏览器打开：

```text
http://127.0.0.1:3210
```

自定义端口：

```bash
autoticket web --port 4000
```

WebUI 当前支持：

- 查看当前配置用户。
- 查询用户状态和积分。
- 查看全部账号今日每日任务和兑换任务执行状态。
- 获取验证码接口返回。
- 发送短信验证码。
- 短信登录并自动保存配置。
- 密码登录并自动保存配置。
- 执行每日任务。
- 执行优惠券兑换。

定时任务设置、PM2 后台管理和通知测试消息目前建议使用 TUI。

## 6. 打开交互式 TUI

构建后运行：

```bash
autoticket ui
```

也可以使用别名：

```bash
autoticket tui
```

TUI 支持：

- ↑ / ↓ 选择菜单项。
- Enter 确认。
- Esc 返回上级。
- Ctrl+C 退出。
- 登录 / 更新会话。
- 用户管理，进入时默认选中当前用户。
- 查询当前用户状态 / 积分。
- 查看全部账号今日每日任务和兑换任务执行状态。
- 每日任务和优惠券兑换。
- 兑换参数设置，兑换面额可直接选择 `2元`、`4元`、`6元`，开始时间可直接选择 `07:00`、`11:30`、`17:00`。
- 消息通知设置，可分别配置钉钉 Webhook / Secret、Server酱³ UID / SendKey / Tags、启用通知、发送测试消息。
- 定时任务设置，包括总开关、执行用户、每日任务时间、兑换场次、PM2 后台启动/重启/状态/日志/停止。
- 查看明日每日任务随机执行时间。
- 打开 WebUI。

登录菜单首位是：

```text
LOGIN_NAME + SES_ID 直接登录
```

适合你已经有可用 `LOGIN_NAME` 和 `SES_ID`，想直接保存为用户会话的场景。

## 7. 查看命令帮助

```bash
autoticket --help
autoticket login --help
autoticket daily --help
autoticket exchange --help
autoticket ui --help
autoticket web --help
```

## 8. 登录辅助

### 8.1 LOGIN_NAME + SES_ID 直接登录

如果你已经有 `LOGIN_NAME` 和 `SES_ID`，可以直接保存：

```bash
autoticket login direct --user user1 --login-name LOGIN_NAME --ses-id SES_ID
```

这是当前推荐放在首位的登录方式。保存后可以直接执行每日任务或兑换任务：

```bash
autoticket daily --user user1
autoticket exchange --user user1
```

### 8.2 获取图形验证码

```bash
autoticket login captcha
```

命令会输出接口返回内容。你需要从返回内容中取得图形验证码相关字段，例如 `imgUniCode` 和验证码图片数据。当前 CLI 只输出结果，不自动渲染图片；WebUI 会把返回 JSON 展示在输出区。

### 8.3 发送短信验证码

```bash
autoticket login send-sms --phone 13800000000 --img-uni-code 图片唯一编号 --captcha 图形验证码
```

### 8.4 短信登录并自动保存

```bash
autoticket login sms --user user1 --phone 13800000000 --code 123456
```

登录成功后，程序会自动写入 `config/autoticket.json`。`--user user1` 表示保存为配置中的 `user1`。

### 8.5 密码登录并自动保存

```bash
autoticket login password --user user1 --phone 13800000000 --password 你的密码 --img-uni-code 图片唯一编号 --captcha 图形验证码
```

## 9. 执行每日任务

每日任务包含：

```text
登录签到 -> 3 次签到 -> 评论 -> 积分查询
```

CLI、TUI、WebUI 默认展示每个步骤的成功/失败摘要。TUI 执行时会按步骤刷新进度，不需要等全部完成后才看到结果。

摘要会显示：

- `签到 1/3`、`签到 2/3`、`签到 3/3`：对应每日任务中的 3 次签到请求。
- `发表评论`：显示接口结果和实际留言内容。
- `积分查询`：显示执行前积分和执行后积分。

完整原始响应会保存在任务状态记录的 `summary.raw` 中，便于排查问题。

每日任务留言内容来自配置 `schedule.daily.commentContent`，默认是 `点赞`。可以在 TUI 的“定时任务设置 -> 每日任务设置 -> 留言内容”中修改。当前评论文章使用固定文章 ID `related_id=1232`，程序没有动态选择文章。

执行命令：

```bash
autoticket daily --user user1
```

指定每日任务步骤随机等待下限：

```bash
autoticket daily --user user1 --delay 1000
```

参数说明：

- `--config`：配置文件路径，可选，默认 `config/autoticket.json`。
- `--user`：配置文件中的用户 ID。
- `--delay`：每日任务步骤之间随机等待的下限，单位毫秒，默认 `1000`。实际上会在 `delay` 到 `delay + 1000` 之间随机，例如默认是 `1000~2000ms`。

## 10. 查询用户与执行状态

列出当前配置中的用户：

```bash
autoticket users
```

查询指定用户的登录状态和积分信息：

```bash
autoticket user status --user user1
```

查看今天保存的任务执行状态：

```bash
autoticket state
```

只查看某个用户：

```bash
autoticket state --user user1
```

查看指定日期：

```bash
autoticket state --date 2026-06-03
```

每日任务和优惠券兑换执行后会自动写入状态文件：

```text
config/autoticket.state.json
```

状态输出包含：

- 每个用户今日每日任务是否执行。
- 每个用户今日优惠券兑换是否执行。
- 如果执行过，会显示成功或失败以及简短结果。
- 优惠券兑换会额外显示兑换面额、开始时间、并发数、请求间隔和最大尝试次数。

TUI 中的 `查看任务状态` 默认显示全部账号，不受当前选中用户影响。CLI 如果不传 `--user` 也会显示全部账号。

状态记录包含任务类型、用户、本地日期、成功/失败、开始/结束时间、摘要和错误信息。它用于判断今天是否执行过、是否执行成功，并尽量避免重复执行。

如果今天已经执行过对应任务：

- CLI 默认不会重复执行；如需强制执行，增加 `--force`。
- TUI 会提示今天已经执行过，并让你选择是否仍然执行。
- WebUI 会弹出确认框，确认后才会重复执行。

## 11. 执行优惠券兑换

使用配置文件中的默认兑换参数：

```bash
autoticket exchange --user user1
```

命令行覆盖部分参数：

```bash
autoticket exchange --user user1 --exchange-id 10 --start-at 07:00:00 --concurrency 5 --interval 50 --interval-max 150 --timeout 3000 --max-attempts 100
```

参数说明：

| 参数 | 说明 |
|---|---|
| `--config` | 配置文件路径，可选，默认 `config/autoticket.json` |
| `--user` | 使用哪个用户配置 |
| `--exchange-id` | 覆盖配置中的兑换面额 ID，`9=2元`、`10=4元`、`11=6元` |
| `--start-at` | 覆盖配置中的开始时间。TUI 和 WebUI 使用固定选项 `07:00`、`11:30`、`17:00`；CLI 自动化可传 `HH:mm:ss` |
| `--concurrency` | 覆盖最大同时在飞请求数 |
| `--interval` | 覆盖新请求发射间隔下限，单位毫秒 |
| `--interval-max` | 覆盖新请求发射间隔上限，单位毫秒；不传时等于 `--interval` |
| `--timeout` | 覆盖单次兑换请求超时时间，单位毫秒 |
| `--max-attempts` | 覆盖最大尝试次数 |

执行结束后，终端会输出摘要。如果没有命中停止条件，`final` 会是 `null`。

兑换请求采用滚动并发模式：每隔 `intervalMs~intervalMaxMs` 之间的随机间隔尝试发起一个新请求，同时最多保留 `concurrency` 个请求在飞。某个请求超时不会阻塞后续请求继续按节拍发起。兑换响应命中 `stopRules` 后会停止当前账号当前轮次继续发新请求；只要本轮任意尝试命中过 `success` 规则，状态记录为 `SUCC`。如果只命中过 `failure` 规则，例如 `手慢啦`，则记录为 `FAIL`。

## 12. 消息通知

当前支持钉钉机器人和 Server酱³。推荐在 TUI 中打开 `消息通知设置`，选择具体通知通道后直接配置启用状态和密钥信息。填写完成后可以选择 `发送测试消息`，确认通知是否正常。程序会自动保存到 `config/autoticket.json`。

未填写 Webhook 或 Secret 时，TUI 不允许启用钉钉通知，并会提示先补全配置。如果通知已启用后清空 Webhook 或 Secret，程序会自动关闭通知。

未填写 UID 或 SendKey 时，TUI 不允许启用 Server酱³通知，并会提示先补全配置。如果通知已启用后清空 UID 或 SendKey，程序会自动关闭通知。

配置保存后的结构如下：

```json
{
  "notifications": {
    "dingtalk": {
      "enabled": true,
      "webhook": "https://oapi.dingtalk.com/robot/send?access_token=你的token",
      "secret": "你的加签密钥"
    },
    "serverChan": {
      "enabled": true,
      "uid": "你的UID",
      "sendKey": "你的SendKey",
      "tags": "AutoTicket"
    }
  }
}
```

Server酱³发送地址由程序自动拼接为 `https://<uid>.push.ft07.com/send/<sendKey>.send`，用户只需要填写 UID 和 SendKey。`tags` 可选，用于 Server酱³侧的消息标签。

当前通知触发时机：

- CLI、WebUI、TUI 执行每日任务结束后发送结果。
- CLI、WebUI、TUI 执行兑换任务结束后发送摘要。
- TUI 中选择 `发送测试消息` 时立即发送一条测试通知。

如果同时启用了钉钉和 Server酱³，程序会同时发送到两个通道。

每日任务和兑换任务通知都会带上本次执行任务的用户 ID，方便多账号场景下区分是哪一个账号触发的结果。

通知失败不会中断核心任务。

## 13. 钉钉机器人远程控制（Stream）

除了第 12 节「程序→你」的通知推送，还可以反过来用手机钉钉**远程控制**本地后台程序：发一条消息立即跑任务、查状态、重启调度等。

实现采用钉钉 **Stream 模式**：程序主动外连钉钉网关的 WebSocket，**不需要公网 IP、不需要内网穿透（frp/ngrok）**，适合控制本地常驻进程。这和第 12 节的「自定义群机器人 webhook 通知」是两套不同的机器人——通知机器人只能单向推送，远程控制需要**另建一个企业内部应用机器人**，两者并存、互不影响。

Server酱³ 是单向推送服务，没有「回复即指令」的入口，因此**命令入口只用钉钉**；任务执行结果会同时通过第 12 节已配置的通知通道推送。

### 13.1 创建钉钉企业内部应用

1. 进入 [钉钉开放平台](https://open-dev.dingtalk.com/)，创建一个**企业内部应用**。
2. 在「凭证与基础信息」记下 **AppKey**（即 `clientId`）和 **AppSecret**（即 `clientSecret`）。
3. 给应用添加**机器人**能力，消息接收模式选择 **Stream 模式**（事件订阅 → Stream 推送）。`robotCode` 一般等于 AppKey。
4. 订阅机器人的**单聊消息**（如需在群里 @机器人 控制，再订阅群聊消息）。
5. 发布并上线应用版本。

### 13.2 配置

`config/autoticket.json` 会自动生成 `bot` 段：

```json
{
  "bot": {
    "enabled": true,
    "dingtalk": {
      "enabled": true,
      "clientId": "你的AppKey",
      "clientSecret": "你的AppSecret",
      "robotCode": "你的AppKey"
    },
    "security": {
      "allowedSenderIds": ["你的staffId"]
    },
    "nlu": {
      "enabled": false,
      "ollamaUrl": "",
      "model": "gemma3:4b"
    }
  }
}
```

- `security.allowedSenderIds` 是发送者白名单（钉钉的 `senderStaffId`）。**留空时 fail-closed：拒绝一切命令**。可以先留空启动一次，给机器人发任意一条消息，从后台日志里读到自己的 `staffId` 后再填入。
- `clientSecret` 会和其他密钥一样自动脱敏后再落盘/输出；`clientId`（AppKey）属半敏感，请勿公开。
- `nlu` 为可选的自然语言解析预留位（默认关闭，关键词命令已够用）。计划接入本地 Ollama + Gemma 做意图解析，当前未启用。

### 13.3 启动与常驻

前台运行（调试用）：

```bash
autoticket bot run
```

推荐用 PM2 后台常驻（与 `autoticket-schedule` 相互独立的进程）：

```bash
autoticket bot start
autoticket bot restart
autoticket bot status
autoticket bot logs
autoticket bot stop
```

启动成功后日志会打印 `dingtalk stream WSS 已连接`。断线会自动按指数退避重连。

### 13.4 可用命令

在钉钉里给机器人发消息（中英文均可，大小写不敏感）：

| 命令 | 别名 | 说明 |
| --- | --- | --- |
| `状态` | `status` / `查询` | 查询今日每日任务与兑换执行状态 |
| `每日` | `daily` / `签到` | 立即执行每日任务（所有计划用户） |
| `兑换` | `exchange` / `券` | 立即执行优惠券兑换 |
| `重启` | `restart` | 重启定时调度进程（PM2） |
| `停止` | `stop` | 停止定时调度进程 |
| `启动` | `start` | 启动定时调度进程 |
| `日志` | `logs` | 查看调度日志，可带行数如 `日志 30` |
| `帮助` | `help` / `?` | 列出可用命令 |

`每日` / `兑换` 默认会跳过当天已执行（成功）的用户；加 `force`（或 `强制`、`--force`、`-f`）强制重跑，例如 `兑换 force`。任务执行前会先回复「开始执行」，结束后再回复结果，同时触发第 12 节的通知推送。

### 13.5 注意事项

- `重启/停止/启动/日志` 控制的是**定时调度**进程（`autoticket-schedule`），不影响 bot 自身（`autoticket-bot`）。
- `每日` / `兑换` 在 bot 进程内同进程触发，状态写入与 WebUI / 定时器存在相同量级的无锁并发读写；人工触发的低并发场景下可忽略。
- 钉钉 Stream 的帧协议以钉钉开放平台当前文档为准；相关常量集中在 `src/core/bot/provider/dingtalk/dingtalk-stream.client.ts` 顶部，线上联调若不符只需调整该文件。
- bot 架构按「通道 provider + 命令注册表」解耦：新增钉钉之外的通道（如 Telegram、企业微信）或新增命令，各加一个独立文件并在注册表登记一行即可，无需改动调度核心。

## 14. 多用户定时执行

配置文件会自动生成 `schedule` 段。可以在 `config/autoticket.json` 中启用多用户定时任务：

```json
{
  "schedule": {
    "enabled": true,
    "users": ["188", "user2"],
    "daily": {
      "enabled": true,
      "mode": "fixed",
      "time": "08:30:00",
      "rangeStartHour": 8,
      "rangeEndHour": 10,
      "delayMs": 1000,
      "commentContent": "点赞"
    },
    "exchange": {
      "enabled": true,
      "times": ["07:00:00", "11:30:00", "17:00:00"],
      "intervalMs": 100,
      "maxAttempts": 50,
      "stopAfterSuccess": true
    }
  }
}
```

`users` 为空数组时，会对所有已保存用户执行。

每日任务支持两种时间模式：

- `mode: "fixed"`：按 `time` 的固定时间执行。
- `mode: "range"`：在 `rangeStartHour` 到 `rangeEndHour` 之间随机选择一个时间执行，例如 `8` 到 `10` 表示 `08:00` 到 `10:00` 之间。

TUI 中每日任务和优惠券兑换分开设置；每日任务的时间区间通过小时选择框设置，优惠券兑换继续使用固定场次多选。

`schedule.daily.delayMs` 是每日任务步骤之间随机等待的下限，上限自动为 `delayMs + 1000`。默认配置 `1000` 表示每次在登录签到之后、每次签到之后随机等待 `1000~2000ms`，再进入下一项。

`schedule.daily.commentContent` 是每日任务评论内容，默认 `点赞`。定时任务、CLI、TUI 和 WebUI 执行每日任务时都会使用这一配置。

定时兑换有独立的最大并发数、请求发射间隔区间、请求超时和最大尝试次数，默认 `concurrency=1`、`intervalMs=100`、`intervalMaxMs=100`、`requestTimeoutMs=5000`、`maxAttempts=50`。请求采用滚动并发模式，某个请求超时不会阻塞后续请求继续按间隔发起。

定时兑换复用全局 `exchange.stopRules` 判断是否停止和本轮结果状态；`schedule.exchange` 只保存定时执行相关参数，避免同一套停止规则在配置里重复维护。

启动常驻定时器：

```bash
autoticket schedule run
```

推荐使用 PM2 后台常驻：

```bash
npm install -g pm2
autoticket schedule start
autoticket schedule restart
autoticket schedule status
autoticket schedule logs
autoticket schedule stop
```

`schedule start` 会用 PM2 启动后台进程 `autoticket-schedule`，实际执行的是 `schedule run`。`schedule restart` 会先删除旧 PM2 进程记录，再按当前目录重新启动，适合迁移目录或重新构建后使用。电脑关机、睡眠或网络断开仍会影响准时性；请保持电脑唤醒、网络稳定。

立即按计划用户执行一次：

```bash
autoticket schedule once daily
autoticket schedule once exchange
```

兑换任务会在配置的多个时间同步对多个用户发起；某个用户当天已经兑换成功后，后续场次会自动跳过该用户。

注意：只有状态记录为 `success` 的兑换才会触发 `stopAfterSuccess` 跳过后续场次。按默认 `stopRules`，`手慢啦` 会停止当前轮次但记录为失败，因此不会被当作已成功兑换。

查看每日任务随机执行时间：

```bash
autoticket schedule daily-plan
autoticket schedule daily-plan --date 2026-06-05
```

随机时间按账号分别生成，精确到秒，并保存在 `config/autoticket.state.json`。多账号会先随机分配账号对应的时间片段，再在片段内随机具体秒数，所以账号之间会尽量错开，但哪个账号落在哪个片段也是随机的。如果再次查看同一天同一账号，会复用已经生成的时间。TUI 中也可以通过 `定时任务设置 -> 查看明日每日时间` 查看。

后台日志包含调度流水，例如下一次执行、每日任务每个步骤、签到等待、兑换每次尝试、任务完成摘要。查看方式：

```bash
autoticket schedule logs
```

## 15. 常见问题

### 15.1 WebUI 怎么打开

```bash
pnpm build
autoticket web
```

然后打开：

```text
http://127.0.0.1:3210
```

### 15.2 `User not found in config`

说明指定用户还没有保存。请先通过短信登录或密码登录保存：

```bash
autoticket login sms --user user1 --phone 13800000000 --code 123456
```

### 15.3 登录后没有自动写入配置

只有接口返回 `result` 为 `"0"` 且包含 `login_name` / `ses_id` 时才会写入配置。请检查登录返回内容和终端提示。

### 15.4 兑换没有按预期停止

检查 `stopRules`：

```json
"stopRules": [
  { "match": "兑换成功", "status": "success" },
  { "match": "每天最多兑换", "status": "success" },
  { "match": "手慢啦", "status": "failure" }
]
```

程序会判断响应消息是否包含这些文本。若接口返回文案变化，需要同步调整。

### 15.5 需要重新构建吗

修改 TypeScript 源码或 WebUI 静态资源后需要重新构建：

```bash
pnpm build
```

只修改配置文件不需要重新构建。

## 16. 安全提醒

- 程序会在任务状态落盘、CLI/TUI/WebUI 输出和后台日志输出前自动脱敏手机号、身份证号、银行卡号、`LOGIN_NAME`、`SES_ID`、密码、Token、钉钉 Webhook / Secret、Server酱 SendKey、钉钉机器人 `clientSecret` 等敏感信息。
- `config/autoticket.state.json` 如果已经存在旧的明文敏感数据，下一次读取状态文件时会自动回写为脱敏后的内容。
- `config/autoticket.json` 是真实登录配置文件，为了能正常执行任务，仍会保存可用的 `loginName` 和 `sesId`。
- 不要提交真实的 `config/autoticket.json`。
- 不要公开手机号、`ses_id`、钉钉 webhook / secret、Server酱 SendKey。
- WebUI 默认监听 `127.0.0.1`，建议只在本机使用。
- 本项目仅用于学习和研究，请遵守相关服务条款和法律法规。
