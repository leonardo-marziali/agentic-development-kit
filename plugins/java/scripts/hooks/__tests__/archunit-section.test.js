'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  writeTree,
  initRepo,
  installedEngine,
  SKIP_WITHOUT_JDK,
} = require('./helpers');

const FAKE_ENGINE = path.join(__dirname, 'fake-engine.js');
const FAKE_ARCHUNIT = path.join(__dirname, 'fake-archunit.js');
const POM = '<project>\n  <properties><java.version>17</java.version></properties>\n</project>\n';
const SOURCE = 'src/main/java/com/acme/project/service/ProjectService.java';

function setup(t, { config = {}, classesAge = 'fresh', wrapper = 'exit 0' } = {}) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  writeTree(root, {
    'pom.xml': POM,
    '.claude/java-standards.json': JSON.stringify({
      archunit: { basePackage: 'com.acme', ...config },
    }),
    [SOURCE]: 'package com.acme.project.service;\n\npublic interface ProjectService {\n}\n',
    'target/classes/com/acme/project/service/ProjectService.class': 'cafebabe',
  });
  fs.writeFileSync(
    path.join(root, 'mvnw'),
    `#!/bin/sh\necho "$@" >> "${root}/mvnw.log"\n${wrapper}\n`,
  );
  fs.chmodSync(path.join(root, 'mvnw'), 0o755);
  const git = initRepo(root);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  const classFile = path.join(root, 'target/classes/com/acme/project/service/ProjectService.class');
  const source = path.join(root, SOURCE);
  const past = new Date(Date.now() - 60_000);
  if (classesAge === 'stale') fs.utimesSync(classFile, past, past);
  else fs.utimesSync(source, past, past);

  const ctx = { root, sessionId: uniqueSessionId(), pluginData: path.join(root, '.plugin-data') };
  ctx.env = {
    CLAUDE_PLUGIN_DATA: ctx.pluginData,
    JAVA_PLUGIN_ENGINE_CMD: FAKE_ENGINE,
    JAVA_PLUGIN_ARCHUNIT_CMD: FAKE_ARCHUNIT,
    FAKE_ARCHUNIT_LOG: path.join(root, 'archunit.log'),
    FAKE_ARCHUNIT_OUTPUT: '',
  };
  return ctx;
}

function touch(ctx, rel) {
  runHook(
    'track-touched.js',
    {
      tool_name: 'Edit',
      tool_input: { file_path: path.join(ctx.root, rel) },
      session_id: ctx.sessionId,
      cwd: ctx.root,
    },
    { env: ctx.env },
  );
}

function stop(ctx, env = {}) {
  return runHook(
    'check-and-loop.js',
    { hook_event_name: 'Stop', session_id: ctx.sessionId, cwd: ctx.root },
    { env: { ...ctx.env, ...env } },
  );
}

const lines = (file) =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
const runnerCalls = (ctx) => lines(path.join(ctx.root, 'archunit.log')).map((l) => JSON.parse(l));
const compiles = (ctx) => lines(path.join(ctx.root, 'mvnw.log'));
const arg = (call, name) => call[call.indexOf(name) + 1];

test('does not run when ArchUnit is disabled', (t) => {
  const ctx = setup(t, { config: { enabled: false } });
  touch(ctx, SOURCE);
  stop(ctx);
  assert.deepEqual(runnerCalls(ctx), []);
});

test('runs on fresh classes without compiling, scoped to the packages', (t) => {
  const ctx = setup(t, { config: { packages: ['com.acme.project..'], disabledRules: ['S24'] } });
  touch(ctx, SOURCE);

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
  assert.deepEqual(compiles(ctx), []);
  const [call] = runnerCalls(ctx);
  assert.equal(arg(call, '--classes'), path.join(ctx.root, 'target/classes'));
  assert.equal(arg(call, '--packages'), 'com.acme.project..');
  assert.equal(arg(call, '--base-package'), 'com.acme');
  assert.equal(arg(call, '--disabled'), 'S24');
  assert.equal(call.includes('--store'), false);
});

