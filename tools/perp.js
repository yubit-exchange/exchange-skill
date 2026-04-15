'use strict';

const { wrapResponse } = require('../lib/normalize');
const { validateOrder, validateTpSl, validateAdvancedTpSl, validateLeverage } = require('../lib/validate');
const { generateOrderLinkId } = require('../lib/signer');
const perpQuery = require('./perp-query');

const PATHS = {
  orders:       '/oapi/contract/trade/private/v1/orders',
  ordersReplace:'/oapi/contract/trade/private/v1/orders/replace',
  ordersCancel: '/oapi/contract/trade/private/v1/orders/cancel',
  cancelAll:    '/oapi/contract/trade/private/v1/orders/cancel-all',
  openOrders:   '/oapi/contract/trade/private/v1/open-orders',
  executions:   '/oapi/contract/trade/private/v1/executions',
  closedPnl:    '/oapi/contract/trade/private/v1/closed-pnl',
  leverage:     '/oapi/contract/trade/private/v1/positions/leverage',
  createTpSl:   '/oapi/contract/trade/private/v1/positions/create-tpsl',
  replaceTpSl:  '/oapi/contract/trade/private/v1/positions/replace-tpsl',
  closeAll:     '/oapi/contract/trade/private/v1/positions/close-all',
  switchSeparate: '/oapi/contract/trade/private/v1/positions/switch-separate-position',
  marginMode:   '/oapi/contract/trade/private/v1/positions/margin-mode',
  addMargin:    '/oapi/contract/trade/private/v1/positions/add-margin',
};

function fail(message) {
  return { success: false, data: null, error: { code: -1, message } };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAllPositions(positionRes, positionIdx) {
  if (!positionRes?.success) return [];
  return [
    ...(positionRes.data?.list || []),
    ...(positionRes.data?.separateList || []),
  ].filter((pos) => Number(pos.positionIdx) === Number(positionIdx));
}

function formatDirection(positionIdx) {
  return Number(positionIdx) === 1 ? 'Long' : Number(positionIdx) === 2 ? 'Short' : `positionIdx=${positionIdx}`;
}

function formatPositionChoices(positions) {
  return positions.map((pos) => (
    `${pos.pzLinkId || 'merged'} size=${pos.size} entry=${pos.entryPrice} leverage=${pos.leverage}`
  )).join('; ');
}

function findPositionByPzLinkId(positions, pzLinkId) {
  return positions.find((pos) => pos.pzLinkId === pzLinkId) || null;
}

function parseTimeMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function approxEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

function approxPriceEqual(a, b) {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  const eps = Math.max(0.5, scale * 1e-5);
  return Math.abs(a - b) <= eps;
}

function summarizeOrder(order) {
  if (!order) return null;
  return {
    orderId: order.orderId || null,
    orderLinkId: order.orderLinkId || null,
    symbol: order.symbol || null,
    side: order.side || null,
    qty: order.qty || null,
    orderType: order.orderType || null,
    orderStatus: order.orderStatus || null,
    reduceOnly: order.reduceOnly === true,
    positionIdx: order.positionIdx ?? null,
  };
}

function summarizeExecution(execution) {
  if (!execution) return null;
  return {
    orderId: execution.orderId || null,
    orderLinkId: execution.orderLinkId || null,
    side: execution.side || null,
    execQty: execution.execQty || null,
    execPrice: execution.execPrice || null,
    execTime: execution.execTime || null,
    closedSize: execution.closedSize || null,
  };
}

function summarizeClosedPnl(record) {
  if (!record) return null;
  return {
    orderId: record.orderId || null,
    side: record.side || null,
    qty: record.qty || null,
    closedSize: record.closedSize || null,
    avgEntryPrice: record.avgEntryPrice || null,
    avgExitPrice: record.avgExitPrice || null,
    closedPnl: record.closedPnl || null,
    createdAt: record.createdAt || null,
  };
}

// MCP clients may serialize boolean args as strings ("true"/"false").
// Normalize to real boolean; return null if input is null/undefined.
function toBool(v) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return null;
}

