'use strict';

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
const { redact } = require('./audit');

const DEFAULT_TRACE_PATH = path.join(__dirname, '..', '.data', 'trace-records.jsonl');
const DEFAULT_TRACE_TTL_DAYS = 7;
const DEFAULT_TRACE_MAX_RECORDS = 1000;
const DEFAULT_LOCK_TIMEOUT_MS = 2000;
const LOCK_POLL_MS = 10;
const STALE_LOCK_MULTIPLIER = 5;

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function parseLimit(limit, fallback = 10) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), 100);
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function normalizeTs(input) {
  if (!input) return null;
  const ts = Date.parse(input);
  return Number.isNaN(ts) ? null : ts;
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  const rows = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch (_) { /* ignore malformed line */ }
  }
  return rows;
}

function firstListItem(data) {
  return Array.isArray(data?.list) && data.list[0] ? data.list[0] : null;
}

function buildIndexes(trace) {
  const normalized = trace.normalizedResponse || {};
  const data = normalized.data || {};
  const listItem = firstListItem(data);
  const lastHttp = trace.httpCalls.length > 0 ? trace.httpCalls[trace.httpCalls.length - 1] : null;
  const rawData = lastHttp?.rawExchangeResponse?.data || {};

  return {
    symbol: pickFirst(
      trace.toolArgs?.symbol,
      data.symbol,
      listItem?.symbol,
      trace.httpCalls.find(call => call.query?.symbol)?.query?.symbol,
      trace.httpCalls.find(call => call.body?.symbol)?.body?.symbol,
    ),
    orderId: pickFirst(
      trace.toolArgs?.orderId,
      trace.toolArgs?.orderNo,
      data.orderId,
      listItem?.orderId,
      rawData.orderId,
    ),
    orderLinkId: pickFirst(
      trace.toolArgs?.orderLinkId,
      data.orderLinkId,
      listItem?.orderLinkId,
      rawData.orderLinkId,
      trace.httpCalls.find(call => call.body?.orderLinkId)?.body?.orderLinkId,
    ),
    pzLinkId: pickFirst(
      trace.toolArgs?.pzLinkId,
      data.pzLinkId,
      listItem?.pzLinkId,
      trace.httpCalls.find(call => call.body?.pzLinkId)?.body?.pzLinkId,
    ),
  };
}

class TraceStore {
  constructor(filePath = DEFAULT_TRACE_PATH, options = {}) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.asyncLocal = new AsyncLocalStorage();
    this.ttlDays = parsePositiveInt(options.ttlDays, DEFAULT_TRACE_TTL_DAYS);
    this.maxRecords = parsePositiveInt(options.maxRecords, DEFAULT_TRACE_MAX_RECORDS);
    this.lockTimeoutMs = parsePositiveInt(options.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  }

