'use strict';

const asset = require('../tools/wallet');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Asset tests\n');

// Mock http that captures the sign option
function makeMockHttp(capture) {
  return {
    async get(path, params, options) {
      capture.path = path;
      capture.params = params;
      capture.options = options;
      return { code: 0, data: { list: [{ coin: 'USDT', total_equity: '100' }] } };
    },
    async post(path, body, options) {
      capture.path = path;
      capture.body = body;
      capture.options = options;
      return { code: 0, data: {} };
    },
  };
}

(async () => {
  // getWalletAssets calls correct path
  const cap1 = {};
  const res1 = await asset.getWalletAssets(makeMockHttp(cap1));
  assert('getWalletAssets → success', res1.success);
  assert('getWalletAssets path', cap1.path === '/oapi/asset/fund/public/v1/wallet/get-wallet-assets');

  // getWalletAssets passes sign: true (critical: public path but needs auth)
  assert('getWalletAssets options.sign === true', cap1.options?.sign === true);

  // getWalletAssets sends empty params (no coin filter)
  assert('getWalletAssets params empty', Object.keys(cap1.params).length === 0);

  // getWalletAssets returns data from response
  assert('getWalletAssets data.list exists', Array.isArray(res1.data?.list));
  assert('getWalletAssets data.list[0].coin === USDT', res1.data?.list?.[0]?.coin === 'USDT');

  // --- getAllWalletBalance ---
  const cap4 = {};
  const res4 = await asset.getAllWalletBalance(makeMockHttp(cap4));
  assert('getAllWalletBalance → success', res4.success);
  assert('getAllWalletBalance path', cap4.path === '/oapi/asset/fund/public/v1/wallet/get-all-wallet-balance');
  assert('getAllWalletBalance options.sign === true', cap4.options?.sign === true);

  // --- transfer validation ---
  const mockHttp = makeMockHttp({});
  const t1 = await asset.transfer(mockHttp, {});
  assert('transfer missing coin → reject', !t1.success && t1.error.message.includes('coin'));

  const t2 = await asset.transfer(mockHttp, { coin: 'USDT' });
  assert('transfer missing amount → reject', !t2.success && t2.error.message.includes('amount'));

  const t3 = await asset.transfer(mockHttp, { coin: 'USDT', amount: '0' });
  assert('transfer amount=0 → reject', !t3.success && t3.error.message.includes('positive'));

  const t4 = await asset.transfer(mockHttp, { coin: 'USDT', amount: '-5' });
  assert('transfer negative amount → reject', !t4.success && t4.error.message.includes('positive'));

  const t5 = await asset.transfer(mockHttp, { coin: 'USDT', amount: 'abc' });
  assert('transfer amount=abc → reject', !t5.success && t5.error.message.includes('positive'));

  const t6 = await asset.transfer(mockHttp, { coin: 'USDT', amount: '10', fromWallet: 'FUNDING' });
  assert('transfer missing toWallet → reject', !t6.success && t6.error.message.includes('toWallet'));

  const t7 = await asset.transfer(mockHttp, { coin: 'USDT', amount: '10', fromWallet: 'BAD', toWallet: 'TRADING' });
  assert('transfer invalid fromWallet → reject', !t7.success && t7.error.message.includes('Invalid'));

  const t8 = await asset.transfer(mockHttp, { coin: 'USDT', amount: '10', fromWallet: 'FUNDING', toWallet: 'FUNDING' });
  assert('transfer same wallet → reject', !t8.success && t8.error.message.includes('different'));

  // transfer valid call
  const capT = {};
  const t9 = await asset.transfer(makeMockHttp(capT), { coin: 'USDT', amount: '10', fromWallet: 'FUNDING', toWallet: 'TRADING' });
  assert('transfer valid → success', t9.success);
  assert('transfer body.coin === USDT', capT.body?.coin === 'USDT');
  assert('transfer body.amount === "10"', capT.body?.amount === '10');
  assert('transfer body.from_wallet === FUNDING', capT.body?.from_wallet === 'FUNDING');
  assert('transfer body.to_wallet === TRADING', capT.body?.to_wallet === 'TRADING');
  assert('transfer options.sign === true', capT.options?.sign === true);

  // transfer case insensitive
  const capT2 = {};
  const t10 = await asset.transfer(makeMockHttp(capT2), { coin: 'BTC', amount: '1', fromWallet: 'funding', toWallet: 'spot' });
  assert('transfer lowercase → success', t10.success);
  assert('transfer lowercase → body.from_wallet === FUNDING', capT2.body?.from_wallet === 'FUNDING');
  assert('transfer lowercase → body.to_wallet === SPOT', capT2.body?.to_wallet === 'SPOT');

  // Verified wallet-pair matrix (real smoke uses only reversible paths)
  const verifiedPairs = [
    ['FUNDING', 'TRADING'],
    ['TRADING', 'FUNDING'],
    ['FUNDING', 'SPOT'],
    ['SPOT', 'FUNDING'],
    ['TRADING', 'SPOT'],
    ['SPOT', 'TRADING'],
  ];
  for (const [fromWallet, toWallet] of verifiedPairs) {
    const cap = {};
    const res = await asset.transfer(makeMockHttp(cap), {
      coin: 'USDT',
      amount: '0.01',
      fromWallet,
      toWallet,
    });
    assert(`transfer matrix ${fromWallet}->${toWallet} → success`, res.success);
    assert(`transfer matrix ${fromWallet}->${toWallet} → from_wallet`, cap.body?.from_wallet === fromWallet);
    assert(`transfer matrix ${fromWallet}->${toWallet} → to_wallet`, cap.body?.to_wallet === toWallet);
    assert(`transfer matrix ${fromWallet}->${toWallet} → sign`, cap.options?.sign === true);
  }

  // ---- Real HttpClient: verify options.sign triggers auth headers on /public/ path ----
  const http = require('http');
  const HttpClient = require('../lib/http');

  // Spin up a local HTTP server to capture headers from real HttpClient
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      code: 0,
      data: { headers: req.headers, url: req.url },
    }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const client = new HttpClient({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    baseUrl: `http://127.0.0.1:${port}`,
    tlsReject: true,
  });
  // Monkey-patch _send to use http instead of https for local test
  client._send = (method, url, headers, body) => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = http.request({
        hostname: urlObj.hostname, port: urlObj.port,
        path: urlObj.pathname + urlObj.search, method, headers,
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  };

  // GET /public/ path WITHOUT sign → no auth headers
  const r1 = await client.get('/oapi/asset/fund/public/v1/test', { foo: 'bar' });
  assert('GET /public/ without sign → no MF-ACCESS-SIGN header',
    !r1.data.headers['mf-access-sign']);

  // GET /public/ path WITH sign → auth headers present
  const r2 = await client.get('/oapi/asset/fund/public/v1/test', { foo: 'bar' }, { sign: true });
  assert('GET /public/ with sign → MF-ACCESS-SIGN header present',
    !!r2.data.headers['mf-access-sign']);
  assert('GET /public/ with sign → MF-ACCESS-API-KEY === test-key',
    r2.data.headers['mf-access-api-key'] === 'test-key');
  assert('GET /public/ with sign → MF-ACCESS-TIMESTAMP present',
    !!r2.data.headers['mf-access-timestamp']);

  // POST /public/ path WITH sign → auth headers present
  const r3 = await client.post('/oapi/asset/fund/public/v1/test', { bar: 'baz' }, { sign: true });
  assert('POST /public/ with sign → MF-ACCESS-SIGN header present',
    !!r3.data.headers['mf-access-sign']);

  // GET /private/ path → auth headers present (existing behavior, regression check)
  const r4 = await client.get('/oapi/contract/trade/private/v1/test', {});
  assert('GET /private/ → MF-ACCESS-SIGN header present (regression)',
    !!r4.data.headers['mf-access-sign']);

  // GET special non-/private/ path → auth headers present (TradFi/Perfi exceptions)
  const r5 = await client.get('/oapi/tradfi/trade/api/v1/user/account/detail', {});
  assert('GET tradfi non-/private/ path → MF-ACCESS-SIGN header present',
    !!r5.data.headers['mf-access-sign']);

  const r6 = await client.get('/oapi/perfi/trade/api/v1/accounts', {});
  assert('GET perfi non-/private/ path → MF-ACCESS-SIGN header present',
    !!r6.data.headers['mf-access-sign']);

  server.close();

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