async function _validateTpSlWithTicker(http, params) {
  if (!params.takeProfit && !params.stopLoss) return { valid: true };
  const { getTicker } = require('./market');
  const tickerRes = await getTicker(http, { symbol: params.symbol });
  if (!tickerRes.success || !tickerRes.data.list || !tickerRes.data.list[0]) return { valid: true };
  return validateTpSl({
    positionIdx: params.positionIdx, side: params.side,
    takeProfit: params.takeProfit, stopLoss: params.stopLoss,
    markPrice: tickerRes.data.list[0].markPrice,
  });
}

async function createOrder(http, params) {
  const check = await validateOrder(http, params);
  if (!check.valid) return fail(check.reason);
  const tpSlCheck = await _validateTpSlWithTicker(http, params);
  if (!tpSlCheck.valid) return fail(tpSlCheck.reason);
  const advCheck = validateAdvancedTpSl(params);
  if (!advCheck.valid) return fail(advCheck.reason);
  // Conditional order: triggerPrice requires triggerDirection (API hard rule)
  if (params.triggerPrice != null && params.triggerDirection == null) {
    return fail('triggerDirection is required when triggerPrice is set (1=rise, 2=fall)');
  }
  if (params.triggerDirection != null && ![1, 2].includes(Number(params.triggerDirection))) {
    return fail('triggerDirection must be 1 (rise) or 2 (fall)');
  }

  const body = {
    symbol: params.symbol, side: params.side,
    orderType: params.orderType, qty: String(params.qty),
    orderLinkId: generateOrderLinkId(),
  };
  if (params.positionIdx != null) body.positionIdx = Number(params.positionIdx);
  if (params.price != null) body.price = String(params.price);
  if (params.timeInForce) body.timeInForce = params.timeInForce;
  if (params.takeProfit != null) body.takeProfit = String(params.takeProfit);
  if (params.stopLoss != null) body.stopLoss = String(params.stopLoss);
  if (params.tpTriggerBy) body.tpTriggerBy = params.tpTriggerBy;
  if (params.slTriggerBy) body.slTriggerBy = params.slTriggerBy;
  if (params.tpOrderType) body.tpOrderType = params.tpOrderType;
  if (params.tpLimitPrice != null) body.tpLimitPrice = String(params.tpLimitPrice);
  if (params.slOrderType) body.slOrderType = params.slOrderType;
  if (params.slLimitPrice != null) body.slLimitPrice = String(params.slLimitPrice);
  if (params.triggerPrice != null) body.triggerPrice = String(params.triggerPrice);
  if (params.triggerDirection != null) body.triggerDirection = Number(params.triggerDirection);
  if (params.triggerBy) body.triggerBy = params.triggerBy;
  if (params.closeOnTrigger != null) {
    const cot = toBool(params.closeOnTrigger);
    if (cot != null) body.closeOnTrigger = cot;
  }
  if (params.reduceOnly != null) {
    const ro = toBool(params.reduceOnly);
    if (ro != null) body.reduceOnly = ro;
  }
  if (params.mmp != null) {
    const mmp = toBool(params.mmp);
    if (mmp != null) body.mmp = mmp;
  }
  if (params.pzLinkId) body.pzLinkId = params.pzLinkId;

  const raw = await http.post(PATHS.orders, body);
  const res = wrapResponse(raw);
  if (res.success) res.data.orderLinkId = body.orderLinkId;
  return res;
}

