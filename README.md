# Yubit Exchange Skill

[English](README.md) | [中文](README.zh.md)

The Yubit Exchange MCP Server lets AI assistants query market data, manage funds, check balances across spot, TradFi, and earn accounts, and execute perpetual trades using natural language.

It works with [OpenClaw](https://github.com/openclaw/openclaw), [Claude Code](https://claude.ai/claude-code), [OpenAI Codex](https://developers.openai.com/codex/cli), [Cursor](https://cursor.sh), [LobeChat Desktop](https://github.com/lobehub/lobe-chat), and any other AI tool compatible with the [MCP](https://modelcontextprotocol.io) protocol.

## Table of Contents

- [1. Feature Overview](#1-feature-overview)
- [2. Modules](#2-modules)
- [3. Quick Start](#3-quick-start)
- [4. Manual Setup](#4-manual-setup)
  - [4.1 OpenClaw](#41-openclaw)
  - [4.2 Claude Code](#42-claude-code)
  - [4.3 OpenAI Codex CLI](#43-openai-codex-cli)
  - [4.4 Cursor](#44-cursor)
  - [4.5 LobeChat Desktop](#45-lobechat-desktop)
- [5. Natural Language Examples](#5-natural-language-examples)
- [6. Available Tools](#6-available-tools)
  - [6.1 Market](#61-market-public-no-auth-required)
  - [6.2 Wallet](#62-wallet-api-key-required)
  - [6.3 Spot](#63-spot-api-key-required)
  - [6.4 TradFi](#64-tradfi-api-key-required)
  - [6.5 Earn](#65-earn-api-key-required)
  - [6.6 Perp Query](#66-perp-query-api-key-required)
  - [6.7 Perp Trade](#67-perp-trade-api-key--exchange_enable_tradetrue)
  - [6.8 Diagnostics](#68-diagnostics-no-auth-required)
- [7. Permission Levels](#7-permission-levels)
- [8. Security Mechanisms](#8-security-mechanisms)
- [9. Environment Variables](#9-environment-variables)
- [10. Agent Skills](#10-agent-skills)
- [11. CLI Commands](#11-cli-commands)
- [12. Project Structure](#12-project-structure)
- [13. Testing](#13-testing)
- [14. Contributing](#14-contributing)
- [15. FAQ](#15-faq)
- [16. Signing Algorithm](#16-signing-algorithm)
- [17. License](#17-license)

---

## 1. Feature Overview

| Feature | Description |
|---------|-------------|
| **39 tools, 7 modules** | Market → Wallet → Spot → TradFi → Earn → Perp Trade → Diagnostics, covering the full trading workflow |
| **Security controls** | Three-tier permission levels, pre-validation of parameters, confirmation required for batch operations |
| **Traceability** | Every call returns a `traceId` so you can trace the original HTTP request and response |
| **No extra infrastructure required** | Runs as a local stdio process, so your API key never leaves your machine |
| **One-click setup** | `yubit setup` auto-detects supported AI tools and configures them |

## 2. Modules

| Module | Tools | Description | Auth |
|--------|:-----:|-------------|:----:|
| `market` | 9 | Real-time quotes, candlesticks, order book depth, funding rates, contract specs, and risk limits | None |
| `wallet` | 3 | Funding account assets, total portfolio net worth (USDT-denominated), inter-account transfer | API Key |
| `spot` | 1 | Spot account asset list (total, available, frozen) | API Key |
| `tradfi` | 1 | TradFi account details (balance, equity, margin, floating P&L) | API Key |
| `earn` | 1 | Earn account assets and earnings breakdown | API Key |
| `perp` | 21 | Perp balances, positions, open orders, history, account ledger, plus order placement, safe add-to-position, cancellation, TP/SL, leverage, and position mode | API Key + Trade |
| `diagnostics` | 3 | Capability probe (`getCapabilities`), request tracing, troubleshooting | None |

> Full usage rules, account semantics, trading constraints, and troubleshooting rules are in [`skills/yubit/SKILL.md`](skills/yubit/SKILL.md).

---

## 3. Quick Start

**Prerequisites**: Node.js >= 19

Recommended installation paths:

- `OpenClaw Hub`: For OpenClaw users. Install the runtime first, then install the public `yubit` skill.
- `npm / npx`: Recommended for most MCP clients, including Claude Code, Codex, Cursor, LobeChat Desktop, and local OpenClaw integration.
- `Source install`: Best for local development, debugging, or running directly from the repository.

### 3.1 OpenClaw Hub Install

```bash
npm install -g @yubit/exchange-skill

yubit setup --client openclaw

openclaw skills install yubit
```

After setup finishes, start a new OpenClaw session for the `yubit` skill so the MCP server is loaded.

### 3.2 General Install

```bash
# Global npm install
npm install -g @yubit/exchange-skill
yubit setup

# Or npx (no install required)
npx @yubit/exchange-skill setup
```

The setup wizard automatically detects supported AI tools, configures your API credentials, and registers the MCP server.
During first-time setup, you will be prompted for:

- `API Key`
- `API Secret`
- `API Base URL`

Credentials are stored in `~/.exchange-skill/config.json` and shared across all clients. To rotate your keys, run `yubit config init`.

### 3.3 Source Install

```bash
git clone https://github.com/yubit-exchange/exchange-skill.git
cd exchange-skill
./setup/install.sh
```

Use this path when running from source or doing local development and debugging.

---

## 4. Manual Setup (Optional)

If you prefer not to use `yubit setup`, or want to control the MCP configuration manually, use the following methods.

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

> The web version does not support STDIO MCP. You must use the desktop app.

Open the plugin menu → **Add MCP Plugin** → **Quick Import JSON** → paste the same JSON shown for Cursor above → select **STDIO** as the connection type.

---

## 5. Natural Language Examples

| You say | Tool called |
|---------|-------------|
| "What's the BTC price now" | `getTicker` |
| "BTC daily candlestick" | `getKlines` |
| "My contract balance" | `perpGetBalance` |
| "How much is in my funding account" | `fundGetAssets` |
| "My spot balance" | `spotGetBalance` |
| "My TradFi account balance" | `tradfiGetBalance` |
| "My earn balance" | `earnGetBalance` |
| "My total assets" | `getPortfolioNetWorth` |
| "Check BTC position" | `perpGetPositions` |
| "Check my BTC perp account ledger" | `perpGetWalletFlowRecords` |
| "Open a 0.01 ETH long position" | `perpCreateOrder` |
| "Add 0.01 contracts to my BTC long position" | `perpAddToPosition` |
| "Add 0.01 contracts to my BTC long in separate-position mode" | `perpAddToPosition` |
| "Set ETH long TP at 3000, SL at 1800" | `perpCreateTpSl` |
| "What mode and leverage is ETH on" | `perpGetModeConfigs` |
| "Close my ETH long" | `perpClosePosition` |
| "Transfer 10 USDT from funding account to contract" | `transfer` |
| "What can this MCP do" | `getCapabilities` |

> Usage recommendations:
> - **Open new position** → `perpCreateOrder`
> - **Add to existing position** → `perpAddToPosition`
> - Especially in **separate-position mode**, do not treat "add to existing position" as simply calling `perpCreateOrder` again

---

## 6. Available Tools

### 6.1 Market (Public, no auth required)

| Tool | Description |
|------|-------------|
| `getTicker` | Real-time quote (price, change, volume, funding rate) |
| `getOrderbook` | Bid/ask order book depth |
| `getKlines` | Candlesticks (OHLCV), intervals: 1/5/15/60/240/D |
| `getMarkPriceKlines` | Mark price candlesticks (OHLC), max limit 200 |
| `getFundingRate` | Current funding rate and next settlement time |
| `getFundingRateHistory` | Historical funding rates |
| `getInstruments` | Contract specs (min qty, price precision, leverage range) |
| `getRiskLimits` | Risk limit tiers (max notional per tier, margin rate, max leverage) |
| `getRecentTrades` | Recent trade records |

### 6.2 Wallet (API Key required)

| Tool | Description |
|------|-------------|
| `fundGetAssets` | **Funding account** asset list (total equity, available, frozen). Independent from contract/spot/TradFi accounts |
| `getPortfolioNetWorth` | Total portfolio net worth (USDT-denominated) |
| `transfer` | Inter-account transfer (FUNDING / TRADING / SPOT / TRADFI) |

### 6.3 Spot (API Key required)

| Tool | Description |
|------|-------------|
| `spotGetBalance` | **Spot account** asset list (total, available, frozen). Independent from fund and perp accounts |

### 6.4 TradFi (API Key required)

| Tool | Description |
|------|-------------|
| `tradfiGetBalance` | **TradFi account** details (balance, equity, margin, available margin, leverage, floating P&L) |

### 6.5 Earn (API Key required)

| Tool | Description |
|------|-------------|
| `earnGetBalance` | **Earn account** assets and earnings breakdown (currency, balance, equity, cumulative/yesterday earnings) |

### 6.6 Perp Query (API Key required)

| Tool | Description |
|------|-------------|
| `perpGetBalance` | **Contract account** balance (equity, available, margin, unrealized P&L) |
| `perpGetPositions` | Current positions |
| `perpGetModeConfigs` | Leverage plus cross/isolated margin and merged/separate position-mode config (no open position required) |
| `perpGetFeeRate` | Maker/Taker fee rates |
| `perpGetOpenOrders` | Active open orders (`orderFilter=StopOrder` to filter TP/SL) |
| `perpGetOrderHistory` | Order history |
| `perpGetExecutions` | Trade execution details |
| `perpGetClosedPnl` | Closed position P&L |
| `perpGetWalletFlowRecords` | Perp account ledger / account statement (transfers, realized P&L, funding fees, trading fees; time parameters are Unix seconds) |

### 6.7 Perp Trade (API Key + `EXCHANGE_ENABLE_TRADE=true`)

| Tool | Description |
|------|-------------|
| `perpCreateOrder` | Place order (market/limit/conditional). This exchange requires `positionIdx`: `1=Long`, `2=Short` |
| `perpAddToPosition` | Safely add to an **existing position**. In separate-position mode, it auto-targets the unique position or requires explicit `pzLinkId`, then reads back to verify no accidental new sub-position was opened |
| `perpModifyOrder` | Amend order (price/qty/TP/SL) |
| `perpCancelOrder` | Cancel order |
| `perpCancelAllOrders` | Batch cancel orders (by settleCoin requires `confirmBatch=true`) |
| `perpSetLeverage` | Set leverage (symbol-level or sub-position-level) |
| `perpCreateTpSl` | Create take-profit/stop-loss (including advanced limit and trailing stop) |
| `perpReplaceTpSl` | Modify TP/SL sub-order |
| `perpSwitchPositionMode` | Switch between separate and merged position mode |
| `perpSwitchMarginMode` | Switch between cross/isolated margin |
| `perpAddMargin` | Adjust position margin (positive to add, negative to reduce; isolated margin only) |
| `perpClosePosition` | Close entire position at market price |

### 6.8 Diagnostics (No auth required)

| Tool | Description |
|------|-------------|
| `getCapabilities` | Modules, tools, and authentication status available in the current session |
| `getTrace` | View full request chain by traceId |
| `searchTraces` | Search traces by traceId/orderId/symbol/toolName etc. |

---

## 7. Permission Levels

| Condition | Available Tools |
|-----------|----------------|
| No API Key | Market + Diagnostics (12 tools) |
| API Key provided | + Wallet query + Spot query + TradFi query + Earn query + Perp query (26 tools) |
| API Key + `EXCHANGE_ENABLE_TRADE=true` | All (39 tools) |

---

## 8. Security Mechanisms

- **Pre-validation** — symbol, quantity range/step, price range, TP/SL direction, leverage range are validated upfront and rejected if non-compliant
- **Batch operation protection** — `perpCancelAllOrders`/`perpClosePosition` by settleCoin requires `confirmBatch=true`
- **Separate-position add-to-position protection** — `perpAddToPosition` queries current positions on the server first; in separate-position mode, it auto-targets the unique position or requires explicit `pzLinkId`, then reads back to verify no accidental new sub-position was opened
- **Intent routing** — documentation and skills route "open new position" and "add to existing position" as two separate paths, reducing the risk of the model misinterpreting "add to position" as "open a new sub-position"
- **Filled-order-but-no-position troubleshooting** — if a market order to open a position is marked `Filled` but `perpGetPositions(symbol)` returns empty, first check `perpGetOrderHistory` + `perpGetExecutions` + `perpGetClosedPnl` to determine whether the position was closed by a later reverse order; do not start by guessing about symbol mapping or position delays
- **Audit log** — all calls are logged to `.data/audit.log` (JSON Lines), with sensitive information automatically redacted
- **Trace records** — each call is recorded to `.data/trace-records.jsonl`, including raw HTTP request/response, retained for 7 days / max 1000 entries
- **Centralized credential management** — `~/.exchange-skill/config.json`; client configs do not contain API Key

### 8.1 Troubleshooting: Filled Order but No Open Position

If a market order to open a position succeeds and an execution is recorded, but the subsequent position query is empty, follow this sequence:

1. `perpGetOrderHistory(symbol, orderId)`: Confirm open order status is `Filled`
2. `perpGetExecutions(symbol, orderId)`: Confirm actual fill qty, price, and time
3. `perpGetPositions(symbol)`: Confirm the position is indeed empty
4. `perpGetClosedPnl(symbol, limit='10')`: Check whether a closed-P&L record with the same size and opposite direction appeared within seconds
5. If needed, use `perpGetOrderHistory(symbol, closeOrderId)` to check if the close order has `reduceOnly=true`

Notes:

- Values like `M1ETHUSDT` in order history are usually just the exchange's internal symbol format. They do not mean the position is hidden under a different symbol.
- The more common real cause is that the position was already closed by a later close order.

---

## 9. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXCHANGE_API_KEY` | — | API Key |
| `EXCHANGE_API_SECRET` | — | API Secret |
| `EXCHANGE_BASE_URL` | — | API base URL (must be explicitly configured) |
| `EXCHANGE_TLS_REJECT` | `true` | TLS verification (set `false` for test environments) |
| `EXCHANGE_RECV_WINDOW` | `5000` | Request validity window (ms) |
| `EXCHANGE_ENABLE_TRADE` | `false` | Enable trading tools |

---

## 10. Agent Skills

| Skill | Description | Auth |
|-------|-------------|:----:|
| [`yubit`](skills/yubit/SKILL.md) | Full Yubit skill covering market, wallet, spot, TradFi, earn, perpetual trading, and troubleshooting rules | Per tool |

---

## 11. CLI Commands

| Command | Description |
|---------|-------------|
| `yubit setup` | One-click setup (auto-detects supported AI tools) |
| `yubit setup --client <name>` | Specify client (openclaw / claude-code / codex / cursor / lobechat) |
| `yubit setup --read-only` | Configure the server in read-only mode |
| `yubit config init` | Configure API credentials |
| `yubit config show` | Show config (redacted) |
| `yubit doctor` | Environment diagnostics |
| `yubit status` | Installation status |
| `yubit uninstall` | Uninstall |
| `yubit start` | Start MCP Server |

---

## 12. Project Structure

```
exchange-skill/
├── mcp-server.js           # MCP Server entry point
├── bin/cli.js              # CLI
├── lib/
│   ├── signer.js           # HMAC-SHA256 signing
│   ├── http.js             # HTTP client (with rate limiting)
│   ├── config.js           # Config loader
│   ├── validate.js         # Parameter validation
│   ├── normalize.js        # Response normalization
│   ├── audit.js            # Audit logging
│   ├── trace-store.js      # Trace storage/retrieval
│   ├── capabilities.js     # Capability snapshot builder
│   └── setup/              # Client management
├── tools/
│   ├── market.js           # Market (9 tools)
│   ├── spot.js             # Spot query (1 tool)
│   ├── tradfi.js           # TradFi query (1 tool)
│   ├── earn.js             # Earn query (1 tool)
│   ├── perp-query.js       # Perp query (9 tools)
│   ├── perp.js             # Perp trade (12 tools)
│   ├── wallet.js           # Wallet (3 tools)
│   └── diagnostics.js      # Diagnostics (3 tools)
├── skills/                 # AI Agent behavior specs
└── test/                   # Unit tests + smoke tests
```

---

## 13. Testing

```bash
npm test                    # Unit tests (no network required)
npm run test:smoke          # Smoke tests (requires API Key, executes real trades)
npm run test:all            # All tests
```

> Smoke tests will place real orders, cancel them, and close positions. Use a dedicated test account.

---

## 14. Contributing

New tools should follow the existing naming convention: `{product}{Action}` camelCase. Product-specific tools get a prefix (`perp`/`spot`/`tradfi`/`earn`/`tapTrading`); shared tools have no prefix.

```bash
npm test && npm run test:smoke    # Must pass after any changes
```

---

## 15. FAQ

| Issue | Solution |
|-------|----------|
| MCP Server starts with no output | Normal — stdio mode communicates via stdin/stdout |
| Cannot connect | Run `yubit doctor` for diagnostics |
| LobeChat connection failure | Must use Desktop version; use absolute paths |
| Signature error (401) | Check Key/Secret (`yubit config show`), verify system clock accuracy |
| Order rejected | Check quantity range, price range, balance, TP/SL direction |
| Still using old key after rotation | Run `yubit config init` to reconfigure |

---

## 16. Signing Algorithm

```
payload = timestamp + apiKey + recvWindow + payload
signature = HMAC-SHA256(apiSecret, payload).hex()
```

| Header | Value |
|--------|-------|
| `MF-ACCESS-API-KEY` | API Key |
| `MF-ACCESS-TIMESTAMP` | Millisecond timestamp |
| `MF-ACCESS-RECV-WINDOW` | Validity window |
| `MF-ACCESS-SIGN` | Hex signature |

---

## 17. License

[MIT](LICENSE)
