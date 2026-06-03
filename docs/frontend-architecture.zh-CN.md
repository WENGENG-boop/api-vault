# 前端架构与界面内容清单（UI/UX 重构参考文档）

> 本文档用于在**不破坏现有项目**的前提下重构 UI/UX。它描述当前前端的技术架构、每个界面**包含哪些内容（数据项与功能）**，以及每块内容所调用的后端接口。
> **本文档不涉及任何界面样式 / 布局描述，只说明内容。**
>
> 适用版本：`api-vault-demo` 0.1.0 ｜ 生成日期：2026-06-02

---

## 第一部分：当前前端架构

### 1.1 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 框架 | **React 19** + **Next.js 16（App Router）** | 渲染层用 React，宿主用 Next.js；亦可打包进 **Electron 42** 桌面端 |
| 语言 | TypeScript 6 | 前后端共享 `src/shared/types.ts` |
| 状态管理 | React Hooks + 自定义 `useAppState` | **无 Redux / Zustand**，单一 `AppState` 自顶向下传递 |
| 数据获取 | 原生 `fetch` 封装（`apiClient`） | 也支持 Electron 注入的 `window.apiVault` |
| 构建 | `next build`（renderer）+ `tsc`（main/server） | |

### 1.2 渲染入口与路由

```
Next.js App Router (src/app/)
├── page.tsx        (/)        # 独立营销官网（与应用本体无关）
└── vault/page.tsx  (/vault)   # 真正的应用 <App/>
                                   ↓
src/renderer/app/App.tsx        # 应用根组件（SPA）
```

- **真正的 Web App 在 `/vault` 路由**，由 `src/renderer/app/App.tsx` 驱动。

### 1.3 应用内部分层（`src/renderer/`）

```
app/                       # 应用骨架
├── App.tsx                # 鉴权门控 + Tab 路由
├── AppShell.tsx           # 导航（顶栏 3 分类 + 侧栏 9 Tab）
├── AuthScreen.tsx         # 初始化 / 解锁页
├── useAppState.ts         # 全局状态拉取 + 5 秒轮询
└── types.ts               # AppTab（9 个 Tab）

features/                  # 9 个功能页面（每个 = 一个 Tab）
│  dashboard / providers / status / models / account-pools /
│  proxy-tokens / local-services / usage / billing

shared/
├── api/apiClient.ts       # 所有后端接口的唯一封装
├── components/            # 通用组件
├── config/constants.ts    # 轮询间隔 5000ms、Usage 每页 100 条
└── utils/                 # 数据聚合
```

### 1.4 全局状态模型（`AppState`）

整个应用围绕单个 `AppState`（`src/shared/types.ts`），包含：

| 字段 | 内容 |
|------|------|
| `initialized` / `unlocked` | 是否已设主密码 / 是否已解锁 |
| `adminToken` | 解锁后返回，存 sessionStorage |
| `proxyPort` | 代理端口（默认 3210）|
| `providers` | 提供商（含脱敏密钥）|
| `proxyTokens` | 代理令牌 |
| `accountPools` | 账号池 |
| `modelCatalog` | 模型目录 |
| `usageEvents` / `usageRollups` | 调用明细 / 聚合 |
| `balanceSnapshots` | 余额快照 |
| `totals` | 汇总指标 |
| `localServices` | 本地服务 |
| `cloudflared` | 隧道状态 |

- 由 `useAppState()` 拉取，解锁后**每 5 秒轮询** `GET /api/state`。
- 各页面通过 props 收到 `state` / `setState`，操作成功后用接口返回的新 `AppState` 覆盖。

### 1.5 鉴权门控流程

```
GET /api/state
  ├─ state == null            → 加载中
  ├─ !initialized             → 设置主密码页
  ├─ initialized & !unlocked  → 解锁页
  └─ unlocked                 → 导航 + 当前 Tab 页面
```

- 解锁成功返回 `adminToken` → 存 sessionStorage → 后续请求带 `x-api-vault-admin` 头；401 或锁定时清除。

### 1.6 导航结构（两级）

