'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.exchange-skill');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function load() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return null; }
}

function save(config) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function redact(val) {
  if (!val || val.length < 10) return '****';
  return val.slice(0, 6) + '****' + val.slice(-3);
}

function show() {
  const cfg = load();
  if (!cfg) {
    process.stderr.write(`  Config not found: ${CONFIG_PATH}\n`);
    process.stderr.write(`  Run: yubit config init\n`);
    return;
  }
  process.stderr.write(`\n`);
  process.stderr.write(`  Path:       ${CONFIG_PATH}\n`);
  process.stderr.write(`  API Key:    ${redact(cfg.apiKey)}\n`);
  process.stderr.write(`  API Secret: ${redact(cfg.apiSecret)}\n`);
  process.stderr.write(`  Base URL:   ${cfg.baseUrl || 'not set'}\n`);
  process.stderr.write(`\n`);
}

async function init(rl, opts = {}) {
  const { askSecret, ask } = require('./prompt');

  const apiKey = opts.apiKey || await askSecret(rl, 'API Key');
  const apiSecret = opts.apiSecret || await askSecret(rl, 'API Secret');
  const baseUrl = await ask(rl, 'API Base URL');
  if (!baseUrl) throw new Error('API Base URL is required');

  const config = { apiKey, apiSecret, baseUrl };
  save(config);
  process.stderr.write(`\n  OK  Config saved (${CONFIG_PATH})\n`);
  return config;
}

module.exports = { CONFIG_PATH, CONFIG_DIR, load, save, show, init, redact };
