'use strict';

const HttpClient = require('../lib/http');
const { TraceStore } = require('../lib/trace-store');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('HTTP tests\n');

(async () => {
  try {
    const traceStore = new TraceStore('/tmp/exchange-skill-http-test.jsonl');
    const client = new HttpClient({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      baseUrl: 'https://example.invalid',
      rateLimitMs: 100,
      traceStore,
    });

    let now = 1000;
    const waits = [];
    client._now = () => now;
    client._sleep = async (ms) => { waits.push(ms); };
    client._send = async () => ({ code: 0, data: { ok: true } });

    const trace = traceStore.createTrace('getTicker', { symbol: 'BTCUSDT' });
    await traceStore.runWithTrace(trace, async () => {
      await client.get('/oapi/contract/market/public/v1/tickers', { symbol: 'BTCUSDT' });
      await client.get('/oapi/contract/market/public/v1/tickers', { symbol: 'ETHUSDT' });
    });
    traceStore.finalizeTrace(trace, { success: true, data: { ok: true }, error: null, traceId: trace.traceId });

    assert('first request no wait', trace.httpCalls?.[0]?.rateLimitWaitMs == null);
    assert('second request waited 100ms', trace.httpCalls?.[1]?.rateLimitWaitMs === 100, JSON.stringify(trace.httpCalls));
    assert('sleep invoked once', waits.length === 1 && waits[0] === 100, JSON.stringify(waits));
    assert('trace meta accumulates rateLimitWaitMs', trace.meta?.rateLimitWaitMs === 100, JSON.stringify(trace.meta));
    assert('trace meta accumulates rateLimitWaitEvents', trace.meta?.rateLimitWaitEvents === 1, JSON.stringify(trace.meta));
    assert('search summary exposes rateLimitWaitMs',
      traceStore.searchTraces({ traceId: trace.traceId })[0]?.rateLimitWaitMs === 100);
  } catch (err) {
    assert('http test runner', false, err.message);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('http test runner', false, err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
