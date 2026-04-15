'use strict';

const https = require('https');
const { signGet, signPost } = require('./signer');

const SIGNED_PATHS = new Set([
  '/oapi/asset/fund/public/v1/wallet/get-wallet-assets',
  '/oapi/asset/fund/public/v1/wallet/get-all-wallet-balance',
  '/oapi/asset/fund/public/v1/wallet/transfer',
  '/oapi/tradfi/trade/api/v1/user/account/detail',
  '/oapi/perfi/trade/api/v1/accounts',
]);

class HttpClient {
  constructor({ apiKey, apiSecret, baseUrl, tlsReject, debugStore, traceStore, rateLimitMs }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = baseUrl;
    this.debugStore = traceStore || debugStore || null;
    this.rateLimitMs = this._parseRateLimitMs(rateLimitMs);
    this._nextRequestAt = 0;
    const rejectUnauthorized = tlsReject !== false;
    if (!rejectUnauthorized) {
      process.stderr.write('WARNING: TLS certificate verification disabled. Do NOT use in production.\n');
    }
    this.agent = new https.Agent({ rejectUnauthorized });
  }

  async request(method, path, params = {}, options = {}) {
    let url = this.baseUrl + path;
    let body = null;
    const headers = { 'Content-Type': 'application/json' };
    const isPrivate = path.includes('/private/') || options.sign === true || SIGNED_PATHS.has(path);
    const startedAt = Date.now();
    const rateLimitWaitMs = await this._throttle();
    const debugCall = {
      method,
      path,
      rateLimitWaitMs: rateLimitWaitMs || undefined,
      query: method === 'GET' && Object.keys(params).length > 0 ? params : null,
      body: method === 'POST' && Object.keys(params).length > 0 ? params : null,
    };

    if (method === 'GET') {
      const hasParams = Object.keys(params).length > 0;
      if (hasParams) {
        if (isPrivate) {
          const { timestamp, recvWindow, signature, payload } = signGet(this.apiKey, this.apiSecret, params);
          url += '?' + payload;
          this._setAuthHeaders(headers, timestamp, recvWindow, signature);
        } else {
          const sorted = Object.keys(params).sort();
          url += '?' + sorted.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
        }
      } else if (isPrivate) {
        const { timestamp, recvWindow, signature } = signGet(this.apiKey, this.apiSecret, {});
        this._setAuthHeaders(headers, timestamp, recvWindow, signature);
      }
    } else if (method === 'POST') {
      if (isPrivate) {
        const { timestamp, recvWindow, signature, payload } = signPost(this.apiKey, this.apiSecret, params);
        body = payload;
        this._setAuthHeaders(headers, timestamp, recvWindow, signature);
      } else {
        body = JSON.stringify(params);
      }
    }

    try {
      const raw = await this._send(method, url, headers, body);
      if (this.debugStore) {
        this.debugStore.recordHttpCall({
          ...debugCall,
          durationMs: Date.now() - startedAt,
          rawExchangeResponse: raw,
        });
      }
      return raw;
    } catch (err) {
      if (this.debugStore) {
        this.debugStore.recordHttpCall({
          ...debugCall,
          durationMs: Date.now() - startedAt,
          transportError: err.message,
        });
      }
      throw err;
    }
  }

  _setAuthHeaders(headers, timestamp, recvWindow, signature) {
    headers['MF-ACCESS-API-KEY'] = this.apiKey;
    headers['MF-ACCESS-TIMESTAMP'] = timestamp;
    headers['MF-ACCESS-RECV-WINDOW'] = recvWindow;
    headers['MF-ACCESS-SIGN'] = signature;
  }

  _parseRateLimitMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 100;
    return Math.floor(n);
  }

  _now() {
    return Date.now();
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async _throttle() {
    if (this.rateLimitMs <= 0) return 0;
    const now = this._now();
    const waitMs = Math.max(0, this._nextRequestAt - now);
    const slotStart = now + waitMs;
    this._nextRequestAt = slotStart + this.rateLimitMs;
    if (waitMs > 0) {
      if (this.debugStore) {
        this.debugStore.recordMetric('rateLimitWaitMs', waitMs);
        this.debugStore.recordMetric('rateLimitWaitEvents', 1);
      }
      await this._sleep(waitMs);
    }
    return waitMs;
  }

  _send(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request({
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        agent: this.agent,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 200)}`)); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
      if (body) req.write(body);
      req.end();
    });
  }

  async get(path, params = {}, options = {}) { return this.request('GET', path, params, options); }
  async post(path, params = {}, options = {}) { return this.request('POST', path, params, options); }
}

module.exports = HttpClient;