  createTrace(toolName, toolArgs = {}) {
    return {
      traceId: `tr_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      ts: new Date().toISOString(),
      toolName,
      toolArgs: clone(redact(toolArgs)),
      success: false,
      meta: {},
      indexes: {},
      httpCalls: [],
      normalizedResponse: null,
    };
  }

  runWithTrace(trace, fn) {
    return this.asyncLocal.run(trace, fn);
  }

  getCurrentTrace() {
    return this.asyncLocal.getStore() || null;
  }

  recordHttpCall(call) {
    const trace = this.getCurrentTrace();
    if (!trace) return;
    const entry = clone(redact(call));
    entry.seq = trace.httpCalls.length + 1;
    trace.httpCalls.push(entry);
  }

  recordMeta(patch = {}) {
    const trace = this.getCurrentTrace();
    if (!trace) return;
    Object.assign(trace.meta, clone(redact(patch)));
  }

  recordMetric(name, delta = 1) {
    const trace = this.getCurrentTrace();
    if (!trace) return;
    const current = Number(trace.meta?.[name] || 0);
    trace.meta[name] = current + Number(delta || 0);
  }

  finalizeTrace(trace, normalizedResponse) {
    trace.normalizedResponse = clone(redact(normalizedResponse));
    trace.success = !!normalizedResponse?.success;
    trace.indexes = buildIndexes(trace);
    try {
      this.appendTrace(trace);
    } catch (_) {
      // Trace persistence must never break the main tool response.
    }
    return trace;
  }

  appendTrace(trace) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const lockFd = this.acquireLock();
    try {
      const rows = readJsonLines(this.filePath);
      rows.push(trace);
      const pruned = this.pruneTraces(rows);
      const content = pruned.map(row => JSON.stringify(row)).join('\n');
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, content ? content + '\n' : '', 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } finally {
      this.releaseLock(lockFd);
    }
  }

  pruneTraces(rows) {
    const now = Date.now();
    const cutoffTs = now - (this.ttlDays * 24 * 60 * 60 * 1000);
    const kept = rows.filter((row) => {
      const ts = normalizeTs(row.ts);
      return ts != null && ts >= cutoffTs;
    });
    if (kept.length <= this.maxRecords) return kept;
    return kept.slice(kept.length - this.maxRecords);
  }

  getTrace(traceId) {
    if (!traceId) return null;
    const all = readJsonLines(this.filePath);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].traceId === traceId) return all[i];
    }
    return null;
  }

  summarize(trace) {
    return {
      traceId: trace.traceId,
      ts: trace.ts,
      toolName: trace.toolName,
      success: trace.success,
      rateLimitWaitMs: trace.meta?.rateLimitWaitMs || 0,
      symbol: trace.indexes?.symbol || null,
      orderId: trace.indexes?.orderId || null,
      orderLinkId: trace.indexes?.orderLinkId || null,
      pzLinkId: trace.indexes?.pzLinkId || null,
      errorCode: trace.normalizedResponse?.error?.code ?? null,
      errorMessage: trace.normalizedResponse?.error?.message || null,
    };
  }

  matches(trace, filters = {}) {
    const fromTs = normalizeTs(filters.fromTs);
    const toTs = normalizeTs(filters.toTs);
    const rowTs = normalizeTs(trace.ts);
    const orderId = filters.orderId || filters.orderNo;

    if (filters.traceId && trace.traceId !== filters.traceId) return false;
    if (filters.symbol && trace.indexes?.symbol !== filters.symbol) return false;
    if (filters.toolName && trace.toolName !== filters.toolName) return false;
    if (filters.orderId && trace.indexes?.orderId !== filters.orderId) return false;
    if (filters.orderNo && trace.indexes?.orderId !== filters.orderNo) return false;
    if (orderId && trace.indexes?.orderId !== orderId) return false;
    if (filters.orderLinkId && trace.indexes?.orderLinkId !== filters.orderLinkId) return false;
    if (filters.success != null && trace.success !== filters.success) return false;
    if (fromTs != null && (rowTs == null || rowTs < fromTs)) return false;
    if (toTs != null && (rowTs == null || rowTs > toTs)) return false;
    return true;
  }

  searchTraces(filters = {}) {
    const limit = parseLimit(filters.limit, 10);
    const rows = readJsonLines(this.filePath);
    const out = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!this.matches(rows[i], filters)) continue;
      out.push(this.summarize(rows[i]));
      if (out.length >= limit) break;
    }
    return out;
  }

  acquireLock() {
    const deadline = Date.now() + this.lockTimeoutMs;
    while (Date.now() < deadline) {
      try {
        return fs.openSync(this.lockPath, 'wx');
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        this.tryBreakStaleLock();
        sleepMs(LOCK_POLL_MS);
      }
    }
    throw new Error(`Timed out acquiring trace store lock: ${this.lockPath}`);
  }

  releaseLock(lockFd) {
    try {
      if (lockFd != null) fs.closeSync(lockFd);
    } finally {
      try { fs.unlinkSync(this.lockPath); } catch (_) { /* ignore */ }
    }
  }

  tryBreakStaleLock() {
    try {
      const stat = fs.statSync(this.lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > this.lockTimeoutMs * STALE_LOCK_MULTIPLIER) {
        fs.unlinkSync(this.lockPath);
      }
    } catch (_) {
      // ignore races or missing lock file
    }
  }
}

module.exports = {
  TraceStore,
  DEFAULT_TRACE_PATH,
  DEFAULT_TRACE_TTL_DAYS,
  DEFAULT_TRACE_MAX_RECORDS,
};
