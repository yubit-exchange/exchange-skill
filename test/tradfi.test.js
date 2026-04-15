'use strict';

const tradfi = require('../tools/tradfi');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('TradFi tests\n');

function makeMockHttp(capture) {
  return {
    async get(path, params, options) {
      capture.path = path;
      capture.params = params;
      capture.options = options;
      return {
        code: 0,
        data: {
          login: 123452202,
          balance: '0',
          equity: '0',
          margin: '0',
          margin_free: '0',
        },
      };
    },
  };
}

(async () => {
  try {
    const capture = {};
    const res = await tradfi.getBalance(makeMockHttp(capture));
    assert('tradfiGetBalance → success', res.success === true, JSON.stringify(res));
    assert('tradfiGetBalance path', capture.path === '/oapi/tradfi/trade/api/v1/user/account/detail', capture.path);
    assert('tradfiGetBalance params empty', Object.keys(capture.params || {}).length === 0, JSON.stringify(capture.params));
    assert('tradfiGetBalance options.sign === true', capture.options?.sign === true, JSON.stringify(capture.options));
    assert('tradfiGetBalance returns object', res.data?.login === 123452202, JSON.stringify(res.data));
  } catch (err) {
    assert('tradfi test runner', false, err.stack || err.message);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('tradfi test runner', false, err.stack || err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
