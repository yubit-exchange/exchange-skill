#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const { loadConfig } = require('./lib/config');
const HttpClient = require('./lib/http');
const { AuditLogger } = require('./lib/audit');
const { TraceStore } = require('./lib/trace-store');
const { buildCapabilitySnapshot } = require('./lib/capabilities');
const market = require('./tools/market');
const spot = require('./tools/spot');
const tradfi = require('./tools/tradfi');
const earn = require('./tools/earn');
const perpQuery = require('./tools/perp-query');
const perp = require('./tools/perp');
const diagnostics = require('./tools/diagnostics');
const wallet = require('./tools/wallet');

// -- Tool definitions grouped by permission level --

const MARKET_TOOLS = [
  { name: 'getTicker', description: 'Get real-time ticker from the exchange. Returns last price, mark price, 24h change, volume, bid/ask, funding rate. Use for any price or market query.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'Trading pair, e.g. BTCUSDT, ETHFreeU' } } } },
  { name: 'getOrderbook', description: 'Get order book depth (bid/ask levels with size). Use when user asks about spread, liquidity, or buy/sell walls.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, depth: { type: 'string', default: '25' } } } },
  { name: 'getKlines', description: 'Get kline/candlestick data (OHLCV). Use for chart analysis or price history. interval: 1/5/15/60/240/D. Pass start+end (ms timestamps) together to query a specific time range.', inputSchema: { type: 'object', required: ['symbol', 'interval'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, interval: { type: 'string', description: '1(1min)/5/15/60(1h)/240(4h)/D(daily)' }, limit: { type: 'string', default: '200' }, start: { type: 'string', description: 'Start time in ms. Must be paired with end.' }, end: { type: 'string', description: 'End time in ms. Must be paired with start.' } } } },
  { name: 'getMarkPriceKlines', description: 'Get mark-price kline data (OHLC only — no volume/turnover). Use when the user specifically asks about mark-price history instead of the normal last-price klines. interval: 1/5/15/60/240/D. Pass start+end (ms timestamps) together to query a specific time range. limit max 200.', inputSchema: { type: 'object', required: ['symbol', 'interval'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, interval: { type: 'string', description: '1(1min)/5/15/60(1h)/240(4h)/D(daily)' }, limit: { type: 'string', default: '200', description: 'Page size. Max 200.' }, start: { type: 'string', description: 'Start time in ms. Must be paired with end.' }, end: { type: 'string', description: 'End time in ms. Must be paired with start.' } } } },
  { name: 'getFundingRate', description: 'Get current perpetual futures funding rate and next settlement time. Use when user asks about funding or settlement.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' } } } },
  { name: 'getInstruments', description: 'Get contract specifications: min/max order size, tick size, leverage range, trading status. Use when user asks about contract rules or trading limits.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU. Omit to get all.' }, status: { type: 'string', description: 'Filter by contract status, e.g. Trading.' }, limit: { type: 'string', description: 'Page size, max 1000.' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' } } } },
  { name: 'getRiskLimits', description: 'Get the risk-limit tiers for a contract (per-tier max notional, maintain/initial margin rates, max leverage). Use when the user asks about leverage brackets, risk tiers, or liquidation thresholds. Omit symbol to list all visible symbols.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU. Omit for all.' } } } },
  { name: 'getRecentTrades', description: 'Get recent public trade executions. Use when user asks about recent trades or market activity.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, limit: { type: 'string', default: '20' } } } },
  { name: 'getFundingRateHistory', description: 'Get historical funding rate records. Use when user asks about past funding rates or funding trends.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, limit: { type: 'string', default: '10' }, startTime: { type: 'string', description: 'Start time in ms (inclusive).' }, endTime: { type: 'string', description: 'End time in ms (inclusive).' } } } },
];

const PERP_QUERY_TOOLS = [
  { name: 'perpGetBalance', description: 'Get PERP account balance (for perpetual futures trading). Returns equity, available balance, position margin, unrealised PnL. This is NOT the funding wallet, spot account, or tradfi account. Omit coin to get all settle coins (USDT, FreeU, etc).', inputSchema: { type: 'object', properties: { coin: { type: 'string', description: 'Settle coin, e.g. USDT, FreeU. Omit for all.' } } } },
  { name: 'perpGetPositions', description: 'Get open perp positions. Must pass symbol or settleCoin.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Trading pair e.g. BTCUSDT, ETHFreeU' }, settleCoin: { type: 'string', description: 'Settle coin e.g. USDT, FreeU. Used when symbol is omitted.' }, limit: { type: 'string', description: 'Page size.' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' } } } },
  { name: 'perpGetFeeRate', description: 'Get maker/taker perp trading fee rates for a symbol.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' } } } },
  { name: 'perpGetModeConfigs', description: 'Query current perp leverage and mode configs: tradeMode (0=Cross/1=Isolated), isSeparatePz (true=Separate/false=Merged), buyLeverage, sellLeverage. Works even without open positions. Check this before leverage or mode writes, and skip the write if the current config already matches the target.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU. Omit for all configured symbols.' }, coin: { type: 'string', description: 'Settle coin e.g. USDT, FreeU.' }, category: { type: 'string', description: 'Product category, typically linear.' } } } },
  { name: 'perpGetOpenOrders', description: 'Get currently active perp orders. Pass symbol, settleCoin, or baseCoin (three-way required). Use orderFilter=StopOrder to find TP/SL sub-orders.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, settleCoin: { type: 'string', description: 'e.g. USDT, FreeU' }, baseCoin: { type: 'string', description: 'Base coin, e.g. BTC, ETH. Use to query all open orders for a base coin across BTCUSDT/BTCFreeU etc.' }, orderId: { type: 'string', description: 'Exchange order id' }, orderLinkId: { type: 'string', description: 'User order link id' }, orderFilter: { type: 'string', enum: ['Order', 'StopOrder'], description: 'Filter by order type. StopOrder for TP/SL/conditional orders.' }, limit: { type: 'string', description: 'Page size.' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' } } } },
  { name: 'perpGetOrderHistory', description: 'Get historical perp orders (filled, cancelled, etc.).', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, limit: { type: 'string', default: '20' }, orderId: { type: 'string', description: 'Exchange order id.' }, orderLinkId: { type: 'string', description: 'User order link id.' }, orderStatus: { type: 'string', description: 'Filter by order status.' }, orderFilter: { type: 'string', enum: ['Order', 'StopOrder'], description: 'Filter by order type.' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' }, baseCoin: { type: 'string', description: 'Base coin, e.g. BTC.' } } } },
  { name: 'perpGetExecutions', description: 'Get perp trade execution details (fill price, fee, size).', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, limit: { type: 'string', default: '20' }, orderId: { type: 'string', description: 'Exchange order id.' }, execType: { type: 'string', description: 'Execution type filter.' }, startTime: { type: 'string', description: 'Start time in ms.' }, endTime: { type: 'string', description: 'End time in ms (must be > startTime).' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' }, baseCoin: { type: 'string', description: 'Base coin, e.g. BTC.' }, orderLinkId: { type: 'string', description: 'User order link id.' }, orderFilter: { type: 'string', enum: ['Order', 'StopOrder'], description: 'Filter by order type.' } } } },
  { name: 'perpGetClosedPnl', description: 'Get profit/loss records for closed perp positions.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, limit: { type: 'string', default: '20' }, startTime: { type: 'string', description: 'Start time in ms.' }, endTime: { type: 'string', description: 'End time in ms (must be > startTime).' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' } } } },
  { name: 'perpGetWalletFlowRecords', description: 'Get perp wallet flow / bill records such as transfers, realized PnL, funding fees, and trading fees. startTime/endTime use Unix seconds, not milliseconds.', inputSchema: { type: 'object', properties: { coin: { type: 'string', description: 'Wallet coin, e.g. USDT. Omit for all.' }, startTime: { type: 'string', description: 'Start time in Unix seconds.' }, endTime: { type: 'string', description: 'End time in Unix seconds. Must be greater than startTime.' }, limit: { type: 'string', description: 'Page size. Default 50, max 100.' }, fundType: { type: 'string', description: 'Flow type filter as numeric enum, e.g. 1=transfer, 2=realized PnL, 3=funding fee, 4=fee.' }, cursor: { type: 'string', description: 'Pagination cursor from previous response.' }, sort: { type: 'string', enum: ['DESC'], description: 'Sort direction. Currently only DESC is supported.' }, includeFreeU: { type: 'boolean', description: 'Whether to include FreeU-related flow records.' } } } },
];