| 顶栏分类 | 侧栏 Tab |
|----------|----------|
| **Gateway** | Dashboard、Providers、Account Pools、Local Services |
| **Access Control** | Proxy Tokens、Models |
| **Analytics & Billing** | Status、Usage、Billing |

常驻信息：代理端口、隧道状态、Lock Vault、`<N> calls recorded` 录制计数。

---

## 第二部分：界面内容清单（每个界面包含哪些内容）

### 2.0 鉴权页 `AuthScreen`
- 主密码输入（setup 要求 8+ 位）
- 操作：初始化 Vault / 解锁
- 错误提示

---

### 2.1 Dashboard（仪表盘）
**包含内容：**
- **行动中心（Action Center）**：根据状态动态生成的待办项，触发条件：
  - 无 Provider → 添加 Provider
  - 有 Provider 无 Proxy Token → 创建令牌
  - 有令牌无模型映射 → 配置 Model Mapping
  - 有失败请求 → 去 Usage 查看（含最近失败的状态码 / 模型 / 错误）
  - 有本地服务但隧道未开 → 启动 Cloudflared
- **视图切换**：Overview / Models；**时间范围**：All / 30d / 7d / today
- **Overview 统计项**：Sessions、Messages、Total tokens、Active days、Current streak、Longest streak、Peak hour、Favorite model；以及按天的 Token 活跃度数据
- **Models**：模型 Token 占比（Top 6）+ 前 4 名 input/output 明细
- **Top Token Provider**：Token 用量最高的提供商（calls / total / input / output / cached）
- **API Connection Status**：各 Provider 与本地服务的连通性（状态、baseUrl、延迟、检查时间、单项测试、隧道公网 URL）

**接口：** `GET /api/state`、`POST /api/test-url`、`POST /api/local-services/:id/test`

---

### 2.2 Providers（提供商与密钥）
**包含内容：**
- **全局代理基址**：OpenAI / Anthropic / Auto 三种协议的全局 Base URL（可复制）
- **新增/编辑密钥**：Provider Name、Key Name、Protocol、Base URL（含连通性测试）、Currency、API Key、Query Key、是否本地服务
- **余额同步配置**：开关、Balance URL、Method、Headers JSON、Balance/Spent/Response Cost 的 JSON Path、自动同步间隔
- **提供商列表**（每项）：名称、是否本地、协议、密钥数、Base URL、连通性、统计（calls / tokens / cost / 最后使用）
- **提供商详情**：元数据编辑、原始 Base URL 与 Provider 代理 URL、密钥列表（名称、脱敏值、是否含 query key、各密钥统计）、增删密钥、删除 Provider

**接口：** `POST /api/providers/add-key`、`POST /api/providers`、`DELETE /api/providers/:id`、`DELETE /api/providers/:id/keys/:keyId`、`GET /api/providers/:id/keys/:keyId/secret`、`GET /api/providers/:id/proxy-url`、`POST /api/test-url`

---

### 2.3 Status（状态监控）
**包含内容：**
- **总览指标**：Avg Latency (7d)、Total Requests、Active Gateways、Models Monitored
- **视图切换**：Providers / Models / Connection Latency
- **过滤**：健康度（全部 / 健康 / 有问题 / 不活跃）；**排序**：调用量 / 名称 / 响应最快 / 成功率；搜索
- **Providers / Models 每项内容**：状态等级、名称、成功率、平均延迟、7 天调用量、延迟趋势数据、Uptime 历史、延迟分位（p50/p95/p99/Peak）、连接状态与 Ping、最后检查时间、最近请求明细（最多 15 条）
- **Connection Latency 内容**：时间范围（最近 1 小时 / 24 小时 / 7 天 / 指定某天）；分组——Provider 连接（每 10 秒探测）与 Models（来自真实调用）；按小时聚合的延迟序列

**接口：** `GET /api/state`（本页只读，数据来自 `usageEvents` 与 Provider 延迟历史）

---

