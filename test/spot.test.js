'use strict';

const spot = require('../tools/spot');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Spot tests\n');

function makeMockHttp(capture) {
  return {
    async get(path, params, options) {
      capture.path = path;
      capture.params = params;
      capture.options = options;
      return {
        code: 0,
        data: [
          { tokenId: 'BTC', total: '0.00305694', free: '0.00305694', locked: '0' },
          { tokenId: 'USDT', total: '823.0691442', free: '823.0691442', locked: '0' },
        ],
      };
    },
  };
}

(async () => {
  try {
    const capture = {};
    const res = await spot.getBalance(makeMockHttp(capture));
    assert('spotGetBalance → success', res.success === true, JSON.stringify(res));
    assert('spotGetBalance path', capture.path === '/oapi/spot/private/v1/asset/get', capture.path);
    assert('spotGetBalance params empty', Object.keys(capture.params || {}).length === 0, JSON.stringify(capture.params));
    assert('spotGetBalance uses private-path auth by default', capture.options === undefined, JSON.stringify(capture.options));
    assert('spotGetBalance returns list', Array.isArray(res.data), JSON.stringify(res.data));
    assert('spotGetBalance returns BTC item', res.data?.[0]?.tokenId === 'BTC', JSON.stringify(res.data));
  } catch (err) {
    assert('spot test runner', false, err.stack || err.message);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('spot test runner', false, err.stack || err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