async function addToPosition(http, params) {
  if (!params.symbol) return fail('symbol is required');
  if (params.positionIdx == null) return fail('positionIdx is required (1=Long, 2=Short)');
  if (![1, 2].includes(Number(params.positionIdx))) return fail('positionIdx must be 1 (Long) or 2 (Short)');
  if (params.qty == null || params.qty === '') return fail('qty is required');
  if (params.orderType && params.orderType !== 'Market') {
    return fail('perpAddToPosition currently only supports orderType=Market so the add-on can be post-verified');
  }

  const positionIdx = Number(params.positionIdx);
  const beforeRes = await perpQuery.getPositions(http, { symbol: params.symbol, limit: '100' });
  if (!beforeRes.success) {
    return fail(`Failed to read positions before add-on: ${beforeRes.error?.message || 'unknown error'}`);
  }

  const sameDirectionPositions = getAllPositions(beforeRes, positionIdx);
  if (sameDirectionPositions.length === 0) {
    return fail(`No existing ${formatDirection(positionIdx)} position found on ${params.symbol}. Use perpCreateOrder to open a new position first.`);
  }

  const separatePositions = sameDirectionPositions.filter((pos) => !!pos.pzLinkId || pos.isSeparatePz === true);
  const isSeparate = separatePositions.length > 0;

  let targetPosition = null;
  if (isSeparate) {
    if (params.pzLinkId) {
      targetPosition = findPositionByPzLinkId(sameDirectionPositions, params.pzLinkId);
      if (!targetPosition) {
        return fail(`pzLinkId ${params.pzLinkId} was not found among current ${formatDirection(positionIdx)} positions on ${params.symbol}`);
      }
    } else if (sameDirectionPositions.length === 1) {
      targetPosition = sameDirectionPositions[0];
    } else {
      return fail(
        `Multiple separate ${formatDirection(positionIdx)} positions exist on ${params.symbol}; specify pzLinkId explicitly. Candidates: ${formatPositionChoices(sameDirectionPositions)}`
      );
    }
  } else {
    targetPosition = sameDirectionPositions[0];
  }

  const beforeCount = sameDirectionPositions.length;
  const beforeSize = Number(targetPosition?.size || '0');
  const requestedQty = Number(params.qty);
  if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
    return fail('qty must be a valid positive number');
  }

  const side = positionIdx === 1 ? 'Buy' : 'Sell';
  const orderRes = await createOrder(http, {
    symbol: params.symbol,
    side,
    positionIdx,
    orderType: 'Market',
    qty: String(params.qty),
    pzLinkId: isSeparate ? targetPosition.pzLinkId : undefined,
  });
  if (!orderRes.success) return orderRes;

  let afterRes = await perpQuery.getPositions(http, { symbol: params.symbol, limit: '100' });
  let afterPositions = getAllPositions(afterRes, positionIdx);
  let afterTarget = isSeparate
    ? findPositionByPzLinkId(afterPositions, targetPosition.pzLinkId)
    : afterPositions[0] || null;

  const verificationPassed = () => {
    if (!afterRes.success || !afterTarget) return false;
    if (isSeparate && afterPositions.length !== beforeCount) return false;
    const afterSize = Number(afterTarget.size || '0');
    return Math.abs(afterSize - (beforeSize + requestedQty)) < 1e-9;
  };

  if (!verificationPassed()) {
    await sleep(800);
    afterRes = await perpQuery.getPositions(http, { symbol: params.symbol, limit: '100' });
    afterPositions = getAllPositions(afterRes, positionIdx);
    afterTarget = isSeparate
      ? findPositionByPzLinkId(afterPositions, targetPosition.pzLinkId)
      : afterPositions[0] || null;
  }

  if (!verificationPassed()) {
    const targetId = isSeparate ? targetPosition.pzLinkId : 'merged';
    const afterCount = afterPositions.length;
    const afterSize = Number(afterTarget?.size || '0');
    return {
      success: false,
      data: {
        orderId: orderRes.data?.orderId || null,
        orderLinkId: orderRes.data?.orderLinkId || null,
        targetPzLinkId: isSeparate ? targetPosition.pzLinkId : null,
        beforeCount,
        afterCount,
        beforeSize: String(beforeSize),
        afterSize: afterTarget ? String(afterSize) : null,
      },
      error: {
        code: -1,
        message: `Add-to-position verification failed for ${params.symbol} ${formatDirection(positionIdx)} target ${targetId}. Expected count=${beforeCount} and size=${beforeSize + requestedQty}, got count=${afterCount} and size=${afterTarget ? afterSize : 'missing target position'}.`,
      },
    };
  }

  return {
    success: true,
    data: {
      orderId: orderRes.data?.orderId || null,
      orderLinkId: orderRes.data?.orderLinkId || null,
      targetPzLinkId: isSeparate ? targetPosition.pzLinkId : null,
      beforeSize: String(beforeSize),
      afterSize: afterTarget.size,
      addedQty: String(params.qty),
      separatePositionCount: afterPositions.length,
    },
    error: null,
  };
}

