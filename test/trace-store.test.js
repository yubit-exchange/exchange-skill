'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TraceStore } = require('../lib/trace-store');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Trace store tests\n');

(async () => {
  const filePath = path.join(os.tmpdir(), `exchange-skill-trace-store-${Date.now()}.jsonl`);
  const store = new TraceStore(filePath);

  try {
    const trace1 = store.createTrace('getTicker', { symbol: 'BTCUSDT' });
    await store.runWithTrace(trace1, async () => {
      store.recordHttpCall({
        method: 'GET',
        path: '/oapi/contract/market/public/v1/tickers',
        query: { symbol: 'BTCUSDT' },
        rawExchangeResponse: { code: 0, data: { list: [{ symbol: 'BTCUSDT', lastPrice: '66000' }] } },
      });
    });
    store.finalizeTrace(trace1, {
      success: true,
      data: { list: [{ symbol: 'BTCUSDT', lastPrice: '66000' }] },
      error: null,
      traceId: trace1.traceId,
    });

    const trace2 = store.createTrace('createOrder', {
      symbol: 'BTCUSDT',
      side: 'Sell',
      orderType: 'Market',
      qty: '0.086',
      reduceOnly: true,
      orderLinkId: 'ol_123',
      pzLinkId: 'pz_123',
      positionIdx: 1,
    });
    await store.runWithTrace(trace2, async () => {
      store.recordHttpCall({
        method: 'POST',
        path: '/oapi/contract/trade/private/v1/orders',
        body: {
          symbol: 'BTCUSDT',
          side: 'Sell',
          orderType: 'Market',
          qty: '0.086',
          reduceOnly: true,
          orderLinkId: 'ol_123',
          pzLinkId: 'pz_123',
          positionIdx: 1,
        },
        rawExchangeResponse: { code: 14120005, message: 'Invalid Parameter' },
      });
    });
    store.finalizeTrace(trace2, {
      success: false,
      data: null,
      error: { code: 14120005, message: 'Invalid Parameter' },
      traceId: trace2.traceId,
    });

    const found = store.getTrace(trace2.traceId);
    assert('getTrace by traceId', found && found.traceId === trace2.traceId);
    assert('trace stores HTTP call body', found?.httpCalls?.[0]?.body?.reduceOnly === true);
    assert('trace stores raw exchange response', found?.httpCalls?.[0]?.rawExchangeResponse?.code === 14120005);

    const byTraceId = store.searchTraces({ traceId: trace2.traceId, limit: 5 });
    assert('search by traceId', byTraceId.length === 1 && byTraceId[0].traceId === trace2.traceId);

    const bySymbol = store.searchTraces({ symbol: 'BTCUSDT', limit: 5 });
    assert('search by symbol returns both traces', bySymbol.length === 2, `expected 2, got ${bySymbol.length}`);

    const byTool = store.searchTraces({ toolName: 'createOrder', success: false, limit: 5 });
    assert('search by toolName + success', byTool.length === 1 && byTool[0].toolName === 'createOrder');

    const byOrderLinkId = store.searchTraces({ orderLinkId: 'ol_123', limit: 5 });
    assert('search by orderLinkId', byOrderLinkId.length === 1 && byOrderLinkId[0].orderLinkId === 'ol_123');

    const byTimeRange = store.searchTraces({ fromTs: '2000-01-01T00:00:00.000Z', toTs: '2100-01-01T00:00:00.000Z', limit: 5 });
    assert('search by time range', byTimeRange.length === 2, `expected 2, got ${byTimeRange.length}`);

    const bestEffortStore = new TraceStore(path.join(os.tmpdir(), `exchange-skill-trace-store-best-effort-${Date.now()}.jsonl`));
    const bestEffortTrace = bestEffortStore.createTrace('getTicker', { symbol: 'BTCUSDT' });
    const realAppendTrace = bestEffortStore.appendTrace.bind(bestEffortStore);
    bestEffortStore.appendTrace = () => { throw new Error('disk full'); };
    let finalizeDidThrow = false;
    try {
      bestEffortStore.finalizeTrace(bestEffortTrace, { success: true, data: { list: [] }, error: null, traceId: bestEffortTrace.traceId });
    } catch (_) {
      finalizeDidThrow = true;
    } finally {
      bestEffortStore.appendTrace = realAppendTrace;
    }
    assert('finalizeTrace is best-effort', finalizeDidThrow === false);

    const pruneFilePath = path.join(os.tmpdir(), `exchange-skill-trace-store-prune-${Date.now()}.jsonl`);
    const pruneStore = new TraceStore(pruneFilePath, { ttlDays: 7, maxRecords: 2 });
    const realNow = Date.now;
    let now = Date.parse('2026-04-10T00:00:00.000Z');
    Date.now = () => now;
    try {
      const oldTrace = pruneStore.createTrace('getTicker', { symbol: 'OLDUSDT' });
      oldTrace.ts = '2026-04-01T00:00:00.000Z';
      pruneStore.finalizeTrace(oldTrace, { success: true, data: { list: [{ symbol: 'OLDUSDT' }] }, error: null, traceId: oldTrace.traceId });

      const midTrace = pruneStore.createTrace('getTicker', { symbol: 'MIDUSDT' });
      midTrace.ts = '2026-04-08T00:00:00.000Z';
      pruneStore.finalizeTrace(midTrace, { success: true, data: { list: [{ symbol: 'MIDUSDT' }] }, error: null, traceId: midTrace.traceId });

      const newTrace = pruneStore.createTrace('getTicker', { symbol: 'NEWUSDT' });
      newTrace.ts = '2026-04-09T00:00:00.000Z';
      pruneStore.finalizeTrace(newTrace, { success: true, data: { list: [{ symbol: 'NEWUSDT' }] }, error: null, traceId: newTrace.traceId });

      const newestTrace = pruneStore.createTrace('getTicker', { symbol: 'LATESTUSDT' });
      newestTrace.ts = '2026-04-10T00:00:00.000Z';
      pruneStore.finalizeTrace(newestTrace, { success: true, data: { list: [{ symbol: 'LATESTUSDT' }] }, error: null, traceId: newestTrace.traceId });

      const prunedRows = fs.readFileSync(pruneFilePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert('prune removes traces older than TTL', prunedRows.every(row => row.toolArgs.symbol !== 'OLDUSDT'), JSON.stringify(prunedRows));
      assert('prune keeps at most maxRecords newest traces', prunedRows.length === 2, `expected 2, got ${prunedRows.length}`);
      assert('prune keeps newest traces', prunedRows[0].toolArgs.symbol === 'NEWUSDT' && prunedRows[1].toolArgs.symbol === 'LATESTUSDT', JSON.stringify(prunedRows));
    } finally {
      Date.now = realNow;
      if (fs.existsSync(pruneFilePath)) fs.unlinkSync(pruneFilePath);
    }
  } catch (err) {
    assert('trace store test runner', false, err.message);
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
})().catch((err) => {
  assert('trace store test runner', false, err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
