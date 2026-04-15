'use strict';

const { loadInstruments, clearCache, validateTpSl, validateAdvancedTpSl, INSTRUMENTS_CACHE_TTL_MS } = require('../lib/validate');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Validate tests\n');

// Long TP/SL
assert('Long TP above mark → pass', validateTpSl({ positionIdx: 1, takeProfit: '70000', markPrice: '68000' }).valid);
assert('Long TP below mark → reject', !validateTpSl({ positionIdx: 1, takeProfit: '66000', markPrice: '68000' }).valid);
assert('Long SL below mark → pass', validateTpSl({ positionIdx: 1, stopLoss: '65000', markPrice: '68000' }).valid);
assert('Long SL above mark → reject', !validateTpSl({ positionIdx: 1, stopLoss: '70000', markPrice: '68000' }).valid);

// Short TP/SL
assert('Short TP below mark → pass', validateTpSl({ positionIdx: 2, takeProfit: '65000', markPrice: '68000' }).valid);
assert('Short TP above mark → reject', !validateTpSl({ positionIdx: 2, takeProfit: '70000', markPrice: '68000' }).valid);
assert('Short SL above mark → pass', validateTpSl({ positionIdx: 2, stopLoss: '70000', markPrice: '68000' }).valid);
assert('Short SL below mark → reject', !validateTpSl({ positionIdx: 2, stopLoss: '65000', markPrice: '68000' }).valid);

// No mark price → skip
assert('No mark price → skip', validateTpSl({ positionIdx: 1, takeProfit: '10', markPrice: null }).valid);

// Advanced TP/SL validation
assert('adv tpsl: Limit TP without price → reject', !validateAdvancedTpSl({ tpOrderType: 'Limit' }).valid);
assert('adv tpsl: Limit SL without price → reject', !validateAdvancedTpSl({ slOrderType: 'Limit' }).valid);
assert('adv tpsl: tpLimitPrice without Limit type → reject', !validateAdvancedTpSl({ tpLimitPrice: '80000' }).valid);
assert('adv tpsl: slLimitPrice without Limit type → reject', !validateAdvancedTpSl({ slLimitPrice: '55000' }).valid);
assert('adv tpsl: valid Limit TP → pass', validateAdvancedTpSl({ tpOrderType: 'Limit', tpLimitPrice: '80000' }).valid);
assert('adv tpsl: no advanced fields → pass', validateAdvancedTpSl({}).valid);

// Instruments cache TTL
(async () => {
  clearCache();
  let calls = 0;
  const http = {
    async get() {
      calls++;
      return {
        code: 0,
        data: {
          list: [
            {
              symbol: 'BTCUSDT',
              lotSizeFilter: { minTradingQty: '0.001', maxTradingQty: '100', qtyStep: '0.001' },
              priceFilter: { minPrice: '1', maxPrice: '1000000' },
              leverageFilter: { minLeverage: '1', maxLeverage: '125' },
            },
          ],
        },
      };
    },
  };
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    await loadInstruments(http);
    await loadInstruments(http);
    assert('Instruments cache hit within TTL', calls === 1, `expected 1 fetch, got ${calls}`);

    now += INSTRUMENTS_CACHE_TTL_MS + 1;
    await loadInstruments(http);
    assert('Instruments cache refresh after TTL', calls === 2, `expected 2 fetches, got ${calls}`);
  } catch (err) {
    assert('Instruments cache TTL tests', false, err.message);
  } finally {
    Date.now = realNow;
    clearCache();
    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
})().catch((err) => {
  assert('Validate test runner', false, err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
