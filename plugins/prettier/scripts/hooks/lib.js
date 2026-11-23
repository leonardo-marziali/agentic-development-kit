'use strict';

/*
 * The prettier-specific half of this plugin's hook. The generic machinery —
 * hook input, change detection, scoped formatting, spawning CLI shims —
 * comes from @leonardo-marziali/ad-lfl-kit.
 */

/*
 * `whole_files` in plugin.json's userConfig, surfaced to hook processes as
 * CLAUDE_PLUGIN_OPTION_WHOLE_FILES: format whole files even inside a git
 * repo, rather than only the lines that differ from HEAD. Absent (plugin
 * installed before the option existed, or never configured) reads as off.
 */
function wholeFilesEnabled() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_WHOLE_FILES || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/*
 * What Prettier says when no parser can be inferred from a path. With
 * --stdin-filepath it errors instead of honouring --ignore-unknown, and
 * such a file is simply not Prettier's to format.
 */
function isNoParserError(text) {
  return /No parser could be inferred/i.test(text || '');
}

module.exports = { wholeFilesEnabled, isNoParserError };
