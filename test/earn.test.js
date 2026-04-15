'use strict';

const earn = require('../tools/earn');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Earn tests\n');

function makeMockHttp(capture) {
  return {
    async get(path, params, options) {
      capture.path = path;
      capture.params = params;
      capture.options = options;
      return {
        code: 0,
        data: {
          list: [{ symbol: 'USDT', balance: 0, equity: 0, total_swap: 5, yesterday_swap: 0 }],
          total: 1,
        },
      };
    },
  };
}

(async () => {
  try {
    const capture = {};
    const res = await earn.getBalance(makeMockHttp(capture));
    assert('earnGetBalance → success', res.success === true, JSON.stringify(res));
    assert('earnGetBalance path', capture.path === '/oapi/perfi/trade/api/v1/accounts', capture.path);
    assert('earnGetBalance params empty', Object.keys(capture.params || {}).length === 0, JSON.stringify(capture.params));
    assert('earnGetBalance options.sign === true', capture.options?.sign === true, JSON.stringify(capture.options));
    assert('earnGetBalance returns list', Array.isArray(res.data?.list), JSON.stringify(res.data));
    assert('earnGetBalance returns total', res.data?.total === 1, JSON.stringify(res.data));
  } catch (err) {
    assert('earn test runner', false, err.stack || err.message);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('earn test runner', false, err.stack || err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
