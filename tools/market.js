'use strict';

const { wrapResponse, normalizeTicker } = require('../lib/normalize');

const PATHS = {
  tickers:           '/oapi/contract/market/public/v1/tickers',
  orderbooks:        '/oapi/contract/market/public/v1/orderbooks',
  klines:            '/oapi/contract/instrument/public/v1/klines',
  markPriceKlines:   '/oapi/contract/instrument/public/v1/mark-price-klines',
  fundingRate:       '/oapi/contract/instrument/public/v1/funding-rate-history',
  instruments:       '/oapi/contract/instrument/public/v1/instruments',
  riskLimits:        '/oapi/contract/instrument/public/v1/risk-limits',
  recentTrades:      '/oapi/contract/market/public/v1/recent-trades',
};

async function getTicker(http, { symbol }) {
  const raw = await http.get(PATHS.tickers, { symbol });
  const res = wrapResponse(raw);
  if (res.success && res.data.list) {
    res.data.list = res.data.list.map(normalizeTicker);
  }
  return res;
}

async function getOrderbook(http, { symbol, depth = '25' }) {
  return wrapResponse(await http.get(PATHS.orderbooks, { symbol, depth: String(depth) }));
}

async function getKlines(http, { symbol, interval, limit = '200', start, end }) {
  const params = { symbol, interval: String(interval), limit: String(limit) };
  if (start != null) params.start = String(start);
  if (end != null) params.end = String(end);
  return wrapResponse(await http.get(PATHS.klines, params));
}

async function getMarkPriceKlines(http, { symbol, interval, limit = '200', start, end }) {
  const params = { symbol, interval: String(interval), limit: String(limit) };
  if (start != null) params.start = String(start);
  if (end != null) params.end = String(end);
  return wrapResponse(await http.get(PATHS.markPriceKlines, params));
}

async function getFundingRate(http, { symbol }) {
  const raw = await http.get(PATHS.tickers, { symbol });
  const res = wrapResponse(raw);
  if (res.success && res.data.list && res.data.list[0]) {
    const t = normalizeTicker(res.data.list[0]);
    res.data = { symbol, fundingRate: t.fundingRate, nextFundingTime: t.nextFundingTime };
  }
  return res;
}

async function getFundingRateHistory(http, { symbol, limit = '10', startTime, endTime }) {
  const params = { symbol, limit: String(limit) };
  if (startTime != null) params.startTime = String(startTime);
  if (endTime != null) params.endTime = String(endTime);
  return wrapResponse(await http.get(PATHS.fundingRate, params));
}

async function getInstruments(http, { symbol, status, limit, cursor } = {}) {
  const params = {};
  if (symbol) params.symbol = symbol;
  if (status) params.status = status;
  if (limit != null) params.limit = String(limit);
  if (cursor) params.cursor = cursor;
  return wrapResponse(await http.get(PATHS.instruments, params));
}

async function getRiskLimits(http, { symbol } = {}) {
  const params = {};
  if (symbol) params.symbol = symbol;
  return wrapResponse(await http.get(PATHS.riskLimits, params));
}

async function getRecentTrades(http, { symbol, limit = '20' }) {
  return wrapResponse(await http.get(PATHS.recentTrades, { symbol, limit: String(limit) }));
}

module.exports = {
  getTicker, getOrderbook, getKlines, getMarkPriceKlines,
  getFundingRate, getFundingRateHistory,
  getInstruments, getRiskLimits, getRecentTrades,
};
