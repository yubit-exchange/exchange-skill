'use strict';

const { wrapResponse } = require('../lib/normalize');

const PATHS = {
  balance: '/oapi/perfi/trade/api/v1/accounts',
};

async function getBalance(http) {
  return wrapResponse(await http.get(PATHS.balance, {}, { sign: true }));
}

module.exports = { getBalance };
