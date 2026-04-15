'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  RETIRED_OPENCLAW_SKILLS,
  buildEntry,
  installOpenclawSkills,
  listOpenclawSkillDirs,
  listSkillDirs,
  uninstallOpenclawSkills,
} = require('../lib/setup/clients');

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name} — ${detail || ''}`); failed++; }
}

function makeTempWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yubit-openclaw-'));
  fs.mkdirSync(path.join(workspace, 'skills'), { recursive: true });
  return workspace;
}

console.log('Setup client tests\n');

try {
  const sourceEntry = buildEntry(true, {
    isSourceRepo: true,
    runtimeDepsAvailable: true,
    yubitBinAvailable: true,
  });
  assert('buildEntry source repo with deps → node mcp-server.js', sourceEntry.command === process.execPath, sourceEntry.command);
  assert('buildEntry source repo with deps → bin/cli.js arg', sourceEntry.args[0].endsWith('bin/cli.js'), JSON.stringify(sourceEntry.args));
  assert('buildEntry source repo with deps → start subcommand', sourceEntry.args[1] === 'start', JSON.stringify(sourceEntry.args));

  const yubitEntry = buildEntry(true, {
    isSourceRepo: true,
    runtimeDepsAvailable: false,
    yubitBinAvailable: true,
  });
  assert('buildEntry source repo without deps → yubit start', yubitEntry.command === 'yubit', yubitEntry.command);
  assert('buildEntry source repo without deps → args=start', JSON.stringify(yubitEntry.args) === JSON.stringify(['start']), JSON.stringify(yubitEntry.args));

  const npxEntry = buildEntry(false, {
    isSourceRepo: false,
    runtimeDepsAvailable: false,
    yubitBinAvailable: false,
  });
  assert('buildEntry no repo/no yubit → npx fallback', npxEntry.command === 'npx', npxEntry.command);
  assert('buildEntry no repo/no yubit → package fallback', JSON.stringify(npxEntry.args) === JSON.stringify(['-y', '@yubit/exchange-skill', 'start']), JSON.stringify(npxEntry.args));

  const workspace = makeTempWorkspace();
  const legacyName = RETIRED_OPENCLAW_SKILLS[0];
  const legacyDir = legacyName ? path.join(workspace, 'skills', legacyName) : null;
  if (legacyDir) {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'SKILL.md'), '# legacy\n', 'utf-8');
  }

  installOpenclawSkills(workspace);

  if (legacyDir) {
    assert('legacy yubit skill removed', !fs.existsSync(legacyDir), legacyDir);
  }

  for (const skillName of listOpenclawSkillDirs()) {
    const skillPath = path.join(workspace, 'skills', skillName, 'SKILL.md');
    assert(`installed ${skillName}`, fs.existsSync(skillPath), skillPath);
  }

  for (const skillName of listSkillDirs().filter((name) => !listOpenclawSkillDirs().includes(name))) {
    const skillDir = path.join(workspace, 'skills', skillName);
    assert(`did not install ${skillName}`, !fs.existsSync(skillDir), skillDir);
  }

  uninstallOpenclawSkills(workspace);

  for (const skillName of [...listOpenclawSkillDirs(), ...RETIRED_OPENCLAW_SKILLS]) {
    const skillDir = path.join(workspace, 'skills', skillName);
    assert(`removed ${skillName} on uninstall`, !fs.existsSync(skillDir), skillDir);
  }

  fs.rmSync(workspace, { recursive: true, force: true });
} catch (err) {
  assert('setup client test runner', false, err.stack || err.message);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
