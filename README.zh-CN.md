# API Vault

[English](README.md)

自托管的 API 密钥管理面板，内置反向代理、用量追踪和余额同步。一个界面管理所有 AI 供应商和 API Key。

## 为什么需要

如果你同时使用多个 AI API 供应商（OpenAI、Anthropic、DeepSeek、OpenRouter 等），在不同工具里管理大量 Key，API Vault 能帮你：

- 集中管理所有供应商和 Key
- 自动记录每次调用的 Token、费用、延迟、错误
- 生成统一代理 URL，粘贴到任何兼容 OpenAI 的工具里即可
- 从供应商计费 API 同步余额和用量
- 通过 Proxy Token 安全地远程调用，不暴露真实 Key

## 工作原理

```
你的 AI 工具  →  API Vault 代理  →  真实供应商 API
                      ↓
                记录调用数据
```

不要把 `https://api.openai.com/v1` 直接填进工具，而是使用 API Vault 代理地址：

```
http://127.0.0.1:3210/proxy/<providerId>/v1
```

API Vault 会注入真实 Key、转发请求、记录结果、返回响应。

## 功能

- **仪表盘** — 总调用次数、Token、费用、成功率概览
- **供应商管理** — 添加/管理供应商，每个供应商下可挂多个 Key，按 Base URL 自动聚合
- **调用记录** — 完整调用历史，含模型、Token、延迟、状态、错误详情
- **分析** — 模型 Token 排行榜和用量分布
- **计费** — 通过自定义 JSON-path 规则同步余额/用量
- **模型目录** — 模型列表，支持从供应商 `/models` 接口自动同步
- **Proxy Token** — 生成带作用域的远程访问令牌，支持速率限制、模型映射、过期时间
- **账号池** — CPA 连接器，批量账号管理
- **本地服务** — 管理本地 AI 服务，含健康检查
- **Cloudflared 隧道** — 一键创建 Cloudflare 公网隧道

### 协议支持

- OpenAI 兼容（`/v1/chat/completions`、`/v1/models`）
- Anthropic 兼容（`/v1/messages`）

### 安全

- 主密码加密所有 vault 数据
- UI 中 API Key 脱敏显示，仅在代理时解密
- 管理用 admin session token 与外部调用用 proxy token 分离
- vault 文件默认被 .gitignore 排除

## 快速开始

### Docker（推荐）

```bash
docker compose up -d --build
```

打开 http://localhost:3210

### Windows

双击 `start-api-vault.bat`（需要先安装 [Node.js LTS](https://nodejs.org/)）

### 手动

```bash
npm install
npm run build
npm run serve
```

## 首次使用

1. 打开 http://127.0.0.1:3210
2. 设置主密码
3. 添加供应商（如 `https://api.openai.com/v1`）和你的 API Key
4. 从供应商卡片复制 **API Vault Base URL**
5. 粘贴到你的 AI 工具的 Base URL 字段
6. 调用会经过 API Vault 并显示在仪表盘中

## 远程访问

CI、脚本或其他机器调用时，创建 **Proxy Token** 而不是暴露真实 Key：

```bash
curl http://YOUR_HOST/proxy/v1/chat/completions \
  -H "Authorization: Bearer proxy_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'
```

详见 [REMOTE_ACCESS.md](./REMOTE_ACCESS.md)，包含 Cloudflare Tunnel、Tailscale 和反向代理部署说明。

## 技术栈

- Node.js + TypeScript
- React + Vite（浏览器 UI）
- 纯 Node.js HTTP 服务（无 Express）
- Docker

这是一个本地浏览器应用，不是 Electron 桌面软件。

## 项目结构

```
src/
  main/       核心逻辑：vault、代理、余额、用量、加密
  renderer/   React 前端
  server/     HTTP 服务、路由、中间件
  shared/     前后端共享 TypeScript 类型
tests/        Node.js 测试
```

## 数据存储

所有数据本地保存在 `.api-vault/vault.json`（加密）。Docker 通过 volume 挂载实现持久化。

## 开发

```bash
npm run dev          # 构建并启动服务
npm run dev:renderer # Vite 前端开发服务器
npm test             # 运行测试
```

## 当前限制

- 只能追踪经过代理的请求
- 各供应商余额 API 格式不同，部分需要手动配置 JSON-path
- 云端工具无法访问本地 `127.0.0.1`，需部署到服务器或使用隧道
- 单用户本地工具，不含团队共享或云同步

## 许可证

MIT
