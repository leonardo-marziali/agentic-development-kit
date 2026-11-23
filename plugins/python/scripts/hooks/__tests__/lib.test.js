'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isPythonFile,
  isIgnoredPath,
  findVenvBinDir,
  resolveTool,
  resolveConfigDir,
  groupByConfigDir,
  pythonPathFor,
  parsePyrightJson,
  formatPyrightReport,
  autoSuppressEnabled,
  insertPyrightIgnores,
  insertNoqa,
  parseRuffJson,
} = require('../lib');
const { mkScratchDir, rmScratchDir } = require('./helpers');

const BIN = process.platform === 'win32' ? 'Scripts' : 'bin';

function scratch(t) {
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  return dir;
}

function fakeExecutable(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, process.platform === 'win32' ? `${name}.exe` : name);
  fs.writeFileSync(file, '#!/bin/sh\n');
  fs.chmodSync(file, 0o755);
  return file;
}

// Runs fn with PATH replaced, restoring it afterwards.
function withPath(dirs, fn) {
  const saved = process.env.PATH;
  process.env.PATH = dirs.join(path.delimiter);
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

function withEnv(name, value, fn) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

function diag(file, line, rule, severity = 'error', message = 'msg') {
  return {
    file,
    severity,
    message,
    rule,
    range: { start: { line, character: 0 }, end: { line, character: 1 } },
  };
}

test('isPythonFile: matches .py and .pyi, case-insensitively, and nothing else', () => {
  assert.equal(isPythonFile('/a/mod.py'), true);
  assert.equal(isPythonFile('/a/mod.pyi'), true);
  assert.equal(isPythonFile('/a/MOD.PY'), true);
  assert.equal(isPythonFile('/a/mod.pyc'), false);
  assert.equal(isPythonFile('/a/mod.py.bak'), false);
  assert.equal(isPythonFile('/a/notes.md'), false);
});

test('isIgnoredPath: skips virtualenvs, caches and vendored trees', () => {
  const root = path.resolve('/project');
  assert.equal(isIgnoredPath(path.join(root, 'src', 'mod.py')), false);
  for (const segment of ['.venv', 'venv', 'node_modules', '.git', '__pycache__', 'site-packages']) {
    assert.equal(isIgnoredPath(path.join(root, segment, 'x', 'mod.py')), true, segment);
  }
});

test('isIgnoredPath: only matches whole directory names', () => {
  assert.equal(isIgnoredPath(path.resolve('/project/my.venv.py/mod.py')), false);
  assert.equal(isIgnoredPath(path.resolve('/project/.venv.py')), false);
});

test('findVenvBinDir: walks up to the nearest .venv', (t) => {
  const root = scratch(t);
  fs.mkdirSync(path.join(root, '.venv', BIN), { recursive: true });
  const nested = path.join(root, 'src', 'pkg');
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(findVenvBinDir(nested), path.join(root, '.venv', BIN));
});

test('findVenvBinDir: returns null when there is no .venv above', (t) => {
  const root = scratch(t);
  assert.equal(findVenvBinDir(root), null);
});

test('resolveTool: prefers the project .venv over PATH', (t) => {
  const root = scratch(t);
  const venvBin = path.join(root, '.venv', BIN);
  fakeExecutable(venvBin, 'ruff');
  const pathDir = path.join(root, 'path-bin');
  fakeExecutable(pathDir, 'ruff');

  const resolved = withPath([pathDir], () => resolveTool('ruff', { fromDir: root }));

  assert.deepEqual(resolved, {
    name: 'ruff',
    prefix: [],
    extraDirs: [venvBin],
    exe: path.join(venvBin, process.platform === 'win32' ? 'ruff.exe' : 'ruff'),
  });
});

test('resolveTool: ignores a .venv that lacks the tool', (t) => {
  const root = scratch(t);
  fs.mkdirSync(path.join(root, '.venv', BIN), { recursive: true });
  const pathDir = path.join(root, 'path-bin');
  fakeExecutable(pathDir, 'ruff');

  const resolved = withPath([pathDir], () => resolveTool('ruff', { fromDir: root }));

  assert.deepEqual(resolved, { name: 'ruff', prefix: [], extraDirs: [] });
});

test('resolveTool: falls back to uvx for ruff when it is only reachable that way', (t) => {
  const root = scratch(t);
  const pathDir = path.join(root, 'path-bin');
  fakeExecutable(pathDir, 'uvx');

  const resolved = withPath([pathDir], () => resolveTool('ruff', { fromDir: root }));

  assert.deepEqual(resolved, { name: 'uvx', prefix: ['ruff'], extraDirs: [] });
});

test('resolveTool: returns null for ruff when neither ruff nor uvx exists', (t) => {
  const root = scratch(t);
  assert.equal(
    withPath([], () => resolveTool('ruff', { fromDir: root })),
    null,
  );
});

test('resolveTool: falls back to npx for pyright', (t) => {
  const root = scratch(t);
  const resolved = withPath([], () => resolveTool('pyright', { fromDir: root }));
  assert.deepEqual(resolved, { name: 'npx', prefix: ['-y', 'pyright'], extraDirs: [] });
});

test(
  'resolveTool: does not count a non-executable file on PATH',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = scratch(t);
    const pathDir = path.join(root, 'path-bin');
    fs.mkdirSync(pathDir);
    fs.writeFileSync(path.join(pathDir, 'ruff'), '');

    assert.equal(
      withPath([pathDir], () => resolveTool('ruff', { fromDir: root })),
      null,
    );
  },
);

