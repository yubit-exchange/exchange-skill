'use strict';

const INSTRUMENTS_CACHE_TTL_MS = 15 * 60 * 1000;

let instrumentsCache = null;
let instrumentsCacheAt = 0;

async function loadInstruments(httpClient) {
  if (instrumentsCache && (Date.now() - instrumentsCacheAt) < INSTRUMENTS_CACHE_TTL_MS) {
    return instrumentsCache;
  }
  const res = await httpClient.get('/oapi/contract/instrument/public/v1/instruments', { limit: '1000' });
  if (res.code === 0 && res.data && res.data.list) {
    instrumentsCache = {};
    for (const item of res.data.list) {
      instrumentsCache[item.symbol] = item;
    }
    instrumentsCacheAt = Date.now();
  }
  return instrumentsCache || {};
}

function clearCache() {
  instrumentsCache = null;
  instrumentsCacheAt = 0;
}

async function validateSymbol(httpClient, symbol) {
  const instruments = await loadInstruments(httpClient);
  if (!instruments[symbol]) {
    return { valid: false, reason: `Unsupported symbol: ${symbol}` };
  }
  return { valid: true, spec: instruments[symbol] };
}

async function validateOrder(httpClient, params) {
  const { symbol, side, orderType, qty, price, positionIdx } = params;

  if (!symbol) return { valid: false, reason: 'symbol is required' };
  if (!side || !['Buy', 'Sell'].includes(side)) return { valid: false, reason: 'side must be Buy or Sell' };
  if (positionIdx == null) return { valid: false, reason: 'positionIdx is required (1=Long, 2=Short)' };
  if (![1, 2].includes(Number(positionIdx))) {
    return { valid: false, reason: 'positionIdx must be 1 (Long) or 2 (Short)' };
  }
  if (!orderType || !['Market', 'Limit'].includes(orderType)) return { valid: false, reason: 'orderType must be Market or Limit' };
  if (!qty) return { valid: false, reason: 'qty is required' };
  if (orderType === 'Limit' && !price) return { valid: false, reason: 'price is required for Limit orders' };

  const symbolCheck = await validateSymbol(httpClient, symbol);
  if (!symbolCheck.valid) return symbolCheck;
  const spec = symbolCheck.spec;

  const qtyNum = parseFloat(qty);
  const minQty = parseFloat(spec.lotSizeFilter.minTradingQty);
  const maxQty = parseFloat(spec.lotSizeFilter.maxTradingQty);
  const qtyStep = parseFloat(spec.lotSizeFilter.qtyStep);

  if (isNaN(qtyNum) || qtyNum < minQty || qtyNum > maxQty) {
    return { valid: false, reason: `qty out of range (${minQty} ~ ${maxQty})` };
  }

  const remainder = (qtyNum - minQty) % qtyStep;
  if (Math.abs(remainder) > 1e-10 && Math.abs(remainder - qtyStep) > 1e-10) {
    return { valid: false, reason: `qty does not match step size (${qtyStep})` };
  }

  if (price) {
    const priceNum = parseFloat(price);
    const minPrice = parseFloat(spec.priceFilter.minPrice);
    const maxPrice = parseFloat(spec.priceFilter.maxPrice);
    if (isNaN(priceNum) || priceNum < minPrice || priceNum > maxPrice) {
      return { valid: false, reason: `price out of range (${minPrice} ~ ${maxPrice})` };
    }
  }

  return { valid: true, spec };
}

function validateTpSl({ side, positionIdx, takeProfit, stopLoss, markPrice }) {
  if (!markPrice) return { valid: true };
  const mark = parseFloat(markPrice);
  const isLong = positionIdx === 1 || side === 'Buy';

  if (takeProfit) {
    const tp = parseFloat(takeProfit);
    if (isLong && tp <= mark) return { valid: false, reason: `Long TP (${tp}) must be above mark price (${mark})` };
    if (!isLong && tp >= mark) return { valid: false, reason: `Short TP (${tp}) must be below mark price (${mark})` };
  }
  if (stopLoss) {
    const sl = parseFloat(stopLoss);
    if (isLong && sl >= mark) return { valid: false, reason: `Long SL (${sl}) must be below mark price (${mark})` };
    if (!isLong && sl <= mark) return { valid: false, reason: `Short SL (${sl}) must be above mark price (${mark})` };
  }
  return { valid: true };
}

async function validateLeverage(httpClient, symbol, leverage) {
  const symbolCheck = await validateSymbol(httpClient, symbol);
  if (!symbolCheck.valid) return symbolCheck;
  const max = parseFloat(symbolCheck.spec.leverageFilter.maxLeverage);
  const min = parseFloat(symbolCheck.spec.leverageFilter.minLeverage);
  const lev = parseFloat(leverage);
  if (isNaN(lev) || lev < min || lev > max) {
    return { valid: false, reason: `leverage out of range (${min} ~ ${max})` };
  }
  return { valid: true };
}

function validateAdvancedTpSl(params) {
  if (params.tpOrderType === 'Limit' && !params.tpLimitPrice) {
    return { valid: false, reason: 'tpLimitPrice is required when tpOrderType=Limit' };
  }
  if (params.slOrderType === 'Limit' && !params.slLimitPrice) {
    return { valid: false, reason: 'slLimitPrice is required when slOrderType=Limit' };
  }
  if (params.tpLimitPrice && params.tpOrderType !== 'Limit') {
    return { valid: false, reason: 'tpLimitPrice requires tpOrderType=Limit' };
  }
  if (params.slLimitPrice && params.slOrderType !== 'Limit') {
    return { valid: false, reason: 'slLimitPrice requires slOrderType=Limit' };
  }
  return { valid: true };
}

module.exports = { loadInstruments, clearCache, validateSymbol, validateOrder, validateTpSl, validateAdvancedTpSl, validateLeverage, INSTRUMENTS_CACHE_TTL_MS };
