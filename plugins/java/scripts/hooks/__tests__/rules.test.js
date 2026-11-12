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
// J25 (empty bodies explained) is on only in its own fixtures: the others use empty bodies freely.
const DEFAULTS = { source: 21, boot: '3.4', nullness: 'off', disabled: ['J25'] };

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

// fixture.json files from the rule directory down to the file's own directory, then <File>.json.
function optionsFor(file) {
  let options = { ...DEFAULTS };
  const parts = path.relative(ROOT, path.dirname(file)).split(path.sep);
  for (let i = 1; i <= parts.length; i += 1) {
    options = { ...options, ...readJson(path.join(ROOT, ...parts.slice(0, i), 'fixture.json')) };
  }
  return { ...options, ...readJson(file.replace(/\.java$/, '.json')) };
}

function toBoot(value) {
  if (!value || value === 'none') return null;
  const [major, minor] = value.split('.').map(Number);
  return { major, minor };
}

function javaFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return javaFiles(full);
      return entry.name.endsWith('.java') ? [full] : [];
    })
    .sort();
}

/*
One engine run per distinct option set, shared by the tests that need it:
starting a JVM per fixture would make the suite crawl.
*/
const FILES = javaFiles(ROOT);
const runs = new Map();

async function findingsFor(file) {
  const options = optionsFor(file);
  const key = JSON.stringify(options);
  if (!runs.has(key)) {
    runs.set(
      key,
      installedEngine().then((manifest) =>
        runEngine({
          manifest,
          files: FILES.filter((f) => JSON.stringify(optionsFor(f)) === key).map((f) => ({
            path: f,
            ranges: null,
          })),
          rules: true,
          source: options.source,
          boot: toBoot(options.boot),
          nullness: options.nullness,
          disabled: options.disabled,
        }),
      ),
    );
  }
  const result = await runs.get(key);
  return {
    errors: result.errors.filter((e) => e.path === file || e.path === '-'),
    findings: result.findings.filter((f) => f.file === file),
  };
}

for (const file of FILES) {
  test(path.relative(ROOT, file), { skip: SKIP_WITHOUT_JDK }, async () => {
    const { errors, findings } = await findingsFor(file);
    assert.deepEqual(errors, []);
    const actual = findings.map((f) => `${f.line} ${f.rule}`).sort();
    assert.deepEqual(actual, expectations(file), JSON.stringify(findings, null, 2));
  });
}
