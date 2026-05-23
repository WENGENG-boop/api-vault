# API Vault 当前进度与半原生账号池计划

本文档用于交接 API Vault 当前状态，并说明下一阶段希望实现的“半原生账号池”方案。

这里的“账号池”主要指把 CLI/OAuth 类账号能力接入 API Vault，让用户可以导入或管理一组 Claude、Codex、Gemini、Grok 等账号，并通过 API Vault 的统一代理、模型映射、Proxy Token 和 JSON 配置导出给客户端使用。

## 1. 项目当前定位

API Vault 目前是一个本地 API 管理与代理工具，核心目标是：

- 集中保存多个 API provider 的 Base URL、协议类型和 API key
- 通过本地代理统一转发请求
- 记录调用日志、token 用量、成本和错误
- 支持 provider 级别代理、全局协议代理和 public proxy token
- 通过 Proxy Token 把内部 provider/key/model mapping 暴露给外部客户端
- 自动生成客户端可用的 JSON 配置，减少手工填 key 和模型名

当前项目更像一个轻量本地版的 API key vault + usage dashboard + model gateway，而不是完整的 CLI/OAuth 账号池系统。

## 2. 当前已实现能力

### 2.1 Vault 与基础安全

- 支持初始化 master password
- API key、query key、proxy token secret 等敏感值会加密存储
- 页面锁定后需要重新解锁
- Proxy Token 支持只展示 masked key，也支持主动 reveal 或 regenerate

### 2.2 Provider 与 API Key 管理

- 支持添加 provider
- 支持 OpenAI-compatible、Anthropic-compatible、OpenAI + Anthropic-compatible 三类协议
- 支持同一个 provider 下多个 API key
- 支持自动合并相同 Base URL 的 provider
- 支持 provider 连接测试
- 支持 provider 级代理 URL

### 2.3 代理能力

项目目前有多种代理入口：

- `/proxy/openai/v1`
- `/proxy/anthropic`
- `/proxy/auto/v1`
- `/proxy/by-key`
- `/proxy/{providerId}/...`
- `/proxy/v1/...`

其中 `/proxy/v1` 是 public proxy token 入口，适合给外部客户端使用。客户端只需要填写 API Vault 生成的 proxy token，不需要知道真实 provider key。

### 2.4 Proxy Token 与模型映射

Proxy Token 当前支持：

- 启用/禁用
- 限制 allowed providers
- 配置 public model -> provider / upstream model 的映射
- 指定某条映射使用 provider 下的某个 API key
- 限制 requests per minute
- 限制 requests per day
- 控制是否允许 stream
- 设置过期时间
- `/proxy/v1/models` 返回当前 proxy token 可用模型列表

这部分已经具备账号池外层网关的基础能力：客户端只看 public model，API Vault 负责把请求转发到真实 provider 和真实 upstream model。

### 2.5 Usage、Billing 与 Dashboard

当前已具备：

- 调用日志
- 成功/失败状态
- provider、key、proxy token、model 维度记录
- input/output/cached/total token 统计
- response cost path 提取
- billing/balance 同步配置
- usage rollup
- dashboard 汇总与模型排行

这对后续账号池很重要，因为账号池不仅要“能转发”，还要能知道每个账号是否可用、用了多少、失败多少。

### 2.6 Local Services

项目已有 Local Services 页面和后端能力，可以保存本地服务：

- name
- baseUrl
- type
- apiKey
- status
- publicAccessUrl
- notes

这为“先接入外部 CLIProxyAPI/CPA 后端”提供了一个现成方向。半原生账号池可以先把 CPA/CLIProxyAPI 当成一种特殊 local service，再逐步升级成更完整的账号池后端。

### 2.7 JSON 配置导出

Proxy Tokens 页面已经新增 JSON File 功能：

- 点击某个 Proxy Token 的 `JSON File`
- 自动读取该 token 对应的真实 proxy key
- 自动生成客户端配置
- 自动把当前模型映射填进 `inferenceModels`
- 模型名带 `[1m]` 时会生成 `supports1m: true`
- 弹窗右上角支持 Copy

当前生成格式：

```json
{
  "inferenceProvider": "gateway",
  "inferenceGatewayBaseUrl": "http://127.0.0.1:3210/proxy/v1",
  "inferenceGatewayApiKey": "proxy_xxx",
  "inferenceModels": [
    {
      "name": "model-name",
      "supports1m": true
    }
  ]
}
```

