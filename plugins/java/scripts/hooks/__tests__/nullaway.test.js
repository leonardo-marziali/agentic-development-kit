'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installedEngine, SKIP_WITHOUT_JDK } = require('./helpers');
const {
  buildJavacArgs,
  detectMode,
  processorJars,
  parseNullAway,
  runNullAway,
} = require('../nullaway');

const MANIFEST = {
  javac: '/jdk/bin/javac',
  jars: {
    errorprone: ['/e/error_prone_core.jar', '/e/nullaway.jar'],
    lombok: ['/l/lombok-1.18.48.jar'],
  },
};

const pluginOf = (args) => args.find((a) => a.startsWith('-Xplugin:'));

test('builds the proven javac invocation for JSpecify', () => {
  const args = buildJavacArgs({
    manifest: MANIFEST,
    classpath: ['/m2/a.jar'],
    outputDirs: ['/p/target/classes'],
    sourcepath: ['/p/src/main/java'],
    processors: ['/m2/lombok-1.18.36.jar'],
    files: ['/p/src/main/java/A.java'],
    mode: 'jspecify',
    javaLevel: 8,
    outDir: '/tmp/out',
  });

  for (const flag of [
    '-XDcompilePolicy=simple',
    '--should-stop=ifError=FLOW',
    '-XDaddTypeAnnotationsToSymbol=true',
    '-proc:full',
    '-implicit:none',
    '-Xlint:-options',
    '-J--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED',
    '-J--add-opens=jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED',
  ]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(args[args.indexOf('--release') + 1], '8');
  assert.equal(
    args[args.indexOf('-processorpath') + 1],
    ['/m2/lombok-1.18.36.jar', '/e/error_prone_core.jar', '/e/nullaway.jar'].join(path.delimiter),
  );
  assert.equal(
    args[args.indexOf('-cp') + 1],
    ['/p/target/classes', '/m2/a.jar'].join(path.delimiter),
  );
  assert.equal(args[args.indexOf('-sourcepath') + 1], '/p/src/main/java');
  assert.match(
    pluginOf(args),
    /-XepDisableAllChecks -Xep:NullAway:ERROR .*OnlyNullMarked=true .*JSpecifyMode=true/,
  );
  assert.equal(args.at(-1), '/p/src/main/java/A.java');
});

test('annotates the base package in Spring mode', () => {
  const args = buildJavacArgs({
    manifest: MANIFEST,
    classpath: [],
    outputDirs: [],
    sourcepath: [],
    processors: [],
    files: ['/A.java'],
    mode: 'spring',
    basePackage: 'com.acme',
    javaLevel: 17,
    outDir: '/o',
  });
  assert.match(pluginOf(args), /AnnotatedPackages=com\.acme/);
  assert.doesNotMatch(pluginOf(args), /OnlyNullMarked/);
});

test('detects the nullness library from the classpath', () => {
  assert.equal(
    detectMode(['/m2/jspecify-1.0.0.jar', '/m2/spring-core-6.2.0.jar'], 'auto'),
    'jspecify',
  );
  assert.equal(detectMode(['/m2/spring-core-5.3.31.jar'], 'auto'), 'spring');
  assert.equal(detectMode(['/m2/guava.jar'], 'auto'), null);
  // Spring 4 has no org.springframework.lang annotations to analyse.
  assert.equal(detectMode(['/m2/spring-core-4.3.30.RELEASE.jar'], 'auto'), null);
  assert.equal(detectMode([], 'spring'), 'spring');
});

test("swaps a Lombok too old for JDK 21 for the plugin's own, with a note", () => {
  const { jars, notes } = processorJars(
    ['/m2/lombok-1.18.22.jar', '/m2/mapstruct-processor-1.6.3.jar'],
    [],
    MANIFEST,
  );
  assert.deepEqual(jars, ['/l/lombok-1.18.48.jar', '/m2/mapstruct-processor-1.6.3.jar']);
  assert.match(
    notes[0],
    /Lombok 1\.18\.22 can't run on JDK 21; used the plugin's Lombok 1\.18\.48/,
  );
});

test('keeps a current Lombok first, preferring the Gradle processor path', () => {
  const { jars, notes } = processorJars(
    ['/m2/querydsl-apt-5.1.0.jar'],
    ['/g/lombok-1.18.36.jar'],
    MANIFEST,
  );
  assert.deepEqual(jars, ['/g/lombok-1.18.36.jar', '/m2/querydsl-apt-5.1.0.jar']);
  assert.deepEqual(notes, []);
});

test('parses only NullAway diagnostics', () => {
  const output = [
    "/p/Svc.java:6: error: [NullAway] passing @Nullable parameter 'find(1)' where @NonNull is required",
    '  int use() { return len(find(1)); }',
    '/p/Svc.java:9: error: cannot find symbol',
    '/p/Dto.java:12: warning: [NullAway] dereferenced expression getNote() is @Nullable',
  ].join('\n');
  assert.deepEqual(parseNullAway(output), [
    {
      file: '/p/Svc.java',
      line: 6,
      rule: 'J20',
      message: "NullAway: passing @Nullable parameter 'find(1)' where @NonNull is required",
    },
    {
      file: '/p/Dto.java',
      line: 12,
      rule: 'J20',
      message: 'NullAway: dereferenced expression getNote() is @Nullable',
    },
  ]);
});

test(
  'real javac: reports a nullable dereference through a Lombok getter',
  { skip: SKIP_WITHOUT_JDK },
  async () => {
    const manifest = await installedEngine();
    const src = path.join(__dirname, 'fixtures', 'nullaway', 'src');
    const file = path.join(src, 'com', 'acme', 'v2', 'Project.java');
    const jspecify = manifest.jars.errorprone.find((jar) =>
      path.basename(jar).startsWith('jspecify-'),
    );

    const findings = runNullAway({
      manifest,
      files: [file, path.join(src, 'com', 'acme', 'v2', 'package-info.java')],
      classpath: [jspecify, ...manifest.jars.lombok],
      processorPath: [],
      outputDirs: [],
      sourcepath: [src],
      mode: 'jspecify',
      javaLevel: 17,
    });

    const expected = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (line.includes('// expect: J20') ? [i + 1] : []));
    assert.deepEqual(
      findings.findings.map((f) => f.line).sort((a, b) => a - b),
      expected,
    );
  },
);
