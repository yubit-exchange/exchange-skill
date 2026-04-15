'use strict';

const { wrapResponse } = require('../lib/normalize');

const PATHS = {
  walletAssets:     '/oapi/asset/fund/public/v1/wallet/get-wallet-assets',
  allWalletBalance: '/oapi/asset/fund/public/v1/wallet/get-all-wallet-balance',
  transfer:         '/oapi/asset/fund/public/v1/wallet/transfer',
};

const VALID_WALLET_TYPES = ['FUNDING', 'TRADING', 'SPOT', 'TRADFI'];

function fail(message) {
  return { success: false, data: null, error: { code: -1, message } };
}

async function getWalletAssets(http) {
  return wrapResponse(await http.get(PATHS.walletAssets, {}, { sign: true }));
}

async function getAllWalletBalance(http) {
  return wrapResponse(await http.get(PATHS.allWalletBalance, {}, { sign: true }));
}

async function transfer(http, { coin, amount, fromWallet, toWallet }) {
  if (!coin) return fail('coin is required (e.g. USDT, BTC)');
  if (!amount) return fail('amount is required');
  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return fail('amount must be a positive number');
  if (!fromWallet) return fail('fromWallet is required (FUNDING, TRADING, SPOT, TRADFI)');
  if (!toWallet) return fail('toWallet is required (FUNDING, TRADING, SPOT, TRADFI)');
  const from = fromWallet.toUpperCase();
  const to = toWallet.toUpperCase();
  if (!VALID_WALLET_TYPES.includes(from)) return fail(`Invalid fromWallet: ${fromWallet}. Must be one of: ${VALID_WALLET_TYPES.join(', ')}`);
  if (!VALID_WALLET_TYPES.includes(to)) return fail(`Invalid toWallet: ${toWallet}. Must be one of: ${VALID_WALLET_TYPES.join(', ')}`);
  if (from === to) return fail('fromWallet and toWallet must be different');

  const body = { coin, amount: String(amount), from_wallet: from, to_wallet: to };
  return wrapResponse(await http.post(PATHS.transfer, body, { sign: true }));
}

module.exports = { getWalletAssets, getAllWalletBalance, transfer };
