'use strict';

const crypto = require('crypto');

const DEFAULT_RECV_WINDOW = '5000';
let recvWindow = DEFAULT_RECV_WINDOW;

function setRecvWindow(val) { recvWindow = String(val); }

function sign(apiKey, apiSecret, payload) {
  const timestamp = Date.now().toString();
  const plain = timestamp + apiKey + recvWindow + payload;
  const signature = crypto.createHmac('sha256', apiSecret).update(plain).digest('hex');
  return { timestamp, recvWindow, signature };
}

function signGet(apiKey, apiSecret, params) {
  const sorted = Object.keys(params).sort();
  const payload = sorted.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return { ...sign(apiKey, apiSecret, payload), payload };
}

function signPost(apiKey, apiSecret, body) {
  const payload = JSON.stringify(body);
  return { ...sign(apiKey, apiSecret, payload), payload };
}

function generateOrderLinkId() {
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(3).toString('hex');
  return `sk_${ts}_${rand}`;
}

module.exports = { sign, signGet, signPost, generateOrderLinkId, setRecvWindow, DEFAULT_RECV_WINDOW };
