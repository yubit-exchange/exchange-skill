'use strict';

const { wrapResponse, normalizePosition } = require('../lib/normalize');

const PATHS = {
  balance:      '/oapi/contract/trade/private/v1/wallet-balances',
  feeRate:      '/oapi/contract/trade/private/v1/fee-rates',
  positions:    '/oapi/contract/trade/private/v1/positions',
  modeConfigs:  '/oapi/contract/trade/private/v1/positions/mode-configs',
  walletFlow:   '/oapi/contract/trade/private/v1/wallet-flow-records',
};

function fail(message) {
  return { success: false, data: null, error: { code: -1, message } };
}

async function getBalance(http, { coin } = {}) {
  const params = coin ? { coin } : {};
  return wrapResponse(await http.get(PATHS.balance, params));
}

async function getFeeRate(http, { symbol }) {
  return wrapResponse(await http.get(PATHS.feeRate, { symbol }));
}

async function getPositions(http, { symbol, settleCoin, limit, cursor } = {}) {
  if (!symbol && !settleCoin) {
    return { success: false, data: null, error: { code: -1,
      message: 'Please specify symbol (e.g. BTCUSDT, ETHFreeU) or settleCoin (e.g. USDT, FreeU)' } };
  }
  const params = {};
  if (symbol) params.symbol = symbol;
  if (settleCoin) params.settleCoin = settleCoin;
  if (limit != null) params.limit = String(limit);
  if (cursor) params.cursor = cursor;
  const raw = await http.get(PATHS.positions, params);
  const res = wrapResponse(raw);
  if (res.success) {
    if (res.data.list) res.data.list = res.data.list.map(normalizePosition);
    if (res.data.separateList) res.data.separateList = res.data.separateList.map(normalizePosition);
  }
  return res;
}

async function getPositionModeConfigs(http, { symbol, coin, category } = {}) {
  const params = {};
  if (symbol) params.symbol = symbol;
  if (coin) params.coin = coin;
  if (category) params.category = category;
  return wrapResponse(await http.get(PATHS.modeConfigs, params));
}

async function getWalletFlowRecords(http, {
  coin,
  startTime,
  endTime,
  limit,
  fundType,
  cursor,
  sort,
  contractType,
  includeFreeU,
} = {}) {
  const params = {};
  if (coin) params.coin = coin;

  if (startTime != null) {
    const n = Number(startTime);
    if (!Number.isFinite(n) || n <= 0) return fail('startTime must be a positive Unix timestamp in seconds');
    params.startTime = String(Math.floor(n));
  }
  if (endTime != null) {
    const n = Number(endTime);
    if (!Number.isFinite(n) || n <= 0) return fail('endTime must be a positive Unix timestamp in seconds');
    params.endTime = String(Math.floor(n));
  }
  if (params.startTime && params.endTime && Number(params.endTime) <= Number(params.startTime)) {
    return fail('endTime must be greater than startTime');
  }

  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n <= 0 || n > 100) return fail('limit must be an integer between 1 and 100');
    params.limit = String(n);
  }

  if (fundType != null) {
    const n = Number(fundType);
    if (!Number.isInteger(n) || n < 0) return fail('fundType must be a non-negative integer');
    params.fundType = String(n);
  }

  if (cursor) params.cursor = cursor;

  if (sort != null) {
    const normalizedSort = String(sort).toUpperCase();
    if (normalizedSort !== 'DESC') return fail('sort currently only supports DESC');
    params.sort = normalizedSort;
  }

  if (contractType != null) {
    const normalizedContractType = String(contractType);
    if (normalizedContractType !== 'linear') return fail('contractType currently only supports linear');
  }

  if (includeFreeU != null) {
    if (typeof includeFreeU === 'boolean') params.includeFreeU = String(includeFreeU);
    else {
      const normalized = String(includeFreeU).toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        return fail('includeFreeU must be true or false');
      }
      params.includeFreeU = normalized;
    }
  }

  return wrapResponse(await http.get(PATHS.walletFlow, params));
}

module.exports = { getBalance, getFeeRate, getPositions, getPositionModeConfigs, getWalletFlowRecords };
