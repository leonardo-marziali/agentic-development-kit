'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendTrackedFile } = require('./state');

/*
 * The PostToolUse half of the loop: records the file a tool just wrote, so the
 * Stop hook only ever inspects files this session actually touched — never
 * pre-existing content the user didn't ask us to police.
 *
 * `matches` decides what's in scope for the calling plugin and receives the
 * resolved absolute path. Returns the path that was tracked, or null when the
 * event wasn't one we care about — callers generally ignore the return and
 * just let the hook exit.
 */
function trackTouchedFile({ input, listFile, matches }) {
  if (!input) return null;
  if (!/^(Edit|Write)$/.test(input.tool_name || '')) return null;

  const filePath = input.tool_input?.file_path;
  if (!filePath) return null;

  /*
   * Tool inputs may carry a relative path; it resolves against the session's
   * cwd, not this hook process's, which can differ.
   */
  const cwd = input.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

  if (!fs.existsSync(absPath)) return null;
  if (typeof matches === 'function' && !matches(absPath)) return null;

  fs.mkdirSync(path.dirname(listFile), { recursive: true });
  appendTrackedFile(listFile, absPath);
  return absPath;
}

module.exports = { trackTouchedFile };
