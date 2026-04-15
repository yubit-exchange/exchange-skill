'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..', '..');
const GENERATED_DIR = path.join(os.homedir(), '.yubit-mcp', 'generated');
const OPENCLAW_INSTALL_SKILLS = ['yubit'];
const RETIRED_OPENCLAW_SKILLS = [
  'yubit-market',
  'yubit-wallet',
  'yubit-spot',
  'yubit-tradfi',
  'yubit-earn',
  'yubit-perp',
  'yubit-diagnostics',
];

// -- Utilities --

function which(bin) {
  try {
    execSync(`which ${bin}`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function fileExists(p) { return fs.existsSync(p); }

function hasRuntimeDeps() {
  return fs.existsSync(path.join(PKG_DIR, 'node_modules', '@modelcontextprotocol', 'sdk'));
}

function buildEntry(enableTrade, opts = {}) {
  const isSourceRepo = opts.isSourceRepo ?? fs.existsSync(path.join(PKG_DIR, '.git'));
  const runtimeDepsAvailable = opts.runtimeDepsAvailable ?? hasRuntimeDeps();
  const yubitBinAvailable = opts.yubitBinAvailable ?? which('yubit');

  if (isSourceRepo && runtimeDepsAvailable) {
    return {
      command: process.execPath,
      args: [path.join(PKG_DIR, 'bin', 'cli.js'), 'start'],
      env: { EXCHANGE_ENABLE_TRADE: enableTrade ? 'true' : 'false' },
    };
  }
  if (yubitBinAvailable) {
    return {
      command: 'yubit',
      args: ['start'],
      env: { EXCHANGE_ENABLE_TRADE: enableTrade ? 'true' : 'false' },
    };
  }
  {
    return {
      command: 'npx',
      args: ['-y', '@yubit/exchange-skill', 'start'],
      env: { EXCHANGE_ENABLE_TRADE: enableTrade ? 'true' : 'false' },
    };
  }
}

function mergeJsonConfig(configPath, serverName, entry) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data = {};
  if (fs.existsSync(configPath)) {
    try { data = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { data = {}; }
    fs.copyFileSync(configPath, configPath + '.bak');
    process.stderr.write(`  OK  Backed up ${configPath} -> ${configPath}.bak\n`);
  }
  if (!data.mcpServers) data.mcpServers = {};
  data.mcpServers[serverName] = entry;
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function removeFromJsonConfig(configPath, serverName) {
  if (!fs.existsSync(configPath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (data.mcpServers && data.mcpServers[serverName]) {
      delete data.mcpServers[serverName];
      fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function writeGeneratedFile(filename, entry) {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const content = JSON.stringify({ mcpServers: { yubit: entry } }, null, 2) + '\n';
  const filePath = path.join(GENERATED_DIR, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function getActiveWorkspace() {
  // OpenClaw skills 目录
  const skillsDir = path.join(os.homedir(), '.openclaw', 'skills');
  if (fs.existsSync(skillsDir) || fs.existsSync(path.join(os.homedir(), '.openclaw'))) {
    return path.join(os.homedir(), '.openclaw');
  }
  return null;
}

function listSkillDirs() {
  const skillsRoot = path.join(PKG_DIR, 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot)
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, 'SKILL.md')));
}

function listOpenclawSkillDirs() {
  return OPENCLAW_INSTALL_SKILLS.filter((name) => fs.existsSync(path.join(PKG_DIR, 'skills', name, 'SKILL.md')));
}

function installOpenclawSkills(workspace) {
  const skillsDir = path.join(workspace, 'skills');
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

  for (const retiredSkill of RETIRED_OPENCLAW_SKILLS) {
    const retiredDir = path.join(skillsDir, retiredSkill);
    if (fs.existsSync(retiredDir)) {
      fs.rmSync(retiredDir, { recursive: true, force: true });
      process.stderr.write(`  OK  Retired skill removed (${retiredDir})\n`);
    }
  }

  for (const skillName of listOpenclawSkillDirs()) {
    const skillSrc = path.join(PKG_DIR, 'skills', skillName);
    const skillDst = path.join(skillsDir, skillName);
    fs.rmSync(skillDst, { recursive: true, force: true });
    fs.cpSync(skillSrc, skillDst, { recursive: true });
    process.stderr.write(`  OK  Skill installed (${skillDst})\n`);
  }
}

function uninstallOpenclawSkills(workspace) {
  const skillsDir = path.join(workspace, 'skills');
  for (const skillName of [...listOpenclawSkillDirs(), ...RETIRED_OPENCLAW_SKILLS]) {
    const skillDir = path.join(skillsDir, skillName);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
  }
}

function restartOpenclawGateway() {
  try {
    execFileSync('openclaw', ['gateway', 'restart'], { stdio: 'pipe', timeout: 10000 });
    process.stderr.write(`  OK  Gateway restarted\n`);
  } catch (err) {
    if (err && err.code === 'ETIMEDOUT') {
      process.stderr.write(`  WARN  Gateway restart timed out after 10s (state may still be healthy; verify with openclaw mcp list)\n`);
      return;
    }
    process.stderr.write(`  WARN  Gateway restart failed (may need manual restart)\n`);
  }
}

function removeTomlYubit(content) {
  const lines = content.split('\n');
  const result = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[mcp_servers\.yubit(?:\.|])/.test(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[/.test(trimmed)) {
      skipping = false;
    }
    if (!skipping) result.push(line);
  }
  // 清理多余空行
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// -- Client Registry --

const CLIENTS = {
  openclaw: {
    name: 'OpenClaw',
    detect: () => which('openclaw'),
    setup: (cfg) => {
      const entry = buildEntry(cfg.enableTrade);
      try {
        execSync(`openclaw mcp set yubit '${JSON.stringify(entry)}'`, { stdio: 'pipe' });
        process.stderr.write(`  OK  MCP server registered\n`);
      } catch (e) {
        process.stderr.write(`  FAIL  openclaw mcp set: ${e.message}\n`);
        return;
      }

      const workspace = cfg.openclawWorkspace || getActiveWorkspace();
      if (!workspace) {
        process.stderr.write(`  WARN  Cannot determine OpenClaw directory.\n`);
        process.stderr.write(`        Use --openclaw-workspace <path> and copy skills/yubit into your OpenClaw skills directory.\n`);
      } else {
        installOpenclawSkills(workspace);
      }

      restartOpenclawGateway();
    },
    uninstall: (cfg = {}) => {
      try { execSync('openclaw mcp unset yubit', { stdio: 'pipe' }); } catch { /* */ }
      const workspace = cfg.openclawWorkspace || getActiveWorkspace();
      if (workspace) {
        uninstallOpenclawSkills(workspace);
      }
      restartOpenclawGateway();
      process.stderr.write(`  OK  OpenClaw: MCP + Skills removed\n`);
    },
    status: (cfg = {}) => {
      let mcp = 'not registered';
      try {
        const out = execSync('openclaw mcp list', { stdio: 'pipe' }).toString();
        mcp = out.includes('yubit') ? 'registered' : 'not registered';
      } catch { return 'openclaw not found'; }
      const workspace = cfg.openclawWorkspace || getActiveWorkspace();
      const installedCount = workspace
        ? listOpenclawSkillDirs().filter((skillName) => fs.existsSync(path.join(workspace, 'skills', skillName))).length
        : 0;
      return `${mcp}${installedCount > 0 ? ` + ${installedCount} skills installed` : ''}`;
    },
  },

  'claude-code': {
    name: 'Claude Code',
    detect: () => which('claude'),
    setup: (cfg) => {
      const entry = buildEntry(cfg.enableTrade);
      try {
        try {
          execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'yubit'], { stdio: 'pipe' });
          process.stderr.write(`  OK  Existing Claude Code MCP entry removed\n`);
        } catch { /* ignore if not present */ }
        const envFlags = Object.entries(entry.env || {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        const args = ['mcp', 'add', '--transport', 'stdio', 'yubit', '--scope', 'user',
          ...envFlags, '--', entry.command, ...entry.args];
        execFileSync('claude', args, { stdio: 'pipe' });
        process.stderr.write(`  OK  MCP server registered via claude mcp add\n`);
      } catch (e) {
        process.stderr.write(`  FAIL  claude mcp add failed: ${e.message}\n`);
        process.stderr.write(`        Fallback: create .mcp.json in your project directory.\n`);
      }
    },
    uninstall: () => {
      try { execFileSync('claude', ['mcp', 'remove', 'yubit'], { stdio: 'pipe' }); } catch { /* */ }
      process.stderr.write(`  OK  Claude Code: MCP removed\n`);
    },
    status: () => {
      try {
        const out = execSync('claude mcp list', { stdio: 'pipe' }).toString();
        return out.includes('yubit') ? 'registered' : 'not registered';
      } catch { return 'claude not found'; }
    },
  },

  codex: {
    name: 'OpenAI Codex CLI',
    detect: () => which('codex'),
    setup: (cfg) => {
      const entry = buildEntry(cfg.enableTrade);
      const configPath = path.join(os.homedir(), '.codex', 'config.toml');
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let existing = '';
      if (fs.existsSync(configPath)) {
        existing = fs.readFileSync(configPath, 'utf-8');
        fs.copyFileSync(configPath, configPath + '.bak');
        process.stderr.write(`  OK  Backed up ${configPath}\n`);
      }

      existing = removeTomlYubit(existing);

      const envLines = Object.entries(entry.env || {}).map(([k, v]) => `${k} = "${v}"`).join('\n');
      const tomlBlock = `
[mcp_servers.yubit]
command = "${entry.command}"
args = ${JSON.stringify(entry.args)}

[mcp_servers.yubit.env]
${envLines}
`;
      const final = existing ? existing + '\n' + tomlBlock : tomlBlock.trim() + '\n';
      fs.writeFileSync(configPath, final, 'utf-8');
      process.stderr.write(`  OK  MCP server registered in ${configPath}\n`);
    },
    uninstall: () => {
      const configPath = path.join(os.homedir(), '.codex', 'config.toml');
      if (!fs.existsSync(configPath)) return;
      let content = fs.readFileSync(configPath, 'utf-8');
      content = removeTomlYubit(content);
      fs.writeFileSync(configPath, content + '\n', 'utf-8');
      process.stderr.write(`  OK  Codex: MCP config removed\n`);
    },
    status: () => {
      const configPath = path.join(os.homedir(), '.codex', 'config.toml');
      if (!fs.existsSync(configPath)) return 'config not found';
      const content = fs.readFileSync(configPath, 'utf-8');
      return content.includes('[mcp_servers.yubit]') ? 'registered' : 'not registered';
    },
  },

  cursor: {
    name: 'Cursor',
    detect: () => fs.existsSync(path.join(os.homedir(), '.cursor')),
    setup: (cfg) => {
      const configPath = path.join(os.homedir(), '.cursor', 'mcp.json');
      mergeJsonConfig(configPath, 'yubit', buildEntry(cfg.enableTrade));
      process.stderr.write(`  OK  MCP server registered in ${configPath}\n`);
    },
    uninstall: () => {
      const configPath = path.join(os.homedir(), '.cursor', 'mcp.json');
      if (removeFromJsonConfig(configPath, 'yubit')) {
        process.stderr.write(`  OK  Cursor: MCP config removed\n`);
      }
    },
    status: () => {
      const configPath = path.join(os.homedir(), '.cursor', 'mcp.json');
      if (!fs.existsSync(configPath)) return 'config not found';
      try {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return data.mcpServers?.yubit ? 'registered' : 'not registered';
      } catch { return 'config parse error'; }
    },
  },

  lobechat: {
    name: 'LobeChat Desktop',
    detect: () => {
      if (process.platform === 'darwin') return fs.existsSync(path.join(os.homedir(), 'Library', 'Application Support', 'LobeChat'));
      if (process.platform === 'linux') return fs.existsSync(path.join(os.homedir(), '.config', 'LobeChat'));
      if (process.platform === 'win32') return fs.existsSync(path.join(process.env.APPDATA || '', 'LobeChat'));
      return false;
    },
    setup: (cfg) => {
      const entry = buildEntry(cfg.enableTrade);
      const filePath = writeGeneratedFile('lobechat.mcp.json', entry);
      process.stderr.write(`  OK  Import file generated: ${filePath}\n`);
      process.stderr.write(`      Open LobeChat → Plugin → Add MCP Plugin → Quick Import JSON\n`);
      process.stderr.write(`      Paste the contents of ${filePath}\n`);
    },
    uninstall: () => {
      const filePath = path.join(GENERATED_DIR, 'lobechat.mcp.json');
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      process.stderr.write(`  OK  LobeChat: generated file removed\n`);
    },
    status: () => {
      return fs.existsSync(path.join(GENERATED_DIR, 'lobechat.mcp.json')) ? 'import file exists' : 'not configured';
    },
  },
};

function detectClients() {
  const detected = [];
  for (const [id, client] of Object.entries(CLIENTS)) {
    if (client.detect()) detected.push({ id, name: client.name });
  }
  return detected;
}

function getClient(id) {
  return CLIENTS[id] || null;
}

function getAllClientIds() {
  return Object.keys(CLIENTS);
}

module.exports = {
  CLIENTS,
  detectClients,
  getClient,
  getAllClientIds,
  buildEntry,
  GENERATED_DIR,
  RETIRED_OPENCLAW_SKILLS,
  listOpenclawSkillDirs,
  listSkillDirs,
  installOpenclawSkills,
  uninstallOpenclawSkills,
};
