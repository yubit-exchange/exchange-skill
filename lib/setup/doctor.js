'use strict';

const { execSync } = require('child_process');
const https = require('https');
const { load, redact, CONFIG_PATH } = require('./credential');
const { CLIENTS } = require('./clients');

function checkLine(label, value, status) {
  const pad = label.padEnd(14);
  const valPad = (value || '').padEnd(20);
  process.stderr.write(`  ${pad} ${valPad} ${status}\n`);
}

async function httpCheck(url, label, tlsReject) {
  return new Promise(resolve => {
    const start = Date.now();
    const req = https.get(url, { rejectUnauthorized: tlsReject !== false, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const ms = Date.now() - start;
        try {
          const json = JSON.parse(data);
          if (json.code === 0) { checkLine(label, `${ms}ms`, 'OK'); resolve(true); }
          else { checkLine(label, `code=${json.code}`, 'FAIL'); resolve(false); }
        } catch { checkLine(label, `${ms}ms`, 'FAIL (parse)'); resolve(false); }
      });
    });
    req.on('error', (e) => { checkLine(label, e.code || e.message, 'FAIL'); resolve(false); });
    req.on('timeout', () => { req.destroy(); checkLine(label, 'timeout', 'FAIL'); resolve(false); });
  });
}

async function run(opts = {}) {
  process.stderr.write('\n');

  // Node.js
  checkLine('Node.js', process.version, parseInt(process.version.slice(1)) >= 19 ? 'OK' : 'FAIL (>=19 required)');

  // npm
  try {
    const npmVer = execSync('npm --version', { stdio: 'pipe' }).toString().trim();
    checkLine('npm', `v${npmVer}`, 'OK');
  } catch { checkLine('npm', '', 'FAIL (not found)'); }

  // Config
  const cfg = load();
  if (cfg) {
    checkLine('Config', CONFIG_PATH, 'OK');
    checkLine('API Key', redact(cfg.apiKey), cfg.apiKey ? 'OK' : 'MISSING');
  } else {
    checkLine('Config', CONFIG_PATH, 'NOT FOUND');
    process.stderr.write('\n');
    return;
  }

  // Public API
  const baseUrl = cfg.baseUrl;
  if (!baseUrl) {
    checkLine('Base URL', '(not set)', 'MISSING');
    return;
  }
  const tlsReject = cfg.tlsReject !== false;
  await httpCheck(`${baseUrl}/oapi/contract/market/public/v1/tickers?symbol=BTCUSDT`, 'Public API', tlsReject);

  // Private API (only if credentials exist)
  if (cfg.apiKey && cfg.apiSecret) {
    const HttpClient = require('../http');
    try {
      const http = new HttpClient({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, baseUrl, tlsReject });
      const start = Date.now();
      const res = await http.get('/oapi/contract/trade/private/v1/wallet-balances', {});
      const ms = Date.now() - start;
      if (res.code === 0) checkLine('Private API', `${ms}ms`, 'OK');
      else checkLine('Private API', `code=${res.code}`, 'FAIL');
    } catch (e) { checkLine('Private API', e.message.slice(0, 20), 'FAIL'); }
  }

  // Client status
  for (const [id, client] of Object.entries(CLIENTS)) {
    if (client.detect()) {
      const st = client.status(opts);
      const ok = st.includes('registered') || st.includes('exists');
      checkLine(client.name, st, ok ? 'OK' : 'NOT CONFIGURED');
    }
  }

  process.stderr.write('\n');
}

module.exports = { run };
