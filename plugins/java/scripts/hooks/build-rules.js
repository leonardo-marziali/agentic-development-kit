'use strict';

/*
 * Build-file rules, scanned line by line (never parsed or executed):
 *   B2  a dependency version outside a BOM is a property (Maven) or a
 *       version-catalog entry (Gradle), never a literal;
 *   B4  the build declares the Java version (anywhere in a POM's parent
 *       chain, which module.js resolves).
 */

const path = require('node:path');
const { detectJavaLevel } = require('./module');

const GRADLE_CONFIGURATIONS =
  'implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|' +
  'annotationProcessor|testAnnotationProcessor|developmentOnly|kapt|compile|testCompile';

const GRADLE_DEPENDENCY = new RegExp(
  String.raw`^\s*(?:${GRADLE_CONFIGURATIONS})\s*\(?\s*['"]([^'":]+):([^'":]+):([^'"]+)['"]`,
);

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.codePointAt(i) === 10) line += 1;
  return line;
}

// Comments blanked out with spaces, so offsets and line numbers stay put.
function blankXmlComments(text) {
  return text.replaceAll(/<!--[\s\S]*?-->/g, (comment) => comment.replaceAll(/[^\n]/g, ' '));
}

function finding(file, line, rule, message) {
  return { file, line, rule, message };
}

function mavenFindings(file, text) {
  const findings = [];
  const clean = blankXmlComments(text);
  for (const match of clean.matchAll(/<dependency>[\s\S]*?<\/dependency>/g)) {
    const block = match[0];
    if (/<scope>\s*import\s*<\/scope>/.test(block)) continue;
    const version = /<version>([^<]*)<\/version>/.exec(block);
    const value = version ? version[1].trim() : '';
    if (!value || value.startsWith('${')) continue;
    const artifact =
      (/<artifactId>([^<]*)<\/artifactId>/.exec(block) || [])[1]?.trim() || 'this dependency';
    findings.push(
      finding(
        file,
        lineOf(clean, match.index + version.index),
        'B2',
        `Move ${artifact}'s version into a <${artifact}.version> property (or rely on the BOM) instead of the literal ${value}.`,
      ),
    );
  }
  return findings;
}

function gradleFindings(file, text) {
  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (/\bplatform\s*\(|\benforcedPlatform\s*\(/.test(line)) return;
    const match = GRADLE_DEPENDENCY.exec(line);
    if (!match || match[3].startsWith('$')) return;
    findings.push(
      finding(
        file,
        index + 1,
        'B2',
        `Declare ${match[1]}:${match[2]} in the version catalog (libs.versions.toml) instead of the literal version ${match[3]}.`,
      ),
    );
  });
  return findings;
}

function checkBuildFile(absPath, text) {
  const name = path.basename(absPath);
  const findings =
    name === 'pom.xml' ? mavenFindings(absPath, text) : gradleFindings(absPath, text);
  if (detectJavaLevel(path.dirname(absPath)) === null) {
    findings.push(
      finding(
        absPath,
        1,
        'B4',
        name === 'pom.xml'
          ? 'Declare the Java version (<java.version> with the Spring Boot parent, or maven.compiler.release).'
          : 'Declare the Java version with a toolchain: java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }.',
      ),
    );
  }
  return findings.sort((a, b) => a.line - b.line);
}

module.exports = { checkBuildFile };
