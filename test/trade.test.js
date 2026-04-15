'use strict';

const trade = require('../tools/perp');
const market = require('../tools/market');
const account = require('../tools/perp-query');
const { clearCache } = require('../lib/validate');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Trade tests\n');

// toBool normalization (MCP clients may serialize boolean as string)
const { toBool } = trade;
assert('toBool(true) → true', toBool(true) === true);
assert('toBool(false) → false', toBool(false) === false);
assert('toBool("true") → true', toBool('true') === true);
assert('toBool("false") → false', toBool('false') === false);
assert('toBool("True") → true (case insensitive)', toBool('True') === true);
assert('toBool("FALSE") → false (case insensitive)', toBool('FALSE') === false);
assert('toBool(null) → null', toBool(null) === null);
assert('toBool(undefined) → null', toBool(undefined) === null);
assert('toBool("yes") → null (invalid string)', toBool('yes') === null);
assert('toBool(1) → null (number not accepted)', toBool(1) === null);

// Mock http client for handler-level tests
function makeMockHttp(captureBody) {
  return {
    async post(path, body) { captureBody.path = path; captureBody.body = body; return { code: 0, data: {} }; },
    async get() { return { code: 0, data: {} }; },
  };
}

(async () => {
  // switchSeparatePosition accepts string "false"
  const cap1 = {};
  const res1 = await trade.switchSeparatePosition(makeMockHttp(cap1), { coin: 'USDT', isSeparatePz: 'false' });
  assert('switchSeparatePosition("false") → success', res1.success);
  assert('switchSeparatePosition("false") → body.isSeparatePz === false', cap1.body?.isSeparatePz === false);

  // switchSeparatePosition accepts string "true"
  const cap2 = {};
  const res2 = await trade.switchSeparatePosition(makeMockHttp(cap2), { coin: 'USDT', isSeparatePz: 'true' });
  assert('switchSeparatePosition("true") → success', res2.success);
  assert('switchSeparatePosition("true") → body.isSeparatePz === true', cap2.body?.isSeparatePz === true);

  // switchSeparatePosition rejects invalid string
  const res3 = await trade.switchSeparatePosition(makeMockHttp({}), { coin: 'USDT', isSeparatePz: 'maybe' });
  assert('switchSeparatePosition("maybe") → rejected', !res3.success);

  // cancelAllOrders confirmBatch="true" works (string form)
  const cap4 = {};
  const res4 = await trade.cancelAllOrders(makeMockHttp(cap4), { settleCoin: 'USDT', confirmBatch: 'true' });
  assert('cancelAllOrders confirmBatch="true" → success', res4.success);

  // cancelAllOrders confirmBatch="false" should be blocked (same as missing)
  const res5 = await trade.cancelAllOrders(makeMockHttp({}), { settleCoin: 'USDT', confirmBatch: 'false' });
  assert('cancelAllOrders confirmBatch="false" → blocked', !res5.success);

  // closePosition confirmBatch="true" works
  const cap6 = {};
  const res6 = await trade.closePosition(makeMockHttp(cap6), { settleCoin: 'USDT', positionIdx: 1, confirmBatch: 'true' });
  assert('closePosition confirmBatch="true" → success', res6.success);

  // closePosition confirmBatch="false" blocked
  const res7 = await trade.closePosition(makeMockHttp({}), { settleCoin: 'USDT', positionIdx: 1, confirmBatch: 'false' });
  assert('closePosition confirmBatch="false" → blocked', !res7.success);

  // Conditional order validation tests
  // Mock http that returns valid instruments + tickers for createOrder prerequisites
  clearCache();
  function makeCreateOrderHttp(captureBody) {
    return {
      async get(path) {
        if (path.includes('instruments')) {
          return {
            code: 0,
            data: {
              list: [{
                symbol: 'BTCUSDT',
                lotSizeFilter: { minTradingQty: '0.001', maxTradingQty: '100', qtyStep: '0.001' },
                priceFilter: { minPrice: '1', maxPrice: '10000000' },
                leverageFilter: { minLeverage: '1', maxLeverage: '125' },
              }],
            },
          };
        }
        if (path.includes('tickers')) {
          return { code: 0, data: { list: [{ symbol: 'BTCUSDT', markPrice: '70000', lastPrice: '70000' }] } };
        }
        return { code: 0, data: {} };
      },
      async post(path, body) { captureBody.path = path; captureBody.body = body; return { code: 0, data: { orderId: 'mock' } }; },
    };
  }

  // triggerPrice without triggerDirection → reject
  clearCache();
  const noPositionIdx = await trade.createOrder(makeCreateOrderHttp({}), {
    symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001',
  });
  assert('createOrder missing positionIdx → rejected', !noPositionIdx.success);
  assert('createOrder missing positionIdx → error mentions required',
    String(noPositionIdx.error?.message || '').includes('positionIdx is required'));

  clearCache();
  const invalidPositionIdx = await trade.createOrder(makeCreateOrderHttp({}), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 3, orderType: 'Market', qty: '0.001',
  });
  assert('createOrder positionIdx=3 → rejected', !invalidPositionIdx.success);
  assert('createOrder positionIdx=3 → error mentions 1 or 2',
    String(invalidPositionIdx.error?.message || '').includes('positionIdx must be 1'));

  // triggerPrice without triggerDirection → reject
  const condRes1 = await trade.createOrder(makeCreateOrderHttp({}), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
    triggerPrice: '72000',
  });
  assert('createOrder triggerPrice without triggerDirection → rejected', !condRes1.success);

  // triggerDirection invalid value → reject
  clearCache();
  const condRes2 = await trade.createOrder(makeCreateOrderHttp({}), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
    triggerPrice: '72000', triggerDirection: 3,
  });
  assert('createOrder triggerDirection=3 → rejected', !condRes2.success);

  // Valid conditional order → success + body contains trigger fields
  clearCache();
  const condCap3 = {};
  const condRes3 = await trade.createOrder(makeCreateOrderHttp(condCap3), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
    triggerPrice: '72000', triggerDirection: 1, triggerBy: 'LastPrice',
  });
  assert('createOrder conditional order → success', condRes3.success);
  assert('createOrder body.triggerPrice === "72000"', condCap3.body?.triggerPrice === '72000');
  assert('createOrder body.triggerDirection === 1', condCap3.body?.triggerDirection === 1);
  assert('createOrder body.triggerBy === "LastPrice"', condCap3.body?.triggerBy === 'LastPrice');

  // closeOnTrigger string "true" normalized to boolean
  clearCache();
  const condCap4 = {};
  const condRes4 = await trade.createOrder(makeCreateOrderHttp(condCap4), {
    symbol: 'BTCUSDT', side: 'Sell', positionIdx: 1, orderType: 'Market', qty: '0.001',
    triggerPrice: '65000', triggerDirection: 2, closeOnTrigger: 'true',
  });
  assert('createOrder closeOnTrigger="true" → success', condRes4.success);
  assert('createOrder body.closeOnTrigger === true', condCap4.body?.closeOnTrigger === true);

  // ---------- perpAddToPosition: safe add-on for merged/separate positions ----------
  function makeAddToPositionHttp(capture, states) {
    let positionReads = 0;
    return {
      async get(path) {
        if (path.includes('instruments')) {
          return {
            code: 0,
            data: {
              list: [{
                symbol: 'BTCUSDT',
                lotSizeFilter: { minTradingQty: '0.001', maxTradingQty: '100', qtyStep: '0.001' },
                priceFilter: { minPrice: '1', maxPrice: '10000000' },
                leverageFilter: { minLeverage: '1', maxLeverage: '125' },
              }],
            },
          };
        }
        if (path.includes('tickers')) {
          return { code: 0, data: { list: [{ symbol: 'BTCUSDT', markPrice: '70000', lastPrice: '70000' }] } };
        }
        if (path.includes('/positions')) {
          const current = states[Math.min(positionReads, states.length - 1)];
          positionReads++;
          return { code: 0, data: current };
        }
        return { code: 0, data: {} };
      },
      async post(path, body) {
        capture.path = path;
        capture.body = body;
        return { code: 0, data: { orderId: 'oid-add', orderLinkId: 'link-add' } };
      },
    };
  }

  clearCache();
  const addCap1 = {};
  const addSingleSeparate = await trade.addToPosition(makeAddToPositionHttp(addCap1, [
    {
      list: [],
      separateList: [{
        symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10',
        tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-1',
      }],
    },
    {
      list: [],
      separateList: [{
        symbol: 'BTCUSDT', positionIdx: 1, size: '0.080', entryPrice: '74187.825', leverage: '10',
        tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-1',
      }],
    },
  ]), {
    symbol: 'BTCUSDT', positionIdx: 1, qty: '0.05',
  });
  assert('perpAddToPosition single separate position → success', addSingleSeparate.success, JSON.stringify(addSingleSeparate));
  assert('perpAddToPosition single separate position → reuse pzLinkId',
    addCap1.body?.pzLinkId === 'pz-1', JSON.stringify(addCap1.body));
  assert('perpAddToPosition single separate position → uses Buy for long',
    addCap1.body?.side === 'Buy' && addCap1.body?.positionIdx === 1, JSON.stringify(addCap1.body));
  assert('perpAddToPosition single separate position → verified final size',
    addSingleSeparate.data?.afterSize === '0.080', JSON.stringify(addSingleSeparate.data));

  clearCache();
  const addCapMerged = {};
  const addMerged = await trade.addToPosition(makeAddToPositionHttp(addCapMerged, [
    {
      list: [{
        symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10',
        tradeMode: 0, isSeparatePz: false,
      }],
      separateList: [],
    },
    {
      list: [{
        symbol: 'BTCUSDT', positionIdx: 1, size: '0.080', entryPrice: '74187.825', leverage: '10',
        tradeMode: 0, isSeparatePz: false,
      }],
      separateList: [],
    },
  ]), {
    symbol: 'BTCUSDT', positionIdx: 1, qty: '0.05',
  });
  assert('perpAddToPosition merged position → success', addMerged.success, JSON.stringify(addMerged));
  assert('perpAddToPosition merged position → does not send pzLinkId',
    addCapMerged.body?.pzLinkId === undefined, JSON.stringify(addCapMerged.body));
  assert('perpAddToPosition merged position → targetPzLinkId is null',
    addMerged.data?.targetPzLinkId === null, JSON.stringify(addMerged.data));

  clearCache();
  const addMultiNoPz = await trade.addToPosition({
    async get(path) {
      if (path.includes('/positions')) {
        return {
          code: 0,
          data: {
            list: [],
            separateList: [
              { symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10', tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-a' },
              { symbol: 'BTCUSDT', positionIdx: 1, size: '0.050', entryPrice: '74204.3', leverage: '10', tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-b' },
            ],
          },
        };
      }
      return { code: 0, data: {} };
    },
    async post() { return { code: 0, data: {} }; },
  }, {
    symbol: 'BTCUSDT', positionIdx: 1, qty: '0.05',
  });
  assert('perpAddToPosition multiple separate positions without pzLinkId → reject', !addMultiNoPz.success);
  assert('perpAddToPosition multiple separate positions without pzLinkId → error mentions specify',
    String(addMultiNoPz.error?.message || '').includes('specify pzLinkId'),
    JSON.stringify(addMultiNoPz));

  clearCache();
  const addBadPz = await trade.addToPosition({
    async get(path) {
      if (path.includes('/positions')) {
        return {
          code: 0,
          data: {
            list: [],
            separateList: [
              { symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10', tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-a' },
            ],
          },
        };
      }
      return { code: 0, data: {} };
    },
    async post() { return { code: 0, data: {} }; },
  }, {
    symbol: 'BTCUSDT', positionIdx: 1, qty: '0.01', pzLinkId: 'pz-missing',
  });
  assert('perpAddToPosition bad pzLinkId → reject', !addBadPz.success);
  assert('perpAddToPosition bad pzLinkId → error mentions not found',
    String(addBadPz.error?.message || '').includes('was not found'),
    JSON.stringify(addBadPz));

  clearCache();
  const addCapMismatch = {};
  const addMismatch = await trade.addToPosition(makeAddToPositionHttp(addCapMismatch, [
    {
      list: [],
      separateList: [{
        symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10',
        tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-1',
      }],
    },
    {
      list: [],
      separateList: [
        {
          symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10',
          tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-1',
        },
        {
          symbol: 'BTCUSDT', positionIdx: 1, size: '0.050', entryPrice: '74204.3', leverage: '10',
          tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-2',
        },
      ],
    },
    {
      list: [],
      separateList: [
        {
          symbol: 'BTCUSDT', positionIdx: 1, size: '0.030', entryPrice: '74166.2', leverage: '10',
          tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-1',
        },
        {
          symbol: 'BTCUSDT', positionIdx: 1, size: '0.050', entryPrice: '74204.3', leverage: '10',
          tradeMode: 1, isSeparatePz: true, pzLinkId: 'pz-2',
        },
      ],
    },
  ]), {
    symbol: 'BTCUSDT', positionIdx: 1, qty: '0.05',
  });
  assert('perpAddToPosition verification detects accidental new separate position', !addMismatch.success);
  assert('perpAddToPosition verification mismatch → keeps submitted order identifiers in data',
    addMismatch.data?.orderId === 'oid-add' && addMismatch.data?.targetPzLinkId === 'pz-1',
    JSON.stringify(addMismatch));

  function makeDiagnosisHttp(fixtures) {
    return {
      async get(path, params) {
        if (path.includes('/closed-pnl')) {
          return { code: 0, data: { list: fixtures.closedPnl || [] } };
        }
        if (path.includes('/executions')) {
          if (params?.orderId && fixtures.executionsByOrderId?.[params.orderId]) {
            return { code: 0, data: { list: fixtures.executionsByOrderId[params.orderId] } };
          }
          return { code: 0, data: { list: [] } };
        }
        if (path.endsWith('/orders')) {
          if (params?.orderId && fixtures.ordersById?.[params.orderId]) {
            return { code: 0, data: { list: [fixtures.ordersById[params.orderId]] } };
          }
          if (params?.orderLinkId && fixtures.orderByLinkId?.[params.orderLinkId]) {
            return { code: 0, data: { list: [fixtures.orderByLinkId[params.orderLinkId]] } };
          }
          return { code: 0, data: { list: [] } };
        }
        if (path.includes('/positions')) {
          return { code: 0, data: fixtures.positions || { list: [], separateList: [] } };
        }
        return { code: 0, data: {} };
      },
      async post() { return { code: 0, data: {} }; },
    };
  }

  const filledOpenOrder = {
    orderId: 'open-1',
    orderLinkId: 'link-open-1',
    symbol: 'ETHUSDT',
    side: 'Buy',
    qty: '1.30',
    orderType: 'Market',
    orderStatus: 'Filled',
    reduceOnly: false,
    positionIdx: 0,
    cumExecQty: '1.30',
  };
  const filledOpenExecution = [{
    orderId: 'open-1',
    orderLinkId: 'link-open-1',
    side: 'Buy',
    execQty: '1.30',
    execPrice: '2323.75',
    execTime: '2026-04-15 11:40:59+08:00',
    closedSize: '0.00',
  }];

  const diagStillOpen = await trade.diagnoseFilledButFlat(makeDiagnosisHttp({
    ordersById: { 'open-1': filledOpenOrder },
    executionsByOrderId: { 'open-1': filledOpenExecution },
    positions: {
      list: [{
        symbol: 'ETHUSDT', positionIdx: 1, size: '1.30', isSeparatePz: false,
      }],
      separateList: [],
    },
    closedPnl: [],
  }), {
    symbol: 'ETHUSDT',
    orderId: 'open-1',
    positionIdx: 1,
  });
  assert('diagnoseFilledButFlat: open position stays open', diagStillOpen.success && diagStillOpen.data?.diagnosis === 'position_still_open', JSON.stringify(diagStillOpen));

  const diagClosed = await trade.diagnoseFilledButFlat(makeDiagnosisHttp({
    ordersById: {
      'open-1': filledOpenOrder,
      'close-1': {
        orderId: 'close-1',
        symbol: 'M1ETHUSDT',
        side: 'Sell',
        qty: '1.30',
        orderType: 'Market',
        orderStatus: 'Filled',
        reduceOnly: true,
        positionIdx: 0,
      },
    },
    executionsByOrderId: {
      'open-1': filledOpenExecution,
      'close-1': [{
        orderId: 'close-1',
        side: 'Sell',
        execQty: '1.30',
        execPrice: '2322.83',
        execTime: '2026-04-15 11:41:05+08:00',
        closedSize: '1.30',
      }],
    },
    positions: { list: [], separateList: [] },
    closedPnl: [{
      symbol: 'ETHUSDT',
      orderId: 'close-1',
      side: 'Sell',
      qty: '1.30',
      closedSize: '1.30',
      avgEntryPrice: '2323.25',
      avgExitPrice: '2322.83',
      closedPnl: '-4.216277',
      createdAt: '2026-04-15 11:41:04+08:00',
    }],
  }), {
    symbol: 'ETHUSDT',
    orderId: 'open-1',
    positionIdx: 1,
  });
  assert('diagnoseFilledButFlat: matched immediate close', diagClosed.success && diagClosed.data?.diagnosis === 'filled_then_flat_due_to_close', JSON.stringify(diagClosed));
  assert('diagnoseFilledButFlat: matched close keeps reduceOnly evidence', diagClosed.data?.closeOrder?.reduceOnly === true, JSON.stringify(diagClosed.data));

  const diagNoMatch = await trade.diagnoseFilledButFlat(makeDiagnosisHttp({
    ordersById: { 'open-1': filledOpenOrder },
    executionsByOrderId: { 'open-1': filledOpenExecution },
    positions: { list: [], separateList: [] },
    closedPnl: [],
  }), {
    symbol: 'ETHUSDT',
    orderId: 'open-1',
    positionIdx: 1,
  });
  assert('diagnoseFilledButFlat: flat without matching close stays inconclusive',
    diagNoMatch.success && diagNoMatch.data?.diagnosis === 'filled_but_flat_no_matching_close_found',
    JSON.stringify(diagNoMatch));

  // addMargin validation
  const addMarginCap = {};
  const addMarginHttp = {
    async get() { return { code: 0, data: {} }; },
    async post(path, body) { addMarginCap.path = path; addMarginCap.body = body; return { code: 0, data: {} }; },
  };

  // Missing required fields
  assert('addMargin missing symbol → reject',
    !(await trade.addMargin(addMarginHttp, { positionIdx: 1, margin: '10' })).success);
  assert('addMargin missing positionIdx → reject',
    !(await trade.addMargin(addMarginHttp, { symbol: 'BTCUSDT', margin: '10' })).success);
  assert('addMargin missing margin → reject',
    !(await trade.addMargin(addMarginHttp, { symbol: 'BTCUSDT', positionIdx: 1 })).success);

  // Invalid positionIdx
  assert('addMargin positionIdx=3 → reject',
    !(await trade.addMargin(addMarginHttp, { symbol: 'BTCUSDT', positionIdx: 3, margin: '10' })).success);

  // Invalid margin
  assert('addMargin margin=0 → reject (backend rejects too)',
    !(await trade.addMargin(addMarginHttp, { symbol: 'BTCUSDT', positionIdx: 1, margin: '0' })).success);
  assert('addMargin margin="abc" → reject (not a number)',
    !(await trade.addMargin(addMarginHttp, { symbol: 'BTCUSDT', positionIdx: 1, margin: 'abc' })).success);

  // Valid positive (add margin): body construction
  const addMarginOk = await trade.addMargin(addMarginHttp, { symbol: 'BTCUSDT', positionIdx: 1, margin: '10' });
  assert('addMargin positive (+10) → success', addMarginOk.success);
  assert('addMargin body.symbol === "BTCUSDT"', addMarginCap.body?.symbol === 'BTCUSDT');
  assert('addMargin body.positionIdx === 1', addMarginCap.body?.positionIdx === 1);
  assert('addMargin body.margin === "10"', addMarginCap.body?.margin === '10');

  // Valid negative (reduce margin): runtime supports it via signed AddToPositionBalanceE8;
  // tradecore has integration test TestTradecoreReduceMarginJourneys exercising the same route.
  const addMarginCapNeg = {};
  const addMarginHttpNeg = {
    async get() { return { code: 0, data: {} }; },
    async post(path, body) { addMarginCapNeg.path = path; addMarginCapNeg.body = body; return { code: 0, data: {} }; },
  };
  const addMarginNeg = await trade.addMargin(addMarginHttpNeg, { symbol: 'BTCUSDT', positionIdx: 1, margin: '-5' });
  assert('addMargin negative (-5) → success', addMarginNeg.success);
  assert('addMargin body.margin === "-5"', addMarginCapNeg.body?.margin === '-5');

  // With pzLinkId
  const addMarginCap2 = {};
  const addMarginHttp2 = {
    async get() { return { code: 0, data: {} }; },
    async post(path, body) { addMarginCap2.path = path; addMarginCap2.body = body; return { code: 0, data: {} }; },
  };
  await trade.addMargin(addMarginHttp2, { symbol: 'BTCUSDT', positionIdx: 1, margin: '10', pzLinkId: 'pz-abc' });
  assert('addMargin body.pzLinkId === "pz-abc"', addMarginCap2.body?.pzLinkId === 'pz-abc');

  // ---------- modifyOrder: "at least one modifiable field" validation ----------
  const modHttp = {
    async get() { return { code: 0, data: {} }; },
    async post() { return { code: 0, data: {} }; },
  };
  assert('modifyOrder missing symbol → reject',
    !(await trade.modifyOrder(modHttp, { orderId: 'oid-1', price: '100' })).success);
  assert('modifyOrder missing orderId/orderLinkId → reject',
    !(await trade.modifyOrder(modHttp, { symbol: 'BTCUSDT', price: '100' })).success);
  const modNoField = await trade.modifyOrder(modHttp, { symbol: 'BTCUSDT', orderId: 'oid-1' });
  assert('modifyOrder no modifiable field → reject', !modNoField.success);
  assert('modifyOrder no modifiable field → error mentions "At least one"',
    String(modNoField.error?.message || '').includes('At least one'));
  assert('modifyOrder with price → success',
    (await trade.modifyOrder(modHttp, { symbol: 'BTCUSDT', orderId: 'oid-1', price: '100' })).success);
  assert('modifyOrder with takeProfit only → success',
    (await trade.modifyOrder(modHttp, { symbol: 'BTCUSDT', orderLinkId: 'link-1', takeProfit: '120' })).success);

  // ---------- getOpenOrders: three-way (symbol/settleCoin/baseCoin) ----------
  const openHttp = (cap) => ({
    async get(path, params) { cap.path = path; cap.params = params; return { code: 0, data: { list: [] } }; },
    async post() { return { code: 0, data: {} }; },
  });
  const openNone = await trade.getOpenOrders(openHttp({}), {});
  assert('getOpenOrders empty → reject', !openNone.success);
  assert('getOpenOrders empty → error mentions baseCoin',
    String(openNone.error?.message || '').includes('baseCoin'));

  const openCapB = {};
  const openBase = await trade.getOpenOrders(openHttp(openCapB), { baseCoin: 'BTC' });
  assert('getOpenOrders baseCoin → success', openBase.success);
  assert('getOpenOrders baseCoin → params.baseCoin === "BTC"', openCapB.params?.baseCoin === 'BTC');

  const openCapS = {};
  const openSym = await trade.getOpenOrders(openHttp(openCapS), { symbol: 'BTCUSDT', orderFilter: 'StopOrder' });
  assert('getOpenOrders symbol+filter → success', openSym.success);
  assert('getOpenOrders symbol+filter → params correct',
    openCapS.params?.symbol === 'BTCUSDT' && openCapS.params?.orderFilter === 'StopOrder');

  const openCapAll = {};
  await trade.getOpenOrders(openHttp(openCapAll), {
    symbol: 'BTCUSDT', orderId: 'oid', orderLinkId: 'link', limit: 50, cursor: 'cur-1',
  });
  assert('getOpenOrders optional passthrough → orderId',
    openCapAll.params?.orderId === 'oid');
  assert('getOpenOrders optional passthrough → orderLinkId',
    openCapAll.params?.orderLinkId === 'link');
  assert('getOpenOrders optional passthrough → limit stringified',
    openCapAll.params?.limit === '50');
  assert('getOpenOrders optional passthrough → cursor',
    openCapAll.params?.cursor === 'cur-1');

  // ---------- Moving TP/SL (trailing stop) validation + body construction ----------
  const tpslHttp = (cap) => ({
    async get() { return { code: 0, data: {} }; },
    async post(path, body) { cap.path = path; cap.body = body; return { code: 0, data: {} }; },
  });

  // createTpSl: isMovingTpSl=true with Partial mode → reject
  const mvPartial = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Partial',
    isMovingTpSl: true, movingActivationPrice: '72000', retracePercentage: '0.5',
  });
  assert('createTpSl moving + Partial → reject', !mvPartial.success);
  assert('createTpSl moving + Partial → error mentions Full',
    String(mvPartial.error?.message || '').includes('Full'));

  // createTpSl: isMovingTpSl=true without movingTriggerBy → ALLOWED (gateway defaults to LastPrice)
  const mvNoTriggerCap = {};
  const mvNoTrigger = await trade.createTpSl(tpslHttp(mvNoTriggerCap), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingActivationPrice: '76000', retracePercentage: '0.005',
  });
  assert('createTpSl moving without movingTriggerBy → success (gateway default)', mvNoTrigger.success);
  assert('createTpSl moving without movingTriggerBy → body has NO movingTriggerBy field',
    !('movingTriggerBy' in (mvNoTriggerCap.body || {})));

  // createTpSl: isMovingTpSl=true with invalid movingTriggerBy → reject
  const mvBadTrigger = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'IndexPrice',
    movingActivationPrice: '76000', retracePercentage: '0.005',
  });
  assert('createTpSl moving with IndexPrice trigger → reject', !mvBadTrigger.success);
  assert('createTpSl moving with IndexPrice trigger → error mentions LastPrice/MarkPrice',
    String(mvBadTrigger.error?.message || '').includes('LastPrice'));

  // createTpSl: isMovingTpSl=true without movingActivationPrice → ALLOWED (core activates immediately at current price)
  const mvNoActivationCap = {};
  const mvNoActivation = await trade.createTpSl(tpslHttp(mvNoActivationCap), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice', retracePercentage: '0.005',
  });
  assert('createTpSl moving without activation → success (activates immediately)', mvNoActivation.success);
  assert('createTpSl moving without activation → body has NO movingActivationPrice field',
    !('movingActivationPrice' in (mvNoActivationCap.body || {})));

  // createTpSl: isMovingTpSl=true without retracePercentage → reject
  const mvNoRetrace = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice', movingActivationPrice: '76000',
  });
  assert('createTpSl moving without retracePercentage → reject', !mvNoRetrace.success);
  assert('createTpSl moving without retracePercentage → error mentions decimal',
    String(mvNoRetrace.error?.message || '').includes('decimal'));

  // createTpSl: retracePercentage range checks (backend: E4 in [10, 10000) → decimal [0.001, 1.0))
  const mvRetraceTooSmall = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000', retracePercentage: '0.0005',
  });
  assert('createTpSl moving retracePercentage=0.0005 → reject', !mvRetraceTooSmall.success);

  const mvRetraceTooBig = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000', retracePercentage: '1.0',
  });
  assert('createTpSl moving retracePercentage=1.0 → reject', !mvRetraceTooBig.success);

  const mvRetraceNaN = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000', retracePercentage: 'abc',
  });
  assert('createTpSl moving retracePercentage="abc" → reject', !mvRetraceNaN.success);

  // createTpSl: valid moving (string "true" + decimal-form percentage 0.5% = "0.005")
  const mvOkCap = {};
  const mvOk = await trade.createTpSl(tpslHttp(mvOkCap), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: 'true',
    movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000',
    retracePercentage: '0.005',
  });
  assert('createTpSl moving valid (0.5% retrace) → success', mvOk.success);
  assert('createTpSl body.isMovingTpSl === true', mvOkCap.body?.isMovingTpSl === true);
  assert('createTpSl body.movingActivationPrice === "76000"',
    mvOkCap.body?.movingActivationPrice === '76000');
  assert('createTpSl body.retracePercentage === "0.005"',
    mvOkCap.body?.retracePercentage === '0.005');
  assert('createTpSl body.movingTriggerBy === "LastPrice"',
    mvOkCap.body?.movingTriggerBy === 'LastPrice');

  // retraceDelta + movingTpSlSize both pass through (runtime accepts both).
  const mvPassCap = {};
  const mvPassHttp = {
    async get() { return { code: 0, data: {} }; },
    async post(path, body) { mvPassCap.path = path; mvPassCap.body = body; return { code: 0, data: {} }; },
  };
  const mvPass = await trade.createTpSl(mvPassHttp, {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000', retracePercentage: '0.005',
    retraceDelta: '250', movingTpSlSize: '0.001',
  });
  assert('createTpSl moving with retraceDelta + movingTpSlSize → success', mvPass.success);
  assert('createTpSl body.retraceDelta === "250"',
    mvPassCap.body?.retraceDelta === '250');
  assert('createTpSl body.movingTpSlSize === "0.001"',
    mvPassCap.body?.movingTpSlSize === '0.001');

  // createTpSl: edge values for retracePercentage (0.001 lower bound, 0.9999 upper bound)
  const mvEdgeLo = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000', retracePercentage: '0.001',
  });
  assert('createTpSl moving retracePercentage=0.001 → success', mvEdgeLo.success);
  const mvEdgeHi = await trade.createTpSl(tpslHttp({}), {
    symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
    isMovingTpSl: true, movingTriggerBy: 'LastPrice',
    movingActivationPrice: '76000', retracePercentage: '0.9999',
  });
  assert('createTpSl moving retracePercentage=0.9999 → success', mvEdgeHi.success);

  // replaceTpSl: moving fields pass through, NO isMovingTpSl
  const rpCap = {};
  const rpRes = await trade.replaceTpSl(tpslHttp(rpCap), {
    symbol: 'BTCUSDT', orderId: 'stop-1',
    movingTriggerBy: 'MarkPrice',
    movingActivationPrice: '72500',
    retracePercentage: '0.008',
    isMovingTpSl: true, // must be ignored
  });
  assert('replaceTpSl moving → success', rpRes.success);
  assert('replaceTpSl body.movingActivationPrice === "72500"',
    rpCap.body?.movingActivationPrice === '72500');
  assert('replaceTpSl body.retracePercentage === "0.008"', rpCap.body?.retracePercentage === '0.008');
  assert('replaceTpSl body.movingTriggerBy === "MarkPrice"',
    rpCap.body?.movingTriggerBy === 'MarkPrice');
  assert('replaceTpSl body.isMovingTpSl NOT present',
    !('isMovingTpSl' in (rpCap.body || {})));

  // replaceTpSl also passes through retraceDelta + movingTpSlSize
  const rpPassCap = {};
  const rpPassHttp = {
    async get() { return { code: 0, data: {} }; },
    async post(path, body) { rpPassCap.path = path; rpPassCap.body = body; return { code: 0, data: {} }; },
  };
  const rpPass = await trade.replaceTpSl(rpPassHttp, {
    symbol: 'BTCUSDT', orderId: 'stop-1',
    retraceDelta: '300', movingTpSlSize: '0.002',
  });
  assert('replaceTpSl with retraceDelta + movingTpSlSize → success', rpPass.success);
  assert('replaceTpSl body.retraceDelta === "300"', rpPassCap.body?.retraceDelta === '300');
  assert('replaceTpSl body.movingTpSlSize === "0.002"', rpPassCap.body?.movingTpSlSize === '0.002');

  // ---------- B-class optional-field passthrough ----------
  // Shared capture helper (captures both body and query params)
  const captureHttp = (cap) => ({
    async get(path, params) { cap.path = path; cap.params = params; return { code: 0, data: { list: [] } }; },
    async post(path, body) { cap.path = path; cap.body = body; return { code: 0, data: {} }; },
  });

  // createOrder.mmp passthrough (boolean + string "true" normalization)
  const mmpCap = {};
  const mmpRes = await trade.createOrder(captureHttp(mmpCap), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001', mmp: 'true',
  });
  assert('createOrder mmp="true" → body.mmp === true', mmpRes.success && mmpCap.body?.mmp === true);
  const mmpCap2 = {};
  await trade.createOrder(captureHttp(mmpCap2), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001', mmp: false,
  });
  assert('createOrder mmp=false → body.mmp === false', mmpCap2.body?.mmp === false);
  const mmpCapNone = {};
  await trade.createOrder(captureHttp(mmpCapNone), {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
  });
  assert('createOrder no mmp → body.mmp not present',
    !('mmp' in (mmpCapNone.body || {})));

  // getOrderHistory optional passthrough
  const ohCap = {};
  await trade.getOrderHistory(captureHttp(ohCap), {
    symbol: 'BTCUSDT', limit: 10, orderId: 'oid-1', orderLinkId: 'olk-1',
    orderStatus: 'Filled', orderFilter: 'StopOrder', cursor: 'c-1', baseCoin: 'BTC',
  });
  assert('getOrderHistory params contain orderId',    ohCap.params?.orderId === 'oid-1');
  assert('getOrderHistory params contain orderLinkId',ohCap.params?.orderLinkId === 'olk-1');
  assert('getOrderHistory params contain orderStatus',ohCap.params?.orderStatus === 'Filled');
  assert('getOrderHistory params contain orderFilter',ohCap.params?.orderFilter === 'StopOrder');
  assert('getOrderHistory params contain cursor',     ohCap.params?.cursor === 'c-1');
  assert('getOrderHistory params contain baseCoin',   ohCap.params?.baseCoin === 'BTC');
  assert('getOrderHistory params.limit stringified',  ohCap.params?.limit === '10');

  // getOrderHistory without symbol rejects locally
  const ohNoSym = await trade.getOrderHistory(captureHttp({}), {});
  assert('getOrderHistory no symbol → rejected', !ohNoSym.success);

  // getExecutions optional passthrough (8 fields)
  const exCap = {};
  await trade.getExecutions(captureHttp(exCap), {
    symbol: 'BTCUSDT', limit: 10, orderId: 'oid-2', execType: 'Trade',
    startTime: 1700000000000, endTime: 1700100000000, cursor: 'c-2',
    baseCoin: 'BTC', orderLinkId: 'olk-2', orderFilter: 'Order',
  });
  assert('getExecutions params.orderId',    exCap.params?.orderId === 'oid-2');
  assert('getExecutions params.execType',   exCap.params?.execType === 'Trade');
  assert('getExecutions params.startTime',  exCap.params?.startTime === '1700000000000');
  assert('getExecutions params.endTime',    exCap.params?.endTime === '1700100000000');
  assert('getExecutions params.cursor',     exCap.params?.cursor === 'c-2');
  assert('getExecutions params.baseCoin',   exCap.params?.baseCoin === 'BTC');
  assert('getExecutions params.orderLinkId',exCap.params?.orderLinkId === 'olk-2');
  assert('getExecutions params.orderFilter',exCap.params?.orderFilter === 'Order');

  // getClosedPnl optional passthrough
  const cpCap = {};
  await trade.getClosedPnl(captureHttp(cpCap), {
    symbol: 'BTCUSDT', limit: 5, startTime: 1700000000000, endTime: 1700100000000, cursor: 'c-3',
  });
  assert('getClosedPnl params.startTime', cpCap.params?.startTime === '1700000000000');
  assert('getClosedPnl params.endTime',   cpCap.params?.endTime === '1700100000000');
  assert('getClosedPnl params.cursor',    cpCap.params?.cursor === 'c-3');

  // getClosedPnl without symbol rejects locally
  const cpNoSym = await trade.getClosedPnl(captureHttp({}), {});
  assert('getClosedPnl no symbol → rejected', !cpNoSym.success);

  // ---------- New tools: getMarkPriceKlines / getRiskLimits / getPositionModeConfigs ----------

  // getMarkPriceKlines: required symbol + interval; limit default 200; start/end optional passthrough
  const mkCap = {};
  const mkRes = await market.getMarkPriceKlines(captureHttp(mkCap), {
    symbol: 'BTCUSDT', interval: '60',
  });
  assert('getMarkPriceKlines → success', mkRes.success);
  assert('getMarkPriceKlines path',
    mkCap.path === '/oapi/contract/instrument/public/v1/mark-price-klines');
  assert('getMarkPriceKlines params.symbol', mkCap.params?.symbol === 'BTCUSDT');
  assert('getMarkPriceKlines params.interval === "60"', mkCap.params?.interval === '60');
  assert('getMarkPriceKlines params.limit default "200"', mkCap.params?.limit === '200');
  assert('getMarkPriceKlines no start/end by default',
    mkCap.params?.start === undefined && mkCap.params?.end === undefined);

  const mkCap2 = {};
  await market.getMarkPriceKlines(captureHttp(mkCap2), {
    symbol: 'BTCUSDT', interval: 'D', limit: 50, start: 1700000000000, end: 1700100000000,
  });
  assert('getMarkPriceKlines params.interval numeric → stringified', mkCap2.params?.interval === 'D');
  assert('getMarkPriceKlines params.limit custom', mkCap2.params?.limit === '50');
  assert('getMarkPriceKlines params.start',  mkCap2.params?.start === '1700000000000');
  assert('getMarkPriceKlines params.end',    mkCap2.params?.end === '1700100000000');

  // getRiskLimits: symbol optional
  const rlCap = {};
  const rlRes = await market.getRiskLimits(captureHttp(rlCap), { symbol: 'BTCUSDT' });
  assert('getRiskLimits → success', rlRes.success);
  assert('getRiskLimits path',
    rlCap.path === '/oapi/contract/instrument/public/v1/risk-limits');
  assert('getRiskLimits params.symbol', rlCap.params?.symbol === 'BTCUSDT');

  const rlCap2 = {};
  await market.getRiskLimits(captureHttp(rlCap2), {});
  assert('getRiskLimits no args → params empty', Object.keys(rlCap2.params || {}).length === 0);

  // getPositionModeConfigs: all args optional
  const mcCap = {};
  const mcRes = await account.getPositionModeConfigs(captureHttp(mcCap), {
    symbol: 'BTCUSDT', coin: 'USDT', category: 'linear',
  });
  assert('getPositionModeConfigs → success', mcRes.success);
  assert('getPositionModeConfigs path',
    mcCap.path === '/oapi/contract/trade/private/v1/positions/mode-configs');
  assert('getPositionModeConfigs params.symbol', mcCap.params?.symbol === 'BTCUSDT');
  assert('getPositionModeConfigs params.coin',   mcCap.params?.coin === 'USDT');
  assert('getPositionModeConfigs params.category', mcCap.params?.category === 'linear');

  const mcCap2 = {};
  await account.getPositionModeConfigs(captureHttp(mcCap2), {});
  assert('getPositionModeConfigs no args → params empty', Object.keys(mcCap2.params || {}).length === 0);

  const mcCap3 = {};
  await account.getPositionModeConfigs(captureHttp(mcCap3), { coin: 'FreeU' });
  assert('getPositionModeConfigs only coin',
    mcCap3.params?.coin === 'FreeU' && mcCap3.params?.symbol === undefined);

  // ---------- setLeverage positionIdx + pzLinkId passthrough ----------
  const slCap = {};
  const slRes = await trade.setLeverage(captureHttp(slCap), {
    symbol: 'BTCUSDT', buyLeverage: '5', positionIdx: 1, pzLinkId: 'pz-abc',
  });
  assert('setLeverage with positionIdx + pzLinkId → success', slRes.success);
  assert('setLeverage body.positionIdx === 1', slCap.body?.positionIdx === 1);
  assert('setLeverage body.pzLinkId === "pz-abc"', slCap.body?.pzLinkId === 'pz-abc');
  assert('setLeverage body.buyLeverage === "5"', slCap.body?.buyLeverage === '5');
  assert('setLeverage body.sellLeverage fallback to buyLeverage', slCap.body?.sellLeverage === '5');

  // setLeverage without positionIdx/pzLinkId → body has no extra fields
  const slCap2 = {};
  await trade.setLeverage(captureHttp(slCap2), { symbol: 'BTCUSDT', buyLeverage: '10' });
  assert('setLeverage without positionIdx → body.positionIdx undefined',
    slCap2.body?.positionIdx === undefined);
  assert('setLeverage without pzLinkId → body.pzLinkId undefined',
    slCap2.body?.pzLinkId === undefined);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('trade test runner', false, err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
