'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function mkScratchDir(prefix = 'adk-export-plugins-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmScratchDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/*
Builds a throwaway repo tree — <root>/.claude-plugin/marketplace.json plus
<root>/plugins/<name>/ per plugin — shaped like the real repo, so the
marketplace-driven lookup and the zipping both run against a real
filesystem instead of mocks.
*/
function makeFixtureRepo(pluginSpecs) {
  const root = mkScratchDir();

  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'fixture-marketplace',
      plugins: pluginSpecs.map((spec) => ({
        name: spec.name,
        source: `./plugins/${spec.name}`,
      })),
    }),
  );

  for (const spec of pluginSpecs) {
    const pluginRoot = path.join(root, 'plugins', spec.name);
    for (const [relativePath, content] of Object.entries(spec.files)) {
      const fullPath = path.join(pluginRoot, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }

  return root;
}

module.exports = { mkScratchDir, rmScratchDir, makeFixtureRepo };
