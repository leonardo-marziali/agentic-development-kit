'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, writeTree } = require('./helpers');
const {
  detectJavaLevel,
  detectSpringBoot,
  detectEncoding,
  moduleInfo,
  buildJavaHome,
} = require('../module');

function pom(body, { parent = '' } = {}) {
  return `<?xml version="1.0"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  ${parent}
  <artifactId>app</artifactId>
  ${body}
</project>
`;
}

function withStderr(fn) {
  const original = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    return { value: fn(), stderr: captured };
  } finally {
    process.stderr.write = original;
  }
}

describe('detectJavaLevel', () => {
  let root;
  beforeEach(() => {
    root = mkScratchDir();
    fs.mkdirSync(path.join(root, '.git'));
  });
  afterEach(() => rmScratchDir(root));

  for (const [name, body, expected] of [
    [
      'maven.compiler.release',
      '<properties><maven.compiler.release>11</maven.compiler.release></properties>',
      11,
    ],
    [
      'maven.compiler.source',
      '<properties><maven.compiler.source>1.8</maven.compiler.source></properties>',
      8,
    ],
    ['java.version "1.8"', '<properties><java.version>1.8</java.version></properties>', 8],
    [
      'a property indirection',
      '<properties><jdk.level>17</jdk.level><maven.compiler.release>${jdk.level}</maven.compiler.release></properties>',
      17,
    ],
    [
      'the compiler plugin <source>',
      '<build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><source>1.8</source></configuration></plugin></plugins></build>',
      8,
    ],
  ]) {
    it(`reads ${name} from pom.xml`, () => {
      writeTree(root, { 'pom.xml': pom(body) });
      assert.equal(detectJavaLevel(root), expected);
    });
  }

  it('prefers maven.compiler.release over java.version', () => {
    writeTree(root, {
      'pom.xml': pom(
        '<properties><java.version>17</java.version><maven.compiler.release>21</maven.compiler.release></properties>',
      ),
    });
    assert.equal(detectJavaLevel(root), 21);
  });

  it('finds the level in the parent POM', () => {
    writeTree(root, {
      'pom.xml': pom('<properties><java.version>11</java.version></properties>'),
      'service/pom.xml': pom('', { parent: '<parent><artifactId>root</artifactId></parent>' }),
    });
    assert.equal(detectJavaLevel(path.join(root, 'service')), 11);
  });

  it('follows an explicit relativePath to the parent', () => {
    writeTree(root, {
      'parent/pom.xml': pom('<properties><java.version>1.8</java.version></properties>'),
      'service/pom.xml': pom('', {
        parent:
          '<parent><artifactId>p</artifactId><relativePath>../parent/pom.xml</relativePath></parent>',
      }),
    });
    assert.equal(detectJavaLevel(path.join(root, 'service')), 8);
  });

  for (const [name, file, text, expected] of [
    [
      'a toolchain',
      'build.gradle.kts',
      'java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }',
      17,
    ],
    [
      'a Groovy toolchain',
      'build.gradle',
      'java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }',
      21,
    ],
    [
      'sourceCompatibility VERSION_1_8',
      'build.gradle',
      'sourceCompatibility = JavaVersion.VERSION_1_8',
      8,
    ],
    ['sourceCompatibility as a string', 'build.gradle', "sourceCompatibility = '11'", 11],
    [
      'options.release.set',
      'build.gradle.kts',
      'tasks.withType<JavaCompile> { options.release.set(11) }',
      11,
    ],
    ['options.release =', 'build.gradle', 'compileJava { options.release = 17 }', 17],
  ]) {
    it(`reads ${name} from ${file}`, () => {
      writeTree(root, { [file]: text });
      assert.equal(detectJavaLevel(root), expected);
    });
  }

  it('reads kotlin { jvmToolchain(17) }', () => {
    writeTree(root, { 'build.gradle.kts': 'kotlin { jvmToolchain(17) }' });
    assert.equal(detectJavaLevel(root), 17);
  });

  it("reads a Gradle submodule's level from the root build file", () => {
    writeTree(root, {
      'settings.gradle': "include 'service'",
      'build.gradle':
        'subprojects { java { toolchain { languageVersion = JavaLanguageVersion.of(11) } } }',
      'service/build.gradle': "plugins { id 'java' }",
    });
    assert.equal(detectJavaLevel(path.join(root, 'service')), 11);
  });

  it('returns null when nothing declares a level', () => {
    writeTree(root, { 'pom.xml': pom('') });
    assert.equal(detectJavaLevel(root), null);
  });
});

describe('detectSpringBoot', () => {
  let root;
  beforeEach(() => {
    root = mkScratchDir();
    fs.mkdirSync(path.join(root, '.git'));
  });
  afterEach(() => rmScratchDir(root));

  it('reads the spring-boot-starter-parent version', () => {
    writeTree(root, {
      'pom.xml': pom('', {
        parent:
          '<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>2.7.18</version></parent>',
      }),
    });
    assert.deepEqual(detectSpringBoot(root), { major: 2, minor: 7 });
  });

  it('reads an imported spring-boot-dependencies BOM', () => {
    writeTree(root, {
      'pom.xml': pom(
        '<dependencyManagement><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>3.4.1</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>',
      ),
    });
    assert.deepEqual(detectSpringBoot(root), { major: 3, minor: 4 });
  });

  it('reads the Gradle plugin version', () => {
    writeTree(root, {
      'build.gradle.kts': 'plugins { id("org.springframework.boot") version "3.3.5" }',
    });
    assert.deepEqual(detectSpringBoot(root), { major: 3, minor: 3 });
  });

  it('reads the Groovy Gradle plugin syntax', () => {
    writeTree(root, {
      'build.gradle': "plugins { id 'org.springframework.boot' version '2.6.3' }",
    });
    assert.deepEqual(detectSpringBoot(root), { major: 2, minor: 6 });
  });

  it('returns null without Spring Boot', () => {
    writeTree(root, { 'pom.xml': pom('') });
    assert.equal(detectSpringBoot(root), null);
  });
});