const SPOT_QUERY_TOOLS = [
  { name: 'spotGetBalance', description: 'Get SPOT account asset balances. Returns per-coin total, free, locked, and valuation fields for the current spot account. This is NOT the funding wallet or perp account.', inputSchema: { type: 'object', properties: {} } },
];

const TRADFI_QUERY_TOOLS = [
  { name: 'tradfiGetBalance', description: 'Get TradFi account details. Returns balance, equity, margin, free margin, margin level, leverage, swap storage, and floating PnL for the current TradFi account.', inputSchema: { type: 'object', properties: {} } },
];

const EARN_QUERY_TOOLS = [
  { name: 'earnGetBalance', description: 'Get earn/perfi account balances. Returns the current earn account rows, including symbol, balance, equity, and accumulated/yesterday interest fields.', inputSchema: { type: 'object', properties: {} } },
];

const WALLET_QUERY_TOOLS = [
  { name: 'fundGetAssets', description: 'Get FUNDING account assets (the central deposit/withdraw/transfer wallet). Returns all coins with total equity, available balance, and frozen amount.', inputSchema: { type: 'object', properties: {} } },
  { name: 'getPortfolioNetWorth', description: 'Get total balance across all wallets (funding + contract + spot + tradfi) in USDT equivalent. Use when the user asks about total account value or net worth.', inputSchema: { type: 'object', properties: {} } },
];

