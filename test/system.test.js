'use strict';

const diagnostics = require('../tools/diagnostics');
const { buildCapabilitySnapshot } = require('../lib/capabilities');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('System tests\n');

(async () => {
  try {
    const sampleTools = [
      { name: 'getTicker', description: 'ticker desc' },
      { name: 'getCapabilities', description: 'caps desc' },
      { name: 'spotGetBalance', description: 'spot desc' },
      { name: 'tradfiGetBalance', description: 'tradfi desc' },
      { name: 'earnGetBalance', description: 'earn desc' },
      { name: 'perpGetBalance', description: 'balance desc' },
      { name: 'perpGetWalletFlowRecords', description: 'wallet flow desc' },
      { name: 'fundGetAssets', description: 'wallet desc' },
      { name: 'perpCreateOrder', description: 'order desc' },
      { name: 'perpAddToPosition', description: 'safe add desc' },
    ];

    const marketOnly = buildCapabilitySnapshot({ hasAuth: false, canTrade: false, toolCount: 10, tools: sampleTools });
    assert('market-only modules', JSON.stringify(marketOnly.modules) === JSON.stringify(['market', 'diagnostics']), JSON.stringify(marketOnly));
    assert('market-only toolCount', marketOnly.toolCount === 10);
    assert('market-only tool includes zh description',
      marketOnly.tools.find((tool) => tool.name === 'getTicker')?.descriptionZh?.length > 0,
      JSON.stringify(marketOnly.tools));

    const authOnly = buildCapabilitySnapshot({ hasAuth: true, canTrade: false, toolCount: 20, tools: sampleTools });
    assert('auth-only modules', JSON.stringify(authOnly.modules) === JSON.stringify(['market', 'wallet', 'spot', 'tradfi', 'earn', 'perp', 'diagnostics']), JSON.stringify(authOnly));
    assert('auth-only moduleDetails include spot',
      authOnly.moduleDetails.some((module) => module.name === 'spot'),
      JSON.stringify(authOnly.moduleDetails));
    assert('auth-only moduleDetails include tradfi',
      authOnly.moduleDetails.some((module) => module.name === 'tradfi'),
      JSON.stringify(authOnly.moduleDetails));
    assert('auth-only moduleDetails include earn',
      authOnly.moduleDetails.some((module) => module.name === 'earn'),
      JSON.stringify(authOnly.moduleDetails));
    assert('auth-only tool includes perp wallet flow records',
      authOnly.tools.some((tool) => tool.name === 'perpGetWalletFlowRecords' && tool.module === 'perp'),
      JSON.stringify(authOnly.tools));

    const tradeEnabled = buildCapabilitySnapshot({ hasAuth: true, canTrade: true, toolCount: 30, tools: sampleTools });
    assert('trade-enabled modules',
      JSON.stringify(tradeEnabled.modules) === JSON.stringify(['market', 'wallet', 'spot', 'tradfi', 'earn', 'perp', 'diagnostics']),
      JSON.stringify(tradeEnabled));
    assert('moduleDetails include diagnostics',
      tradeEnabled.moduleDetails.some((module) => module.name === 'diagnostics'),
      JSON.stringify(tradeEnabled.moduleDetails));

    const res = await diagnostics.getCapabilities(tradeEnabled);
    assert('getCapabilities success', res.success === true);
    assert('getCapabilities returns snapshot', res.data?.canTrade === true && res.data?.toolCount === 30, JSON.stringify(res));
  } catch (err) {
    assert('system test runner', false, err.message);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('system test runner', false, err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