async function diagnoseFilledButFlat(http, params = {}) {
  if (!params.symbol) return fail('symbol is required');
  if (!params.orderId && !params.orderLinkId) return fail('orderId or orderLinkId is required');

  const requestedPositionIdx = params.positionIdx == null ? null : Number(params.positionIdx);
  const closeWindowMs = Number(params.closeWindowMs || 30000);
  const closedPnlLimit = String(params.closedPnlLimit || '10');

  const loadOpenOrder = async () => {
    const res = await getOrderHistory(http, {
      symbol: params.symbol,
      limit: '20',
      orderId: params.orderId,
      orderLinkId: params.orderLinkId,
    });
    return { res, order: res.success ? (res.data?.list?.[0] || null) : null };
  };

  let { res: openOrderRes, order: openOrder } = await loadOpenOrder();
  if (!openOrderRes.success) {
    return fail(`Failed to read order history: ${openOrderRes.error?.message || 'unknown error'}`);
  }
  if (!openOrder) {
    await sleep(800);
    ({ res: openOrderRes, order: openOrder } = await loadOpenOrder());
    if (!openOrderRes.success) {
      return fail(`Failed to read order history: ${openOrderRes.error?.message || 'unknown error'}`);
    }
  }
  if (!openOrder) {
    return fail(`Open order was not found on ${params.symbol}`);
  }

  const effectivePositionIdx = requestedPositionIdx
    || (openOrder.side === 'Buy' ? 1 : openOrder.side === 'Sell' ? 2 : null);
  if (![1, 2].includes(Number(effectivePositionIdx))) {
    return fail('positionIdx is required when it cannot be inferred from the filled order');
  }

  if (openOrder.orderStatus !== 'Filled') {
    return {
      success: true,
      data: {
        diagnosis: 'order_not_filled',
        openOrder: summarizeOrder(openOrder),
      },
      error: null,
    };
  }

  const loadOpenExecution = async () => {
    const res = await getExecutions(http, {
      symbol: params.symbol,
      limit: '20',
      orderId: openOrder.orderId,
      orderLinkId: params.orderLinkId,
    });
    return { res, execution: res.success ? (res.data?.list?.[0] || null) : null };
  };

  let { res: openExecRes, execution: openExecution } = await loadOpenExecution();
  if (!openExecRes.success) {
    return fail(`Failed to read executions for ${openOrder.orderId}: ${openExecRes.error?.message || 'unknown error'}`);
  }
  if (!openExecution) {
    await sleep(800);
    ({ res: openExecRes, execution: openExecution } = await loadOpenExecution());
    if (!openExecRes.success) {
      return fail(`Failed to read executions for ${openOrder.orderId}: ${openExecRes.error?.message || 'unknown error'}`);
    }
  }

  const positionsRes = await perpQuery.getPositions(http, { symbol: params.symbol, limit: '100' });
  if (!positionsRes.success) {
    return fail(`Failed to read current positions: ${positionsRes.error?.message || 'unknown error'}`);
  }
  const sameDirectionPositions = getAllPositions(positionsRes, effectivePositionIdx);
  if (sameDirectionPositions.length > 0) {
    return {
      success: true,
      data: {
        diagnosis: 'position_still_open',
        openOrder: summarizeOrder(openOrder),
        openExecution: summarizeExecution(openExecution),
        matchingPositionCount: sameDirectionPositions.length,
      },
      error: null,
    };
  }

  const openExecTimeMs = parseTimeMs(openExecution?.execTime);
  const openExecQty = toFiniteNumber(openExecution?.execQty || openOrder.cumExecQty || openOrder.qty);
  const openExecPrice = toFiniteNumber(openExecution?.execPrice);
  const expectedCloseSide = Number(effectivePositionIdx) === 1 ? 'Sell' : 'Buy';
  const findMatchingClose = async () => {
    const closedPnlRes = await getClosedPnl(http, {
      symbol: params.symbol,
      limit: closedPnlLimit,
    });
    if (!closedPnlRes.success) {
      return { res: closedPnlRes, match: null };
    }
    const match = (closedPnlRes.data?.list || [])
      .map((record) => {
        const createdAtMs = parseTimeMs(record.createdAt);
        const closedSize = toFiniteNumber(record.closedSize || record.qty);
        const avgEntryPrice = toFiniteNumber(record.avgEntryPrice);
        const timeDeltaMs = openExecTimeMs != null && createdAtMs != null ? createdAtMs - openExecTimeMs : null;
        const sideMatches = record.side === expectedCloseSide;
        const sizeMatches = openExecQty != null && closedSize != null && approxEqual(closedSize, openExecQty);
        const timeMatches = timeDeltaMs != null && timeDeltaMs >= 0 && timeDeltaMs <= closeWindowMs;
        const entryMatches = openExecPrice == null || avgEntryPrice == null || approxPriceEqual(avgEntryPrice, openExecPrice);
        return {
          record,
          timeDeltaMs,
          sideMatches,
          sizeMatches,
          timeMatches,
          entryMatches,
        };
      })
      .filter((candidate) => candidate.sideMatches && candidate.sizeMatches && candidate.timeMatches && candidate.entryMatches)
      .sort((a, b) => (a.timeDeltaMs || 0) - (b.timeDeltaMs || 0))[0]?.record || null;
    return { res: closedPnlRes, match };
  };

  let { res: closedPnlRes, match: matchedClose } = await findMatchingClose();
  if (!closedPnlRes.success) {
    return fail(`Failed to read closed PnL records: ${closedPnlRes.error?.message || 'unknown error'}`);
  }
  if (!matchedClose) {
    await sleep(800);
    ({ res: closedPnlRes, match: matchedClose } = await findMatchingClose());
    if (!closedPnlRes.success) {
      return fail(`Failed to read closed PnL records: ${closedPnlRes.error?.message || 'unknown error'}`);
    }
  }

  if (!matchedClose) {
    return {
      success: true,
      data: {
        diagnosis: 'filled_but_flat_no_matching_close_found',
        openOrder: summarizeOrder(openOrder),
        openExecution: summarizeExecution(openExecution),
      },
      error: null,
    };
  }

  const closeOrderRes = await getOrderHistory(http, {
    symbol: params.symbol,
    limit: '20',
    orderId: matchedClose.orderId,
  });
  const closeOrder = closeOrderRes.success ? (closeOrderRes.data?.list?.[0] || null) : null;

  const closeExecRes = await getExecutions(http, {
    symbol: params.symbol,
    limit: '20',
    orderId: matchedClose.orderId,
  });
  const closeExecution = closeExecRes.success ? (closeExecRes.data?.list?.[0] || null) : null;

  return {
    success: true,
    data: {
      diagnosis: 'filled_then_flat_due_to_close',
      openOrder: summarizeOrder(openOrder),
      openExecution: summarizeExecution(openExecution),
      closeOrder: summarizeOrder(closeOrder),
      closeExecution: summarizeExecution(closeExecution),
      closedPnl: summarizeClosedPnl(matchedClose),
    },
    error: null,
  };
}

