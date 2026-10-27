'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { trackTouchedFile, toolChangedFiles, trackSessionChanges } = require('../track');
const { readTrackedFiles, agentStateDir } = require('../state');
const { mkScratchDir, mkScratchRepo, rmScratchDir, writeFile } = require('./helpers');

function payload(dir, filePath, overrides = {}) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
    cwd: dir,
    session_id: 'test-session',
    ...overrides,
  };
}

test('tracks an edited file that matches', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'state', 'touched.txt');
    const target = writeFile(dir, 'doc.md');

    const tracked = trackTouchedFile({
      input: payload(dir, target),
      listFile,
      matches: (p) => p.endsWith('.md'),
    });

    assert.strictEqual(tracked, target);
    assert.strictEqual(fs.readFileSync(listFile, 'utf8').trim(), target);
  } finally {
    rmScratchDir(dir);
  }
});

test('resolves a relative tool path against the session cwd', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'nested/doc.md');

    const tracked = trackTouchedFile({
      input: payload(dir, 'nested/doc.md'),
      listFile,
      matches: () => true,
    });

    assert.strictEqual(tracked, target);
  } finally {
    rmScratchDir(dir);
  }
});

test('ignores tools other than Edit and Write', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'doc.md');

    const tracked = trackTouchedFile({
      input: payload(dir, target, { tool_name: 'Read' }),
      listFile,
      matches: () => true,
    });

    assert.strictEqual(tracked, null);
    assert.strictEqual(fs.existsSync(listFile), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('accepts Write as well as Edit', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'doc.md');
    const tracked = trackTouchedFile({
      input: payload(dir, target, { tool_name: 'Write' }),
      listFile,
      matches: () => true,
    });
    assert.strictEqual(tracked, target);
  } finally {
    rmScratchDir(dir);
  }
});

test('ignores a file the matcher rejects', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'notes.txt');
    const tracked = trackTouchedFile({
      input: payload(dir, target),
      listFile,
      matches: (p) => p.endsWith('.md'),
    });
    assert.strictEqual(tracked, null);
    assert.strictEqual(fs.existsSync(listFile), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('ignores a file that no longer exists', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const tracked = trackTouchedFile({
      input: payload(dir, path.join(dir, 'gone.md')),
      listFile,
      matches: () => true,
    });
    assert.strictEqual(tracked, null);
  } finally {
    rmScratchDir(dir);
  }
});

test('returns null for null input or a missing file_path', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    assert.strictEqual(trackTouchedFile({ input: null, listFile, matches: () => true }), null);
    assert.strictEqual(
      trackTouchedFile({
        input: { tool_name: 'Edit', tool_input: {} },
        listFile,
        matches: () => true,
      }),
      null,
    );
  } finally {
    rmScratchDir(dir);
  }
});

test('tracks everything when no matcher is supplied', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'anything.bin');
    assert.strictEqual(trackTouchedFile({ input: payload(dir, target), listFile }), target);
  } finally {
    rmScratchDir(dir);
  }
});

test('accepts MultiEdit and NotebookEdit, reading notebook_path for the latter', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const py = writeFile(dir, 'a.py');
    const nb = writeFile(dir, 'b.ipynb');
    assert.strictEqual(
      trackTouchedFile({ input: payload(dir, py, { tool_name: 'MultiEdit' }), listFile }),
      py,
    );
    assert.strictEqual(
      trackTouchedFile({
        input: {
          ...payload(dir, null),
          tool_name: 'NotebookEdit',
          tool_input: { notebook_path: nb },
        },
        listFile,
      }),
      nb,
    );
  } finally {
    rmScratchDir(dir);
  }
});

test("also tracks a subagent's file in that subagent's own list", () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'state', 'touched.txt');
    const target = writeFile(dir, 'doc.md');
    trackTouchedFile({ input: payload(dir, target, { agent_id: 'abc123' }), listFile });

    const agentList = path.join(agentStateDir(path.dirname(listFile), 'abc123'), 'touched.txt');
    assert.deepStrictEqual(readTrackedFiles(listFile), [target]);
    assert.deepStrictEqual(readTrackedFiles(agentList), [target]);
  } finally {
    rmScratchDir(dir);
  }
});

function bashEvent(repo, event, extra = {}) {
  return {
    hook_event_name: event,
    tool_name: 'Bash',
    tool_input: { command: 'python fix.py' },
    tool_use_id: 'toolu_01',
    cwd: repo,
    session_id: 'test-session',
    ...extra,
  };
}

function aged(file) {
  const then = new Date(Date.now() - 60_000);
  fs.utimesSync(file, then, then);
  return file;
}

