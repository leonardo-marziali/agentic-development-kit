'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, writeTree } = require('./helpers');
const { checkBuildFile } = require('../build-rules');

function project(t, files) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  fs.mkdirSync(path.join(root, '.git'));
  writeTree(root, files);
  return root;
}

function check(root, rel) {
  const file = path.join(root, rel);
  return checkBuildFile(file, fs.readFileSync(file, 'utf8')).map((f) => `${f.line} ${f.rule}`);
}

const POM_HEAD = `<project>
  <properties>
    <java.version>21</java.version>
    <zjsonpatch.version>0.6.4</zjsonpatch.version>
  </properties>
`;

test('flags a dependency whose version is a literal', (t) => {
  const root = project(t, {
    'pom.xml': `${POM_HEAD}  <dependencies>
    <dependency>
      <groupId>io.github.vishwakarma</groupId>
      <artifactId>zjsonpatch</artifactId>
      <version>0.6.4</version>
    </dependency>
  </dependencies>
</project>
`,
  });
  assert.deepEqual(check(root, 'pom.xml'), ['10 B2']);
});

test('accepts a version property and a BOM-managed dependency', (t) => {
  const root = project(t, {
    'pom.xml': `${POM_HEAD}  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-dependencies</artifactId>
        <version>2024.0.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.github.vishwakarma</groupId>
      <artifactId>zjsonpatch</artifactId>
      <version>\${zjsonpatch.version}</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <!-- <dependency><artifactId>old</artifactId><version>1.0</version></dependency> -->
  </dependencies>
</project>
`,
  });
  assert.deepEqual(check(root, 'pom.xml'), []);
});

test('flags a POM that declares no Java version anywhere in its parent chain', (t) => {
  const root = project(t, { 'pom.xml': '<project>\n  <artifactId>app</artifactId>\n</project>\n' });
  assert.deepEqual(check(root, 'pom.xml'), ['1 B4']);
});

test('accepts a module whose parent declares the Java version', (t) => {
  const root = project(t, {
    'pom.xml': POM_HEAD + '</project>\n',
    'service/pom.xml': '<project>\n  <parent><artifactId>root</artifactId></parent>\n</project>\n',
  });
  assert.deepEqual(check(root, 'service/pom.xml'), []);
});

test('flags a literal Gradle dependency version and accepts catalog and platform entries', (t) => {
  const root = project(t, {
    'build.gradle.kts': `plugins { java }
java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }
dependencies {
    implementation("io.github.vishwakarma:zjsonpatch:0.6.4")
    testImplementation 'org.assertj:assertj-core:3.26.0'
    implementation(platform("org.springframework.cloud:spring-cloud-dependencies:2024.0.0"))
    implementation(libs.zjsonpatch)
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("com.acme:lib:$libVersion")
}
`,
  });
  assert.deepEqual(check(root, 'build.gradle.kts'), ['4 B2', '5 B2']);
});

test('flags a Gradle build without a Java version', (t) => {
  const root = project(t, { 'build.gradle': "plugins { id 'java' }\n" });
  assert.deepEqual(check(root, 'build.gradle'), ['1 B4']);
});