async function modifyOrder(http, params) {
  if (!params.symbol) return fail('symbol is required');
  if (!params.orderId && !params.orderLinkId) return fail('orderId or orderLinkId is required');
  const advCheck = validateAdvancedTpSl(params);
  if (!advCheck.valid) return fail(advCheck.reason);

  const body = { symbol: params.symbol };
  if (params.orderId) body.orderId = params.orderId;
  if (params.orderLinkId) body.orderLinkId = params.orderLinkId;
  if (params.price != null) body.price = String(params.price);
  if (params.qty != null) body.qty = String(params.qty);
  if (params.takeProfit != null) body.takeProfit = String(params.takeProfit);
  if (params.stopLoss != null) body.stopLoss = String(params.stopLoss);
  if (params.tpTriggerBy) body.tpTriggerBy = params.tpTriggerBy;
  if (params.slTriggerBy) body.slTriggerBy = params.slTriggerBy;
  if (params.tpOrderType) body.tpOrderType = params.tpOrderType;
  if (params.tpLimitPrice != null) body.tpLimitPrice = String(params.tpLimitPrice);
  if (params.slOrderType) body.slOrderType = params.slOrderType;
  if (params.slLimitPrice != null) body.slLimitPrice = String(params.slLimitPrice);
  if (params.triggerPrice != null) body.triggerPrice = String(params.triggerPrice);
  if (params.triggerBy) body.triggerBy = params.triggerBy;

  const IDENTIFIER_KEYS = ['symbol', 'orderId', 'orderLinkId'];
  const hasMutable = Object.keys(body).some(k => !IDENTIFIER_KEYS.includes(k));
  if (!hasMutable) {
    return fail('At least one field to modify is required (price, qty, takeProfit, stopLoss, triggerPrice, tpTriggerBy, slTriggerBy, tpOrderType/tpLimitPrice, slOrderType/slLimitPrice, triggerBy)');
  }

  return wrapResponse(await http.post(PATHS.ordersReplace, body));
}

