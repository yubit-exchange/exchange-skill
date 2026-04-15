#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const args = process.argv.slice(2);
const command = args[0] || 'setup';

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client' && argv[i + 1]) { flags.client = argv[++i]; continue; }
    if (argv[i] === '--openclaw-workspace' && argv[i + 1]) { flags.openclawWorkspace = argv[++i]; continue; }
    if (argv[i] === '--api-key' && argv[i + 1]) { flags.apiKey = argv[++i]; continue; }
    if (argv[i] === '--api-secret' && argv[i + 1]) { flags.apiSecret = argv[++i]; continue; }
    if (argv[i] === '--read-only') { flags.readOnly = true; continue; }
    if (argv[i] === '--yes') { flags.yes = true; continue; }
    if (argv[i] === '--force') { flags.force = true; continue; }
    if (argv[i] === '--verbose') { flags.verbose = true; continue; }
    if (argv[i] === '--purge-config') { flags.purgeConfig = true; continue; }
  }
  return flags;
}

const flags = parseFlags(args);

async function cmdSetup() {
  const { detectClients, getClient } = require('../lib/setup/clients');
  const { createRL, askNumber } = require('../lib/setup/prompt');
  const credential = require('../lib/setup/credential');

  process.stderr.write('\nYubit MCP Setup\n\n');

  // 1. 选择客户端
  let clientId = flags.client;
  if (!clientId) {
    const detected = detectClients();
    if (detected.length === 0) {
      process.stderr.write('No supported AI tools detected.\n');
      process.stderr.write('Supported: openclaw, claude-code, codex, cursor, lobechat\n');
      process.exitCode = 1;
      return;
    }
    const { getAllClientIds } = require('../lib/setup/clients');
    const allIds = getAllClientIds();
    let idx = 1;
    const map = {};
    for (const id of allIds) {
      const client = getClient(id);
      if (client.detect()) {
        process.stderr.write(`  [${idx}] ${client.name}\n`);
        map[idx] = id;
        idx++;
      } else {
        process.stderr.write(`  [ ] ${client.name} (not found)\n`);
      }
    }
    process.stderr.write('\n');
    const rl = createRL();
    const choice = await askNumber(rl, 'Select client', 1, idx - 1, 1);
    clientId = map[choice];
    rl.close();
  }

  const client = getClient(clientId);
  if (!client) {
    process.stderr.write(`Unknown client: ${clientId}\n`);
    process.stderr.write('Supported: openclaw, claude-code, codex, cursor, lobechat\n');
    process.exitCode = 1;
    return;
  }

  // 2. 凭证
  let config = credential.load();
  if (config && !flags.force) {
    process.stderr.write(`\nUsing existing config: ${credential.CONFIG_PATH}\n\n`);
  } else {
    const rl = createRL();
    config = await credential.init(rl, { apiKey: flags.apiKey, apiSecret: flags.apiSecret });
    rl.close();
  }

  // 3. 交易开关
  const enableTrade = !flags.readOnly;

  // 4. 配置客户端
  process.stderr.write(`\nConfiguring ${client.name}...\n`);
  client.setup({ enableTrade, openclawWorkspace: flags.openclawWorkspace });

  // 5. 完成提示
  process.stderr.write(`\nDone!\n`);
}

async function cmdConfig() {
  const sub = args[1];
  const credential = require('../lib/setup/credential');

  if (sub === 'init') {
    const { createRL } = require('../lib/setup/prompt');
    const rl = createRL();
    await credential.init(rl, { apiKey: flags.apiKey, apiSecret: flags.apiSecret });
    rl.close();
  } else if (sub === 'show') {
    credential.show();
  } else {
    process.stderr.write('Usage: yubit config <init|show>\n');
  }
}

async function cmdStatus() {
  const { getAllClientIds, getClient } = require('../lib/setup/clients');
  const credential = require('../lib/setup/credential');

  process.stderr.write('\nYubit MCP Status\n\n');
  const cfg = credential.load();
  process.stderr.write(`  Config:  ${cfg ? credential.CONFIG_PATH : 'not found'}\n`);

  const statusCfg = { openclawWorkspace: flags.openclawWorkspace };
  for (const id of getAllClientIds()) {
    const client = getClient(id);
    if (client.detect()) {
      const st = client.status(statusCfg);
      process.stderr.write(`  ${client.name.padEnd(16)} ${st}\n`);
    }
  }
  process.stderr.write('\n');
}

async function cmdDoctor() {
  const doctor = require('../lib/setup/doctor');
  await doctor.run({ openclawWorkspace: flags.openclawWorkspace });
}

async function cmdUninstall() {
  const { getClient, getAllClientIds } = require('../lib/setup/clients');
  const credential = require('../lib/setup/credential');
  const fs = require('fs');

  const clientId = flags.client;
  const cfg = { openclawWorkspace: flags.openclawWorkspace };
  if (clientId) {
    const client = getClient(clientId);
    if (client) {
      process.stderr.write(`\nUninstalling from ${client.name}...\n`);
      client.uninstall(cfg);
    }
  } else {
    process.stderr.write('\nUninstalling from all detected clients...\n');
    for (const id of getAllClientIds()) {
      const client = getClient(id);
      if (client.detect()) client.uninstall(cfg);
    }
  }

  if (flags.purgeConfig) {
    if (fs.existsSync(credential.CONFIG_PATH)) {
      fs.unlinkSync(credential.CONFIG_PATH);
      process.stderr.write(`  OK  Credentials removed (${credential.CONFIG_PATH})\n`);
    }
  } else {
    process.stderr.write(`  --  Credentials kept (${credential.CONFIG_PATH}). Use --purge-config to delete.\n`);
  }

  process.stderr.write('\nDone!\n');
}

function cmdStart() {
  const repoRoot = path.join(__dirname, '..');
  const isSourceRepo = fs.existsSync(path.join(repoRoot, '.git'));
  const sdkDir = path.join(repoRoot, 'node_modules', '@modelcontextprotocol', 'sdk');

  if (isSourceRepo && !fs.existsSync(sdkDir)) {
    process.stderr.write('Installing local dependencies...\n');
    execFileSync('npm', ['install'], { cwd: repoRoot, stdio: 'inherit' });
  }
  require(path.join(__dirname, '..', 'mcp-server.js'));
}

function showHelp() {
  process.stderr.write(`
Yubit MCP — Perpetual Futures Trading for AI Tools

Usage:
  yubit setup [--client <name>] [--read-only]     Install and configure
  yubit config init                                Setup API credentials
  yubit config show                                Show current config
  yubit status                                     Check installation status
  yubit doctor                                     Run environment diagnostics
  yubit uninstall [--client <name>] [--purge-config]  Remove configuration
  yubit start                                      Start MCP Server (stdio)

Clients: openclaw, claude-code, codex, cursor, lobechat
`);
}

(async () => {
  try {
    if (command === 'setup') await cmdSetup();
    else if (command === 'config') await cmdConfig();
    else if (command === 'status') await cmdStatus();
    else if (command === 'doctor') await cmdDoctor();
    else if (command === 'uninstall') await cmdUninstall();
    else if (command === 'start') cmdStart();
    else if (command === '--help' || command === '-h' || command === 'help') showHelp();
    else { process.stderr.write(`Unknown command: ${command}\n`); showHelp(); process.exitCode = 1; }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
})();