test('blocks on a violation and names the source file', (t) => {
  const ctx = setup(t);
  touch(ctx, SOURCE);

  const res = stop(ctx, {
    FAKE_ARCHUNIT_OUTPUT:
      'FINDING\tcom/acme/project/service/ProjectService.java\t0\tS7\tMethod <findById> uses ProjectEntity\n',
  });

  assert.equal(res.json?.decision, 'block', res.stderr);
  assert.match(
    res.json.reason,
    /## ArchUnit[\s\S]*src\/main\/java\/com\/acme\/project\/service\/ProjectService\.java:0 \[S7\] Method <findById>/,
  );
});

test('compiles stale classes first in auto mode', (t) => {
  const ctx = setup(t, { classesAge: 'stale' });
  touch(ctx, SOURCE);
  stop(ctx);
  assert.match(compiles(ctx)[0], /-q -B compile test-compile/);
  assert.equal(runnerCalls(ctx).length, 1);
});

test('skips stale classes with a note when compile is never', (t) => {
  const ctx = setup(t, { classesAge: 'stale', config: { compile: 'never' } });
  touch(ctx, SOURCE);

  const res = stop(ctx);

  assert.deepEqual(compiles(ctx), []);
  assert.deepEqual(runnerCalls(ctx), []);
  assert.match(res.stderr, /java plugin: .*classes .*older than the sources.*compile: never/);
});

test('a failed compile warns and never blocks', (t) => {
  const ctx = setup(t, {
    classesAge: 'stale',
    wrapper: 'echo "[ERROR] COMPILATION ERROR" >&2; exit 1',
  });
  touch(ctx, SOURCE);

  const res = stop(ctx, { FAKE_ARCHUNIT_OUTPUT: 'FINDING\t-\t0\tS7\tx\n' });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /java plugin: .*could not compile.*COMPILATION ERROR/s);
  assert.deepEqual(runnerCalls(ctx), []);
});

test('passes the freeze store when the project has one', (t) => {
  const ctx = setup(t);
  writeTree(ctx.root, { '.claude/archunit-store/root/stored.rules': '' });
  touch(ctx, SOURCE);
  stop(ctx);
  assert.equal(
    arg(runnerCalls(ctx)[0], '--store'),
    path.join(ctx.root, '.claude/archunit-store/root'),
  );
});

test(
  "compiles the project's own rules and passes them as --extra",
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const manifest = await installedEngine();
    const ctx = setup(t);
    writeTree(ctx.root, {
      '.claude/archunit/TeamRules.java': `import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

public class TeamRules {
    public static final ArchRule NO_SYSTEM_OUT = noClasses().should().accessField(System.class, "out");
}
`,
    });
    const { runSection } = require('../archunit');
    process.env.JAVA_PLUGIN_ARCHUNIT_CMD = FAKE_ARCHUNIT;
    process.env.FAKE_ARCHUNIT_LOG = path.join(ctx.root, 'archunit.log');
    t.after(() => {
      delete process.env.JAVA_PLUGIN_ARCHUNIT_CMD;
      delete process.env.FAKE_ARCHUNIT_LOG;
    });
    const config = JSON.parse(
      fs.readFileSync(path.join(ctx.root, '.claude/java-standards.json'), 'utf8'),
    );
    const warnings = [];

    runSection({
      repoRoot: ctx.root,
      config: {
        archunit: {
          enabled: true,
          packages: [],
          disabledRules: [],
          compile: 'auto',
          ...config.archunit,
        },
      },
      modules: new Map([
        [ctx.root, { files: [path.join(ctx.root, SOURCE)], info: { javaLevel: 17 } }],
      ]),
      manifest,
      warn: (m) => warnings.push(m),
    });

    assert.deepEqual(
      warnings.filter((m) => !m.startsWith('no JDK ')),
      [],
    );
    const extra = arg(runnerCalls(ctx)[0], '--extra');
    assert.ok(fs.existsSync(path.join(extra, 'TeamRules.class')));
  },
);

