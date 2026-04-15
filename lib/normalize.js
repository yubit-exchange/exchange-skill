'use strict';

const TIME_FIELDS = new Set([
  'createdTime', 'updatedTime', 'execTime', 'createdAt',
  'fundingRateTimestamp', 'nextFundingTime',
  'launchTime', 'deliveryTime', 'execTimeE0',
]);

function formatTimestamp(raw) {
  // Accept ms (13 digits), us (16 digits), or ns (19 digits).
  // Detect by magnitude and convert to ms.
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  let ms;
  if (n >= 1e18) ms = Math.floor(n / 1e6);      // nanoseconds
  else if (n >= 1e15) ms = Math.floor(n / 1e3); // microseconds
  else if (n >= 1e9 && n < 1e12) ms = n * 1000; // seconds
  else ms = n;                                   // milliseconds (or seconds, but rare)
  const d = new Date(ms);
  if (isNaN(d.getTime())) return raw;
  const pad = (x) => String(x).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const tz = `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tz}`;
}

function formatTimestamps(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(formatTimestamps);
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (TIME_FIELDS.has(k) && (typeof v === 'string' || typeof v === 'number')) {
      out[k] = formatTimestamp(v);
    } else {
      out[k] = formatTimestamps(v);
    }
  }
  return out;
}

function wrapResponse(raw) {
  if (raw.code === 0) {
    return { success: true, data: formatTimestamps(raw.data), error: null };
  }
  return { success: false, data: null, error: { code: raw.code, message: friendlyError(raw.message) } };
}

function friendlyError(msg) {
  if (!msg) return 'Unknown error';
  const m = msg.toLowerCase();
  if (m.includes('insufficient')) return `Insufficient balance — ${msg}`;
  if (m.includes('invalid price')) return `Invalid price — ${msg}`;
  if (m.includes('position') && m.includes('not')) return `Position not found — ${msg}`;
  if (m.includes('order') && m.includes('not')) return `Order not found — ${msg}`;
  if (m.includes('qty')) return `Invalid quantity — ${msg}`;
  return msg;
}

function normalizeTicker(ticker) {
  if (!ticker) return ticker;
  const raw24h = parseFloat(ticker.price24hPcnt);
  const rawFr = parseFloat(ticker.fundingRate);
  return {
    symbol: ticker.symbol,
    lastPrice: ticker.lastPrice,
    markPrice: ticker.markPrice,
    indexPrice: ticker.indexPrice,
    bidPrice: ticker.bidPrice,
    askPrice: ticker.askPrice,
    highPrice24h: ticker.highPrice24h,
    lowPrice24h: ticker.lowPrice24h,
    volume24h: ticker.volume24h,
    turnover24h: ticker.turnover24h,
    price24hPcnt: isNaN(raw24h) ? ticker.price24hPcnt : (raw24h / 10000).toFixed(4) + '%',
    fundingRate: isNaN(rawFr) ? ticker.fundingRate : (rawFr / 10000).toFixed(4) + '%',
    nextFundingTime: ticker.nextFundingTime,
    openInterest: ticker.openInterest,
  };
}

function normalizePosition(pos) {
  if (!pos) return pos;
  return {
    ...pos,
    direction: pos.positionIdx === 1 ? 'Long' : pos.positionIdx === 2 ? 'Short' : 'Unknown',
    tradeModeLabel: Number(pos.tradeMode) === 0 ? 'Cross' : 'Isolated',
  };
}

module.exports = { wrapResponse, friendlyError, normalizeTicker, normalizePosition };
