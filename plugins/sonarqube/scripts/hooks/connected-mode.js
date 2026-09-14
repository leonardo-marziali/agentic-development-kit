'use strict';

/*
 * SonarLint connected-mode binding discovery.
 *
 * `.sonarlint/connectedMode.json` is committed to repositories that are bound
 * to a SonarQube Server or SonarQube Cloud project, so the project key is
 * already on disk for most users and asking them to configure it again would
 * be redundant. Walk up from each tracked file to the nearest binding, the
 * same way lib.js in the markdown plugin walks up to the nearest
 * .markdownlint.* config, and analyse each group from its own binding root.
 *
 * Grouping is not cosmetic: `sonar analyze` resolves project context from its
 * own process cwd, so a monorepo with two bound sub-projects has to be
 * analysed as two runs with two `--project` values, not one.
 */

const fs = require('node:fs');
const path = require('node:path');

const CONNECTED_MODE_FILE = path.join('.sonarlint', 'connectedMode.json');

/*
 * Nearest directory at or above `filePath` holding a connected-mode binding,
 * or null when there is none all the way up to the filesystem root.
 */
function resolveBindingDir(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  const root = path.parse(dir).root;

  for (;;) {
    if (fs.existsSync(path.join(dir, CONNECTED_MODE_FILE))) return dir;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/*
 * A binding that exists but is unreadable or malformed reads as no binding at
 * all. The alternative — crashing the hook, or passing an undefined project
 * key to the CLI — is worse than analysing without `--project`.
 */
function readBinding(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, CONNECTED_MODE_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      projectKey: parsed.projectKey || null,
      sonarQubeUri: parsed.sonarQubeUri || null,
      sonarCloudOrganization: parsed.sonarCloudOrganization || null,
    };
  } catch {
    return null;
  }
}

/*
 * Groups files by their nearest binding directory. Files under no binding
 * collapse into a single unbound group rooted at `fallbackDir` (the session's
 * cwd), which gets analysed without `--project` — the CLI can still run a
 * local analysis there.
 *
 * Returns groups in first-seen order, so the report reads in the same order
 * the session touched things.
 */
function groupByBinding(files, { fallbackDir = process.cwd() } = {}) {
  const groups = new Map();

  for (const file of files) {
    const bindingDir = resolveBindingDir(file);
    const dir = bindingDir || fallbackDir;
    const key = bindingDir ? `bound:${dir}` : 'unbound';

    if (!groups.has(key)) {
      groups.set(key, {
        dir,
        binding: bindingDir ? readBinding(bindingDir) : null,
        files: [],
      });
    }
    groups.get(key).files.push(file);
  }

  return [...groups.values()];
}

/*
 * Human-readable label for a group, used in the reports the hook hands back
 * to Claude so it can tell which project a finding belongs to.
 */
function describeGroup(group) {
  const key = group.binding?.projectKey;
  if (!key) return group.dir;

  const server = group.binding.sonarCloudOrganization
    ? `SonarQube Cloud org ${group.binding.sonarCloudOrganization}`
    : group.binding.sonarQubeUri || 'SonarQube';
  return `${key} (${server}) in ${group.dir}`;
}

module.exports = {
  CONNECTED_MODE_FILE,
  resolveBindingDir,
  readBinding,
  groupByBinding,
  describeGroup,
};