const PERP_TRADE_TOOLS = [
  { name: 'perpCreateOrder', description: 'Place a perp order (market, limit, or conditional/trigger). positionIdx is required for this exchange: 1=Long, 2=Short. Validates parameters before submitting. For partial close, use side=opposite, reduceOnly=true, and pzLinkId in separate-position mode. For conditional orders, pass triggerPrice + triggerDirection.', inputSchema: { type: 'object', required: ['symbol', 'side', 'positionIdx', 'orderType', 'qty'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, side: { type: 'string', enum: ['Buy', 'Sell'] }, positionIdx: { type: 'number', enum: [1, 2], description: 'Required for this exchange. 1=Long 2=Short' }, orderType: { type: 'string', enum: ['Market', 'Limit'] }, qty: { type: 'string' }, price: { type: 'string' }, timeInForce: { type: 'string', enum: ['GoodTillCancel', 'PostOnly', 'ImmediateOrCancel', 'FillOrKill'] }, takeProfit: { type: 'string' }, stopLoss: { type: 'string' }, tpTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, slTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, tpOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'], description: 'Advanced TP order type. UNKNOWN = not specified.' }, tpLimitPrice: { type: 'string', description: 'TP limit price, only when tpOrderType=Limit.' }, slOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'], description: 'Advanced SL order type. UNKNOWN = not specified.' }, slLimitPrice: { type: 'string', description: 'SL limit price, only when slOrderType=Limit.' }, triggerPrice: { type: 'string', description: 'Trigger price for conditional orders. Requires triggerDirection.' }, triggerDirection: { type: 'number', enum: [1, 2], description: 'Conditional order trigger direction: 1=rise (trigger when price >= triggerPrice), 2=fall (trigger when price <= triggerPrice).' }, triggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'], description: 'Trigger price type.' }, closeOnTrigger: { type: 'boolean', description: 'If true, trigger will close position (reduce-only).' }, reduceOnly: { type: 'boolean' }, mmp: { type: 'boolean', description: 'MMP (Market Maker Protection) switch. Only relevant for market-maker accounts; leave unset for normal trading.' }, pzLinkId: { type: 'string', description: 'Target specific separate position (required for partial close in separate-position mode)' } } } },
  { name: 'perpAddToPosition', description: 'Safely add to an EXISTING position at market. In merged mode it adds to the single same-direction position. In separate-position mode it resolves or requires the target pzLinkId, then verifies no unintended new sub-position was opened. Use this for "加仓" on an existing long/short.', inputSchema: { type: 'object', required: ['symbol', 'positionIdx', 'qty'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, positionIdx: { type: 'number', enum: [1, 2], description: '1=Long position, 2=Short position' }, qty: { type: 'string', description: 'Add-on quantity. Must be positive.' }, pzLinkId: { type: 'string', description: 'Target existing separate position. Required when multiple same-direction separate positions exist.' }, orderType: { type: 'string', enum: ['Market'], description: 'Currently only Market is supported so the tool can verify the result immediately.' } } } },
  { name: 'perpModifyOrder', description: 'Amend an open perp order (price/qty/TP/SL).', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, orderId: { type: 'string' }, orderLinkId: { type: 'string' }, price: { type: 'string' }, qty: { type: 'string' }, takeProfit: { type: 'string' }, stopLoss: { type: 'string' }, tpTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, slTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, tpOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'], description: 'Advanced TP order type.' }, tpLimitPrice: { type: 'string', description: 'TP limit price, only when tpOrderType=Limit.' }, slOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'], description: 'Advanced SL order type.' }, slLimitPrice: { type: 'string', description: 'SL limit price, only when slOrderType=Limit.' }, triggerPrice: { type: 'string' }, triggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] } } } },
  { name: 'perpCancelOrder', description: 'Cancel a specific perp order.', inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, orderId: { type: 'string' }, orderLinkId: { type: 'string' } } } },
  { name: 'perpCancelAllOrders', description: 'Cancel all open perp orders. Pass symbol for one pair. To cancel all orders under a settleCoin, pass settleCoin + confirmBatch=true.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, settleCoin: { type: 'string', description: 'e.g. USDT, FreeU. Requires confirmBatch=true.' }, confirmBatch: { type: 'boolean', description: 'Required when using settleCoin without symbol. Confirms coin-level batch operation.' } } } },
  { name: 'perpSetLeverage', description: 'Set perp leverage for a symbol, or for a specific separate position (pass positionIdx + pzLinkId). Always read current config first with perpGetModeConfigs; if leverage is already at the target value, do not submit another write.', inputSchema: { type: 'object', required: ['symbol', 'buyLeverage'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, buyLeverage: { type: 'string' }, sellLeverage: { type: 'string' }, positionIdx: { type: 'number', enum: [1, 2], description: '1=Long 2=Short. Pass together with pzLinkId to target a specific separate position.' }, pzLinkId: { type: 'string', description: 'Target a specific separate position. Requires positionIdx.' } } } },
  { name: 'perpCreateTpSl', description: 'Create take-profit / stop-loss on a perp position. Supports advanced limit-price TP/SL and trailing stop (moving TP/SL).', inputSchema: { type: 'object', required: ['symbol', 'positionIdx', 'tpSlMode'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, positionIdx: { type: 'number', enum: [1, 2] }, pzLinkId: { type: 'string', description: 'Target specific separate position' }, tpSlMode: { type: 'string', enum: ['Full', 'Partial'] }, takeProfit: { type: 'string' }, stopLoss: { type: 'string' }, tpTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, slTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, tpOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'], description: 'Advanced TP order type.' }, tpLimitPrice: { type: 'string', description: 'Only when tpOrderType=Limit.' }, slOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'], description: 'Advanced SL order type.' }, slLimitPrice: { type: 'string', description: 'Only when slOrderType=Limit.' }, tpSize: { type: 'string', description: 'Only in Partial mode.' }, slSize: { type: 'string', description: 'Only in Partial mode.' }, isMovingTpSl: { type: 'boolean', description: 'Create a trailing stop (moving TP/SL). Requires tpSlMode=Full + retracePercentage.' }, movingTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'], description: 'Optional when isMovingTpSl=true; gateway defaults to LastPrice when omitted.' }, movingActivationPrice: { type: 'string', description: 'Optional when isMovingTpSl=true.' }, retracePercentage: { type: 'string', description: 'Required when isMovingTpSl=true. Decimal form, e.g. 0.005 = 0.5%.' }, retraceDelta: { type: 'string', description: 'Optional absolute price-delta retrace.' }, movingTpSlSize: { type: 'string', description: 'Optional trailing-stop qty.' } } } },
  { name: 'perpReplaceTpSl', description: 'Modify existing perp TP/SL sub-order by orderId.', inputSchema: { type: 'object', required: ['symbol', 'orderId'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, orderId: { type: 'string', description: 'TP/SL sub-order ID' }, takeProfit: { type: 'string' }, stopLoss: { type: 'string' }, tpTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, slTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'] }, tpSize: { type: 'string' }, slSize: { type: 'string' }, tpOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'] }, tpLimitPrice: { type: 'string', description: 'Only when tpOrderType=Limit.' }, slOrderType: { type: 'string', enum: ['UNKNOWN', 'Market', 'Limit'] }, slLimitPrice: { type: 'string', description: 'Only when slOrderType=Limit.' }, movingTriggerBy: { type: 'string', enum: ['LastPrice', 'MarkPrice'], description: 'New trailing stop trigger price type.' }, movingActivationPrice: { type: 'string', description: 'New activation price for trailing stop.' }, retracePercentage: { type: 'string', description: 'New retrace percentage in decimal form (e.g. 0.005 = 0.5%).' }, retraceDelta: { type: 'string', description: 'Optional absolute price-delta retrace.' }, movingTpSlSize: { type: 'string', description: 'Optional trailing-stop qty.' } } } },
  { name: 'perpSwitchPositionMode', description: 'Switch between merged and separate perp position mode for a settle coin. This is coin-level, not symbol-level: changing USDT affects all symbols under that settle coin. Check current config first with perpGetModeConfigs, and skip the write if it already matches the target.', inputSchema: { type: 'object', required: ['coin', 'isSeparatePz'], properties: { coin: { type: 'string', description: 'Settle coin, e.g. USDT, FreeU' }, isSeparatePz: { type: 'boolean', description: 'true=Separate (分仓), false=Merged (合仓)' } } } },
  { name: 'perpSwitchMarginMode', description: 'Switch between cross and isolated perp margin mode for a symbol. Check current config first with perpGetModeConfigs, and skip the write if it already matches the target.', inputSchema: { type: 'object', required: ['symbol', 'tradeMode', 'buyLeverage', 'sellLeverage'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, tradeMode: { type: 'number', enum: [0, 1], description: '0=Cross (全仓), 1=Isolated (逐仓)' }, buyLeverage: { type: 'string' }, sellLeverage: { type: 'string' } } } },
  { name: 'perpAddMargin', description: 'Adjust the margin on an isolated perp position. Positive value adds margin; negative value reduces margin.', inputSchema: { type: 'object', required: ['symbol', 'positionIdx', 'margin'], properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, positionIdx: { type: 'number', enum: [1, 2], description: '1=Long 2=Short' }, margin: { type: 'string', description: 'Margin delta in settle coin. Positive = add, negative = reduce. Must not be zero.' }, pzLinkId: { type: 'string', description: 'Target a specific separate position in 分仓 mode' } } } },
  { name: 'perpClosePosition', description: 'Close entire perp position at market. No qty — always full close. For partial close, use perpCreateOrder with reduceOnly=true.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, settleCoin: { type: 'string', description: 'e.g. USDT, FreeU. Requires confirmBatch=true.' }, confirmBatch: { type: 'boolean', description: 'Required when using settleCoin without symbol. Confirms coin-level batch operation.' }, positionIdx: { type: 'number', enum: [-1, 1, 2], description: '1=Long only, 2=Short only, -1=Close all positions for this symbol (both long and short)' }, pzLinkId: { type: 'string', description: 'Target a specific separate position' } } } },
];

