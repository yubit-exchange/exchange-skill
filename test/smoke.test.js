'use strict';

const HttpClient = require('../lib/http');
const { loadConfig } = require('../lib/config');
const market = require('../tools/market');
const wallet = require('../tools/wallet');
const spot = require('../tools/spot');
const tradfi = require('../tools/tradfi');
const earn = require('../tools/earn');
const account = require('../tools/perp-query');
const trade = require('../tools/perp');
const { validateSymbol, validateOrder } = require('../lib/validate');

const cfg = loadConfig();
if (!cfg.apiKey || !cfg.apiSecret) {
  console.error('Set EXCHANGE_API_KEY and EXCHANGE_API_SECRET');
  process.exit(1);
}
const http = new HttpClient({ ...cfg, tlsReject: false });

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function approxEqual(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

async function snapshotUsdtBalances() {
  const [fundRes, spotRes, perpRes] = await Promise.all([
    wallet.getWalletAssets(http),
    spot.getBalance(http),
    account.getBalance(http, { coin: 'USDT' }),
  ]);
  if (!fundRes.success) throw new Error(`fundGetAssets failed: ${JSON.stringify(fundRes.error || fundRes.data)}`);
  if (!spotRes.success) throw new Error(`spotGetBalance failed: ${JSON.stringify(spotRes.error || spotRes.data)}`);
  if (!perpRes.success) throw new Error(`perpGetBalance failed: ${JSON.stringify(perpRes.error || perpRes.data)}`);
  const fund = fundRes.data.list.find(x => x.coin === 'USDT');
  const spotUsdt = spotRes.data.find(x => x.tokenId === 'USDT');
  const perp = perpRes.data.list.find(x => x.coin === 'USDT');
  if (!fund) throw new Error('fundGetAssets did not return USDT row');
  if (!spotUsdt) throw new Error('spotGetBalance did not return USDT row');
  if (!perp) throw new Error('perpGetBalance did not return USDT row');
  return {
    FUNDING: parseFloat(fund.available_balance),
    SPOT: parseFloat(spotUsdt.free),
    TRADING: parseFloat(perp.availableBalance),
  };
}

async function main() {
  console.log('Smoke test\n');

  // -- Market --
  console.log('Market');
  const ticker = await market.getTicker(http, { symbol: 'BTCUSDT' });
  assert('getTicker', ticker.success && ticker.data.list.length > 0);
  const lastPrice = ticker.success ? ticker.data.list[0].lastPrice : '60000';

  assert('getOrderbook', (await market.getOrderbook(http, { symbol: 'BTCUSDT', depth: '3' })).success);
  assert('getKlines', (await market.getKlines(http, { symbol: 'BTCUSDT', interval: '60', limit: '3' })).success);
  assert('getMarkPriceKlines', (await market.getMarkPriceKlines(http, { symbol: 'BTCUSDT', interval: '60', limit: '3' })).success);
  assert('getFundingRate', (await market.getFundingRate(http, { symbol: 'BTCUSDT' })).success);
  assert('getInstruments', (await market.getInstruments(http, { symbol: 'BTCUSDT' })).success);
  assert('getRiskLimits (symbol)', (await market.getRiskLimits(http, { symbol: 'BTCUSDT' })).success);
  assert('getRiskLimits (no symbol)', (await market.getRiskLimits(http, {})).success);

  // -- Account --
  console.log('\nAccount');
  assert('spotGetBalance', (await spot.getBalance(http)).success);
  assert('tradfiGetBalance', (await tradfi.getBalance(http)).success);
  assert('earnGetBalance', (await earn.getBalance(http)).success);
  assert('getBalance', (await account.getBalance(http, { coin: 'USDT' })).success);
  assert('getPositions by symbol', (await account.getPositions(http, { symbol: 'BTCUSDT' })).success);
  assert('getPositions by settleCoin', (await account.getPositions(http, { settleCoin: 'USDT' })).success);
  assert('getFeeRate', (await account.getFeeRate(http, { symbol: 'BTCUSDT' })).success);
  assert('getPositionModeConfigs (symbol)',
    (await account.getPositionModeConfigs(http, { symbol: 'BTCUSDT' })).success);
  assert('getPositionModeConfigs (coin)',
    (await account.getPositionModeConfigs(http, { coin: 'USDT' })).success);
  assert('getPositionModeConfigs (no args)',
    (await account.getPositionModeConfigs(http, {})).success);
  const walletFlow = await account.getWalletFlowRecords(http, { coin: 'USDT', limit: '5', sort: 'DESC', contractType: 'linear' });
  assert('perpGetWalletFlowRecords', walletFlow.success && Array.isArray(walletFlow.data?.list), JSON.stringify(walletFlow.error || walletFlow.data));
  assert('fundGetAssets', (await wallet.getWalletAssets(http)).success);
  assert('getPortfolioNetWorth', (await wallet.getAllWalletBalance(http)).success);

  // -- Validation --
  console.log('\nValidation');
  assert('valid symbol', (await validateSymbol(http, 'BTCUSDT')).valid);
  assert('invalid symbol', !(await validateSymbol(http, 'FAKEUSDT')).valid);
  assert('valid order', (await validateOrder(http, { symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Limit', qty: '0.001', price: '50000' })).valid);
  assert('qty below min', !(await validateOrder(http, { symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Limit', qty: '0.0001', price: '50000' })).valid);

  // -- Wallet transfer (verified reversible pairs only) --
  console.log('\nWallet transfer');
  const transferPairs = [
    ['FUNDING', 'TRADING'],
    ['FUNDING', 'SPOT'],
    ['TRADING', 'SPOT'],
  ];
  for (const [fromWallet, toWallet] of transferPairs) {
    const before = await snapshotUsdtBalances();
    const go = await wallet.transfer(http, {
      coin: 'USDT',
      amount: '0.01',
      fromWallet,
      toWallet,
    });
    assert(`transfer ${fromWallet}->${toWallet}`, go.success, JSON.stringify(go.error || {}));
    if (!go.success) continue;

    await sleep(1200);
    const mid = await snapshotUsdtBalances();
    assert(
      `transfer ${fromWallet}->${toWallet} read-back`,
      approxEqual(mid[fromWallet], before[fromWallet] - 0.01) &&
      approxEqual(mid[toWallet], before[toWallet] + 0.01),
      `before=${JSON.stringify(before)} mid=${JSON.stringify(mid)}`
    );

    const back = await wallet.transfer(http, {
      coin: 'USDT',
      amount: '0.01',
      fromWallet: toWallet,
      toWallet: fromWallet,
    });
    assert(`transfer ${toWallet}->${fromWallet} rollback`, back.success, JSON.stringify(back.error || {}));
    if (!back.success) continue;

    await sleep(1200);
    const after = await snapshotUsdtBalances();
    assert(
      `transfer ${fromWallet}<->${toWallet} restored`,
      approxEqual(after[fromWallet], before[fromWallet]) &&
      approxEqual(after[toWallet], before[toWallet]),
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
    );
  }

  // -- Create limit order → modify → cancel --
  console.log('\nOrder lifecycle');
  const limitPrice = String(Math.floor(parseFloat(lastPrice) * 0.8));

  const order = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1,
    orderType: 'Limit', qty: '0.001', price: limitPrice,
  });
  assert('createOrder (limit)', order.success && order.data.orderId);

  if (order.success) {
    const oid = order.data.orderId;
    await sleep(1000);

    const mod = await trade.modifyOrder(http, { symbol: 'BTCUSDT', orderId: oid, price: String(parseInt(limitPrice) + 1000) });
    assert('modifyOrder', mod.success);

    const cancel = await trade.cancelOrder(http, { symbol: 'BTCUSDT', orderId: oid });
    assert('cancelOrder', cancel.success);
    await sleep(500);
  }

  // -- cancelAllOrders --
  console.log('\nCancelAll');
  const throwaway = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1,
    orderType: 'Limit', qty: '0.001', price: limitPrice, timeInForce: 'GoodTillCancel',
  });
  if (throwaway.success) {
    await sleep(500);
    const ca = await trade.cancelAllOrders(http, { symbol: 'BTCUSDT' });
    assert('cancelAllOrders', ca.success);
    await sleep(500);
  }

  // -- setLeverage --
  console.log('\nSetLeverage');
  const lev = await trade.setLeverage(http, { symbol: 'BTCUSDT', buyLeverage: '10' });
  assert('setLeverage', lev.success);

  // -- Conditional order (trigger) --
  console.log('\nConditional order');
  // triggerPrice without triggerDirection → rejected locally
  const condReject = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
    triggerPrice: String(Math.floor(parseFloat(lastPrice) * 1.1)),
  });
  assert('conditional: triggerPrice without triggerDirection → rejected', !condReject.success);

  // Valid conditional market order: trigger when price rises above target
  const triggerPriceVal = String(Math.floor(parseFloat(lastPrice) * 1.1));
  const condOrder = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
    triggerPrice: triggerPriceVal, triggerDirection: 1, triggerBy: 'LastPrice',
  });
  assert('conditional: create trigger order', condOrder.success && condOrder.data.orderId);

  if (condOrder.success) {
    await sleep(500);
    // Verify via getOpenOrders with orderFilter=StopOrder
    const condList = await trade.getOpenOrders(http, { symbol: 'BTCUSDT', orderFilter: 'StopOrder' });
    const condInList = (condList.data?.list || []).find(o => o.orderId === condOrder.data.orderId);
    assert('conditional: appears in StopOrder list', !!condInList);
    assert('conditional: triggerPrice matches', condInList?.triggerPrice === triggerPriceVal + '.0' || condInList?.triggerPrice === triggerPriceVal);

    // Cancel the conditional order
    const condCancel = await trade.cancelOrder(http, { symbol: 'BTCUSDT', orderId: condOrder.data.orderId });
    assert('conditional: cancel trigger order', condCancel.success);
    await sleep(500);
  }

  // Reverse conditional: sell when price falls (triggerDirection=2) + MarkPrice
  const downTriggerPrice = String(Math.floor(parseFloat(lastPrice) * 0.9));
  const condDown = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Sell', positionIdx: 2, orderType: 'Market', qty: '0.001',
    triggerPrice: downTriggerPrice, triggerDirection: 2, triggerBy: 'MarkPrice',
  });
  assert('conditional: fall trigger + MarkPrice', condDown.success && condDown.data.orderId);
  if (condDown.success) {
    await sleep(500);
    const cancelDown = await trade.cancelOrder(http, { symbol: 'BTCUSDT', orderId: condDown.data.orderId });
    assert('conditional: cancel fall trigger', cancelDown.success);
    await sleep(500);
  }


  // -- Market long → partial close (reduceOnly + pzLinkId) → full close --
  console.log('\nFull trade lifecycle (Long)');
  const marketOrder = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.003',
  });
  assert('market open long', marketOrder.success);

  if (marketOrder.success) {
    await sleep(1000);

    const pos = await account.getPositions(http, { symbol: 'BTCUSDT' });
    const allPos = [...(pos.data?.list || []), ...(pos.data?.separateList || [])];
    const myPos = allPos.find(p => p.positionIdx === 1);
    assert('position exists', !!myPos);
    assert('position normalized (direction)', myPos?.direction === 'Long');
    assert('position normalized (tradeModeLabel)', !!myPos?.tradeModeLabel);

    // Safe add-on to the existing position. In separate mode this must hit the same
    // pzLinkId instead of opening a second sub-position.
    let activeLongPos = myPos;
    const longPosCountBeforeAdd = allPos.filter(p => p.positionIdx === 1).length;
    if (activeLongPos) {
      const addToExisting = await trade.addToPosition(http, {
        symbol: 'BTCUSDT',
        positionIdx: 1,
        qty: '0.001',
        ...(activeLongPos.pzLinkId ? { pzLinkId: activeLongPos.pzLinkId } : {}),
      });
      assert('perpAddToPosition (existing long)', addToExisting.success, JSON.stringify(addToExisting.error || addToExisting.data));
      await sleep(1000);

      const posAfterAddToPosition = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const allAfterAddToPosition = [...(posAfterAddToPosition.data?.list || []), ...(posAfterAddToPosition.data?.separateList || [])];
      const longPositionsAfterAdd = allAfterAddToPosition.filter(p => p.positionIdx === 1);
      const sameTargetPos = activeLongPos.pzLinkId
        ? longPositionsAfterAdd.find(p => p.pzLinkId === activeLongPos.pzLinkId)
        : longPositionsAfterAdd[0];

      assert('perpAddToPosition keeps same long position target', !!sameTargetPos, JSON.stringify(longPositionsAfterAdd));
      assert('perpAddToPosition increases size by 0.001',
        !!sameTargetPos && Math.abs(parseFloat(sameTargetPos.size) - (parseFloat(activeLongPos.size) + 0.001)) < 1e-9,
        `before=${activeLongPos?.size} after=${sameTargetPos?.size}`);
      assert('perpAddToPosition does not create extra long separate position',
        longPositionsAfterAdd.length === longPosCountBeforeAdd,
        `beforeCount=${longPosCountBeforeAdd} afterCount=${longPositionsAfterAdd.length}`);

      activeLongPos = sameTargetPos || activeLongPos;
    }

    // addMargin (isolated only): add 5 U and verify positionBalance +5, then reduce 3 U
    // and verify net delta ~+2. The same /positions/add-margin route supports signed margin
    // (positive to add, negative to reduce); runtime's marginbiz.TrySetMargin has an explicit
    // "addedMarginE8 < 0" branch for releasing margin on isolated positions.
    if (activeLongPos && Number(activeLongPos.tradeMode) === 1) {
      const beforeBalance = parseFloat(activeLongPos.positionBalance);
      const addMarginRes = await trade.addMargin(http, {
        symbol: 'BTCUSDT', positionIdx: 1, margin: '5',
        ...(activeLongPos.pzLinkId ? { pzLinkId: activeLongPos.pzLinkId } : {}),
      });
      assert('addMargin +5 success', addMarginRes.success);
      await sleep(500);

      const posAfterAddMargin = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const allAfterAdd = [...(posAfterAddMargin.data?.list || []), ...(posAfterAddMargin.data?.separateList || [])];
      const posAfterAdd = allAfterAdd.find(p => p.positionIdx === 1);
      const afterAddBalance = parseFloat(posAfterAdd?.positionBalance || '0');
      assert('addMargin +5: positionBalance increased by ~5',
        afterAddBalance >= beforeBalance + 4.9 && afterAddBalance <= beforeBalance + 5.1,
        `before=${beforeBalance}, after=${afterAddBalance}`);

      // Reduce 3 U via negative margin
      const reduceMarginRes = await trade.addMargin(http, {
        symbol: 'BTCUSDT', positionIdx: 1, margin: '-3',
        ...(activeLongPos.pzLinkId ? { pzLinkId: activeLongPos.pzLinkId } : {}),
      });
      assert('addMargin -3 (reduce) success', reduceMarginRes.success);
      await sleep(500);

      const posAfterReduce = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const allAfterReduce = [...(posAfterReduce.data?.list || []), ...(posAfterReduce.data?.separateList || [])];
      const posReduced = allAfterReduce.find(p => p.positionIdx === 1);
      const afterReduceBalance = parseFloat(posReduced?.positionBalance || '0');
      assert('addMargin -3: positionBalance decreased by ~3 (net ~+2 from original)',
        afterReduceBalance >= beforeBalance + 1.9 && afterReduceBalance <= beforeBalance + 2.1,
        `before=${beforeBalance}, afterAdd=${afterAddBalance}, afterReduce=${afterReduceBalance}`);

      // Zero margin must still be rejected locally (runtime also returns MarginNotModified)
      const zeroRes = await trade.addMargin(http, {
        symbol: 'BTCUSDT', positionIdx: 1, margin: '0',
        ...(activeLongPos.pzLinkId ? { pzLinkId: activeLongPos.pzLinkId } : {}),
      });
      assert('addMargin 0 → rejected', !zeroRes.success);
    }

    // createTpSl with pzLinkId
    if (activeLongPos?.pzLinkId) {
      const tp = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Full', takeProfit: '80000', stopLoss: '55000',
      });
      assert('createTpSl with pzLinkId', tp.success);

      // Advanced TP/SL: limit TP + market SL
      const advTpSl = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Full',
        takeProfit: '80000', tpTriggerBy: 'LastPrice',
        tpOrderType: 'Limit', tpLimitPrice: '79900',
        stopLoss: '55000', slTriggerBy: 'LastPrice',
        slOrderType: 'Market',
      });
      assert('createTpSl advanced (limit TP + market SL)', advTpSl.success);

      // Conditional order with closeOnTrigger=true: needs an existing position (covered here)
      const closeTriggerPrice = String(Math.floor(parseFloat(lastPrice) * 1.15));
      const condCloseOnly = await trade.createOrder(http, {
        symbol: 'BTCUSDT', side: 'Sell', positionIdx: 1, orderType: 'Market', qty: '0.001',
        triggerPrice: closeTriggerPrice, triggerDirection: 1, triggerBy: 'LastPrice',
        closeOnTrigger: true, reduceOnly: true,
        ...(activeLongPos.pzLinkId ? { pzLinkId: activeLongPos.pzLinkId } : {}),
      });
      assert('conditional: closeOnTrigger=true (with position)', condCloseOnly.success && condCloseOnly.data.orderId);
      if (condCloseOnly.success) {
        await sleep(500);
        const cancelCloseOnly = await trade.cancelOrder(http, { symbol: 'BTCUSDT', orderId: condCloseOnly.data.orderId });
        assert('conditional: cancel closeOnTrigger order', cancelCloseOnly.success);
        await sleep(500);
      }

      // orderFilter + replaceTpSl (must run while TP/SL sub-orders exist)
      await sleep(500);
      const stopOrders = await trade.getOpenOrders(http, { symbol: 'BTCUSDT', orderFilter: 'StopOrder' });
      assert('getOpenOrders StopOrder filter', stopOrders.success);
      const tpSubOrder = (stopOrders.data?.list || []).find(o => o.stopOrderType === 'TakeProfit');
      assert('StopOrder list contains TakeProfit', !!tpSubOrder);
      if (tpSubOrder) {
        const replace = await trade.replaceTpSl(http, {
          symbol: 'BTCUSDT', orderId: tpSubOrder.orderId,
          takeProfit: '81000', tpOrderType: 'Limit', tpLimitPrice: '80900',
        });
        assert('replaceTpSl', replace.success);
      }

      // Trailing stop local guards (pre-check, before any real creation)
      const mvGuardPartial = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Partial', isMovingTpSl: true,
        movingTriggerBy: 'LastPrice',
        movingActivationPrice: String(Math.floor(parseFloat(lastPrice) * 1.05)),
        retracePercentage: '0.005',
      });
      assert('createTpSl trailing stop with Partial → rejected', !mvGuardPartial.success);
      const mvGuardBadTrigger = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Full', isMovingTpSl: true, movingTriggerBy: 'IndexPrice',
        movingActivationPrice: String(Math.floor(parseFloat(lastPrice) * 1.05)),
        retracePercentage: '0.005',
      });
      assert('createTpSl trailing stop with IndexPrice trigger → rejected', !mvGuardBadTrigger.success);
      const mvGuardRetraceRange = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Full', isMovingTpSl: true, movingTriggerBy: 'LastPrice',
        movingActivationPrice: String(Math.floor(parseFloat(lastPrice) * 1.05)),
        retracePercentage: '0.00005',
      });
      assert('createTpSl trailing stop retracePercentage too small → rejected', !mvGuardRetraceRange.success);
      const mvGuardNoRetrace = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Full', isMovingTpSl: true, movingTriggerBy: 'LastPrice',
        movingActivationPrice: String(Math.floor(parseFloat(lastPrice) * 1.05)),
      });
      assert('createTpSl trailing stop without retracePercentage → rejected', !mvGuardNoRetrace.success);

      // Trailing stop — real exchange call. retracePercentage is decimal form ('0.005' = 0.5%).
      // Observed behaviour:
      // - Creates an independent stop sub-order; does NOT update position.trailingStop /
      //   position.activePrice (those belong to the legacy setTradingStop path).
      // - Only one moving TP/SL per position; second creation returns 14120005.
      const activationPrice = String(Math.floor(parseFloat(lastPrice) * 1.05));
      const movingTp = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
        tpSlMode: 'Full',
        isMovingTpSl: true,
        movingTriggerBy: 'LastPrice',
        movingActivationPrice: activationPrice,
        retracePercentage: '0.005',
      });
      assert('createTpSl trailing stop → exchange accepted', movingTp.success);

      // Second creation while the first still exists must fail (one per position rule).
      // Exchange returns 14120005. This doubles as "proof the first creation persisted".
      if (movingTp.success) {
        const mvConflict = await trade.createTpSl(http, {
          symbol: 'BTCUSDT', positionIdx: 1, pzLinkId: activeLongPos.pzLinkId,
          tpSlMode: 'Full', isMovingTpSl: true, movingTriggerBy: 'LastPrice',
          movingActivationPrice: activationPrice, retracePercentage: '0.01',
        });
        assert('createTpSl trailing stop second attempt → exchange rejects (one per position)',
          !mvConflict.success && mvConflict.error?.code === 14120005);
      }
    }

    // partial close after add-on: reduce the same targeted long position via reduceOnly + pzLinkId
    if (activeLongPos?.pzLinkId) {
      const partial = await trade.createOrder(http, {
        symbol: 'BTCUSDT', side: 'Sell', positionIdx: 1, orderType: 'Market',
        qty: '0.001', reduceOnly: true, pzLinkId: activeLongPos.pzLinkId,
      });
      assert('partial close (reduceOnly + pzLinkId)', partial.success);
      await sleep(500);

      const posAfterPartial = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const remaining = [...(posAfterPartial.data?.list || []), ...(posAfterPartial.data?.separateList || [])];
      const stillOpen = remaining.find(p => p.pzLinkId === activeLongPos.pzLinkId);
      assert('partial close: position reduced', !!stillOpen && parseFloat(stillOpen.size) < parseFloat(activeLongPos.size));
    }

    // full close
    const close = await trade.closePosition(http, { symbol: 'BTCUSDT', positionIdx: 1 });
    assert('closePosition (full)', close.success);
    await sleep(500);

    const posAfter = await account.getPositions(http, { symbol: 'BTCUSDT' });
    const remainingFinal = [...(posAfter.data?.list || []), ...(posAfter.data?.separateList || [])];
    const ourPos = remainingFinal.find(p => p.pzLinkId === activeLongPos?.pzLinkId);
    assert('position fully closed', !ourPos);
  }

  // -- Market short → partial close → full close --
  console.log('\nFull trade lifecycle (Short)');
  const shortOrder = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Sell', positionIdx: 2, orderType: 'Market', qty: '0.003',
  });
  assert('market open short', shortOrder.success);

  if (shortOrder.success) {
    await sleep(1000);

    const posShort = await account.getPositions(http, { symbol: 'BTCUSDT' });
    const allShort = [...(posShort.data?.list || []), ...(posShort.data?.separateList || [])];
    const myShort = allShort.find(p => p.positionIdx === 2);
    assert('short position exists', !!myShort);
    assert('short position direction', myShort?.direction === 'Short');

    // partial close short: Buy + reduceOnly + pzLinkId
    if (myShort?.pzLinkId) {
      const partialShort = await trade.createOrder(http, {
        symbol: 'BTCUSDT', side: 'Buy', positionIdx: 2, orderType: 'Market',
        qty: '0.001', reduceOnly: true, pzLinkId: myShort.pzLinkId,
      });
      assert('partial close short (reduceOnly + pzLinkId)', partialShort.success);
      await sleep(500);

      const posAfterPartialShort = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const remainingShort = [...(posAfterPartialShort.data?.list || []), ...(posAfterPartialShort.data?.separateList || [])];
      const stillShort = remainingShort.find(p => p.pzLinkId === myShort.pzLinkId);
      assert('partial close short: position reduced', !!stillShort && parseFloat(stillShort.size) < 0.003);
    }

    // full close short
    const closeShort = await trade.closePosition(http, { symbol: 'BTCUSDT', positionIdx: 2 });
    assert('closePosition short (full)', closeShort.success);
    await sleep(500);

    const posAfterShort = await account.getPositions(http, { symbol: 'BTCUSDT' });
    const remainingFinalShort = [...(posAfterShort.data?.list || []), ...(posAfterShort.data?.separateList || [])];
    const ourShort = remainingFinalShort.find(p => p.pzLinkId === myShort?.pzLinkId);
    assert('short position fully closed', !ourShort);
  }

  // -- Filled then flat diagnosis --
  console.log('\nFilled then flat diagnosis');
  const diagOpen = await trade.createOrder(http, {
    symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.001',
  });
  assert('diagnosis: open long', diagOpen.success);

  if (diagOpen.success) {
    await sleep(1000);

    const diagPos = await account.getPositions(http, { symbol: 'BTCUSDT' });
    const diagAllPos = [...(diagPos.data?.list || []), ...(diagPos.data?.separateList || [])];
    const diagLong = diagAllPos.find(p => p.positionIdx === 1);
    assert('diagnosis: long position exists before forced close', !!diagLong);

    if (diagLong) {
      const diagCloseBody = {
        symbol: 'BTCUSDT', side: 'Sell', positionIdx: 1, orderType: 'Market',
        qty: '0.001', reduceOnly: true,
      };
      if (diagLong.pzLinkId) diagCloseBody.pzLinkId = diagLong.pzLinkId;
      const diagClose = await trade.createOrder(http, diagCloseBody);
      assert('diagnosis: reduceOnly close', diagClose.success);

      if (diagClose.success) {
        await sleep(1200);
        const diagnosis = await trade.diagnoseFilledButFlat(http, {
          symbol: 'BTCUSDT',
          orderId: diagOpen.data.orderId,
          orderLinkId: diagOpen.data.orderLinkId,
          positionIdx: 1,
        });
        assert('diagnosis: detects filled then flat due to close',
          diagnosis.success && diagnosis.data?.diagnosis === 'filled_then_flat_due_to_close',
          JSON.stringify(diagnosis.error || diagnosis.data));
        assert('diagnosis: close order matches reduceOnly close',
          diagnosis.data?.closeOrder?.orderId === diagClose.data.orderId && diagnosis.data?.closeOrder?.reduceOnly === true,
          JSON.stringify(diagnosis.data));
      }
    }
  }

  // -- Merged position mode (non-separate) --
  console.log('\nMerged position mode');

  // Clean up any residual USDT orders/positions before switching
  await trade.cancelAllOrders(http, { settleCoin: 'USDT', confirmBatch: true });
  await trade.closePosition(http, { settleCoin: 'USDT', positionIdx: 1, confirmBatch: true });
  await trade.closePosition(http, { settleCoin: 'USDT', positionIdx: 2, confirmBatch: true });
  await sleep(500);

  // Switch to merged mode
  const switchToMerged = await trade.switchSeparatePosition(http, { coin: 'USDT', isSeparatePz: false });
  assert('switch to merged mode', switchToMerged.success);

  if (switchToMerged.success) {
    // Open long in merged mode
    const mergedOrder = await trade.createOrder(http, {
      symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.003',
    });
    assert('merged: open long', mergedOrder.success);

    if (mergedOrder.success) {
      await sleep(1000);

      const mergedPos = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const mergedList = mergedPos.data?.list || [];
      const mergedSepList = mergedPos.data?.separateList || [];
      assert('merged: position in list (not separateList)', mergedList.length > 0 && mergedSepList.length === 0);

      const myMergedPos = mergedList[0];
      assert('merged: isSeparatePz is false', myMergedPos?.isSeparatePz === false);
      assert('merged: no pzLinkId', !myMergedPos?.pzLinkId);

      const mergedAdd = await trade.addToPosition(http, {
        symbol: 'BTCUSDT',
        positionIdx: 1,
        qty: '0.001',
      });
      assert('merged: perpAddToPosition', mergedAdd.success, JSON.stringify(mergedAdd.error || mergedAdd.data));
      await sleep(500);

      const mergedPosAfterAdd = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const mergedAfterAddList = mergedPosAfterAdd.data?.list || [];
      assert('merged: addToPosition keeps single merged position',
        mergedAfterAddList.length === 1 && (mergedPosAfterAdd.data?.separateList || []).length === 0,
        JSON.stringify(mergedPosAfterAdd.data));
      assert('merged: addToPosition increases size',
        mergedAfterAddList.length === 1 &&
          Math.abs(parseFloat(mergedAfterAddList[0].size) - (parseFloat(myMergedPos.size) + 0.001)) < 1e-9,
        `before=${myMergedPos?.size} after=${mergedAfterAddList[0]?.size}`);
      const mergedSizeAfterAdd = parseFloat(mergedAfterAddList[0]?.size || '0');

      // Partial close without pzLinkId
      const mergedPartial = await trade.createOrder(http, {
        symbol: 'BTCUSDT', side: 'Sell', positionIdx: 1, orderType: 'Market',
        qty: '0.001', reduceOnly: true,
      });
      assert('merged: partial close (no pzLinkId)', mergedPartial.success);
      await sleep(500);

      const mergedPosAfter = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const mergedRemaining = mergedPosAfter.data?.list || [];
      assert('merged: position reduced',
        mergedRemaining.length > 0 && parseFloat(mergedRemaining[0].size) < mergedSizeAfterAdd,
        `beforeAfterAdd=${mergedSizeAfterAdd} afterPartial=${mergedRemaining[0]?.size}`);

      // createTpSl in merged mode (no pzLinkId)
      const mergedTpSl = await trade.createTpSl(http, {
        symbol: 'BTCUSDT', positionIdx: 1, tpSlMode: 'Full',
        takeProfit: '80000', stopLoss: '55000',
      });
      assert('merged: createTpSl (no pzLinkId)', mergedTpSl.success);

      // Full close long
      const mergedClose = await trade.closePosition(http, { symbol: 'BTCUSDT', positionIdx: 1 });
      assert('merged: closePosition long', mergedClose.success);
      await sleep(500);
    }

    // Merged short: open → partial close → full close
    const mergedShort = await trade.createOrder(http, {
      symbol: 'BTCUSDT', side: 'Sell', positionIdx: 2, orderType: 'Market', qty: '0.003',
    });
    assert('merged: open short', mergedShort.success);

    if (mergedShort.success) {
      await sleep(1000);

      const mergedShortPos = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const mergedShortList = mergedShortPos.data?.list || [];
      const myMergedShort = mergedShortList.find(p => p.positionIdx === 2);
      assert('merged: short position exists', !!myMergedShort);

      // Partial close short
      const mergedShortPartial = await trade.createOrder(http, {
        symbol: 'BTCUSDT', side: 'Buy', positionIdx: 2, orderType: 'Market',
        qty: '0.001', reduceOnly: true,
      });
      assert('merged: partial close short', mergedShortPartial.success);
      await sleep(500);

      const mergedShortAfter = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const mergedShortRemaining = mergedShortAfter.data?.list || [];
      const stillShort = mergedShortRemaining.find(p => p.positionIdx === 2);
      assert('merged: short position reduced', !!stillShort && parseFloat(stillShort.size) < 0.003);

      // Full close short
      const mergedCloseShort = await trade.closePosition(http, { symbol: 'BTCUSDT', positionIdx: 2 });
      assert('merged: closePosition short', mergedCloseShort.success);
      await sleep(500);
    }

    // Clean up before switching back
    await trade.cancelAllOrders(http, { settleCoin: 'USDT', confirmBatch: true });
    await trade.closePosition(http, { settleCoin: 'USDT', positionIdx: 1, confirmBatch: true });
    await trade.closePosition(http, { settleCoin: 'USDT', positionIdx: 2, confirmBatch: true });
    await sleep(500);

    // Switch back to separate mode
    const switchBack = await trade.switchSeparatePosition(http, { coin: 'USDT', isSeparatePz: true });
    assert('switch back to separate mode', switchBack.success);
  }

  // -- Cross margin mode --
  console.log('\nCross margin mode');

  const switchToCross = await trade.switchMarginMode(http, {
    symbol: 'BTCUSDT', tradeMode: 0, buyLeverage: '10', sellLeverage: '10',
  });
  assert('switch to cross margin', switchToCross.success);

  if (switchToCross.success) {
    const crossOrder = await trade.createOrder(http, {
      symbol: 'BTCUSDT', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.003',
    });
    assert('cross: open long', crossOrder.success);

    if (crossOrder.success) {
      await sleep(1000);

      const crossPos = await account.getPositions(http, { symbol: 'BTCUSDT' });
      const crossAll = [...(crossPos.data?.list || []), ...(crossPos.data?.separateList || [])];
      const myCrossPos = crossAll.find(p => p.positionIdx === 1);
      assert('cross: tradeMode is 0 (Cross)', myCrossPos?.tradeMode === 0);
      assert('cross: tradeModeLabel is Cross', myCrossPos?.tradeModeLabel === 'Cross');

      // Partial close with pzLinkId if separate mode
      const partialBody = {
        symbol: 'BTCUSDT', side: 'Sell', positionIdx: 1, orderType: 'Market',
        qty: '0.001', reduceOnly: true,
      };
      if (myCrossPos?.pzLinkId) partialBody.pzLinkId = myCrossPos.pzLinkId;
      const crossPartial = await trade.createOrder(http, partialBody);
      assert('cross: partial close', crossPartial.success);
      await sleep(500);

      // Full close
      const crossClose = await trade.closePosition(http, { symbol: 'BTCUSDT', positionIdx: 1 });
      assert('cross: closePosition', crossClose.success);
      await sleep(500);
    }

    // Switch back to isolated
    const switchToIsolated = await trade.switchMarginMode(http, {
      symbol: 'BTCUSDT', tradeMode: 1, buyLeverage: '10', sellLeverage: '10',
    });
    assert('switch back to isolated', switchToIsolated.success);
  }

  // -- History --
  console.log('\nHistory');
  assert('getOrderHistory', (await trade.getOrderHistory(http, { symbol: 'BTCUSDT', limit: '1' })).success);
  assert('getExecutions', (await trade.getExecutions(http, { symbol: 'BTCUSDT', limit: '1' })).success);
  assert('getClosedPnl', (await trade.getClosedPnl(http, { symbol: 'BTCUSDT', limit: '1' })).success);

  // getOpenOrders three-way required (symbol/settleCoin/baseCoin)
  assert('getOpenOrders: baseCoin=BTC',
    (await trade.getOpenOrders(http, { baseCoin: 'BTC' })).success);
  assert('getOpenOrders: no key → rejected',
    !(await trade.getOpenOrders(http, {})).success);

  // modifyOrder "at least one modifiable field" guard — local reject, no HTTP call
  const modGuardRes = await trade.modifyOrder(http, { symbol: 'BTCUSDT', orderId: 'non-existent' });
  assert('modifyOrder no modifiable field → rejected locally', !modGuardRes.success);

  // ========== FreeU 合约测试 ==========

  // -- FreeU Market --
  console.log('\nFreeU Market');
  const freeUTicker = await market.getTicker(http, { symbol: 'ETHFreeU' });
  assert('FreeU: getTicker', freeUTicker.success && freeUTicker.data.list.length > 0);
  const freeUPrice = freeUTicker.success ? freeUTicker.data.list[0].lastPrice : '2000';

  assert('FreeU: getOrderbook', (await market.getOrderbook(http, { symbol: 'ETHFreeU', depth: '3' })).success);
  assert('FreeU: getKlines', (await market.getKlines(http, { symbol: 'ETHFreeU', interval: '60', limit: '3' })).success);
  assert('FreeU: getMarkPriceKlines', (await market.getMarkPriceKlines(http, { symbol: 'ETHFreeU', interval: '60', limit: '3' })).success);
  assert('FreeU: getFundingRate', (await market.getFundingRate(http, { symbol: 'ETHFreeU' })).success);
  assert('FreeU: getInstruments', (await market.getInstruments(http, { symbol: 'ETHFreeU' })).success);
  assert('FreeU: getRiskLimits', (await market.getRiskLimits(http, { symbol: 'ETHFreeU' })).success);

  // -- FreeU Account --
  console.log('\nFreeU Account');
  assert('FreeU: getBalance (FreeU)', (await account.getBalance(http, { coin: 'FreeU' })).success);
  assert('FreeU: getBalance (all)', (await account.getBalance(http, {})).success);
  assert('FreeU: getPositions by symbol', (await account.getPositions(http, { symbol: 'ETHFreeU' })).success);
  assert('FreeU: getPositions by settleCoin', (await account.getPositions(http, { settleCoin: 'FreeU' })).success);
  assert('FreeU: getPositions fail-fast', !(await account.getPositions(http, {})).success);
  assert('FreeU: getFeeRate', (await account.getFeeRate(http, { symbol: 'ETHFreeU' })).success);
  assert('FreeU: getPositionModeConfigs (coin)',
    (await account.getPositionModeConfigs(http, { coin: 'FreeU' })).success);

  // -- FreeU Validation --
  console.log('\nFreeU Validation');
  assert('FreeU: valid symbol', (await validateSymbol(http, 'ETHFreeU')).valid);
  assert('FreeU: valid order', (await validateOrder(http, {
    symbol: 'ETHFreeU', side: 'Buy', positionIdx: 1, orderType: 'Limit', qty: '0.01', price: '1500'
  })).valid);

  // -- FreeU Order Lifecycle --
  console.log('\nFreeU Order Lifecycle');
  const freeULimitPrice = String(Math.floor(parseFloat(freeUPrice) * 0.8));

  const freeUOrder = await trade.createOrder(http, {
    symbol: 'ETHFreeU', side: 'Buy', positionIdx: 1,
    orderType: 'Limit', qty: '0.01', price: freeULimitPrice,
  });
  assert('FreeU: createOrder (limit)', freeUOrder.success && freeUOrder.data.orderId);

  if (freeUOrder.success) {
    const foid = freeUOrder.data.orderId;
    await sleep(1000);

    const fmod = await trade.modifyOrder(http, {
      symbol: 'ETHFreeU', orderId: foid, price: String(parseInt(freeULimitPrice) + 50)
    });
    assert('FreeU: modifyOrder', fmod.success);

    const fcancel = await trade.cancelOrder(http, { symbol: 'ETHFreeU', orderId: foid });
    assert('FreeU: cancelOrder', fcancel.success);
    await sleep(500);
  }

  // -- FreeU cancelAllOrders by settleCoin (with confirmBatch) --
  console.log('\nFreeU CancelAll');
  const freeUThrowaway = await trade.createOrder(http, {
    symbol: 'ETHFreeU', side: 'Buy', positionIdx: 1,
    orderType: 'Limit', qty: '0.01', price: freeULimitPrice, timeInForce: 'GoodTillCancel',
  });
  if (freeUThrowaway.success) {
    await sleep(500);
    // Without confirmBatch → should be rejected
    const fcaBlocked = await trade.cancelAllOrders(http, { settleCoin: 'FreeU' });
    assert('FreeU: cancelAllOrders without confirmBatch rejected', !fcaBlocked.success);
    // With confirmBatch → should succeed
    const fca = await trade.cancelAllOrders(http, { settleCoin: 'FreeU', confirmBatch: true });
    assert('FreeU: cancelAllOrders (settleCoin + confirmBatch)', fca.success);
    await sleep(500);
  }

  // -- FreeU Trade Lifecycle --
  console.log('\nFreeU Trade Lifecycle');
  const freeULev = await trade.setLeverage(http, { symbol: 'ETHFreeU', buyLeverage: '10' });
  assert('FreeU: setLeverage', freeULev.success);

  const freeUMarket = await trade.createOrder(http, {
    symbol: 'ETHFreeU', side: 'Buy', positionIdx: 1, orderType: 'Market', qty: '0.03',
  });
  assert('FreeU: market open long', freeUMarket.success);

  if (freeUMarket.success) {
    await sleep(1000);

    const fpos = await account.getPositions(http, { symbol: 'ETHFreeU' });
    const fallPos = [...(fpos.data?.list || []), ...(fpos.data?.separateList || [])];
    const fmyPos = fallPos.find(p => p.positionIdx === 1);
    assert('FreeU: position exists', !!fmyPos);
    assert('FreeU: position normalized (direction)', fmyPos?.direction === 'Long');

    // createTpSl
    if (fmyPos) {
      const ftp = await trade.createTpSl(http, {
        symbol: 'ETHFreeU', positionIdx: 1, tpSlMode: 'Full',
        ...(fmyPos.pzLinkId ? { pzLinkId: fmyPos.pzLinkId } : {}),
        takeProfit: String(Math.floor(parseFloat(freeUPrice) * 1.05)),
        stopLoss: String(Math.floor(parseFloat(freeUPrice) * 0.95)),
      });
      assert('FreeU: createTpSl', ftp.success);
    }

    // partial close
    const fPartialBody = {
      symbol: 'ETHFreeU', side: 'Sell', positionIdx: 1, orderType: 'Market',
      qty: '0.01', reduceOnly: true,
    };
    if (fmyPos?.pzLinkId) fPartialBody.pzLinkId = fmyPos.pzLinkId;
    const fpartial = await trade.createOrder(http, fPartialBody);
    assert('FreeU: partial close', fpartial.success);
    await sleep(500);

    // full close
    const fclose = await trade.closePosition(http, { symbol: 'ETHFreeU', positionIdx: 1 });
    assert('FreeU: closePosition', fclose.success);
    await sleep(500);
  }

  // -- FreeU History --
  console.log('\nFreeU History');
  assert('FreeU: getOpenOrders (settleCoin)',
    (await trade.getOpenOrders(http, { settleCoin: 'FreeU' })).success);
  assert('FreeU: getOrderHistory',
    (await trade.getOrderHistory(http, { symbol: 'ETHFreeU', limit: '1' })).success);
  assert('FreeU: getExecutions',
    (await trade.getExecutions(http, { symbol: 'ETHFreeU', limit: '1' })).success);
  assert('FreeU: getClosedPnl',
    (await trade.getClosedPnl(http, { symbol: 'ETHFreeU', limit: '1' })).success);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
