'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratchDir, rmScratchDir, installedEngine, SKIP_WITHOUT_JDK } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'archunit');

function javaSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? javaSources(full) : entry.name.endsWith('.java') ? [full] : [];
  });
}

function compile(manifest, outDir, ...sourceDirs) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = spawnSync(
    manifest.javac,
    ['-d', outDir, '-cp', outDir, ...sourceDirs.flatMap(javaSources)],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

function runner(manifest, args) {
  const classpath = [manifest.classes.archunit, ...manifest.jars.archunit].join(path.delimiter);
  const result = spawnSync(
    manifest.javaBin,
    ['-cp', classpath, 'dev.adk.java.archunit.Runner', ...args],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split('\n')
    .filter((line) => line.startsWith('FINDING\t'))
    .map((line) => {
      const [, file, lineNo, rule, message] = line.split('\t');
      return { file, line: Number(lineNo), rule, message };
    });
}

async function setup(t) {
  const manifest = await installedEngine();
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  const classes = path.join(dir, 'classes');
  compile(manifest, classes, path.join(FIXTURES, 'base'));
  return { manifest, dir, classes };
}

const rulesOf = (findings) => [...new Set(findings.map((f) => f.rule))].sort();

test('reports the standard rules a project breaks', { skip: SKIP_WITHOUT_JDK }, async (t) => {
  const { manifest, classes } = await setup(t);

  const findings = runner(manifest, [
    '--classes',
    classes,
    '--packages',
    'com.acme..',
    '--base-package',
    'com.acme',
  ]);

  assert.deepEqual(rulesOf(findings), ['D1', 'D5', 'S24', 'S7']);
  const s24 = findings.find((f) => f.rule === 'S24');
  assert.match(s24.message, /saveProject/);
  assert.equal(s24.file, 'com/acme/project/service/ProjectService.java');
  const d5 = findings.find((f) => f.rule === 'D5');
  assert.equal(d5.file, 'com/acme/project/api/ProjectController.java');
  assert.equal(d5.line, 8);
});

test(
  'a *UseCase class has exactly one public method, handle (S24)',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const { manifest, dir } = await setup(t);
    const classes = path.join(dir, 'usecase-classes');
    compile(manifest, classes, path.join(FIXTURES, 'usecase'));

    const findings = runner(manifest, ['--classes', classes, '--packages', 'com.acme..']);

    const flagged = findings
      .filter((f) => f.rule === 'S24')
      .map((f) => path.basename(f.file))
      .sort();
    // ArchiveProjectUseCase: Consumer's accept is an extra public method; Ship: notify; Rename: no handle.
    assert.deepEqual(flagged, [
      'ArchiveProjectUseCase.java',
      'RenameProjectUseCase.java',
      'ShipProjectUseCase.java',
    ]);
    assert.match(
      findings.find((f) => f.file.endsWith('ShipProjectUseCase.java')).message,
      /notify/,
    );
  },
);

test(
  'S40 accepts a servlet or a WebFlux ResponseEntityExceptionHandler',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const { manifest, dir } = await setup(t);
    const classes = path.join(dir, 'advice-classes');
    compile(manifest, classes, path.join(FIXTURES, 'advice'));

    const findings = runner(manifest, ['--classes', classes, '--packages', 'com.acme..']);

    assert.deepEqual(
      findings.filter((f) => f.rule === 'S40').map((f) => path.basename(f.file)),
      ['PlainAdvice.java'],
    );
  },
);

test(
  'skips disabled rules and classes outside the packages',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const { manifest, classes } = await setup(t);

    const disabled = runner(manifest, [
      '--classes',
      classes,
      '--packages',
      'com.acme..',
      '--disabled',
      'S24,S7,D5',
    ]);
    assert.deepEqual(rulesOf(disabled), ['D1']);

    assert.deepEqual(runner(manifest, ['--classes', classes, '--packages', 'com.other..']), []);
  },
);

test(
  'a freeze baseline hides existing violations but not new ones',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const { manifest, dir, classes } = await setup(t);
    const store = path.join(dir, 'archunit-store');
    const args = ['--classes', classes, '--packages', 'com.acme..', '--store', store];

    assert.deepEqual(runner(manifest, [...args, '--create-store']), []);
    assert.deepEqual(runner(manifest, args), []);

    compile(manifest, classes, path.join(FIXTURES, 'base'), path.join(FIXTURES, 'extra'));
    const findings = runner(manifest, args);
    assert.deepEqual(rulesOf(findings), ['D1']);
    assert.match(findings[0].message, /Task/);
  },
);

test(
  'ignores a project archunit.properties among the classes',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const { manifest, dir, classes } = await setup(t);
    fs.writeFileSync(
      path.join(classes, 'archunit.properties'),
      `freeze.store.default.path=${path.join(dir, 'elsewhere')}\nfreeze.store.default.allowStoreCreation=true\n`,
    );

    const findings = runner(manifest, ['--classes', classes, '--packages', 'com.acme..']);

    assert.deepEqual(rulesOf(findings), ['D1', 'D5', 'S24', 'S7']);
    assert.equal(fs.existsSync(path.join(dir, 'elsewhere')), false);
  },
);

test(
  'a rule the baseline never recorded is checked, not silently frozen',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const { manifest, dir, classes } = await setup(t);
    const store = path.join(dir, 'archunit-store');
    const args = ['--classes', classes, '--packages', 'com.acme..', '--store', store];

    runner(manifest, [...args, '--create-store', '--disabled', 'S24']);

    assert.deepEqual(rulesOf(runner(manifest, args)), ['S24']);
    assert.deepEqual(rulesOf(runner(manifest, args)), ['S24'], 'still reported on the next stop');
    assert.doesNotMatch(fs.readFileSync(path.join(store, 'stored.rules'), 'utf8'), /vocabulary/);
  },
);
