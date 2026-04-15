'use strict';

const readline = require('readline');

function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stderr });
}

function ask(rl, question, defaultVal) {
  const suffix = defaultVal != null ? ` [${defaultVal}]` : '';
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, answer => {
      resolve(answer.trim() || (defaultVal != null ? String(defaultVal) : ''));
    });
  });
}

function askSecret(rl, question) {
  return new Promise(resolve => {
    process.stderr.write(`${question}: `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let buf = '';
    const onData = (ch) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw || false);
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(buf);
      } else if (c === '\u0003') {
        process.exit(1);
      } else if (c === '\u007f' || c === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
        process.stderr.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function askNumber(rl, question, min, max, defaultVal) {
  while (true) {
    const ans = await ask(rl, question, defaultVal);
    const n = parseInt(ans, 10);
    if (!isNaN(n) && n >= min && n <= max) return n;
    process.stderr.write(`  Please enter a number between ${min} and ${max}.\n`);
  }
}

async function askYesNo(rl, question, defaultYes = false) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const ans = await ask(rl, `${question} (${hint})`);
  if (!ans) return defaultYes;
  return ans.toLowerCase().startsWith('y');
}

module.exports = { createRL, ask, askSecret, askNumber, askYesNo };