### 2.4 Models（模型目录）
**包含内容：**
- **过滤**：搜索、按 Provider、按能力（Text / Vision / Tools / Long Context / Reasoning）
- **同步**：按 Provider 触发模型同步
- **手动新增/编辑模型**：Provider、Model ID、Display Name、Aliases、Input/Output Price、Context Window、能力多选
- **汇总**：模型总数、分组名数、手动条目数
- **模型分组列表**（按显示名/canonical 聚合，每项）：分组名、provider 数、调用量、成功率、成本、能力标签；展开后每个 provider 变体含 modelId、aliases、来源、context、价格、最后见到时间、统计

**接口：** `GET /api/model-catalog`、`POST /api/model-catalog/sync-provider/:providerId`、`POST /api/model-catalog/manual`、`POST /api/model-catalog/:id`、`DELETE /api/model-catalog/:id`

---

### 2.5 Account Pools（账号池，对接 CPA / CLIProxyAPI）
**包含内容：**
- **新增/编辑账号池**：Backend Type、Name、Base URL、Proxy API Key、Management URL、Management Secret、Auths Directory、Notes、是否同时创建 Provider
- **账号池列表**（每项）：名称、类型、状态、Base URL、模型数、Key 脱敏、/v1/models 与 Root 的 HTTP 状态、延迟、检查时间、错误、关联 Provider、已同步模型列表
- **操作**：选择 Proxy Token 导入模型、上传 auth JSON、测试连接、同步模型、创建/更新 Provider、删除

**接口：** `GET /api/account-pools`、`POST /api/account-pools`、`DELETE /api/account-pools/:id`、`POST /api/account-pools/:id/create-provider`、`POST /api/account-pools/:id/test`、`POST /api/account-pools/:id/sync-models`、`POST /api/account-pools/:id/import-models-to-proxy-token`、`POST /api/account-pools/:id/upload-auth`

---

### 2.6 Proxy Tokens（代理令牌）
**包含内容：**
- **用法说明**：`Authorization: Bearer proxy_xxx` → `/proxy/v1/chat/completions`
- **新增/编辑令牌**：Token Name、每分钟/每天请求上限、过期时间、是否允许流式、允许的 Provider（多选）
- **模型映射**：Public model → Provider / Upstream model / Key；支持从模型目录或账号池批量导入；可测试 Provider 拉取真实模型列表；规则的 ready / missing 状态
- **令牌列表**（每项）：名称、启用状态、脱敏令牌、模型规则数、限额、流式开关、只读规则列表
- **操作**：编辑映射、揭示明文 Key、生成可粘贴的 JSON 配置（base URL + token + 映射模型）、启用/停用、重新生成、删除

**接口：** `POST /api/proxy-tokens`、`POST /api/proxy-tokens/:id`、`DELETE /api/proxy-tokens/:id`、`GET /api/proxy-tokens/:id/secret`、`POST /api/proxy-tokens/:id/regenerate`、`POST /api/test-url`、`GET /api/model-catalog`

---

### 2.7 Local Services（本地服务 + Cloudflared 隧道）
**包含内容：**
- **隧道控制**：启动/停止 Cloudflared；状态（未安装 / 运行中 / 错误 / 未运行）；运行时显示公网 URL 与拼接规则 `/api/proxy/local/:serviceId/v1`；隧道配置（Target Port、Protocol、Hostname、noAutoUpdate）；日志
- **新增本地服务**：Service Name、Base URL（含测试）、Type（unknown / openai / anthropic / custom）、API Key、Notes
- **本地服务列表**（每项）：名称、类型、Base URL、连通状态、延迟、检查时间、Key 脱敏、公网代理 URL、测试连接、删除

**接口：** `GET /api/local-services`、`POST /api/local-services`、`DELETE /api/local-services/:id`、`POST /api/local-services/:id/test`、`GET /api/cloudflared/status`、`POST /api/cloudflared/start`、`POST /api/cloudflared/stop`、`GET /api/cloudflared/logs`、`POST /api/test-url`

---

### 2.8 Usage（调用日志）
**包含内容：**
- **过滤**：按 Provider、按 Key、关键词（模型 / 网关 / Base URL / 状态 / 错误）
- **汇总**：失败数、筛选后总成本、分页（每页 100 条）
- **调用列表字段**：时间、Provider、Base URL、Gateway、Key、Model、状态、Input、Output、成本、延迟、错误
- **单条详情**：状态、模型、时间、Provider、Base/Gateway URL、Key、Proxy Token、Tokens（total/input/output）、成本、延迟、Endpoint（method+path）、错误全文