async function cancelOrder(http, { symbol, orderId, orderLinkId }) {
  if (!orderId && !orderLinkId) return fail('orderId or orderLinkId is required');
  const body = { symbol };
  if (orderId) body.orderId = orderId;
  if (orderLinkId) body.orderLinkId = orderLinkId;
  return wrapResponse(await http.post(PATHS.ordersCancel, body));
}

async function cancelAllOrders(http, { symbol, settleCoin, confirmBatch }) {
  if (!symbol && !settleCoin) return fail('symbol or settleCoin is required');
  const batch = toBool(confirmBatch);
  if (settleCoin && !symbol && batch !== true) {
    return fail('Coin-level batch cancel requires confirmBatch=true. This will cancel ALL orders under ' + settleCoin);
  }
  const body = {};
  if (symbol) { body.symbol = symbol; } else if (settleCoin) { body.settleCoin = settleCoin; }
  return wrapResponse(await http.post(PATHS.cancelAll, body));
}

async function getOpenOrders(http, { symbol, settleCoin, baseCoin, orderId, orderLinkId, orderFilter, limit, cursor } = {}) {
  if (!symbol && !settleCoin && !baseCoin) {
    return fail('symbol, settleCoin, or baseCoin is required');
  }
  const params = {};
  if (symbol) params.symbol = symbol;
  if (settleCoin) params.settleCoin = settleCoin;
  if (baseCoin) params.baseCoin = baseCoin;
  if (orderId) params.orderId = orderId;
  if (orderLinkId) params.orderLinkId = orderLinkId;
  if (orderFilter) params.orderFilter = orderFilter;
  if (limit != null) params.limit = String(limit);
  if (cursor) params.cursor = cursor;
  return wrapResponse(await http.get(PATHS.openOrders, params));
}

async function getOrderHistory(http, { symbol, limit = '20', orderId, orderLinkId, orderStatus, orderFilter, cursor, baseCoin } = {}) {
  if (!symbol) return fail('symbol is required');
  const params = { symbol, limit: String(limit) };
  if (orderId) params.orderId = orderId;
  if (orderLinkId) params.orderLinkId = orderLinkId;
  if (orderStatus) params.orderStatus = orderStatus;
  if (orderFilter) params.orderFilter = orderFilter;
  if (cursor) params.cursor = cursor;
  if (baseCoin) params.baseCoin = baseCoin;
  return wrapResponse(await http.get(PATHS.orders, params));
}

async function getExecutions(http, { symbol, limit = '20', orderId, execType, startTime, endTime, cursor, baseCoin, orderLinkId, orderFilter } = {}) {
  if (!symbol) return fail('symbol is required');
  const params = { symbol, limit: String(limit) };
  if (orderId) params.orderId = orderId;
  if (execType) params.execType = execType;
  if (startTime != null) params.startTime = String(startTime);
  if (endTime != null) params.endTime = String(endTime);
  if (cursor) params.cursor = cursor;
  if (baseCoin) params.baseCoin = baseCoin;
  if (orderLinkId) params.orderLinkId = orderLinkId;
  if (orderFilter) params.orderFilter = orderFilter;
  return wrapResponse(await http.get(PATHS.executions, params));
}

async function getClosedPnl(http, { symbol, limit = '20', startTime, endTime, cursor } = {}) {
  if (!symbol) return fail('symbol is required');
  const params = { symbol, limit: String(limit) };
  if (startTime != null) params.startTime = String(startTime);
  if (endTime != null) params.endTime = String(endTime);
  if (cursor) params.cursor = cursor;
  return wrapResponse(await http.get(PATHS.closedPnl, params));
}

