'use strict';

const TOOL_MODULES = {
  getTicker: 'market',
  getOrderbook: 'market',
  getKlines: 'market',
  getMarkPriceKlines: 'market',
  getFundingRate: 'market',
  getInstruments: 'market',
  getRiskLimits: 'market',
  getRecentTrades: 'market',
  getFundingRateHistory: 'market',

  spotGetBalance: 'spot',
  tradfiGetBalance: 'tradfi',
  earnGetBalance: 'earn',

  perpGetBalance: 'perp',
  perpGetPositions: 'perp',
  perpGetFeeRate: 'perp',
  perpGetModeConfigs: 'perp',
  perpGetOpenOrders: 'perp',
  perpGetOrderHistory: 'perp',
  perpGetExecutions: 'perp',
  perpGetClosedPnl: 'perp',
  perpGetWalletFlowRecords: 'perp',

  fundGetAssets: 'wallet',
  getPortfolioNetWorth: 'wallet',
  transfer: 'wallet',

  perpCreateOrder: 'perp',
  perpAddToPosition: 'perp',
  perpModifyOrder: 'perp',
  perpCancelOrder: 'perp',
  perpCancelAllOrders: 'perp',
  perpSetLeverage: 'perp',
  perpCreateTpSl: 'perp',
  perpReplaceTpSl: 'perp',
  perpSwitchPositionMode: 'perp',
  perpSwitchMarginMode: 'perp',
  perpAddMargin: 'perp',
  perpClosePosition: 'perp',

  getCapabilities: 'diagnostics',
  getTrace: 'diagnostics',
  searchTraces: 'diagnostics',
};

const MODULE_DESCRIPTIONS = {
  market: {
    description: 'Market data and public exchange information.',
    descriptionZh: '行情与公开市场数据。',
  },
  spot: {
    description: 'Spot account balances and assets.',
    descriptionZh: '现货账户余额与资产列表。',
  },
  tradfi: {
    description: 'TradFi account balances and margin details.',
    descriptionZh: 'TradFi 账户余额与保证金详情。',
  },
  earn: {
    description: 'Earn account balances and interest details.',
    descriptionZh: '理财账户余额与收益详情。',
  },
  wallet: {
    description: 'Funding wallet assets, portfolio net worth, and transfers.',
    descriptionZh: '资金账户资产、总资产净值和资金划转。',
  },
  perp: {
    description: 'Perpetual futures balances, positions, orders, executions, and trading actions.',
    descriptionZh: '永续合约余额、持仓、订单、成交和交易操作。',
  },
  diagnostics: {
    description: 'Capability inspection, traces, and troubleshooting.',
    descriptionZh: '能力探测、链路追踪与排障。',
  },
};

