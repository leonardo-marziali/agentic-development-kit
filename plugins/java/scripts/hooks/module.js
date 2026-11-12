'use strict';

/*
 * What a module is built for, read straight from its build file: the Java
 * language level (which drives JDT, `javac --release` and the rules that
 * need newer syntax), the Spring Boot version (which gates Boot-3-only
 * rules), and a JDK of that level to run the project's own build with.
 *
 * Build files are scanned, never parsed or executed: this runs on every
 * stop and must not start Maven or Gradle just to learn a number.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FALLBACK_LEVEL = 17;

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function stripXmlComments(text) {
  return text.replaceAll(/<!--[\s\S]*?-->/g, '');
}

// "1.8" → 8, "11" → 11, "VERSION_1_8" → 8, "VERSION_17" → 17.
function toLevel(value) {
  if (value === undefined || value === null) return null;
  const match = /^(?:VERSION_)?(?:1[._])?(\d+)$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
}

function tagValue(block, tag) {
  const match = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block);
  return match ? match[1] : null;
}

function blocks(text, tag) {
  return [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}

/*
 * The POM and its parents, child first, as far as the parent chain stays
 * inside the repository (a parent from a remote repository is out of reach).
 */
function pomChain(moduleRoot) {
  const chain = [];
  let file = path.join(moduleRoot, 'pom.xml');
  const seen = new Set();
  while (file && !seen.has(file)) {
    seen.add(file);
    const text = read(file);
    if (text === null) break;
    const clean = stripXmlComments(text);
    chain.push({ file, text: clean });
    const parent = blocks(clean, 'parent')[0];
    if (parent === undefined) break;
    const relative = tagValue(parent, 'relativePath') ?? '../pom.xml';
    if (!relative) break;
    const candidate = path.resolve(path.dirname(file), relative);
    file = candidate.endsWith('.xml') ? candidate : path.join(candidate, 'pom.xml');
  }
  return chain;
}

// Properties across the chain; a child's value wins over its parent's.
function chainProperties(chain) {
  const properties = {};
  for (const { text } of [...chain].reverse()) {
    for (const block of blocks(text, 'properties')) {
      for (const match of block.matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) {
        properties[match[1]] = match[2].trim();
      }
    }
  }
  return properties;
}

function resolveProperties(value, properties, depth = 0) {
  if (value === null || depth > 5) return value;
  const resolved = value.replaceAll(/\$\{([\w.-]+)\}/g, (whole, name) => properties[name] ?? whole);
  return resolved === value ? value : resolveProperties(resolved, properties, depth + 1);
}

function compilerPluginLevel(chain, properties) {
  for (const { text } of chain) {
    for (const plugin of blocks(text, 'plugin')) {
      if (tagValue(plugin, 'artifactId') !== 'maven-compiler-plugin') continue;
      for (const tag of ['release', 'source']) {
        const level = toLevel(resolveProperties(tagValue(plugin, tag), properties));
        if (level !== null) return level;
      }
    }
  }
  return null;
}

function mavenLevel(moduleRoot) {
  const chain = pomChain(moduleRoot);
  if (chain.length === 0) return null;
  const properties = chainProperties(chain);
  for (const name of ['maven.compiler.release', 'maven.compiler.source', 'java.version']) {
    const level = toLevel(resolveProperties(properties[name] ?? null, properties));
    if (level !== null) return level;
  }
  return compilerPluginLevel(chain, properties);
}

function gradleText(moduleRoot) {
  return (
    read(path.join(moduleRoot, 'build.gradle.kts')) ?? read(path.join(moduleRoot, 'build.gradle'))
  );
}

