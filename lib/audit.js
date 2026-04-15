'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_PATH = path.join(__dirname, '..', '.data', 'audit.log');
const REDACTED_KEYS = ['apiKey', 'apiSecret', 'signature', 'headers'];

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value
      .replace(/MF-ACCESS-SIGN["']?\s*:\s*["'][^"']+/gi, 'MF-ACCESS-SIGN:[REDACTED]')
      .replace(/MF-ACCESS-API-KEY["']?\s*:\s*["'][^"']+/gi, 'MF-ACCESS-API-KEY:[REDACTED]')
      .replace(/apiSecret["']?\s*:\s*["'][^"']+/gi, 'apiSecret:[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACTED_KEYS.includes(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

class AuditLogger {
  constructor(filePath) {
    this.filePath = filePath || DEFAULT_LOG_PATH;
  }

  async log(event, payload = {}) {
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event, payload: redact(payload) });
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.filePath, line + '\n', 'utf8');
    } catch (_) { /* audit failure must not interrupt request */ }
  }
}

module.exports = { AuditLogger, redact };
