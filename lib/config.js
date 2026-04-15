'use strict';

const path = require('path');
const fs = require('fs');

const HOME_CONFIG = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.exchange-skill', 'config.json');
const LOCAL_CONFIG = path.join(process.cwd(), 'config.json');

function loadConfig(overrides = {}) {
  let fileConfig = {};
  const configPath = fs.existsSync(LOCAL_CONFIG) ? LOCAL_CONFIG : HOME_CONFIG;
  try {
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (_) { /* ignore */ }

  return {
    apiKey: overrides.apiKey || process.env.EXCHANGE_API_KEY || fileConfig.apiKey || '',
    apiSecret: overrides.apiSecret || process.env.EXCHANGE_API_SECRET || fileConfig.apiSecret || '',
    baseUrl: (overrides.baseUrl || process.env.EXCHANGE_BASE_URL || fileConfig.baseUrl || '').replace(/\/$/, ''),
    tlsReject: overrides.tlsReject ?? (process.env.EXCHANGE_TLS_REJECT !== 'false'),
    recvWindow: overrides.recvWindow || process.env.EXCHANGE_RECV_WINDOW || fileConfig.recvWindow || '5000',
    rateLimitMs: overrides.rateLimitMs || process.env.EXCHANGE_RATE_LIMIT_MS || fileConfig.rateLimitMs || '100',
  };
}

module.exports = { loadConfig, HOME_CONFIG, LOCAL_CONFIG };