async function setLeverage(http, params) {
  const actualSell = params.sellLeverage || params.buyLeverage;
  const checkBuy = await validateLeverage(http, params.symbol, params.buyLeverage);
  if (!checkBuy.valid) return fail(checkBuy.reason);
  const checkSell = await validateLeverage(http, params.symbol, actualSell);
  if (!checkSell.valid) return fail(checkSell.reason);

  const body = { symbol: params.symbol, buyLeverage: String(params.buyLeverage), sellLeverage: String(actualSell) };
  if (params.positionIdx != null) body.positionIdx = Number(params.positionIdx);
  if (params.pzLinkId) body.pzLinkId = params.pzLinkId;
  return wrapResponse(await http.post(PATHS.leverage, body));
}

async function createTpSl(http, params) {
  if (params.positionIdx == null) return fail('positionIdx is required');
  if (!params.tpSlMode) return fail('tpSlMode is required (Full or Partial)');

  const isMoving = toBool(params.isMovingTpSl);
  if (isMoving === true) {
    if (params.tpSlMode !== 'Full') {
      return fail('Moving TP/SL (isMovingTpSl=true) only supports tpSlMode=Full');
    }
    if (params.movingTriggerBy != null && params.movingTriggerBy !== '' &&
        params.movingTriggerBy !== 'LastPrice' && params.movingTriggerBy !== 'MarkPrice') {
      return fail('movingTriggerBy must be LastPrice or MarkPrice (omit to accept the gateway default LastPrice)');
    }
    if (params.retracePercentage == null || params.retracePercentage === '') {
      return fail('retracePercentage is required when isMovingTpSl=true. Use decimal form, e.g. "0.005" = 0.5% retrace.');
    }
    const retrace = parseFloat(params.retracePercentage);
    if (!Number.isFinite(retrace) || retrace < 0.001 || retrace >= 1) {
      return fail('retracePercentage must be in decimal form within [0.001, 1.0), i.e. 0.1% to just under 100%. Example: "0.005" = 0.5%.');
    }
  }

  const advCheck = validateAdvancedTpSl(params);
  if (!advCheck.valid) return fail(advCheck.reason);

  const body = { symbol: params.symbol, positionIdx: Number(params.positionIdx), tpSlMode: params.tpSlMode };
  if (params.pzLinkId) body.pzLinkId = params.pzLinkId;
  if (params.takeProfit != null) body.takeProfit = String(params.takeProfit);
  if (params.stopLoss != null) body.stopLoss = String(params.stopLoss);
  if (params.tpTriggerBy) body.tpTriggerBy = params.tpTriggerBy;
  if (params.slTriggerBy) body.slTriggerBy = params.slTriggerBy;
  if (params.tpOrderType) body.tpOrderType = params.tpOrderType;
  if (params.tpLimitPrice != null) body.tpLimitPrice = String(params.tpLimitPrice);
  if (params.slOrderType) body.slOrderType = params.slOrderType;
  if (params.slLimitPrice != null) body.slLimitPrice = String(params.slLimitPrice);
  if (params.tpSize != null) body.tpSize = String(params.tpSize);
  if (params.slSize != null) body.slSize = String(params.slSize);

  if (isMoving != null) body.isMovingTpSl = isMoving;
  if (params.movingTriggerBy) body.movingTriggerBy = params.movingTriggerBy;
  if (params.movingActivationPrice != null) body.movingActivationPrice = String(params.movingActivationPrice);
  if (params.retracePercentage != null) body.retracePercentage = String(params.retracePercentage);
  if (params.retraceDelta != null) body.retraceDelta = String(params.retraceDelta);
  if (params.movingTpSlSize != null) body.movingTpSlSize = String(params.movingTpSlSize);

  return wrapResponse(await http.post(PATHS.createTpSl, body));
}