test('tracks the files a Bash command wrote between PreToolUse and PostToolUse', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n', 'b.py': 'y = 1\n', 'c.md': '# c\n' });
  const state = mkScratchDir();
  try {
    for (const name of ['a.py', 'b.py', 'c.md']) aged(path.join(repo, name));
    const listFile = path.join(state, 'touched.txt');
    const matches = (p) => p.endsWith('.py');

    assert.deepStrictEqual(
      trackSessionChanges({ input: bashEvent(repo, 'PreToolUse'), listFile, matches }),
      [],
    );
    fs.writeFileSync(path.join(repo, 'a.py'), 'x = 2\n');
    fs.writeFileSync(path.join(repo, 'c.md'), '# changed\n');

    const tracked = trackSessionChanges({
      input: bashEvent(repo, 'PostToolUse'),
      listFile,
      matches,
    });
    assert.deepStrictEqual(tracked, [path.join(repo, 'a.py')]);
    assert.deepStrictEqual(readTrackedFiles(listFile), [path.join(repo, 'a.py')]);
    assert.strictEqual(fs.existsSync(path.join(state, 'pending')), false, 'snapshot consumed');
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('tracks a failed Bash command too, via PostToolUseFailure', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  const state = mkScratchDir();
  try {
    aged(path.join(repo, 'a.py'));
    const listFile = path.join(state, 'touched.txt');
    trackSessionChanges({ input: bashEvent(repo, 'PreToolUse'), listFile });
    fs.writeFileSync(path.join(repo, 'a.py'), 'x = 2\n');
    const tracked = trackSessionChanges({
      input: bashEvent(repo, 'PostToolUseFailure', { error: 'Exit code 1' }),
      listFile,
    });
    assert.deepStrictEqual(tracked, [path.join(repo, 'a.py')]);
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test("tracks a subagent's Bash writes in its own list as well", () => {
  const repo = mkScratchRepo({ README: 'x\n' });
  const state = mkScratchDir();
  try {
    const listFile = path.join(state, 'touched.txt');
    const extra = { agent_id: 'def456' };
    trackSessionChanges({ input: bashEvent(repo, 'PreToolUse', extra), listFile });
    const written = writeFile(repo, 'new.py', 'x = 1\n');
    trackSessionChanges({ input: bashEvent(repo, 'PostToolUse', extra), listFile });

    assert.deepStrictEqual(readTrackedFiles(listFile), [written]);
    assert.deepStrictEqual(
      readTrackedFiles(path.join(agentStateDir(state, 'def456'), 'touched.txt')),
      [written],
    );
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('treats MCP tools like shell commands', () => {
  const repo = mkScratchRepo({ README: 'x\n' });
  const state = mkScratchDir();
  try {
    const extra = { tool_name: 'mcp__fs__write_file', tool_input: {} };
    toolChangedFiles({ input: bashEvent(repo, 'PreToolUse', extra), stateDir: state });
    const written = writeFile(repo, 'out.py', 'x = 1\n');
    assert.deepStrictEqual(
      toolChangedFiles({ input: bashEvent(repo, 'PostToolUse', extra), stateDir: state }),
      [written],
    );
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('finds nothing for a Bash call whose start was never seen', () => {
  const repo = mkScratchRepo({ README: 'x\n' });
  const state = mkScratchDir();
  try {
    writeFile(repo, 'new.py', 'x = 1\n');
    assert.deepStrictEqual(
      toolChangedFiles({ input: bashEvent(repo, 'PostToolUse'), stateDir: state }),
      [],
    );
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('never scans for read-only tools', () => {
  const repo = mkScratchRepo({ README: 'x\n' });
  const state = mkScratchDir();
  try {
    const extra = { tool_name: 'Read', tool_input: { file_path: path.join(repo, 'x') } };
    toolChangedFiles({ input: bashEvent(repo, 'PreToolUse', extra), stateDir: state });
    assert.strictEqual(fs.existsSync(path.join(state, 'pending')), false);
    writeFile(repo, 'new.py');
    assert.deepStrictEqual(
      toolChangedFiles({ input: bashEvent(repo, 'PostToolUse', extra), stateDir: state }),
      [],
    );
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('prunes snapshots a PostToolUse never consumed', () => {
  const repo = mkScratchRepo({ README: 'x\n' });
  const state = mkScratchDir();
  try {
    const stale = writeFile(state, 'pending/toolu_old.json', '{}');
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    toolChangedFiles({ input: bashEvent(repo, 'PreToolUse'), stateDir: state });
    assert.strictEqual(fs.existsSync(stale), false);
    assert.strictEqual(fs.existsSync(path.join(state, 'pending', 'toolu_01.json')), true);
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});
