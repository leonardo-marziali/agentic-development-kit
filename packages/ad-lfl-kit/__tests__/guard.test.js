'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { isCommitCall, guardCommit } = require('../guard');
const { mkScratchDir, rmScratchDir, writeFile } = require('./helpers');

const bash = (command, extra = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  ...extra,
});

test('recognises git commit however it is spelled', () => {
  for (const command of [
    'git commit -m "x"',
    'git add -A && git commit -m x',
    'cd repo; git commit --amend --no-edit',
    'git -C "some dir" commit -m x',
    "git -c user.name='A' -c commit.gpgsign=false commit -m x",
    'git --no-pager commit',
    '(git commit -m x)',
    'git\tcommit',
    'git.exe commit -m x',
  ]) {
    assert.strictEqual(isCommitCall(bash(command)), true, command);
  }
});

test('ignores commands that only mention commit', () => {
  for (const command of [
    'git status',
    'git log --grep commit',
    'git commit-tree HEAD^{tree}',
    'git commit-graph write',
    'echo legit commit',
    'git show HEAD:commit.md',
    'mygit commit',
  ]) {
    assert.strictEqual(isCommitCall(bash(command)), false, command);
  }
});

test('covers PowerShell and MCP commit tools, not other tools', () => {
  assert.strictEqual(
    isCommitCall({ tool_name: 'PowerShell', tool_input: { command: 'git commit -m x' } }),
    true,
  );
  assert.strictEqual(isCommitCall({ tool_name: 'mcp__git__git_commit', tool_input: {} }), true);
  assert.strictEqual(isCommitCall({ tool_name: 'mcp__vcs__commit', tool_input: {} }), true);
  assert.strictEqual(isCommitCall({ tool_name: 'mcp__git__git_status', tool_input: {} }), false);
  assert.strictEqual(
    isCommitCall({ tool_name: 'Write', tool_input: { command: 'git commit' } }),
    false,
  );
  assert.strictEqual(isCommitCall(null), false);
});

function withList(names, fn) {
  const dir = mkScratchDir();
  try {
    const files = names.map((name) => writeFile(dir, name));
    const listFile = path.join(dir, 'touched.txt');
    if (files.length > 0) writeFile(dir, 'touched.txt', files.join('\n') + '\n');
    fn({ dir, files, listFile });
  } finally {
    rmScratchDir(dir);
  }
}

test('denies a commit while tracked files are still unchecked', () => {
  withList(['a.md', 'b.md'], ({ files, listFile }) => {
    let out = '';
    const result = guardCommit({
      input: bash('git commit -am x'),
      listFile,
      label: 'markdown plugin',
      write: (text) => (out += text),
    });

    assert.strictEqual(result.denied, true);
    assert.deepStrictEqual(result.files, files);
    const payload = JSON.parse(out);
    assert.strictEqual(payload.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(payload.hookSpecificOutput.permissionDecision, 'deny');
    const reason = payload.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^markdown plugin: commit blocked\. 2 file\(s\)/);
    for (const file of files) assert.ok(reason.includes(file));
  });
});

test('allows a commit once the list is gone or empty', () => {
  withList([], ({ listFile }) => {
    let out = '';
    const result = guardCommit({
      input: bash('git commit -m x'),
      listFile,
      write: (text) => (out += text),
    });
    assert.deepStrictEqual(result, { denied: false });
    assert.strictEqual(out, '');
  });
});

test('allows non-commit calls and non-PreToolUse events', () => {
  withList(['a.md'], ({ listFile }) => {
    let out = '';
    const write = (text) => (out += text);
    assert.strictEqual(guardCommit({ input: bash('git status'), listFile, write }).denied, false);
    assert.strictEqual(
      guardCommit({
        input: bash('git commit -m x', { hook_event_name: 'PostToolUse' }),
        listFile,
        write,
      }).denied,
      false,
    );
    assert.strictEqual(guardCommit({ input: null, listFile, write }).denied, false);
    assert.strictEqual(out, '');
  });
});

test('ignores tracked files that `matches` rejects', () => {
  withList(['a.py'], ({ listFile }) => {
    const result = guardCommit({
      input: bash('git commit -m x'),
      listFile,
      matches: (file) => file.endsWith('.md'),
      write: () => {},
    });
    assert.strictEqual(result.denied, false);
  });
});

test('lists at most ten files and accepts a custom reason', () => {
  const names = Array.from({ length: 12 }, (_, i) => `f${i}.md`);
  withList(names, ({ listFile }) => {
    let out = '';
    guardCommit({ input: bash('git commit'), listFile, write: (text) => (out += text) });
    assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /… and 2 more/);

    out = '';
    guardCommit({
      input: bash('git commit'),
      listFile,
      buildReason: ({ files }) => `custom ${files.length}`,
      write: (text) => (out += text),
    });
    assert.strictEqual(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, 'custom 12');
  });
});