这已经解决了“客户端配置自动填充”的第一步。

## 3. 当前还没有实现的能力

当前 API Vault 还不是完整账号池系统，主要缺少：

- OAuth 登录流程
- OAuth refresh token 自动刷新
- CLI 账号 JSON 文件上传、解析和生命周期管理
- 账号级状态：可用、失效、冷却、禁用、额度耗尽
- 多账号轮询、权重、失败切换
- 账号池级模型聚合
- 账号池级 `/v1/models` 同步
- 针对 Claude/Codex/Gemini/Grok 等 CLI 账号的协议适配器
- 账号池导入后的配额、套餐、限额识别
- 后端账号池运行时

这些能力不建议直接塞进现有 `Provider.apiKeys`，因为普通 API key 和 CLI/OAuth 账号的生命周期完全不同。

## 4. 为什么选择“阶段 2：半原生账号池”

完整原生账号池虽然最终体验最好，但工程量很大。它需要 API Vault 自己实现 OAuth、refresh、账号状态、provider adapter、轮询策略和兼容协议转换。

半原生账号池的思路是：

- API Vault 负责统一入口、管理体验、配置导出、usage 展示和模型映射
- CPA/CLIProxyAPI 负责复杂的 CLI/OAuth 账号池后端能力
- API Vault 通过 API 调用或文件挂载方式管理 CPA/CLIProxyAPI
- 用户在 API Vault 里看到的是“账号池”，底层可以先由 CPA 执行

这样可以最快得到接近原生账号池的体验，同时避免一开始复制 CLIProxyAPI 的全部底层复杂度。

## 5. 半原生账号池目标

### 5.1 用户视角目标

用户希望在 API Vault 里完成：

- 添加一个账号池后端，例如 CPA/CLIProxyAPI
- 填写 CPA API 地址和管理密钥/API key
- 上传转换好的 JSON 账号文件
- 查看账号是否导入成功
- 查看账号状态、模型、额度或错误
- 一键把账号池模型生成到 Proxy Token mapping
- 一键生成客户端 JSON 配置
- 客户端只连接 API Vault，不直接连接 CPA

最终使用体验应接近：

```text
账号 JSON 文件
  -> API Vault Account Pools 页面上传
  -> CPA/CLIProxyAPI 后端保存和调度账号
  -> API Vault 拉取模型列表
  -> API Vault 生成 Proxy Token mapping
  -> 客户端使用 API Vault JSON 配置
```

### 5.2 技术视角目标

API Vault 不直接处理 OAuth refresh token，而是先把 CPA/CLIProxyAPI 当作账号池 runtime。

API Vault 新增一个 `AccountPool` 概念：

```text
AccountPool
  id
  name
  kind: "cpa"
  baseUrl
  managementUrl
  apiKey / managementSecret
  status
  modelSync
  importedAccounts
  createdAt / updatedAt
```

同时可以把账号池暴露为一个虚拟 provider：

```text
Provider
  name: "CPA Account Pool"
  protocol: "openai-compatible"
  baseUrl: "http://127.0.0.1:8317/v1"
  apiKey: "<CPA_PROXY_API_KEY>"
```

这样现有 Proxy Token、Usage、JSON File 能继续复用。

## 6. 推荐架构

### 6.1 第一层：Account Pools 页面

新增页面：

```text
Account Pools
```

页面功能：

- 添加 CPA/CLIProxyAPI 后端
- 测试连接
- 上传认证 JSON 文件
- 同步模型列表
- 查看账号池状态
- 将模型导入 Proxy Token mapping
- 进入对应 provider 详情

这个页面是“半原生”的关键：用户不需要知道 CPA 的管理页在哪里，也不需要手工跳来跳去。

### 6.2 第二层：CPA Connector

新增一个 connector 层，而不是把 CPA 逻辑散落到页面里。

建议文件：

```text
src/main/accountPools.ts
src/main/cpaConnector.ts
src/renderer/pages/AccountPools.tsx
```

`cpaConnector` 负责：

- 测试 CPA 后端健康
- 调用 CPA/CLIProxyAPI 管理接口
- 上传 JSON 认证文件
- 拉取模型列表
- 拉取账号/配额状态
- 标准化错误