const GRADLE_LEVEL_PATTERNS = [
  /JavaLanguageVersion\.of\(\s*['"]?(\d+)['"]?\s*\)/,
  /jvmToolchain\(\s*(\d+)\s*\)/,
  /options\.release(?:\.set\(\s*|\s*=\s*)(\d+)/,
  /sourceCompatibility\s*=\s*(?:JavaVersion\.)?['"]?(VERSION_[\d_]+|[\d.]+)['"]?/,
];

function levelIn(text) {
  for (const pattern of GRADLE_LEVEL_PATTERNS) {
    const match = pattern.exec(text);
    const level = match ? toLevel(match[1]) : null;
    if (level !== null) return level;
  }
  return null;
}

// Gradle scripts under a convention-plugin build (buildSrc/, build-logic/).
function conventionScripts(dir) {
  const scripts = [];
  const walk = (current, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'build' && entry.name !== '.gradle')
        walk(full, depth + 1);
      else if (/\.gradle(\.kts)?$/.test(entry.name)) scripts.push(full);
    }
  };
  walk(dir, 0);
  return scripts.sort((a, b) => a.localeCompare(b));
}

/*
 * The first value `find` reads from a Gradle module's build: its own build
 * file, then each enclosing build up to the repository root (a root
 * `subprojects {}` / `allprojects {}`), then the root's convention plugins
 * in buildSrc/ or build-logic/.
 */
function searchGradle(moduleRoot, find) {
  if (gradleText(moduleRoot) === null) return null;
  let dir = moduleRoot;
  while (true) {
    const text = gradleText(dir);
    const value = text === null ? null : find(text);
    if (value !== null) return value;
    for (const plugins of ['buildSrc', 'build-logic']) {
      for (const script of conventionScripts(path.join(dir, plugins))) {
        const fromPlugin = find(read(script) || '');
        if (fromPlugin !== null) return fromPlugin;
      }
    }
    const parent = path.dirname(dir);
    if (fs.existsSync(path.join(dir, '.git')) || parent === dir) return null;
    dir = parent;
  }
}

function gradleLevel(moduleRoot) {
  return searchGradle(moduleRoot, levelIn);
}

function mavenEncoding(moduleRoot) {
  const chain = pomChain(moduleRoot);
  if (chain.length === 0) return null;
  const properties = chainProperties(chain);
  const declared = resolveProperties(
    properties['project.build.sourceEncoding'] ?? null,
    properties,
  );
  if (declared) return declared;
  for (const { text } of chain) {
    for (const plugin of blocks(text, 'plugin')) {
      if (tagValue(plugin, 'artifactId') !== 'maven-compiler-plugin') continue;
      const encoding = resolveProperties(tagValue(plugin, 'encoding'), properties);
      if (encoding) return encoding;
    }
  }
  return null;
}

function gradleEncoding(moduleRoot) {
  return searchGradle(moduleRoot, (text) => {
    const match = /options\.encoding(?:\.set\(\s*|\s*=\s*)['"]([\w.:-]+)['"]/.exec(text);
    return match ? match[1] : null;
  });
}

// The charset the module's sources are written in; UTF-8 unless the build says otherwise.
function detectEncoding(moduleRoot) {
  return mavenEncoding(moduleRoot) ?? gradleEncoding(moduleRoot) ?? 'UTF-8';
}

function detectJavaLevel(moduleRoot) {
  return mavenLevel(moduleRoot) ?? gradleLevel(moduleRoot);
}

function majorMinor(version) {
  const match = /^(\d+)\.(\d+)/.exec(version || '');
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

function mavenBoot(moduleRoot) {
  const chain = pomChain(moduleRoot);
  const properties = chainProperties(chain);
  for (const { text } of chain) {
    const parent = blocks(text, 'parent')[0];
    if (parent && tagValue(parent, 'artifactId') === 'spring-boot-starter-parent') {
      return majorMinor(resolveProperties(tagValue(parent, 'version'), properties));
    }
    for (const dependency of blocks(text, 'dependency')) {
      if (tagValue(dependency, 'artifactId') === 'spring-boot-dependencies') {
        return majorMinor(resolveProperties(tagValue(dependency, 'version'), properties));
      }
    }
  }
  return null;
}

function gradleBoot(moduleRoot) {
  const text = gradleText(moduleRoot);
  if (text === null) return null;
  const match = /id[\s(]+['"]org\.springframework\.boot['"]\)?\s+version\s+['"](\d+\.\d+)/.exec(
    text,
  );
  return match ? majorMinor(match[1]) : null;
}

function detectSpringBoot(moduleRoot) {
  return mavenBoot(moduleRoot) ?? gradleBoot(moduleRoot);
}

function moduleInfo(moduleRoot, config) {
  let javaLevel = config?.javaVersion ?? detectJavaLevel(moduleRoot);
  if (javaLevel === null || javaLevel === undefined) {
    process.stderr.write(
      `java plugin: could not detect the Java version of ${moduleRoot}; assuming ${FALLBACK_LEVEL} — ` +
        'set javaVersion in .claude/java-standards.json\n',
    );
    javaLevel = FALLBACK_LEVEL;
  }
  return { javaLevel, boot: detectSpringBoot(moduleRoot), encoding: detectEncoding(moduleRoot) };
}

// A JDK home's major version, from its `release` file ("1.8.0_402" → 8).
function jdkMajor(home) {
  const text = read(path.join(home, 'release'));
  const match = text && /JAVA_VERSION="(?:1\.)?(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/*
 * The `jdk_homes` user option. Claude Code exports a `multiple` option to
 * hooks as CLAUDE_PLUGIN_OPTION_JDK_HOMES; accept a JSON array or a
 * comma/newline-separated list, whichever form it arrives in.
 */
function configuredHomes() {
  const raw = process.env.CLAUDE_PLUGIN_OPTION_JDK_HOMES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((entry) => typeof entry === 'string');
  } catch {
    // not JSON: fall through to a plain list
  }
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toolchainHomes(level) {
  const text = read(path.join(os.homedir(), '.m2', 'toolchains.xml'));
  if (!text) return [];
  return blocks(stripXmlComments(text), 'toolchain')
    .filter(
      (block) => tagValue(block, 'type') === 'jdk' && toLevel(tagValue(block, 'version')) === level,
    )
    .map((block) => tagValue(block, 'jdkHome'))
    .filter(Boolean);
}

function defaultSearchRoots() {
  const home = os.homedir();
  return [
    path.join(home, '.sdkman', 'candidates', 'java'),
    path.join(home, '.local', 'share', 'mise', 'installs', 'java'),
    path.join(home, '.asdf', 'installs', 'java'),
    '/usr/lib/jvm',
    '/Library/Java/JavaVirtualMachines',
  ];
}

function installedHomes(searchRoots) {
  const homes = [];
  for (const root of searchRoots) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const dir = path.join(root, entry);
      // macOS bundles keep the JDK under Contents/Home.
      homes.push(
        fs.existsSync(path.join(dir, 'Contents', 'Home'))
          ? path.join(dir, 'Contents', 'Home')
          : dir,
      );
    }
  }
  return homes;
}

function buildJavaHome(level, { searchRoots = defaultSearchRoots(), warn } = {}) {
  const candidates = [
    ...configuredHomes(),
    ...toolchainHomes(level),
    ...installedHomes(searchRoots),
  ];
  const home = candidates.find((candidate) => jdkMajor(candidate) === level) ?? null;
  if (home === null && warn) {
    warn(
      `no JDK ${level} found for the build tool; using JAVA_HOME. Add one to the plugin's jdk_homes option (/config).`,
    );
  }
  return home;
}

module.exports = {
  detectJavaLevel,
  detectSpringBoot,
  detectEncoding,
  moduleInfo,
  buildJavaHome,
  toLevel,
};
