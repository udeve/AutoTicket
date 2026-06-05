# AutoTicket TypeScript / Node.js

这是 AutoTicket 当前推荐的新版本实现，所有新版 CLI、TUI、WebUI、定时任务和核心业务逻辑都在本目录内维护。

旧 Python、旧 JavaScript、uni-app 小程序实现仍保留在仓库根目录，作为历史实现参考。

## 目录定位

本目录是一个完整独立的 TypeScript 项目。常规使用时请先进入本目录：

```bash
cd typescript
```

默认配置和状态文件都相对当前工作目录生成，因此从仓库根目录直接执行 `node typescript/dist/cli/index.js ...` 会把配置写到根目录的 `config/` 下。推荐始终在 `typescript/` 目录内运行。

主要目录：

```text
src/        TypeScript 源码
public/     WebUI 静态资源
config/     配置模板、运行时配置和状态文件
tests/      单元测试
docs/       中文架构说明和用户手册
dist/       构建产物
```

## 快速开始

```bash
pnpm install
pnpm check
pnpm build
```

启动交互式 TUI：

```bash
node dist/cli/index.js ui
```

启动 WebUI：

```bash
node dist/cli/index.js web
```

默认地址：

```text
http://127.0.0.1:3210
```

## 配置文件

默认配置路径是相对当前目录的：

```text
config/autoticket.json
```

任务状态文件是：

```text
config/autoticket.state.json
```

首次运行需要配置的命令时，程序会自动生成配置文件。短信登录、密码登录、LOGIN_NAME + SES_ID 直接登录成功后，会自动保存或更新用户会话。

配置模板见 [config/autoticket.example.json](config/autoticket.example.json)。真实账号、`sesId`、钉钉 Webhook 和 Secret 不要提交。

## 常用命令

```bash
node dist/cli/index.js login direct --user user1 --login-name LOGIN_NAME --ses-id SES_ID
node dist/cli/index.js login captcha
node dist/cli/index.js login send-sms --phone 13800000000 --img-uni-code 图片唯一编号 --captcha 图形验证码
node dist/cli/index.js login sms --user user1 --phone 13800000000 --code 123456
node dist/cli/index.js login password --user user1 --phone 13800000000 --password 密码 --img-uni-code 图片唯一编号 --captcha 图形验证码
node dist/cli/index.js users
node dist/cli/index.js user status --user user1
node dist/cli/index.js daily --user user1
node dist/cli/index.js exchange --user user1
node dist/cli/index.js state
```

`package.json` 暴露了 `autoticket` bin，安装或链接后也可以使用：

```bash
autoticket ui
autoticket users
autoticket exchange --user user1
```

未安装为全局命令时，直接使用 `node dist/cli/index.js ...` 最稳定。

## 功能形态

三种入口共用同一套 `src/core/` 核心实现：

| 入口 | 命令 | 适合场景 |
|---|---|---|
| CLI | `node dist/cli/index.js ...` | 脚本化、排错、自动化 |
| TUI | `node dist/cli/index.js ui` | 日常交互配置、登录、定时任务管理 |
| WebUI | `node dist/cli/index.js web` | 本地浏览器查看用户、状态和手动执行任务 |

TUI 当前功能最完整，包含钉钉通知测试、PM2 后台管理和定时任务设置。WebUI 侧重本地浏览器里的登录、状态查看、每日任务和兑换执行。

## 定时任务

前台运行：

```bash
node dist/cli/index.js schedule run
```

PM2 后台运行：

```bash
npm install -g pm2
node dist/cli/index.js schedule start
node dist/cli/index.js schedule restart
node dist/cli/index.js schedule status
node dist/cli/index.js schedule logs
node dist/cli/index.js schedule stop
```

`schedule restart` 会先删除旧的 `autoticket-schedule` PM2 进程记录，再按当前目录重新启动，适合项目目录迁移后使用。

查看明天每日任务执行时间：

```bash
node dist/cli/index.js schedule daily-plan
```

指定日期：

```bash
node dist/cli/index.js schedule daily-plan --date 2026-06-05
```

如果每日任务是随机时间区间模式，查看时会为每个账号生成并保存该日期的随机执行时间；之后重启后台或再次查看都会复用同一个时间。

多账号会使用“账号片段随机分配 + 片内随机”：先随机决定哪个账号落在哪个时间片段，再在各自片段内随机到秒。同一天同一账号重复查看会复用已生成结果，避免后台重启后计划漂移。

## 兑换停止规则

兑换使用 `stopRules` 同时表达“何时停止”和“停止后记为成功还是失败”：

```json
"stopRules": [
  { "match": "兑换中", "status": "success" },
  { "match": "兑换成功", "status": "success" },
  { "match": "已达上限", "status": "success" },
  { "match": "手慢啦", "status": "failure" }
]
```

命中 `match` 后会停止当前账号当前轮次。`status` 决定今日状态记录为 `SUCC` 还是 `FAIL`。

默认规则中 `手慢啦` 会停止当前轮次，但记录为失败；只有记录为成功的兑换才会触发定时兑换的 `stopAfterSuccess`，跳过当天后续场次。

## 敏感信息脱敏

程序会在状态落盘和界面输出前自动脱敏手机号、身份证号、银行卡号、`LOGIN_NAME`、`SES_ID`、密码、Token、钉钉 Webhook 和 Secret 等敏感信息。

`config/autoticket.state.json` 只用于记录任务执行状态，读取旧状态文件时也会自动回写脱敏后的内容。`config/autoticket.json` 是真实登录配置，仍需要保存可用的 `loginName` 和 `sesId` 才能执行任务，请不要提交或公开该文件。

## 文档

- [架构设计与实现说明](docs/architecture-and-implementation.zh-CN.md)
- [用户使用手册](docs/user-manual.zh-CN.md)
- [迁移说明](docs/typescript-core-migration.md)

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

或直接运行：

```bash
pnpm check
```