test('resolveConfigDir: finds pyproject.toml in an ancestor', (t) => {
  const root = scratch(t);
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "x"\n');
  const nested = path.join(root, 'src', 'pkg');
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(resolveConfigDir(path.join(nested, 'mod.py')), root);
});

test('resolveConfigDir: stops at the nearest config, pyrightconfig.json included', (t) => {
  const root = scratch(t);
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '');
  const near = path.join(root, 'packages', 'a');
  fs.mkdirSync(near, { recursive: true });
  fs.writeFileSync(path.join(near, 'pyrightconfig.json'), '{}');

  assert.equal(resolveConfigDir(path.join(near, 'mod.py')), near);
});

test("resolveConfigDir: falls back to the file's own directory", (t) => {
  const root = scratch(t);
  assert.equal(resolveConfigDir(path.join(root, 'mod.py')), root);
});

test('groupByConfigDir: splits files across monorepo packages', (t) => {
  const root = scratch(t);
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'pyproject.toml'), '');
  fs.writeFileSync(path.join(b, 'pyproject.toml'), '');

  const groups = groupByConfigDir([
    path.join(a, 'x.py'),
    path.join(b, 'y.py'),
    path.join(a, 'z.py'),
  ]);

  assert.deepEqual(groups.get(a), [path.join(a, 'x.py'), path.join(a, 'z.py')]);
  assert.deepEqual(groups.get(b), [path.join(b, 'y.py')]);
});

test("pythonPathFor: returns the config dir's .venv interpreter", (t) => {
  const root = scratch(t);
  const python = fakeExecutable(path.join(root, '.venv', BIN), 'python');
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[tool.pyright]\nstrict = ["src"]\n');

  assert.equal(pythonPathFor(root), python);
});

test('pythonPathFor: defers to a venv named in the config', (t) => {
  const root = scratch(t);
  fakeExecutable(path.join(root, '.venv', BIN), 'python');
  fs.writeFileSync(path.join(root, 'pyrightconfig.json'), '{\n  "venv": "other"\n}\n');

  assert.equal(pythonPathFor(root), null);
});

test('pythonPathFor: returns null without a .venv', (t) => {
  const root = scratch(t);
  assert.equal(pythonPathFor(root), null);
});

test('parsePyrightJson: keeps only error-severity diagnostics', () => {
  const raw = JSON.stringify({
    generalDiagnostics: [
      diag('/a.py', 0, 'reportAssignmentType'),
      diag('/a.py', 1, 'reportUnusedVariable', 'warning'),
      diag('/a.py', 2, undefined, 'information'),
    ],
  });

  const parsed = parsePyrightJson(raw);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].rule, 'reportAssignmentType');
});

test('parsePyrightJson: recovers the payload from behind npx notices', () => {
  const raw =
    'npm warn exec The following package was not found and will be installed: pyright\n' +
    JSON.stringify({ generalDiagnostics: [diag('/a.py', 0, 'reportAssignmentType')] });

  assert.equal(parsePyrightJson(raw).length, 1);
});

test('parsePyrightJson: returns null for empty or unparseable input', () => {
  assert.equal(parsePyrightJson(''), null);
  assert.equal(parsePyrightJson(undefined), null);
  assert.equal(parsePyrightJson('not json'), null);
  assert.equal(parsePyrightJson('{"summary": {}}'), null);
});

test('formatPyrightReport: 1-based positions, indented continuation, rule last', () => {
  const report = formatPyrightReport([
    diag('/a.py', 3, 'reportAssignmentType', 'error', 'bad\n  because'),
    diag('/b.py', 0, undefined, 'error', 'syntax'),
  ]);

  assert.equal(
    report,
    '/a.py:4:1 - error: bad\n      because (reportAssignmentType)\n/b.py:1:1 - error: syntax',
  );
});

test('autoSuppressEnabled: truthy spellings on, anything else off', () => {
  for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
    assert.equal(
      withEnv('CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS', value, autoSuppressEnabled),
      true,
      value,
    );
  }
  for (const value of [undefined, '', 'false', '0', 'off']) {
    assert.equal(
      withEnv('CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS', value, autoSuppressEnabled),
      false,
      String(value),
    );
  }
});