const TOOL_DESCRIPTIONS_ZH = {
  getTicker: '查询实时价格、标记价、24h 涨跌、成交量、买一卖一和资金费率。',
  getOrderbook: '查询盘口深度、价差和买卖盘挂单墙。',
  getKlines: '查询普通成交价 K 线。',
  getMarkPriceKlines: '查询标记价格 K 线，不含成交量。',
  getFundingRate: '查询当前资金费率和下次结算时间。',
  getInstruments: '查询合约规则，如最小下单量、tick size、杠杆范围、交易状态。',
  getRiskLimits: '查询风险限额分层、最大名义价值和杠杆档位。',
  getRecentTrades: '查询最近公开成交明细。',
  getFundingRateHistory: '查询历史资金费率。',

  spotGetBalance: '查询现货账户资产列表，返回各币种总额、可用和冻结数量。',
  tradfiGetBalance: '查询 TradFi 账户详情，返回余额、净值、保证金、可用保证金、杠杆和浮动盈亏。',
  earnGetBalance: '查询理财账户余额与收益明细，返回币种、余额、净值和利息字段。',

  perpGetBalance: '查询永续合约账户余额，不是资金账户。',
  perpGetPositions: '查询永续合约当前持仓。',
  perpGetFeeRate: '查询指定永续交易对的 maker/taker 手续费率。',
  perpGetModeConfigs: '查询永续当前杠杆、全仓/逐仓、合仓/分仓配置。配置类写操作前应先查这里，当前已是目标配置就不要重复写。',
  perpGetOpenOrders: '查询永续当前挂单；看条件单或 TP/SL 需用 StopOrder 过滤。',
  perpGetOrderHistory: '查询永续历史订单。',
  perpGetExecutions: '查询永续成交明细。',
  perpGetClosedPnl: '查询永续已平仓盈亏记录。',
  perpGetWalletFlowRecords: '查询永续资金流水/账单流水，包括划转、已实现盈亏、资金费用和手续费等记录。',

  fundGetAssets: '查询 funding 资金账户资产列表。',
  getPortfolioNetWorth: '查询资金、合约、现货、TradFi 全账户总资产折算值。',

  perpCreateOrder: '永续下单，支持市价、限价和条件单。',
  perpAddToPosition: '安全地给已有永续仓位加仓。合仓模式下直接并入单一同方向仓位；分仓模式下会自动定位或要求目标 pzLinkId，并回读验证没有误开新分仓。',
  perpModifyOrder: '修改永续挂单价格、数量或附带 TP/SL。',
  perpCancelOrder: '撤销指定永续订单。',
  perpCancelAllOrders: '批量撤销永续订单；按结算币批量操作时需要确认标记。',
  perpSetLeverage: '设置永续 symbol 默认杠杆，或设置指定分仓仓位杠杆。执行前先查当前配置，已是目标杠杆时不要重复写。',
  perpCreateTpSl: '创建永续止盈止损，也支持 trailing stop。',
  perpReplaceTpSl: '修改已有永续 TP/SL 子单。',
  perpSwitchPositionMode: '切换永续合仓/分仓模式。这是结算币级配置，会影响该结算币下所有 symbol；执行前先查当前配置。',
  perpSwitchMarginMode: '切换永续全仓/逐仓模式。执行前先查当前配置，已是目标状态时不要重复写。',
  perpAddMargin: '增加或减少永续逐仓保证金。',
  perpClosePosition: '整仓市价平掉永续仓位；部分平仓要用 reduceOnly 下单。',
  transfer: '在 FUNDING、TRADING、SPOT、TRADFI 之间划转资金，并在划转后读回校验。',

  getCapabilities: '查询当前 MCP 会话启用了哪些模块和工具。',
  getTrace: '按 traceId 查看完整请求链路和原始响应。',
  searchTraces: '按 traceId、订单号、symbol、时间范围搜索链路记录。',
};

function getEnabledModules({ hasAuth, canTrade }) {
  const modules = ['market'];
  if (hasAuth) modules.push('wallet', 'spot', 'tradfi', 'earn', 'perp');
  modules.push('diagnostics');
  return modules;
}

function buildToolSummaries(tools = [], enabledModules = []) {
  return tools
    .map((tool) => ({
      name: tool.name,
      module: TOOL_MODULES[tool.name] || 'unknown',
      description: tool.description || '',
      descriptionZh: TOOL_DESCRIPTIONS_ZH[tool.name] || '',
    }))
    .filter((tool) => enabledModules.includes(tool.module));
}

function buildModuleSummaries(enabledModules, toolSummaries) {
  return enabledModules.map((name) => ({
    name,
    description: MODULE_DESCRIPTIONS[name]?.description || '',
    descriptionZh: MODULE_DESCRIPTIONS[name]?.descriptionZh || '',
    toolCount: toolSummaries.filter((tool) => tool.module === name).length,
  }));
}

function buildCapabilitySnapshot({ hasAuth, canTrade, toolCount, tools = [] }) {
  const modules = getEnabledModules({ hasAuth, canTrade });
  const toolSummaries = buildToolSummaries(tools, modules);
  return {
    hasAuth: !!hasAuth,
    canTrade: !!canTrade,
    toolCount: Number(toolCount) || toolSummaries.length || 0,
    modules,
    moduleDetails: buildModuleSummaries(modules, toolSummaries),
    tools: toolSummaries,
  };
}

module.exports = {
  TOOL_MODULES,
  TOOL_DESCRIPTIONS_ZH,
  MODULE_DESCRIPTIONS,
  getEnabledModules,
  buildCapabilitySnapshot,
};
