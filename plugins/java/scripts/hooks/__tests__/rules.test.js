'use strict';

/*
Fixture-driven tests for the engine's source rules. Each directory under
fixtures/rules/ holds Java files whose expected findings are marked inline:

  - a line ending in `// expect: <ID>` must get exactly that finding;
  - a line ending in `// expect-next: <ID>` expects it on the following line
    (for lines whose own text can't carry a marker, like a suppression);
  - a file without markers must get none.

`fixture.json` in a directory, or `<File>.json` beside one file, sets the
engine options for that run: { "source": 21, "boot": "3.4", "nullness": … }.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installedEngine, SKIP_WITHOUT_JDK } = require('./helpers');
const { runEngine } = require('../engine');

const ROOT = path.join(__dirname, 'fixtures', 'rules');
const DEFAULTS = { source: 21, boot: '3.4', nullness: 'jspecify' };

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function expectations(file) {
  const expected = [];
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const match = /\/\/ expect(-next)?: ([\w,]+)\s*$/.exec(line);
      if (!match) return;
      for (const rule of match[2].split(','))
        expected.push(`${index + 1 + (match[1] ? 1 : 0)} ${rule}`);
    });
  return expected.sort();
}

function optionsFor(dir, file) {
  return {
    ...DEFAULTS,
    ...readJson(path.join(dir, 'fixture.json')),
    ...readJson(file.replace(/\.java$/, '.json')),
  };
}

function toBoot(value) {
  if (!value || value === 'none') return null;
  const [major, minor] = value.split('.').map(Number);
  return { major, minor };
}

for (const rule of fs.readdirSync(ROOT).sort()) {
  const dir = path.join(ROOT, rule);
  for (const name of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.java'))
    .sort()) {
    const file = path.join(dir, name);
    test(`${rule}/${name}`, { skip: SKIP_WITHOUT_JDK }, async () => {
      const manifest = await installedEngine();
      const options = optionsFor(dir, file);
      const result = runEngine({
        manifest,
        files: [{ path: file, ranges: null }],
        rules: true,
        source: options.source,
        boot: toBoot(options.boot),
        nullness: options.nullness,
      });

      assert.deepEqual(result.errors, []);
      const actual = result.findings.map((f) => `${f.line} ${f.rule}`).sort();
      assert.deepEqual(actual, expectations(file), JSON.stringify(result.findings, null, 2));
    });
  }
}