test('insertPyrightIgnores: appends one comment per line, merging rules on the same line', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'mod.py');
  fs.writeFileSync(file, 'a: int = "x"\nb = 1\nc: str = 1   \n');

  const suppressed = insertPyrightIgnores([
    diag(file, 0, 'reportAssignmentType'),
    diag(file, 0, 'reportOther'),
    diag(file, 2, 'reportAssignmentType'),
  ]);

  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'a: int = "x"  # pyright: ignore[reportAssignmentType, reportOther]\n' +
      'b = 1\n' +
      'c: str = 1  # pyright: ignore[reportAssignmentType]\n',
  );
  assert.equal(suppressed.length, 2);
  assert.deepEqual(suppressed[0], {
    file,
    lineNumber: 1,
    rules: ['reportAssignmentType', 'reportOther'],
  });
});

test('insertPyrightIgnores: merges into an existing ignore comment', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'mod.py');
  fs.writeFileSync(file, 'a = f()  # pyright: ignore[reportA]\n');

  insertPyrightIgnores([diag(file, 0, 'reportB'), diag(file, 0, 'reportA')]);

  assert.equal(fs.readFileSync(file, 'utf8'), 'a = f()  # pyright: ignore[reportA, reportB]\n');
});

test('insertPyrightIgnores: leaves rule-less diagnostics and continuation lines alone', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'mod.py');
  const original = 'x = (\ny = 1 + \\\n    2\n';
  fs.writeFileSync(file, original);

  const suppressed = insertPyrightIgnores([diag(file, 0, undefined), diag(file, 1, 'reportX')]);

  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(suppressed, []);
});

test('insertPyrightIgnores: preserves CRLF line endings', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'mod.py');
  fs.writeFileSync(file, 'a: int = "x"\r\nb = 1\r\n');

  insertPyrightIgnores([diag(file, 0, 'reportAssignmentType')]);

  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'a: int = "x"  # pyright: ignore[reportAssignmentType]\r\nb = 1\r\n',
  );
});

function ruffFinding(filename, row, code, noqaRow) {
  return { filename, code, location: { row, column: 1 }, noqa_row: noqaRow ?? row };
}

test('insertNoqa: appends one comment per line, merging codes on the same line', (t) => {
  const file = path.join(scratch(t), 'mod.py');
  fs.writeFileSync(file, 'a = 1\nb = 2\n');

  const suppressed = insertNoqa([
    ruffFinding(file, 1, 'F841'),
    ruffFinding(file, 1, 'E501'),
    ruffFinding(file, 2, 'F841'),
  ]);

  assert.equal(fs.readFileSync(file, 'utf8'), 'a = 1  # noqa: F841, E501\nb = 2  # noqa: F841\n');
  assert.equal(suppressed.length, 2);
});

test('insertNoqa: merges into an existing noqa directive', (t) => {
  const file = path.join(scratch(t), 'mod.py');
  fs.writeFileSync(file, 'a = 1  # noqa: E501\n');

  insertNoqa([ruffFinding(file, 1, 'F841'), ruffFinding(file, 1, 'E501')]);

  assert.equal(fs.readFileSync(file, 'utf8'), 'a = 1  # noqa: E501, F841\n');
});

test('insertNoqa: leaves blanket noqa, continuation lines and codeless findings alone', (t) => {
  const file = path.join(scratch(t), 'mod.py');
  const text = 'a = 1  # noqa\nb = 1 + \\\n    2\nc = (\n';
  fs.writeFileSync(file, text);

  const suppressed = insertNoqa([
    ruffFinding(file, 1, 'F841'),
    ruffFinding(file, 2, 'F841'),
    { filename: file, code: null, location: { row: 4, column: 1 }, noqa_row: 4 },
  ]);

  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(suppressed, []);
});

test("insertNoqa: comments ruff's noqa_row and preserves CRLF", (t) => {
  const file = path.join(scratch(t), 'mod.py');
  fs.writeFileSync(file, 'x = """\r\nlong\r\n"""\r\n');

  insertNoqa([ruffFinding(file, 2, 'E501', 3)]);

  assert.equal(fs.readFileSync(file, 'utf8'), 'x = """\r\nlong\r\n"""  # noqa: E501\r\n');
});

test('parseRuffJson: reads the findings array, also from behind launcher notices', () => {
  const findings = [{ code: 'F841', filename: 'a.py', location: { row: 1, column: 1 } }];
  assert.deepEqual(parseRuffJson(JSON.stringify(findings)), findings);
  assert.deepEqual(parseRuffJson(`Installed 1 package\n${JSON.stringify(findings)}\n`), findings);
});

test('parseRuffJson: returns null for empty, non-array or unparseable input', () => {
  assert.equal(parseRuffJson(''), null);
  assert.equal(parseRuffJson('{"not": "an array"}'), null);
  assert.equal(parseRuffJson('error: no [valid json'), null);
});
