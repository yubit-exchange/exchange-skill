'use strict';

const { signGet, signPost, generateOrderLinkId } = require('../lib/signer');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Signer tests\n');

const getResult = signGet('testKey', 'testSecret', { symbol: 'BTCUSDT', depth: '50' });
assert('GET params sorted alphabetically', getResult.payload === 'depth=50&symbol=BTCUSDT', getResult.payload);
assert('GET timestamp is 13 digits', /^\d{13}$/.test(getResult.timestamp));
assert('GET signature is 64-char hex', /^[a-f0-9]{64}$/.test(getResult.signature));

const postResult = signPost('testKey', 'testSecret', { symbol: 'BTCUSDT', side: 'Buy' });
assert('POST payload is JSON', postResult.payload === '{"symbol":"BTCUSDT","side":"Buy"}', postResult.payload);
assert('POST signature is 64-char hex', /^[a-f0-9]{64}$/.test(postResult.signature));

const id1 = generateOrderLinkId();
const id2 = generateOrderLinkId();
assert('orderLinkId format valid', /^sk_\d{13}_[a-f0-9]{6}$/.test(id1), id1);
assert('orderLinkId is unique', id1 !== id2, `${id1} vs ${id2}`);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
