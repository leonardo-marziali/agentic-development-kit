'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendTrackedFile, agentStateDir } = require('./state');
const { snapshotWorkspace, filesChangedSince } = require('./changes');

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

// A Pre marker whose Post never came (a denied permission, a crash).
const STALE_MARKER_MS = 24 * 60 * 60 * 1000;

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
 * Appends to the session's list and, for a subagent's tool call, to that
 * subagent's own list as well (see agentStateDir).
 */
function record(listFile, absPath, input) {
  const lists = [listFile];
  if (input.agent_id) {
    lists.push(
      path.join(agentStateDir(path.dirname(listFile), input.agent_id), path.basename(listFile)),
    );
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

  record(listFile, absPath, input);
  return absPath;
}

function markerFile(stateDir, toolUseId) {
  return path.join(stateDir, PENDING_DIR, `${String(toolUseId).replaceAll(/[^\w-]/g, '_')}.json`);
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
 * Each snapshot is consumed by the first Post hook that reads it, so a
 * plugin should have one script per state dir call this.
 */
function toolChangedFiles({ input, stateDir, now = Date.now() }) {
  if (!input) return [];
  const tool = input.tool_name || '';
  const event = input.hook_event_name || 'PostToolUse';

  if (FILE_TOOLS.has(tool)) {
    if (event === 'PreToolUse') return [];
    const absPath = resolveToolPath(input);
    return absPath && fs.existsSync(absPath) ? [absPath] : [];
  }

  if (!SHELL_TOOL.test(tool) || !input.tool_use_id) return [];
  const marker = markerFile(stateDir, input.tool_use_id);

  if (event === 'PreToolUse') {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    pruneStaleMarkers(path.dirname(marker), now);
    fs.writeFileSync(marker, JSON.stringify(snapshotWorkspace(input.cwd, { now })));
    return [];
  }

  const snapshot = takeMarker(marker);
  return snapshot ? filesChangedSince(snapshot, { cwd: input.cwd }) : [];
}

/*
 * toolChangedFiles + trackTouchedFile's bookkeeping: tracks every file the
 * call wrote that `matches` accepts, in the session's list and (inside a
 * subagent) the subagent's. Snapshots live beside `listFile`. Returns the
 * paths tracked.
 */
function trackSessionChanges({ input, listFile, matches, now }) {
  if (!input) return [];
  const files = toolChangedFiles({ input, stateDir: path.dirname(listFile), now });
  const tracked = files.filter((file) => typeof matches !== 'function' || matches(file));
  for (const file of tracked) record(listFile, file, input);
  return tracked;
}

module.exports = { trackTouchedFile, toolChangedFiles, trackSessionChanges };