test(
  'keeps a separate freeze baseline per module of a multi-module repo',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const manifest = await installedEngine();
    const root = require('./helpers').mkScratchDir();
    t.after(() => rmScratchDir(root));
    fs.mkdirSync(path.join(root, '.git'));
    const fixtures = path.join(__dirname, 'fixtures', 'archunit');
    const javaSources = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? javaSources(full) : e.name.endsWith('.java') ? [full] : [];
      });
    const compileInto = (module, ...dirs) => {
      const out = path.join(root, module, 'target', 'classes');
      fs.mkdirSync(out, { recursive: true });
      writeTree(root, { [`${module}/pom.xml`]: POM });
      const r = require('node:child_process').spawnSync(
        manifest.javac,
        ['-d', out, ...dirs.flatMap(javaSources)],
        { encoding: 'utf8' },
      );
      assert.equal(r.status, 0, r.stderr);
    };
    compileInto('a', path.join(fixtures, 'base'));
    compileInto('b', path.join(fixtures, 'base', 'org'), path.join(fixtures, 'extra'));

    const { runSection } = require('../archunit');
    const modules = new Map(
      ['a', 'b'].map((m) => [path.join(root, m), { files: [], info: { javaLevel: 17 } }]),
    );
    const config = {
      archunit: {
        enabled: true,
        basePackage: 'com.acme',
        packages: [],
        disabledRules: [],
        compile: 'never',
      },
    };
    const warnings = [];
    const run = (extra = {}) =>
      runSection({
        repoRoot: root,
        config,
        modules,
        manifest,
        warn: (m) => warnings.push(m),
        ...extra,
      }).findings;

    run({ createStore: true });
    assert.deepEqual(run(), [], 'neither module reports its frozen violations');
    assert.deepEqual(run(), [], 'and the baseline survives a second stop');
    assert.ok(fs.existsSync(path.join(root, '.claude', 'archunit-store', 'a', 'stored.rules')));
    assert.ok(fs.existsSync(path.join(root, '.claude', 'archunit-store', 'b', 'stored.rules')));
  },
);

test('does not retry a failed compile until the sources or build files change', (t) => {
  const ctx = setup(t, { classesAge: 'stale', wrapper: 'echo "[ERROR] boom" >&2; exit 1' });
  touch(ctx, SOURCE);
  stop(ctx);
  touch(ctx, SOURCE);
  stop(ctx);
  assert.equal(compiles(ctx).length, 1);

  writeTree(ctx.root, {
    [SOURCE]:
      'package com.acme.project.service;\n\npublic interface ProjectService {\n    void save();\n}\n',
  });
  touch(ctx, SOURCE);
  stop(ctx);
  assert.equal(compiles(ctx).length, 2);
});

test('a violation in a class the session did not touch is listed, not blocking', (t) => {
  const ctx = setup(t);
  touch(ctx, SOURCE);

  const res = stop(ctx, {
    FAKE_ARCHUNIT_OUTPUT: 'FINDING\tcom/acme/project/other/Legacy.java\t0\tD1\tlegacy violation\n',
  });

  assert.equal(res.stdout.trim(), '', res.stderr);
});

test('the block message gives ArchUnit-specific guidance, not the source-rule comment', (t) => {
  const ctx = setup(t);
  touch(ctx, SOURCE);

  const res = stop(ctx, {
    FAKE_ARCHUNIT_OUTPUT:
      'FINDING\tcom/acme/project/service/ProjectService.java\t0\tS7\tuses ProjectEntity\n',
  });

  assert.match(res.json.reason, /archunit\.disabledRules/);
  assert.doesNotMatch(res.json.reason, /java-rules:allow/);
});

test('skips the slow sections with a warning once the stop has used its time budget', (t) => {
  const ctx = setup(t);
  touch(ctx, SOURCE);

  const res = stop(ctx, {
    JAVA_PLUGIN_STOP_BUDGET_MS: '1',
    FAKE_ARCHUNIT_OUTPUT: 'FINDING\tcom/acme/project/service/ProjectService.java\t0\tS7\tx\n',
  });

  assert.deepEqual(runnerCalls(ctx), []);
  assert.match(res.stderr, /java plugin: .*time budget.*ArchUnit/);
  assert.equal(res.stdout.trim(), '');
});
