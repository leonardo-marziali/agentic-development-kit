'use strict';

/*
 * The MCP server is static configuration, but a couple of its properties are
 * load-bearing enough to pin down — most of all that the credential must
 * never be reachable from the container's argument list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', '.mcp.json'), 'utf8'),
);
const SERVER = CONFIG.sonarqube;

test('the token is passed by name only, never as a value in argv', () => {
  /*
   * `-e SONARQUBE_TOKEN` tells the runtime to forward the variable from the
   * already-expanded env block. The moment it becomes `-e SONARQUBE_TOKEN=…`
   * the credential is in the process list for every user on the machine.
   */
  assert.ok(SERVER.args.includes('SONARQUBE_TOKEN'));
  assert.ok(
    !SERVER.args.some((arg) => arg.startsWith('SONARQUBE_TOKEN=')),
    'the token must not appear as an inline -e assignment',
  );
  assert.equal(SERVER.env.SONARQUBE_TOKEN, '${SONARQUBE_TOKEN}');
});

test('no credential is committed into the config', () => {
  const serialised = JSON.stringify(SERVER);
  for (const key of ['SONARQUBE_TOKEN', 'SONARQUBE_URL']) {
    assert.match(
      serialised,
      new RegExp(`"\\$\\{${key}\\}"`),
      `${key} must come from the environment, not be written into the file`,
    );
  }
});

test('the runtime is invoked through the `docker` CLI', () => {
  /*
   * Deliberately the plain command, not a configurable one: OrbStack,
   * Colima, Rancher Desktop and Lima all provide a `docker` CLI, so the
   * plugin doesn't need to know which of them is behind it. Podman users
   * install its `docker` shim — a setup step on their side, rather than
   * configuration surface on the plugin's.
   */
  assert.equal(SERVER.command, 'docker');
});

test('the image is fully qualified', () => {
  /*
   * Podman (reached through its `docker` shim) has no implicit Docker Hub
   * default: a short name either consults unqualified-search-registries or
   * prompts, and a prompt on a stdio server hangs the connection. Docker
   * itself ignores the prefix.
   */
  assert.ok(SERVER.args.includes('docker.io/sonarsource/sonarqube-mcp'));
});

test('the args stay compatible with both docker and podman', () => {
  for (const flag of ['run', '--init', '--pull=always', '-i', '--rm']) {
    assert.ok(SERVER.args.includes(flag), `${flag} should be passed`);
  }
});

test('the toolset allowlist is explicit', () => {
  const toolsets = SERVER.env.SONARQUBE_TOOLSETS.split(',');
  assert.ok(toolsets.length > 0);
  /*
   * Documented in the README and the sonarqube-mcp-usage skill; the ones
   * left off are deliberate, so an accidental addition should fail here.
   */
  for (const off of ['vortex', 'vortex-context', 'system', 'webhooks']) {
    assert.ok(!toolsets.includes(off), `${off} is documented as disabled`);
  }
});
