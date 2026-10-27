'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendTrackedFile, agentStateDir } = require('./state');
const { snapshotWorkspace, advanceSnapshot, filesChangedSince } = require('./changes');

/*
 * The PostToolUse half of the loop: records the files a tool just wrote, so
 * the Stop hook only ever inspects files this session actually touched —
 * never pre-existing content the user didn't ask us to police.
 */

// Tools that name the one file they write in their input.
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/*
 * Tools that can write files without saying which: shells and MCP servers.
 * Read-only built-ins (Read, Grep, Glob, WebFetch…) are left out so their
 * hooks don't pay for a workspace scan on every call. A subagent's own tool
 * calls fire these hooks themselves, so Agent/Task needs no entry.
 */
const SHELL_TOOL = /^(Bash|PowerShell|mcp__.+)$/;

const PENDING_DIR = 'pending';
const BACKGROUND_DIR = 'background';

// A Pre marker whose Post never came (a denied permission, a crash).
const STALE_MARKER_MS = 24 * 60 * 60 * 1000;

/*
 * How long a background command's writes keep being attributed to the
 * session. Claude Code doesn't tell hooks when a background command exits,
 * so its window closes on a clock instead: long enough for a build, a
 * codegen run or a test suite, short enough that a dev server left running
 * doesn't make the session answer for the rest of the day's edits.
 */
const BACKGROUND_WINDOW_MS = 2 * 60 * 60 * 1000;

// Events that only collect what background commands wrote since last time.
const STOP_EVENTS = new Set(['Stop', 'SubagentStop']);

function resolveToolPath(input) {
  const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!filePath) return null;

  /*
   * Tool inputs may carry a relative path; it resolves against the session's
   * cwd, not this hook process's, which can differ.
   */
  const cwd = input.cwd || process.cwd();
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

/*
 * Appends to the session's list and, for a file a subagent wrote, to that
 * subagent's own list as well (see agentStateDir).
 */
function record(listFile, absPath, agentId) {
  const lists = [listFile];
  if (agentId) {
    lists.push(path.join(agentStateDir(path.dirname(listFile), agentId), path.basename(listFile)));
  }
  for (const list of lists) {
    fs.mkdirSync(path.dirname(list), { recursive: true });
    appendTrackedFile(list, absPath);
  }
}

/*
 * Tracks the file an Edit, Write, MultiEdit or NotebookEdit call wrote.
 *
 * `matches` decides what's in scope for the calling plugin and receives the
 * resolved absolute path. Returns the path that was tracked, or null when the
 * event wasn't one we care about — callers generally ignore the return and
 * just let the hook exit.
 */
function trackTouchedFile({ input, listFile, matches }) {
  if (!input) return null;
  if (!FILE_TOOLS.has(input.tool_name || '')) return null;

  const absPath = resolveToolPath(input);
  if (!absPath || !fs.existsSync(absPath)) return null;
  if (typeof matches === 'function' && !matches(absPath)) return null;

  record(listFile, absPath, input.agent_id);
  return absPath;
}

function markerFile(stateDir, toolUseId, kind = PENDING_DIR) {
  return path.join(stateDir, kind, `${String(toolUseId).replaceAll(/[^\w-]/g, '_')}.json`);
}

/*
 * A `run_in_background: true` call, or one the user sent to the background
 * mid-run: its Post event fires as soon as it's backgrounded, while the
 * command itself keeps writing.
 */
function isBackgrounded(input) {
  return (
    input.tool_input?.run_in_background === true || Boolean(input.tool_response?.backgroundTaskId)
  );
}

// Rename over the old file, so a concurrent reader never sees half of one.
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

/*
 * Keeps watching after a background command's Post event: its snapshot,
 * moved up to now, is left under `<stateDir>/background/` for later events
 * to sweep. `cwd` is where the call left the session, which filesChangedSince
 * also scans.
 */
function openBackgroundWindow(stateDir, input, snapshot, now) {
  writeJsonAtomic(markerFile(stateDir, input.tool_use_id, BACKGROUND_DIR), {
    openedAt: now,
    cwd: input.cwd,
    agentId: input.agent_id,
    snapshot,
  });
}

/*
 * Everything open background commands wrote since the last sweep, each
 * window then moved up to `now` — or, once BACKGROUND_WINDOW_MS has passed,
 * closed after this last look.
 */
function sweepBackgroundWindows(stateDir, now) {
  const dir = path.join(stateDir, BACKGROUND_DIR);
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }

  const changes = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let window;
    try {
      window = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // Swept and closed by a concurrent hook, or unreadable: fail closed.
      fs.rmSync(file, { force: true });
      continue;
    }

    const expired = !(now - window.openedAt < BACKGROUND_WINDOW_MS);
    const next = expired ? null : advanceSnapshot(window.snapshot, { now });
    for (const changed of filesChangedSince(window.snapshot, { cwd: window.cwd })) {
      changes.push({ file: changed, agentId: window.agentId });
    }
    try {
      if (expired) fs.rmSync(file, { force: true });
      else writeJsonAtomic(file, { ...window, snapshot: next });
    } catch {
      // best effort
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    // windows still open
  }
  return changes;
}