**接口：** `GET /api/state`（只读，数据来自 `usageEvents`）

---

### 2.9 Billing（账单与额度）
**包含内容：**（按 Provider）
- 同步余额操作（未配置则不可用）
- 可用余额（或无限额度）
- 额度使用情况（Spent / Granted 比例）
- 明细：Total Spent、Total Granted、所用 API Token
- 最后检查时间、错误信息
- 历史同步记录（最多 10 条）

**接口：** `POST /api/providers/:id/test-balance`、`GET /api/state`（`balanceSnapshots`）

---

## 第三部分：后端接口总表

> 封装于 `src/renderer/shared/api/apiClient.ts`，路由在 `src/server/routes/apiRoutes.ts`。
> 除 `setup` / `unlock` / `state` 外均需 `x-api-vault-admin` 头；多数写操作直接返回新的 `AppState`。

### 鉴权 / 全局
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/state` | 拉取全局状态 |
| POST | `/api/vault/setup` | 设置主密码，返回 adminToken |
| POST | `/api/vault/unlock` | 解锁，返回 adminToken |
| POST | `/api/vault/lock` | 锁定 |

### Providers / Keys
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/providers` | 新建/更新 Provider |
| POST | `/api/providers/add-key` | 添加密钥（自动合并 Provider）|
| POST | `/api/providers/:id/keys` | 给 Provider 加 key |
| DELETE | `/api/providers/:id/keys/:keyId` | 删除 key |
| DELETE | `/api/providers/:id` | 删除 Provider |
| GET | `/api/providers/:id/keys/:keyId/secret?kind=api\|query` | 取明文 key |
| GET | `/api/providers/:id/keys/:keyId/proxy-url` | key 级代理 URL |
| GET | `/api/providers/:id/proxy-url` | Provider 级代理 URL |
| GET | `/api/providers/:id/secret` | 取首个 key 明文 |
| POST | `/api/providers/:id/test-balance` | 同步余额 |
| POST | `/api/test-url` | 测试 Base URL 连通性（含拉模型列表）|

### Model Catalog
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/model-catalog` | 列出模型目录 |
| POST | `/api/model-catalog/sync-provider/:providerId` | 同步模型 |
| POST | `/api/model-catalog/manual` | 手动新增 |
| POST | `/api/model-catalog/:id` | 更新 |
| DELETE | `/api/model-catalog/:id` | 删除 |

### Account Pools
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/account-pools` | 列出 |
| POST | `/api/account-pools` | 新建/更新（可选建 Provider）|
| DELETE | `/api/account-pools/:id` | 删除 |
| POST | `/api/account-pools/:id/create-provider` | 创建关联 Provider |
| POST | `/api/account-pools/:id/test` | 测试连接 |
| POST | `/api/account-pools/:id/sync-models` | 同步模型 |
| POST | `/api/account-pools/:id/import-models-to-proxy-token` | 导入模型到令牌 |
| POST | `/api/account-pools/:id/upload-auth` | 上传 auth JSON |

### Proxy Tokens
| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/proxy-tokens` | 创建（返回一次性 secret）|
| POST | `/api/proxy-tokens/:id` | 更新 / 启停 |
| DELETE | `/api/proxy-tokens/:id` | 删除 |
| GET | `/api/proxy-tokens/:id/secret` | 揭示明文 |
| POST | `/api/proxy-tokens/:id/regenerate` | 重新生成 |

### Local Services
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/local-services` | 列出 |
| POST | `/api/local-services` | 新建/更新 |
| DELETE | `/api/local-services/:id` | 删除 |
| POST | `/api/local-services/:id/test` | 测试连接 |

### Cloudflared 隧道
| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/cloudflared/status` | 隧道状态 |
| POST | `/api/cloudflared/start` | 启动 |
| POST | `/api/cloudflared/stop` | 停止 |
| GET | `/api/cloudflared/logs?limit=N` | 日志 |

