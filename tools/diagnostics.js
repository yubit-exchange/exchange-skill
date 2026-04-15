'use strict';

function fail(message) {
  return { success: false, data: null, error: { code: -1, message } };
}

async function getTrace(store, { traceId }) {
  if (!traceId) return fail('traceId is required');
  const trace = store.getTrace(traceId);
  if (!trace) return fail(`Trace not found: ${traceId}`);
  return { success: true, data: trace, error: null };
}

async function searchTraces(store, params = {}) {
  const list = store.searchTraces(params);
  return {
    success: true,
    data: { list, count: list.length },
    error: null,
  };
}

async function getCapabilities(snapshot) {
  return {
    success: true,
    data: snapshot,
    error: null,
  };
}

module.exports = { getTrace, searchTraces, getCapabilities };