const WALLET_WRITE_TOOLS = [
  { name: 'transfer', description: 'Transfer funds between wallets. FUNDING=fund account, TRADING=contract account, SPOT=spot account, TRADFI=tradfi account. Always verify the result by reading balances back.', inputSchema: { type: 'object', required: ['coin', 'amount', 'fromWallet', 'toWallet'], properties: { coin: { type: 'string', description: 'Coin to transfer, e.g. USDT, BTC' }, amount: { type: 'string', description: 'Amount to transfer, must be positive' }, fromWallet: { type: 'string', enum: ['FUNDING', 'TRADING', 'SPOT', 'TRADFI'], description: 'Source wallet' }, toWallet: { type: 'string', enum: ['FUNDING', 'TRADING', 'SPOT', 'TRADFI'], description: 'Destination wallet' } } } },
];

const DIAGNOSTIC_TOOLS = [
  { name: 'getCapabilities', description: 'Get a machine-readable capability snapshot for this MCP server session: auth state, trade enablement, tool count, and loaded modules.', inputSchema: { type: 'object', properties: {} } },
  { name: 'getTrace', description: 'Get full trace by traceId. Returns tool args, normalized MCP response, and raw exchange HTTP calls/responses.', inputSchema: { type: 'object', required: ['traceId'], properties: { traceId: { type: 'string', description: 'Trace id returned by a previous MCP tool call.' } } } },
  { name: 'searchTraces', description: 'Search traces by traceId, orderId/orderNo, orderLinkId, symbol, toolName, success, or time range.', inputSchema: { type: 'object', properties: { traceId: { type: 'string' }, orderId: { type: 'string' }, orderNo: { type: 'string', description: 'Alias of orderId.' }, orderLinkId: { type: 'string' }, symbol: { type: 'string', description: 'e.g. BTCUSDT, ETHFreeU' }, toolName: { type: 'string' }, success: { type: 'boolean' }, fromTs: { type: 'string', description: 'ISO timestamp inclusive.' }, toTs: { type: 'string', description: 'ISO timestamp inclusive.' }, limit: { type: 'number', default: 10 } } } },
];

