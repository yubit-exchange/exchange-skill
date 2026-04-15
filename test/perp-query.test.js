'use strict';

const perpQuery = require('../tools/perp-query');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

console.log('Perp query tests\n');

function makeMockHttp(capture) {
  return {
    async get(path, params) {
      capture.path = path;
      capture.params = params;
      return {
        code: 0,
        data: {
          list: [
            {
              id: '123',
              coin: 5,
              coinName: 'USDT',
              type: 'FLOW_TYPE_TRANSFER_IN_FROM_FUNDING',
              extWrType: 111,
              amountE8: '1000000',
              symbol: '',
              execTimeE0: '1776157382',
            },
          ],
          nextPageCursor: 'cursor-1',
        },
      };
    },
  };
}

(async () => {
  try {
    const capture = {};
    const res = await perpQuery.getWalletFlowRecords(makeMockHttp(capture), {
      coin: 'USDT',
      startTime: '1770000000',
      endTime: '1770086400',
      limit: 50,
      fundType: 4,
      cursor: 'abc',
      sort: 'desc',
      contractType: 'linear',
      includeFreeU: false,
    });
    assert('perpGetWalletFlowRecords → success', res.success === true, JSON.stringify(res));
    assert('perpGetWalletFlowRecords path', capture.path === '/oapi/contract/trade/private/v1/wallet-flow-records', capture.path);
    assert('perpGetWalletFlowRecords coin', capture.params?.coin === 'USDT', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords startTime in seconds', capture.params?.startTime === '1770000000', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords endTime in seconds', capture.params?.endTime === '1770086400', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords limit stringified', capture.params?.limit === '50', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords fundType stringified', capture.params?.fundType === '4', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords cursor', capture.params?.cursor === 'abc', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords sort normalized', capture.params?.sort === 'DESC', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords contractType omitted from request', !('contractType' in (capture.params || {})), JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords includeFreeU normalized', capture.params?.includeFreeU === 'false', JSON.stringify(capture.params));
    assert('perpGetWalletFlowRecords list returned', Array.isArray(res.data?.list), JSON.stringify(res.data));
    assert('perpGetWalletFlowRecords nextPageCursor returned', res.data?.nextPageCursor === 'cursor-1', JSON.stringify(res.data));
    assert('perpGetWalletFlowRecords execTimeE0 formatted',
      typeof res.data?.list?.[0]?.execTimeE0 === 'string' && res.data.list[0].execTimeE0.includes('-'),
      JSON.stringify(res.data?.list?.[0]));

    const badRange = await perpQuery.getWalletFlowRecords(makeMockHttp({}), {
      startTime: '1770086400',
      endTime: '1770000000',
    });
    assert('perpGetWalletFlowRecords invalid time range → reject',
      !badRange.success && badRange.error?.message.includes('endTime must be greater'),
      JSON.stringify(badRange));

    const badLimit = await perpQuery.getWalletFlowRecords(makeMockHttp({}), { limit: 101 });
    assert('perpGetWalletFlowRecords limit > 100 → reject',
      !badLimit.success && badLimit.error?.message.includes('between 1 and 100'),
      JSON.stringify(badLimit));

    const badFundType = await perpQuery.getWalletFlowRecords(makeMockHttp({}), { fundType: 'abc' });
    assert('perpGetWalletFlowRecords invalid fundType → reject',
      !badFundType.success && badFundType.error?.message.includes('fundType'),
      JSON.stringify(badFundType));

    const badSort = await perpQuery.getWalletFlowRecords(makeMockHttp({}), { sort: 'ASC' });
    assert('perpGetWalletFlowRecords invalid sort → reject',
      !badSort.success && badSort.error?.message.includes('DESC'),
      JSON.stringify(badSort));

    const badContractType = await perpQuery.getWalletFlowRecords(makeMockHttp({}), { contractType: 'inverse' });
    assert('perpGetWalletFlowRecords invalid contractType → reject',
      !badContractType.success && badContractType.error?.message.includes('linear'),
      JSON.stringify(badContractType));

    const badIncludeFreeU = await perpQuery.getWalletFlowRecords(makeMockHttp({}), { includeFreeU: 'maybe' });
    assert('perpGetWalletFlowRecords invalid includeFreeU → reject',
      !badIncludeFreeU.success && badIncludeFreeU.error?.message.includes('true or false'),
      JSON.stringify(badIncludeFreeU));
  } catch (err) {
    assert('perp query test runner', false, err.stack || err.message);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  assert('perp query test runner', false, err.stack || err.message);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