如果 CPA 某些接口不稳定或没有公开 API，短期可以降级为：

- 指导用户把 JSON 放进挂载目录
- API Vault 只检测 CPA `/v1/models`
- API Vault 保存外部账号池配置

### 6.3 第三层：虚拟 Provider

每个账号池可以自动生成或绑定一个 provider。

例如：

```text
Provider Name: CPA Pool
Protocol: OpenAI Compatible
Base URL: http://127.0.0.1:8317/v1
API Key: <CPA_PROXY_API_KEY>
```

好处：

- 不需要重写当前 proxy pipeline
- 不需要重写 usage pipeline
- 不需要重写 Proxy Token mapping
- JSON File 功能可以直接复用

### 6.4 第四层：模型同步与映射生成

账号池连接成功后，API Vault 请求：

```http
GET /v1/models
Authorization: Bearer <CPA_PROXY_API_KEY>
```

然后生成候选模型列表。

用户可以选择：

- 全部导入
- 只导入 Claude
- 只导入 Codex
- 只导入 Gemini
- 手工勾选

导入后自动创建 Proxy Token mapping：

```text
publicModel -> CPA Pool / upstreamModel
```

这样客户端最终只看 API Vault 的模型名。

## 7. 数据模型建议

新增类型：

```ts
export type AccountPoolKind = "cpa";
export type AccountPoolStatus = "unknown" | "available" | "unavailable";

export interface AccountPool {
  id: string;
  name: string;
  kind: AccountPoolKind;
  baseUrl: string;
  managementUrl?: string;
  providerId?: string;
  status: AccountPoolStatus;
  lastCheckedAt?: string;
  modelNames?: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

敏感字段单独加密保存：

```ts
interface AccountPoolRecord extends AccountPool {
  apiKey?: EncryptedText;
  managementSecret?: EncryptedText;
}
```

短期最重要的是 `baseUrl + apiKey + providerId + modelNames`。

## 8. API 设计建议

新增后端 API：

```http
GET /api/account-pools
POST /api/account-pools
DELETE /api/account-pools/:id
POST /api/account-pools/:id/test
POST /api/account-pools/:id/sync-models
POST /api/account-pools/:id/import-models-to-proxy-token
POST /api/account-pools/:id/upload-auth
```

说明：

- `test`：测试 CPA 后端是否可用
- `sync-models`：调用 `/v1/models` 获取模型
- `import-models-to-proxy-token`：把模型写入某个 Proxy Token mapping
- `upload-auth`：上传 JSON 认证文件到 CPA 或保存到指定挂载目录

如果上传文件的实现暂时复杂，可以第一版先不做真正上传，只做：

- 保存 CPA 连接
- 同步模型
- 自动创建 provider
- 自动生成 model mapping

文件上传放第二轮。

## 9. 实施计划

### 第一步：账号池配置与连接测试

目标：

- 新增 Account Pools 页面
- 可以保存 CPA base URL、API key、管理地址/管理密钥
- 可以测试后端 `/` 和 `/v1/models`
- 可以显示 available/unavailable

验收标准：

- 页面能添加一个 CPA 后端
- 测试成功后展示模型数量
- 失败时展示明确错误，例如 401、连接失败、模型为空

### 第二步：自动创建虚拟 Provider

目标：

- 添加账号池时可勾选“Create Provider”
- 自动生成 provider
- provider 的 baseUrl 指向 CPA `/v1`
- provider 的 apiKey 使用 CPA proxy API key

验收标准：

- Providers 页面能看到 CPA Pool provider
- 通过现有 provider test 能成功
- API Vault 能通过这个 provider 转发请求

### 第三步：模型同步到 Proxy Token

目标：

- Account Pools 页面显示同步到的模型列表
- 用户选择一个 Proxy Token
- 一键导入模型映射

映射规则：

```text
publicModel = model.id
providerId = linked CPA provider id
upstreamModel = model.id
```

验收标准：

- Proxy Tokens 页面能看到导入后的 model rules
- `/proxy/v1/models` 返回导入模型
- JSON File 弹窗显示导入模型

### 第四步：JSON 认证文件上传

目标：

- Account Pools 页面支持上传转换好的 JSON 文件
- 文件传给 CPA/CLIProxyAPI 或写入 CPA auths 挂载目录
- 上传后可以触发 CPA 后端刷新或提示重启

注意：

- 这一步要先确认 CPA/CLIProxyAPI 是否有稳定管理上传 API
- 如果没有，就需要用户配置本机 auths 目录路径
- Windows 路径和 Docker volume 映射需要特别谨慎

验收标准：

- 上传后账号出现在 CPA/CLIProxyAPI
- 同步模型能看到新增账号带来的模型
- 错误提示能区分格式错误、权限错误、后端不可达

### 第五步：账号状态展示

目标：

- 展示 CPA 返回的账号列表、可用性、配额、错误
- 如果 CPA 没有统一 API，则先展示模型和后端健康状态
- 后续再扩展账号级详情

验收标准：

- Account Pools 页面不只是配置表单，而是能看到账号池运行状态
- 用户能判断账号是否已经导入、是否可用

## 10. 风险与注意事项

### 10.1 不要过早复制 CLIProxyAPI

短期目标不是重写 CLIProxyAPI，而是把它变成 API Vault 的账号池后端。否则会一下子引入 OAuth、refresh、协议转换、账号轮询等大量复杂度。

### 10.2 文件上传边界要明确

JSON 账号文件通常很敏感。上传、保存、日志、错误提示都不能泄露完整内容。

建议：

- 不在日志里打印 JSON 内容
- 不在 UI 里显示 token
- 保存路径要明确
- 上传前提示这是认证文件
- 后端只返回 masked 文件名或账号摘要

### 10.3 CPA 管理密钥和 API key 不能混淆

CPA 通常有两类 key：

- 管理密钥：用于管理页或管理 API
- Proxy API key：用于客户端请求 `/v1/...`

API Vault 的 Account Pool 表单要明确区分两者。

### 10.4 模型名以 `/v1/models` 为准

账号池里实际可用模型应该以 CPA/CLIProxyAPI 的 `/v1/models` 返回为准。

如果用户手动写了不存在的模型，API Vault 应该提示：

```text
Model not found in account pool model list.
```

### 10.5 Usage 归属

半原生阶段，API Vault 只能准确记录“请求打到了 CPA Pool provider”。如果 CPA 内部选择了哪一个真实账号，API Vault 未必知道。

后续如果 CPA 提供账号级 usage API，可以再把内部账号维度同步回来。

## 11. 推荐最小可行版本

第一版半原生账号池建议只做这些：

1. 新增 Account Pools 页面
2. 支持保存 CPA base URL 和 proxy API key
3. 支持测试 `/v1/models`
4. 支持一键创建 CPA Provider
5. 支持一键把 CPA 模型导入某个 Proxy Token
6. 复用现有 JSON File 弹窗给客户端导出配置

这版做完后，用户已经可以得到完整使用链路：

```text
CPA/CLIProxyAPI 负责账号池
API Vault 负责统一代理、模型映射、统计和 JSON 配置
客户端只连接 API Vault
```

## 12. 后续完全原生化方向

如果半原生方案稳定，后续可以逐步把底层能力迁回 API Vault：

- 原生 OAuth 登录
- 原生 JSON 账号导入
- 原生账号 refresh
- 原生账号轮询
- 原生账号状态和额度
- 原生账号级 usage
- 原生 Claude/Codex/Gemini/Grok adapter

迁移时可以保持 Account Pool 抽象不变，只新增不同 kind：

```ts
export type AccountPoolKind = "cpa" | "native-claude" | "native-codex" | "native-gemini" | "native-grok";
```

这样前端页面和 Proxy Token mapping 不需要推倒重来。

## 13. 当前结论

API Vault 现在已经具备做账号池外层管理的基础：

- 有安全存储
- 有 provider/key
- 有 proxy token
- 有模型映射
- 有 usage
- 有 JSON 配置导出
- 有 local service 概念

下一步不建议直接做完整 OAuth 账号池，而是先做“半原生账号池”：

```text
API Vault Account Pools 页面
  -> 管理 CPA/CLIProxyAPI 后端
  -> 同步模型
  -> 自动创建 provider
  -> 自动写入 proxy token mapping
  -> 继续由 API Vault 对客户端暴露统一 /proxy/v1
```

这条路线最稳，能最快把用户体验做出来，也保留以后完全原生化的空间。