describe('detectEncoding', () => {
  let root;
  beforeEach(() => {
    root = mkScratchDir();
    fs.mkdirSync(path.join(root, '.git'));
  });
  afterEach(() => rmScratchDir(root));

  it('reads project.build.sourceEncoding, also from the parent POM', () => {
    writeTree(root, {
      'pom.xml': pom(
        '<properties><project.build.sourceEncoding>ISO-8859-1</project.build.sourceEncoding></properties>',
      ),
      'service/pom.xml': pom('', { parent: '<parent><artifactId>root</artifactId></parent>' }),
    });
    assert.equal(detectEncoding(path.join(root, 'service')), 'ISO-8859-1');
  });

  it("reads the compiler plugin's <encoding>", () => {
    writeTree(root, {
      'pom.xml': pom(
        '<build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><encoding>windows-1252</encoding></configuration></plugin></plugins></build>',
      ),
    });
    assert.equal(detectEncoding(root), 'windows-1252');
  });

  it('reads options.encoding from a Gradle build', () => {
    writeTree(root, {
      'build.gradle': "tasks.withType(JavaCompile) { options.encoding = 'ISO-8859-1' }",
    });
    assert.equal(detectEncoding(root), 'ISO-8859-1');
  });

  it('defaults to UTF-8', () => {
    writeTree(root, { 'pom.xml': pom('') });
    assert.equal(detectEncoding(root), 'UTF-8');
  });
});

describe('moduleInfo', () => {
  let root;
  beforeEach(() => {
    root = mkScratchDir();
    fs.mkdirSync(path.join(root, '.git'));
  });
  afterEach(() => rmScratchDir(root));

  it('falls back to 17 with a note when no level is found', () => {
    writeTree(root, { 'pom.xml': pom('') });
    const { value, stderr } = withStderr(() => moduleInfo(root, null));
    assert.equal(value.javaLevel, 17);
    assert.match(stderr, /could not detect the Java version.*assuming 17/);
  });

  it('lets javaVersion in the config override the detected level', () => {
    writeTree(root, { 'pom.xml': pom('<properties><java.version>17</java.version></properties>') });
    assert.equal(moduleInfo(root, { javaVersion: 11 }).javaLevel, 11);
  });

  it('includes the Spring Boot version', () => {
    writeTree(root, {
      'build.gradle': "plugins { id 'org.springframework.boot' version '3.2.0' }",
    });
    assert.deepEqual(withStderr(() => moduleInfo(root, null)).value.boot, { major: 3, minor: 2 });
  });
});

describe('buildJavaHome', () => {
  let home;
  let savedEnv;
  beforeEach(() => {
    home = mkScratchDir();
    savedEnv = { HOME: process.env.HOME, OPT: process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES };
    process.env.HOME = home;
    delete process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES;
  });
  afterEach(() => {
    process.env.HOME = savedEnv.HOME;
    if (savedEnv.OPT === undefined) delete process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES;
    else process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES = savedEnv.OPT;
    rmScratchDir(home);
  });

  function fakeJdk(dir, version) {
    writeTree(dir, { release: `JAVA_VERSION="${version}"\n`, 'bin/java': '' });
    return dir;
  }

  const searchRoots = () => [path.join(home, 'jvm')];

  it('picks a jdk_homes entry given as a JSON array', () => {
    const jdk8 = fakeJdk(path.join(home, 'a'), '1.8.0_402');
    const jdk11 = fakeJdk(path.join(home, 'b'), '11.0.22');
    process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES = JSON.stringify([jdk8, jdk11]);
    assert.equal(buildJavaHome(11, { searchRoots: searchRoots() }), jdk11);
    assert.equal(buildJavaHome(8, { searchRoots: searchRoots() }), jdk8);
  });

  it('accepts jdk_homes given as a comma-separated list', () => {
    const jdk8 = fakeJdk(path.join(home, 'a'), '1.8.0_402');
    process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES = `${path.join(home, 'none')},${jdk8}`;
    assert.equal(buildJavaHome(8, { searchRoots: searchRoots() }), jdk8);
  });

  it('finds a matching JDK in ~/.m2/toolchains.xml', () => {
    const jdk11 = fakeJdk(path.join(home, 'tc11'), '11.0.22');
    writeTree(home, {
      '.m2/toolchains.xml': `<toolchains><toolchain><type>jdk</type><provides><version>11</version></provides><configuration><jdkHome>${jdk11}</jdkHome></configuration></toolchain></toolchains>`,
    });
    assert.equal(buildJavaHome(11, { searchRoots: searchRoots() }), jdk11);
  });

  it('discovers a JDK in an install directory', () => {
    const jdk8 = fakeJdk(path.join(home, 'jvm', 'java-8-openjdk'), '1.8.0_402');
    fakeJdk(path.join(home, 'jvm', 'java-21-openjdk'), '21.0.5');
    assert.equal(buildJavaHome(8, { searchRoots: searchRoots() }), jdk8);
  });

  it('returns null when no JDK of that version exists', () => {
    fakeJdk(path.join(home, 'jvm', 'java-21-openjdk'), '21.0.5');
    assert.equal(buildJavaHome(8, { searchRoots: searchRoots() }), null);
  });

  it('says so when no JDK of that version exists', () => {
    const notes = [];
    buildJavaHome(8, { searchRoots: searchRoots(), warn: (message) => notes.push(message) });
    assert.equal(notes.length, 1);
    assert.match(notes[0], /no JDK 8 found.*jdk_homes/);
  });
});
