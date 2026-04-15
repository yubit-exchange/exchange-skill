# Yubit Exchange Skill

Yubit 交易 MCP Server — 让 AI 助手通过自然语言查询行情、管理资金、查询现货 / TradFi / 理财资产、执行永续合约交易。

支持 [OpenClaw](https://github.com/openclaw/openclaw) / [Claude Code](https://claude.ai/claude-code) / [OpenAI Codex](https://developers.openai.com/codex/cli) / [Cursor](https://cursor.sh) / [LobeChat Desktop](https://github.com/lobehub/lobe-chat) 等所有兼容 [MCP](https://modelcontextprotocol.io) 协议的 AI 工具。

## 目录

- [1. 功能概览](#1-功能概览)
- [2. 模块](#2-模块)
- [3. 快速开始](#3-快速开始)
- [4. 手动接入](#4-手动接入)
  - [4.1 OpenClaw](#41-openclaw)
  - [4.2 Claude Code](#42-claude-code)
  - [4.3 OpenAI Codex CLI](#43-openai-codex-cli)
  - [4.4 Cursor](#44-cursor)
  - [4.5 LobeChat Desktop](#45-lobechat-desktop)
- [5. 自然语言示例](#5-自然语言示例)
- [6. 可用工具](#6-可用工具)
  - [6.1 行情](#61-行情公开无需认证)
  - [6.2 钱包](#62-钱包需要-api-key)
  - [6.3 现货](#63-现货需要-api-key)
  - [6.4 TradFi](#64-tradfi需要-api-key)
  - [6.5 理财](#65-理财需要-api-key)
  - [6.6 永续查询](#66-永续查询需要-api-key)
  - [6.7 永续交易](#67-永续交易需要-api-key--exchange_enable_tradetrue)
  - [6.8 诊断](#68-诊断无需认证)
- [7. 权限分级](#7-权限分级)
- [8. 安全机制](#8-安全机制)
- [9. 环境变量](#9-环境变量)
- [10. Agent Skills](#10-agent-skills)
- [11. CLI 命令](#11-cli-命令)
- [12. 项目结构](#12-项目结构)
- [13. 测试](#13-测试)
- [14. 开发贡献](#14-开发贡献)
- [15. 常见问题](#15-常见问题)
- [16. 签名算法](#16-签名算法)
- [17. License](#17-license)

---

## 1. 功能概览

| 特性 | 说明 |
|------|------|
| **39 个工具，7 个模块** | 行情 → 钱包 → 现货 → TradFi → 理财 → 永续交易 → 诊断，覆盖完整交易链路 |
| **安全控制** | 三级权限分级、参数前置校验、批量操作二次确认 |
| **可追溯** | 每次调用返回 `traceId`，可回查原始 HTTP 请求/响应 |
| **零基础设施** | 本地 stdio 进程，API Key 不离开本机 |
| **一键安装** | `yubit setup` 自动检测 AI 工具并配置 |

## 2. 模块

| 模块 | 工具数 | 说明 | 认证 |
|------|:------:|------|:----:|
| `market` | 9 | 实时行情、K 线、深度、资金费率、合约规格、风险限额 | 无需 |
| `wallet` | 3 | 资金账户资产、全账户总资产（USDT 计价）、账户间划转 | API Key |
| `spot` | 1 | 现货账户资产列表（总额、可用、冻结） | API Key |
| `tradfi` | 1 | TradFi 账户详情（余额、净值、保证金、浮动盈亏） | API Key |
| `earn` | 1 | 理财账户资产与收益明细 | API Key |
| `perp` | 21 | 永续余额/持仓/挂单/历史/资金流水 + 下单/安全加仓/撤单/止盈止损/杠杆/仓位模式 | API Key + Trade |
| `diagnostics` | 3 | 能力探测（`getCapabilities`）、链路追踪、排障 | 无需 |

> 完整使用规则、账户语义、交易约束和排障规则见 [`skills/yubit/SKILL.md`](skills/yubit/SKILL.md)。

---

## 3. 快速开始

**前置条件**：Node.js >= 19

适用范围：

- `OpenClaw Hub`：适合 OpenClaw 用户先安装运行时，再安装公开 skill `yubit`
- `npm / npx`：适合大多数 MCP 客户端，包括 Claude Code、Codex、Cursor、LobeChat Desktop，也适合 OpenClaw 本地接入
- `源码安装`：适合本地开发、调试和直接从仓库运行

### 3.1 OpenClaw Hub 安装

```bash
npm install -g @yubit/exchange-skill

yubit setup --client openclaw

openclaw skills install yubit
```

完成后重新打开一个新的 OpenClaw 会话，让 `yubit` skill 和 MCP 生效。

### 3.2 通用安装

```bash
# npm 全局安装
npm install -g @yubit/exchange-skill
yubit setup

# 或 npx（无需安装）
npx @yubit/exchange-skill setup
```

安装向导会自动检测已安装的 AI 工具、配置 API 凭证、注册 MCP Server。
首次 setup 会要求输入：

- `API Key`
- `API Secret`
- `API Base URL`

凭证统一存储在 `~/.exchange-skill/config.json`，多客户端共享，换 key 只需 `yubit config init`。

### 3.3 源码安装

```bash
git clone https://github.com/yubit-exchange/exchange-skill.git
cd exchange-skill
./setup/install.sh
```

这条路径适合直接从源码运行或本地开发调试。

---

## 4. 手动接入（可选）

如果你不想走 `yubit setup`，或者希望手工控制 MCP 配置，可以使用以下方式。

### 4.1 OpenClaw

```bash
openclaw mcp set yubit '{
  "command": "yubit",
  "args": ["start"],
  "env": { "EXCHANGE_ENABLE_TRADE": "true" }
}'
rm -rf ~/.openclaw/skills/yubit ~/.openclaw/skills/yubit-*
cp -r skills/yubit ~/.openclaw/skills/
openclaw gateway restart
```

### 4.2 Claude Code

```bash
claude mcp add --transport stdio yubit --env EXCHANGE_ENABLE_TRADE=true -- yubit start
```

### 4.3 OpenAI Codex CLI

```toml
# ~/.codex/config.toml
[mcp_servers.yubit]
command = "yubit"
args = ["start"]

[mcp_servers.yubit.env]
EXCHANGE_ENABLE_TRADE = "true"
```

### 4.4 Cursor

```json
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "yubit": {
      "command": "yubit",
      "args": ["start"],
      "env": { "EXCHANGE_ENABLE_TRADE": "true" }
    }
  }
}
```

### 4.5 LobeChat Desktop

> Web 版不支持 STDIO MCP，必须使用 Desktop 版。

插件图标 → **添加 MCP 插件** → **快速导入 JSON** → 粘贴与 Cursor 相同格式 → 连接类型选 **STDIO**。

---

## 5. 自然语言示例

| 你说 | 调用的工具 |
|------|----------|
| "BTC 现在多少钱" | `getTicker` |
| "BTC 日线 K 线" | `getKlines` |
| "我的合约余额" | `perpGetBalance` |
| "我的资金账户有多少钱" | `fundGetAssets` |
| "我的现货余额" | `spotGetBalance` |
| "我的 TradFi 账户余额" | `tradfiGetBalance` |
| "我的理财余额" | `earnGetBalance` |
| "我的总资产" | `getPortfolioNetWorth` |
| "查 BTC 持仓" | `perpGetPositions` |
| "查 BTC 合约资金流水" | `perpGetWalletFlowRecords` |
| "开多 ETH 0.01 张" | `perpCreateOrder` |
| "给 BTC 多仓加仓 0.01 张" | `perpAddToPosition` |
| "合仓模式下给 BTC 多仓加仓 0.01 张" | `perpAddToPosition` |
| "ETH 多单止盈 3000 止损 1800" | `perpCreateTpSl` |
| "ETH 当前是什么模式，杠杆多少" | `perpGetModeConfigs` |
| "平掉 ETH 多单" | `perpClosePosition` |
| "从资金账户划 10 USDT 到合约" | `transfer` |
| "这个 MCP 能做什么" | `getCapabilities` |

> 对外使用建议：
> - **新开仓** → `perpCreateOrder`
> - **给已有仓位加仓** → `perpAddToPosition`
> - 尤其在**分仓模式**下，不要把“加仓已有仓位”直接等同于再次 `perpCreateOrder`

---

## 6. 可用工具

### 6.1 行情（公开，无需认证）

| 工具 | 说明 |
|------|------|
| `getTicker` | 实时行情（价格、涨跌幅、成交量、资金费率） |
| `getOrderbook` | 买卖盘深度 |
| `getKlines` | K 线（OHLCV），interval: 1/5/15/60/240/D |
| `getMarkPriceKlines` | 标记价 K 线（OHLC），limit 上限 200 |
| `getFundingRate` | 当前资金费率和下次结算时间 |
| `getFundingRateHistory` | 历史资金费率 |
| `getInstruments` | 合约规格（最小数量、价格精度、杠杆范围） |
| `getRiskLimits` | 风险限额表（分档最大名义、保证金率、最大杠杆） |
| `getRecentTrades` | 最近成交记录 |

### 6.2 钱包（需要 API Key）

| 工具 | 说明 |
|------|------|
| `fundGetAssets` | **资金账户**资产列表（总权益、可用、冻结）。与合约/现货/TradFi 账户独立 |
| `getPortfolioNetWorth` | 全账户总资产（USDT 计价） |
| `transfer` | 账户间划转（FUNDING / TRADING / SPOT / TRADFI） |

### 6.3 现货（需要 API Key）

| 工具 | 说明 |
|------|------|
| `spotGetBalance` | **现货账户**资产列表（总额、可用、冻结）。与资金账户、永续账户独立 |

### 6.4 TradFi（需要 API Key）

| 工具 | 说明 |
|------|------|
| `tradfiGetBalance` | **TradFi 账户**详情（余额、净值、保证金、可用保证金、杠杆、浮动盈亏） |

### 6.5 理财（需要 API Key）

| 工具 | 说明 |
|------|------|
| `earnGetBalance` | **理财账户**资产与收益明细（币种、余额、净值、累计/昨日收益） |

### 6.6 永续查询（需要 API Key）

| 工具 | 说明 |
|------|------|
| `perpGetBalance` | **合约账户**余额（权益、可用、保证金、未实现盈亏） |
| `perpGetPositions` | 当前持仓 |
| `perpGetModeConfigs` | 杠杆、全仓/逐仓、合仓/分仓配置（无需持仓） |
| `perpGetFeeRate` | Maker/Taker 手续费率 |
| `perpGetOpenOrders` | 活动挂单（`orderFilter=StopOrder` 过滤 TP/SL） |
| `perpGetOrderHistory` | 历史订单 |
| `perpGetExecutions` | 成交明细 |
| `perpGetClosedPnl` | 已平仓盈亏 |
| `perpGetWalletFlowRecords` | 合约资金流水 / 账单流水（划转、已实现盈亏、资金费用、手续费；时间参数用 Unix 秒） |

### 6.7 永续交易（需要 API Key + `EXCHANGE_ENABLE_TRADE=true`）

| 工具 | 说明 |
|------|------|
| `perpCreateOrder` | 下单（市价/限价/条件单）。本交易所下单必须传 `positionIdx`：`1=Long`，`2=Short` |
| `perpAddToPosition` | 给**已有仓位**安全加仓。分仓模式会自动命中唯一仓位或要求显式 `pzLinkId`，并回读验证没有误开新分仓 |
| `perpModifyOrder` | 改单（价格/数量/TP/SL） |
| `perpCancelOrder` | 撤单 |
| `perpCancelAllOrders` | 批量撤单（按 settleCoin 需 `confirmBatch=true`） |
| `perpSetLeverage` | 设置杠杆（symbol 级或分仓级） |
| `perpCreateTpSl` | 创建止盈止损（含高级限价和移动止损） |
| `perpReplaceTpSl` | 修改 TP/SL 子单 |
| `perpSwitchPositionMode` | 切换合仓/分仓 |
| `perpSwitchMarginMode` | 切换全仓/逐仓 |
| `perpAddMargin` | 调整仓位保证金（正加负减，仅逐仓） |
| `perpClosePosition` | 整仓市价平仓 |

### 6.8 诊断（无需认证）

| 工具 | 说明 |
|------|------|
| `getCapabilities` | 当前会话的模块、工具列表、认证状态 |
| `getTrace` | 按 traceId 查看完整请求链路 |
| `searchTraces` | 按 traceId/orderId/symbol/toolName 等搜索 trace |

---

## 7. 权限分级

| 条件 | 可用工具 |
|------|---------|
| 无 API Key | 行情 + 诊断（12 个） |
| 有 API Key | + 钱包查询 + 现货查询 + TradFi 查询 + 理财查询 + 永续查询（26 个） |
| 有 API Key + `EXCHANGE_ENABLE_TRADE=true` | 全部（39 个） |

---

## 8. 安全机制

- **参数前置校验** — symbol、数量范围/步长、价格范围、TP/SL 方向、杠杆范围，不合规直接拒绝
- **批量操作保护** — `perpCancelAllOrders`/`perpClosePosition` 按 settleCoin 操作需 `confirmBatch=true`
- **分仓加仓保护** — `perpAddToPosition` 会在服务端先查当前持仓，分仓模式下自动命中唯一仓位或要求显式 `pzLinkId`，并回读验证没有误开新分仓
- **意图分流** — 文档与 skill 默认把“新开仓”和“加仓已有仓位”分成两条路径，减少模型把“加仓”误执行成“新开一笔分仓”的概率
- **开仓后空仓排障顺序** — 对 `Filled` 的市价开仓，如果随后 `perpGetPositions(symbol)` 为空，先查 `perpGetOrderHistory` + `perpGetExecutions` + `perpGetClosedPnl` 判断是否被后续反向平仓；不要先猜 symbol 映射或仓位延迟
- **审计日志** — 所有调用记录到 `.data/audit.log`（JSON Lines），敏感信息自动脱敏
- **Trace 记录** — 每次调用记录到 `.data/trace-records.jsonl`，含原始 HTTP 请求/响应，保留 7 天 / 最多 1000 条
- **凭证集中管理** — `~/.exchange-skill/config.json`，客户端配置不含 API Key

### 8.1 Filled But Flat 排障

如果市价开仓返回成功、成交也存在，但随后查仓位为空，推荐固定按这个顺序排查：

1. `perpGetOrderHistory(symbol, orderId)`：确认开仓单状态是 `Filled`
2. `perpGetExecutions(symbol, orderId)`：确认实际成交数量、价格、时间
3. `perpGetPositions(symbol)`：确认当前确实为空仓
4. `perpGetClosedPnl(symbol, limit='10')`：查是否在几秒内出现了同数量、反方向的已平仓记录
5. 如有需要，再用 `perpGetOrderHistory(symbol, closeOrderId)` 看平仓单是否为 `reduceOnly=true`

注意：

- 订单历史里出现 `M1ETHUSDT` 这类值，通常只是交易所的本地 symbol 表示，不等于“仓位藏在别的 symbol 下”
- 更常见的真实原因是：仓位已经被另一笔后续平仓单关掉了

---

## 9. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EXCHANGE_API_KEY` | — | API Key |
| `EXCHANGE_API_SECRET` | — | API Secret |
| `EXCHANGE_BASE_URL` | — | API 地址（必须显式配置） |
| `EXCHANGE_TLS_REJECT` | `true` | TLS 验证（测试环境可设 `false`） |
| `EXCHANGE_RECV_WINDOW` | `5000` | 请求有效窗口（ms） |
| `EXCHANGE_ENABLE_TRADE` | `false` | 启用交易工具 |

---

## 10. Agent Skills

| Skill | 说明 | 认证 |
|-------|------|:----:|
| [`yubit`](skills/yubit/SKILL.md) | 完整 Yubit skill，覆盖市场、钱包、现货、TradFi、理财、永续交易与排障规则 | 按工具而定 |

---

## 11. CLI 命令

| 命令 | 说明 |
|------|------|
| `yubit setup` | 一键安装（自动检测 AI 工具） |
| `yubit setup --client <name>` | 指定客户端（openclaw / claude-code / codex / cursor / lobechat） |
| `yubit setup --read-only` | 只读模式 |
| `yubit config init` | 配置 API 凭证 |
| `yubit config show` | 查看配置（脱敏） |
| `yubit doctor` | 环境诊断 |
| `yubit status` | 安装状态 |
| `yubit uninstall` | 卸载 |
| `yubit start` | 启动 MCP Server |

---

## 12. 项目结构

```
exchange-skill/
├── mcp-server.js           # MCP Server 入口
├── bin/cli.js              # CLI
├── lib/
│   ├── signer.js           # HMAC-SHA256 签名
│   ├── http.js             # HTTP 客户端（含限流）
│   ├── config.js           # 配置加载
│   ├── validate.js         # 参数校验
│   ├── normalize.js        # 响应标准化
│   ├── audit.js            # 审计日志
│   ├── trace-store.js      # Trace 存储/检索
│   ├── capabilities.js     # 能力快照构建
│   └── setup/              # 客户端管理
├── tools/
│   ├── market.js           # 行情（9 工具）
│   ├── spot.js             # 现货查询（1 工具）
│   ├── tradfi.js           # TradFi 查询（1 工具）
│   ├── earn.js             # 理财查询（1 工具）
│   ├── perp-query.js       # 永续查询（9 工具）
│   ├── perp.js             # 永续交易（12 工具）
│   ├── wallet.js           # 钱包（3 工具）
│   └── diagnostics.js      # 诊断（3 工具）
├── skills/                 # AI Agent 行为规范
└── test/                   # 单元测试 + 冒烟测试
```

---

## 13. 测试

```bash
npm test                    # 单元测试（无需网络）
npm run test:smoke          # 冒烟测试（需 API Key，会执行真实交易）
npm run test:all            # 全部
```

> 冒烟测试会真实下单/撤单/平仓，请使用专用测试账号。

---

## 14. 开发贡献

新增工具遵循现有命名规则：`{产品}{操作}` camelCase，产品专属工具加前缀（`perp`/`spot`/`tradfi`/`earn`/`tapTrading`），共享工具无前缀。

```bash
npm test && npm run test:smoke    # 改动后必须通过
```

---

## 15. 常见问题

| 问题 | 解决 |
|------|------|
| MCP Server 启动后没输出 | 正常，stdio 模式通过标准输入输出通信 |
| 连接不上 | `yubit doctor` 诊断 |
| LobeChat 连接失败 | 必须用 Desktop 版，路径用绝对路径 |
| 签名错误 (401) | 检查 Key/Secret（`yubit config show`）、本机时间是否准确 |
| 下单被拒绝 | 检查数量范围、价格范围、余额、TP/SL 方向 |
| 换 Key 后还是旧的 | `yubit config init` 重新配置 |

---

## 16. 签名算法

```
载荷 = timestamp + apiKey + recvWindow + payload
签名 = HMAC-SHA256(apiSecret, 载荷).hex()
```

| Header | 值 |
|--------|-----|
| `MF-ACCESS-API-KEY` | API Key |
| `MF-ACCESS-TIMESTAMP` | 毫秒时间戳 |
| `MF-ACCESS-RECV-WINDOW` | 有效窗口 |
| `MF-ACCESS-SIGN` | hex 签名 |

---

## 17. License

[MIT](LICENSE)
