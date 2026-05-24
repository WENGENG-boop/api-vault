# API Vault 中文说明

API Vault 是一个本地浏览器访问的 API 管理和统计工具，用来集中管理多个 API 平台、多个 API Key、代理 Base URL、调用记录、Token 使用情况，以及第三方平台返回的余额或用量数据。

它适合这些场景：

- 你有很多官方或第三方 API 平台
- 你经常忘记某个 API Key 对应哪个平台
- 你想知道每个模型被调用了多少次
- 你想统计每次调用消耗了多少 Token
- 你想看到调用成功、失败、错误信息
- 你想把多个 API Key 按同一个供应商聚合管理
- 你想把一个统一的代理 Base URL 填到第三方工具里，让所有调用都被记录

这个项目默认在本地运行。用户启动以后自己添加 API Key。本仓库不包含任何真实 API Key 或个人 vault 数据。

## 核心原理

很多 AI 工具都支持自定义 API Base URL 和 API Key。API Vault 的作用是放在第三方工具和真实 API 平台中间。

不要把真实平台的 Base URL 直接填进第三方工具，而是复制 API Vault 生成的代理地址：

```text
http://127.0.0.1:3210/proxy/<providerId>/v1
```

调用链路变成：

```text
第三方工具
  -> API Vault 本地代理
  -> 真实上游 API 平台
  -> API Vault 记录调用数据
  -> 返回结果给第三方工具
```

API Vault 会负责注入或匹配真实 API Key、转发请求、记录调用结果，并在网页里显示统计数据。

## 最重要：API Vault Base URL 是什么

页面里最重要的字段是：

```text
API Vault Base URL - copy this into the third-party app
```

中文意思就是：

```text
把这个 API Vault Base URL 复制到第三方工具里
```

这是 API Vault 用来统计调用数据的入口。

添加 Provider 和 API Key 后，页面里会出现两种 URL：

```text
Original Base URL
```

这是原始平台的真实地址，例如：

```text
https://api.openai.com/v1
https://openrouter.ai/api/v1
https://api.deepseek.com/v1
https://jmrai.net/v1
```

还有：

```text
API Vault Base URL
```

这是 API Vault 生成的 Provider 级本地代理地址。同一个 Provider 下面的所有 Key 共用这个地址，例如：

```text
http://127.0.0.1:3210/proxy/provider_abc/v1
```

你应该复制 **API Vault Base URL**，不是复制 **Original Base URL**。

## API Vault Base URL 应该填到哪里

在第三方工具里，找到类似这些字段：

- Base URL
- API Base URL
- Custom API URL
- OpenAI Compatible Base URL
- Endpoint
- 接口地址
- 自定义 API 地址

然后把 **API Vault Base URL** 粘贴进去。

例如第三方工具里应该这样填：

```text
Base URL:
http://127.0.0.1:3210/proxy/provider_abc/v1
```

API Key 字段应该仍然填写用户自己的真实 API Key。API Vault 会用这个 Key 判断应该把调用记录归到该 Provider 下面的哪一个 Key。

## 为什么必须使用 API Vault Base URL

API Vault 只能统计经过它代理的请求。

如果第三方工具直接调用真实平台：

```text
https://api.openai.com/v1
```

API Vault 完全看不到这个请求，所以页面里不会出现调用记录。

如果第三方工具调用 API Vault 代理：

```text
http://127.0.0.1:3210/proxy/provider_abc/v1
```

API Vault 就可以：

- 把请求转发到真实平台
- 识别或注入对应 API Key
- 记录使用的模型
- 记录成功或失败状态
- 记录输入 Token 和输出 Token
- 记录延迟
- 记录错误信息
- 在 Dashboard 和 Usage 页面显示调用数据

## 本地工具和云端工具的区别

如果第三方工具也运行在你的电脑上，可以使用：

```text
http://127.0.0.1:3210
```

或者：

```text
http://localhost:3210
```

如果第三方工具是云端网站或云服务器，它不能访问你个人电脑上的 `127.0.0.1`。

这种情况需要把 API Vault 部署到一台公网服务器上，并配置 HTTPS，例如：

```text
https://api-vault.example.com/proxy/provider_abc/v1
```

然后把这个 HTTPS 的 API Vault Base URL 填到云端平台里。

## 功能列表

- 本地浏览器仪表盘
- Provider 管理
- API Key 管理
- 同一个 Provider 下管理多个 Key
- 根据 Base URL 自动聚合同一个供应商
- 同一个 Provider 下所有 Key 共用一个 API Vault Base URL
- OpenAI-compatible 协议转发
- Anthropic-compatible 协议转发
- 调用历史记录
- Provider 总统计
- API Key 单独统计
- 模型 Token 使用排行榜
- 自定义余额或用量同步
- 本地加密保存 vault 数据
- Docker 部署
- Windows 双击启动

## 能统计哪些数据

只要请求经过 API Vault 代理，每次调用都会记录：

- 调用时间
- Provider
- Base URL
- API Key 名称或脱敏 Key
- 模型名称
- 请求状态
- 输入 Token
- 输出 Token
- 总 Token
- 本次费用，如果接口返回或可识别
- 请求延迟
- 错误信息，如果调用失败

## Provider 和 API Key 聚合逻辑

API Vault 会把同一个 Base URL 的 Key 归到同一个 Provider 下。

例如：

```text
https://api.openai.com/v1  key1
https://api.openai.com/v1  key2
https://api.openai.com/v1  key3
```

会显示为：

```text
OpenAI
  - key1
  - key2
  - key3
```

Provider 展示总调用次数、总 Token、总费用、最近调用时间等汇总信息。

每个 API Key 也会单独展示自己的调用次数、Token、费用和最近调用时间。