function pruneStaleMarkers(pendingDir, now) {
  let names;
  try {
    names = fs.readdirSync(pendingDir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(pendingDir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_MARKER_MS) fs.rmSync(full, { force: true });
    } catch {
      // best effort
    }
  }
}

function takeMarker(file) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.rmSync(file, { force: true });
    try {
      fs.rmdirSync(path.dirname(file));
    } catch {
      // other calls still pending
    }
    return snapshot;
  } catch {
    return null;
  }
}

/*
 * The files one tool call wrote, whatever the tool.
 *
 * Wire it to PreToolUse, PostToolUse and PostToolUseFailure — a shell
 * command that edits files and then exits non-zero (`./fix.py && pytest`)
 * reports through PostToolUseFailure, not PostToolUse:
 *
 *   - PreToolUse on a shell or MCP tool: records a snapshot under
 *     `<stateDir>/pending/<tool_use_id>.json` and returns [].
 *   - Post* on an Edit-family tool: the one file it names, if it exists.
 *   - Post* on a shell or MCP tool: every file changed since the snapshot
 *     (see changes.js), consuming the snapshot. No snapshot, no files —
 *     the PreToolUse hook wasn't wired, or the call was never seen starting.
 *
 * A backgrounded command's Post event fires when it's sent to the
 * background, not when it exits, so its snapshot moves to
 * `<stateDir>/background/` instead, and every later Post* — and a Stop or
 * SubagentStop, which only does this — also returns what open background
 * commands wrote since the last such sweep.
 *
 * Each snapshot is consumed by the first Post hook that reads it, so a
 * plugin should have one script per state dir call this.
 */
function toolChangedEntries({ input, stateDir, now }) {
  const tool = input.tool_name || '';
  const event = input.hook_event_name || 'PostToolUse';
  const own = (files) => files.map((file) => ({ file, agentId: input.agent_id }));

  if (event === 'PreToolUse') {
    if (SHELL_TOOL.test(tool) && input.tool_use_id) {
      const marker = markerFile(stateDir, input.tool_use_id);
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      pruneStaleMarkers(path.dirname(marker), now);
      fs.writeFileSync(marker, JSON.stringify(snapshotWorkspace(input.cwd, { now })));
    }
    return [];
  }

  const changes = sweepBackgroundWindows(stateDir, now);
  if (STOP_EVENTS.has(event)) return changes;

  if (FILE_TOOLS.has(tool)) {
    const absPath = resolveToolPath(input);
    return absPath && fs.existsSync(absPath) ? [...changes, ...own([absPath])] : changes;
  }

  if (!SHELL_TOOL.test(tool) || !input.tool_use_id) return changes;
  const snapshot = takeMarker(markerFile(stateDir, input.tool_use_id));
  if (!snapshot) return changes;

  const next = isBackgrounded(input) ? advanceSnapshot(snapshot, { now }) : null;
  changes.push(...own(filesChangedSince(snapshot, { cwd: input.cwd })));
  if (next) openBackgroundWindow(stateDir, input, next, now);
  return changes;
}

function toolChangedFiles({ input, stateDir, now = Date.now() }) {
  if (!input) return [];
  return [...new Set(toolChangedEntries({ input, stateDir, now }).map(({ file }) => file))];
}

/*
 * toolChangedFiles + trackTouchedFile's bookkeeping: tracks every file the
 * call wrote that `matches` accepts, in the session's list and (inside a
 * subagent) the subagent's. Snapshots live beside `listFile`. Returns the
 * paths tracked.
 *
 * Call it from the Stop/SubagentStop hook too, before reading `listFile`,
 * to collect what background commands wrote after the last tool call. A
 * background command's file goes in its subagent's list only when that
 * subagent is the one sweeping: one that has already stopped has no loop
 * left to read it, and the session's list still gets it.
 */
function trackSessionChanges({ input, listFile, matches, now = Date.now() }) {
  if (!input) return [];
  const tracked = [];
  for (const { file, agentId } of toolChangedEntries({
    input,
    stateDir: path.dirname(listFile),
    now,
  })) {
    if (typeof matches === 'function' && !matches(file)) continue;
    record(listFile, file, agentId && agentId === input.agent_id ? agentId : undefined);
    if (!tracked.includes(file)) tracked.push(file);
  }
  return tracked;
}

module.exports = { BACKGROUND_WINDOW_MS, trackTouchedFile, toolChangedFiles, trackSessionChanges };