async function replaceTpSl(http, params) {
  if (!params.symbol) return fail('symbol is required');
  if (!params.orderId) return fail('orderId is required (TP/SL sub-order ID)');
  const advCheck = validateAdvancedTpSl(params);
  if (!advCheck.valid) return fail(advCheck.reason);

  const body = { symbol: params.symbol, orderId: params.orderId };
  if (params.takeProfit != null) body.takeProfit = String(params.takeProfit);
  if (params.stopLoss != null) body.stopLoss = String(params.stopLoss);
  if (params.tpTriggerBy) body.tpTriggerBy = params.tpTriggerBy;
  if (params.slTriggerBy) body.slTriggerBy = params.slTriggerBy;
  if (params.tpSize != null) body.tpSize = String(params.tpSize);
  if (params.slSize != null) body.slSize = String(params.slSize);
  if (params.tpOrderType) body.tpOrderType = params.tpOrderType;
  if (params.tpLimitPrice != null) body.tpLimitPrice = String(params.tpLimitPrice);
  if (params.slOrderType) body.slOrderType = params.slOrderType;
  if (params.slLimitPrice != null) body.slLimitPrice = String(params.slLimitPrice);

  if (params.movingTriggerBy) body.movingTriggerBy = params.movingTriggerBy;
  if (params.movingActivationPrice != null) body.movingActivationPrice = String(params.movingActivationPrice);
  if (params.retracePercentage != null) body.retracePercentage = String(params.retracePercentage);
  if (params.retraceDelta != null) body.retraceDelta = String(params.retraceDelta);
  if (params.movingTpSlSize != null) body.movingTpSlSize = String(params.movingTpSlSize);

  return wrapResponse(await http.post(PATHS.replaceTpSl, body));
}

async function switchSeparatePosition(http, { coin, isSeparatePz }) {
  if (!coin) return fail('coin is required (e.g. USDT, FreeU)');
  const normalized = toBool(isSeparatePz);
  if (normalized == null) return fail('isSeparatePz is required (true=Separate, false=Merged)');
  return wrapResponse(await http.post(PATHS.switchSeparate, { coin, isSeparatePz: normalized }));
}

async function switchMarginMode(http, { symbol, tradeMode, buyLeverage, sellLeverage }) {
  if (!symbol) return fail('symbol is required');
  if (tradeMode == null) return fail('tradeMode is required (0=Cross, 1=Isolated)');
  if (!buyLeverage || !sellLeverage) return fail('buyLeverage and sellLeverage are required');
  const checkBuy = await validateLeverage(http, symbol, buyLeverage);
  if (!checkBuy.valid) return fail(checkBuy.reason);
  const checkSell = await validateLeverage(http, symbol, sellLeverage);
  if (!checkSell.valid) return fail(checkSell.reason);
  return wrapResponse(await http.post(PATHS.marginMode, {
    symbol, tradeMode: Number(tradeMode),
    buyLeverage: String(buyLeverage), sellLeverage: String(sellLeverage),
  }));
}

async function addMargin(http, { symbol, positionIdx, margin, pzLinkId }) {
  if (!symbol) return fail('symbol is required');
  if (positionIdx == null) return fail('positionIdx is required (1=Long, 2=Short)');
  if (![1, 2].includes(Number(positionIdx))) return fail('positionIdx must be 1 (Long) or 2 (Short)');
  if (margin == null || margin === '') return fail('margin is required');
  const marginNum = parseFloat(margin);
  if (!Number.isFinite(marginNum)) return fail('margin must be a valid number');
  if (marginNum === 0) return fail('margin must not be zero (positive to add, negative to reduce)');
  const body = { symbol, positionIdx: Number(positionIdx), margin: String(margin) };
  if (pzLinkId) body.pzLinkId = pzLinkId;
  return wrapResponse(await http.post(PATHS.addMargin, body));
}

async function closePosition(http, params) {
  if (!params.symbol && !params.settleCoin) return fail('symbol or settleCoin is required');
  const batch = toBool(params.confirmBatch);
  if (params.settleCoin && !params.symbol && batch !== true) {
    return fail('Coin-level batch close requires confirmBatch=true. This will close ALL positions under ' + params.settleCoin);
  }
  const body = {};
  if (params.symbol) { body.symbol = params.symbol; } else if (params.settleCoin) { body.settleCoin = params.settleCoin; }
  if (params.positionIdx != null) body.positionIdx = Number(params.positionIdx);
  if (params.pzLinkId) body.pzLinkId = params.pzLinkId;
  return wrapResponse(await http.post(PATHS.closeAll, body));
}

module.exports = {
  createOrder, modifyOrder, cancelOrder, cancelAllOrders,
  getOpenOrders, getOrderHistory, getExecutions, getClosedPnl,
  setLeverage, createTpSl, replaceTpSl,
  addToPosition,
  diagnoseFilledButFlat,
  switchSeparatePosition, switchMarginMode, addMargin, closePosition,
  toBool, // exported for unit testing
};
