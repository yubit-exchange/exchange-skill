'use strict';

const { wrapResponse } = require('../lib/normalize');

const PATHS = {
  balance: '/oapi/spot/private/v1/asset/get',
};

async function getBalance(http) {
  return wrapResponse(await http.get(PATHS.balance, {}));
}

module.exports = { getBalance };
