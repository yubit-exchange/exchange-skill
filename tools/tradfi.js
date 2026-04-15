'use strict';

const { wrapResponse } = require('../lib/normalize');

const PATHS = {
  balance: '/oapi/tradfi/trade/api/v1/user/account/detail',
};

async function getBalance(http) {
  return wrapResponse(await http.get(PATHS.balance, {}, { sign: true }));
}

module.exports = { getBalance };