// -- Main --

async function main() {
  const config = loadConfig();
  const hasAuth = !!(config.apiKey && config.apiSecret);
  const canTrade = hasAuth && process.env.EXCHANGE_ENABLE_TRADE === 'true';

  const { setRecvWindow } = require('./lib/signer');
  if (config.recvWindow) setRecvWindow(config.recvWindow);

  const traceStore = new TraceStore();
  const http = new HttpClient({ ...config, debugStore: traceStore });
  const audit = new AuditLogger();

  // Register tools based on auth level
  const tools = [...MARKET_TOOLS];
  if (hasAuth) tools.push(...SPOT_QUERY_TOOLS, ...TRADFI_QUERY_TOOLS, ...EARN_QUERY_TOOLS, ...PERP_QUERY_TOOLS, ...WALLET_QUERY_TOOLS);
  if (canTrade) tools.push(...PERP_TRADE_TOOLS, ...WALLET_WRITE_TOOLS);
  tools.push(...DIAGNOSTIC_TOOLS);
  const capabilitySnapshot = buildCapabilitySnapshot({ hasAuth, canTrade, toolCount: tools.length, tools });

  const MARKET_HANDLERS = {
    getTicker:            (args) => market.getTicker(http, args),
    getOrderbook:         (args) => market.getOrderbook(http, args),
    getKlines:            (args) => market.getKlines(http, args),
    getMarkPriceKlines:   (args) => market.getMarkPriceKlines(http, args),
    getFundingRate:        (args) => market.getFundingRate(http, args),
    getInstruments:       (args) => market.getInstruments(http, args),
    getRiskLimits:        (args) => market.getRiskLimits(http, args),
    getRecentTrades:      (args) => market.getRecentTrades(http, args),
    getFundingRateHistory:(args) => market.getFundingRateHistory(http, args),
  };
  const PERP_QUERY_HANDLERS = {
    perpGetBalance:       (args) => perpQuery.getBalance(http, args),
    perpGetPositions:     (args) => perpQuery.getPositions(http, args),
    perpGetFeeRate:       (args) => perpQuery.getFeeRate(http, args),
    perpGetModeConfigs:   (args) => perpQuery.getPositionModeConfigs(http, args),
    perpGetOpenOrders:    (args) => perp.getOpenOrders(http, args),
    perpGetOrderHistory:  (args) => perp.getOrderHistory(http, args),
    perpGetExecutions:    (args) => perp.getExecutions(http, args),
    perpGetClosedPnl:     (args) => perp.getClosedPnl(http, args),
    perpGetWalletFlowRecords: (args) => perpQuery.getWalletFlowRecords(http, args),
  };
  const SPOT_QUERY_HANDLERS = {
    spotGetBalance:       (args) => spot.getBalance(http, args),
  };
  const TRADFI_QUERY_HANDLERS = {
    tradfiGetBalance:     (args) => tradfi.getBalance(http, args),
  };
  const EARN_QUERY_HANDLERS = {
    earnGetBalance:       (args) => earn.getBalance(http, args),
  };
  const WALLET_QUERY_HANDLERS = {
    fundGetAssets:        (args) => wallet.getWalletAssets(http, args),
    getPortfolioNetWorth: (args) => wallet.getAllWalletBalance(http, args),
  };
  const PERP_TRADE_HANDLERS = {
    perpCreateOrder:      (args) => perp.createOrder(http, args),
    perpAddToPosition:    (args) => perp.addToPosition(http, args),
    perpModifyOrder:      (args) => perp.modifyOrder(http, args),
    perpCancelOrder:      (args) => perp.cancelOrder(http, args),
    perpCancelAllOrders:  (args) => perp.cancelAllOrders(http, args),
    perpSetLeverage:      (args) => perp.setLeverage(http, args),
    perpCreateTpSl:       (args) => perp.createTpSl(http, args),
    perpReplaceTpSl:      (args) => perp.replaceTpSl(http, args),
    perpSwitchPositionMode: (args) => perp.switchSeparatePosition(http, args),
    perpSwitchMarginMode: (args) => perp.switchMarginMode(http, args),
    perpAddMargin:        (args) => perp.addMargin(http, args),
    perpClosePosition:    (args) => perp.closePosition(http, args),
  };
  const WALLET_WRITE_HANDLERS = {
    transfer:             (args) => wallet.transfer(http, args),
  };
  const DIAGNOSTIC_HANDLERS = {
    getCapabilities:      () => diagnostics.getCapabilities(capabilitySnapshot),
    getTrace:             (args) => diagnostics.getTrace(traceStore, args),
    searchTraces:         (args) => diagnostics.searchTraces(traceStore, args),
  };

  const HANDLERS = { ...MARKET_HANDLERS };
  if (hasAuth) Object.assign(HANDLERS, SPOT_QUERY_HANDLERS, TRADFI_QUERY_HANDLERS, EARN_QUERY_HANDLERS, PERP_QUERY_HANDLERS, WALLET_QUERY_HANDLERS);
  if (canTrade) Object.assign(HANDLERS, PERP_TRADE_HANDLERS, WALLET_WRITE_HANDLERS);
  Object.assign(HANDLERS, DIAGNOSTIC_HANDLERS);

  const server = new Server(
    { name: 'yubit', version: '1.0.3' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const callArgs = args || {};
    const handler = HANDLERS[name];
    if (!handler) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { message: `Unknown tool: ${name}` } }) }] };
    }
    const trace = traceStore.createTrace(name, callArgs);
    return traceStore.runWithTrace(trace, async () => {
      try {
        const result = await handler(callArgs);
        const response = { ...result, traceId: trace.traceId };
        traceStore.finalizeTrace(trace, response);
        await audit.log('tool_call', {
          tool: name,
          traceId: trace.traceId,
          args: callArgs,
          success: response.success,
          rateLimitWaitMs: trace.meta?.rateLimitWaitMs || 0,
          rateLimitWaitEvents: trace.meta?.rateLimitWaitEvents || 0,
        });
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (err) {
        const response = { success: false, data: null, error: { message: err.message }, traceId: trace.traceId };
        traceStore.finalizeTrace(trace, response);
        await audit.log('tool_error', {
          tool: name,
          traceId: trace.traceId,
          args: callArgs,
          error: err.message,
          rateLimitWaitMs: trace.meta?.rateLimitWaitMs || 0,
          rateLimitWaitEvents: trace.meta?.rateLimitWaitEvents || 0,
        });
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      }
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  await audit.log('server_started', capabilitySnapshot);
}

main().catch(err => { console.error(err); process.exit(1); });