如果添加新 Key 时 Base URL 已经存在，API Vault 不会新建 Provider，而是把这个 Key 加到已有 Provider 下面。

## Docker 启动

克隆项目后运行：

```bash
docker compose up -d --build
```

打开：

```text
http://localhost:3210
```

停止：

```bash
docker compose down
```

查看日志：

```bash
docker compose logs -f
```

更新后重新构建：

```bash
docker compose up -d --build
```

## Windows 双击启动

先安装官方 Node.js LTS：

```text
https://nodejs.org/en/download/
```

然后双击：

```text
start-api-vault.bat
```

脚本会自动：

1. 检查是否安装 Node.js 和 npm
2. 使用 `npm install` 安装依赖
3. 构建项目
4. 在 `3210` 端口启动本地服务
5. 自动打开浏览器

如果浏览器没有自动打开，可以手动访问：

```text
http://127.0.0.1:3210
```

## 手动命令

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

启动：

```bash
npm run serve
```

测试：

```bash
npm test
```

开发模式：

```bash
npm run dev
```

## 第一次使用流程

1. 打开 `http://127.0.0.1:3210`
2. 设置主密码
3. 添加 Provider 或 API Key
4. 输入原始平台 Base URL，例如：

```text
https://api.openai.com/v1
https://api.anthropic.com
https://openrouter.ai/api/v1
https://api.deepseek.com/v1
```

5. 输入用户自己的 API Key
6. 复制页面显示的 API Vault Base URL
7. 把 API Vault Base URL 填到第三方工具的 Base URL 字段
8. 在第三方工具里发起一次模型调用
9. 回到 API Vault 查看 Dashboard 或 Usage 页面

## 数据保存在哪里

用户启动项目后，本地会生成：

```text
.api-vault/vault.json
```

这个文件保存加密后的 Provider、API Key 和本地调用记录。

干净仓库默认排除这些内容：

```text
.api-vault/
node_modules/
dist/
dist-main/
*.log
.env
```

## 隐私和安全

- 仓库里不包含 API Key
- 用户启动后自己填写 API Key
- API Key 本地保存
- vault 文件被 `.gitignore` 排除
- UI 中默认只展示脱敏 Key
- 完整 Key 只在代理请求或复制时临时解密

这个项目默认适合本地自用。如果要公开部署，请务必配置 HTTPS、访问控制、防火墙和认证策略。

## Docker 数据持久化

Docker Compose 会把本地目录挂载进容器：

```yaml
volumes:
  - ./.api-vault:/app/.api-vault
```

所以容器重启后数据仍然保存在用户自己的项目目录里。

重置本地数据：

```bash
docker compose down
rm -rf .api-vault
```

Windows PowerShell：

```powershell
docker compose down
Remove-Item -Recurse -Force .\.api-vault
```

## 余额和用量同步

不同第三方平台返回余额或用量的接口格式不一样。

API Vault 支持自定义同步规则：

- Balance URL
- HTTP Method
- Headers
- JSON 路径

如果平台返回的是 `token_usage`、`tokens` 或其他单位，API Vault 会尽量按平台返回的单位展示，而不是强行转换成某一种货币。

## 项目结构

```text
src/
  main/       vault、proxy、balance、usage 等核心逻辑
  renderer/   浏览器前端界面
  server/     本地 HTTP 服务
  shared/     前后端共享类型

tests/        Node 测试文件

Dockerfile
docker-compose.yml
start-api-vault.bat
package.json
```

## 技术栈

- Node.js
- TypeScript
- React
- Vite
- Docker

这是一个本地浏览器应用，不是 Electron 桌面软件。

## 当前限制

- 只有经过 API Vault 代理的请求才能被统计
- 不同平台的余额接口差异很大，可能需要手动配置
- 云端第三方平台不能访问用户电脑的 `127.0.0.1`
- 默认是本地单机工具，不包含账号、团队共享或云同步

## 上传 GitHub 前检查

上传前确认不要包含：

```text
.api-vault/
node_modules/
dist/
dist-main/
*.log
```

本发布文件夹已经按这个原则整理。

用户克隆后可以运行：

```bash
docker compose up -d --build
```

或者在 Windows 上双击：

```text
start-api-vault.bat
```

## 远程公网代理

如果要让第三方电脑、CI、脚本或公网隧道调用，不要把真实 Provider API Key 暴露出去。请在 **Proxy Tokens** 页面创建 `proxy_xxx`，配置允许的 Provider、模型映射、是否允许流式、每分钟限制、每日限制和过期时间，然后调用：

```text
POST /proxy/v1/chat/completions
GET  /proxy/v1/models
```

请求头使用：

```text
Authorization: Bearer proxy_xxx
```

API Vault 会验证 Proxy Token，按模型映射选择内部 Provider 和真实模型 ID，在服务端注入加密保存的真实 API Key，转发请求并记录 provider、key、model、token、状态码和延迟。公网部署说明见 [REMOTE_ACCESS.md](./REMOTE_ACCESS.md)，里面包含 Cloudflare Tunnel、Tailscale 和反向代理建议。


## Cloudflared Tunnel（本地服务页）

本地服务页面支持 Cloudflared Tunnel，包含明确阶段：idle、starting、unning、stopping、error。

Cloudflared 接口：
- GET /api/cloudflared/status
- POST /api/cloudflared/start
- POST /api/cloudflared/stop
- GET /api/cloudflared/logs?limit=200

启动配置（白名单参数）：
- 	argetPort（默认代理端口）
- protocol：http 或 https
- hostname（可选）
- 
oAutoUpdate（可选）

常见结构化错误码：
- MISSING_BINARY
- START_TIMEOUT
- TUNNEL_URL_NOT_FOUND
- PROCESS_EXITED
- PROCESS_ERROR
- MANAGER_UNAVAILABLE

