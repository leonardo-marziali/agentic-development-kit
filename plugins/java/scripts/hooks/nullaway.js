'use strict';

/*
 * J20's flow analysis: compiles the session's changed files with javac +
 * Error Prone + NullAway (the plugin's pinned jars, on its JDK 21) against
 * the module's own classpath, and reports NullAway's diagnostics. Only
 * NullAway counts: other compiler errors are jdtls's to show, and never block.
 *
 * The invocation is the one proven on JDK 21 (see the plan's Global
 * Constraints): javac needs these exports for Error Prone, and
 * -XDaddTypeAnnotationsToSymbol for JSpecify's type-use annotations.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveClasspath } = require('./classpath');
const { buildJavaHome } = require('./module');
const { registerSection } = require('./sections');

const JAVAC_TIMEOUT_MS = 120 * 1000;
const FIRST_LOMBOK_FOR_JDK21 = [1, 18, 30];
const EXPORTED = [
  'api',
  'file',
  'main',
  'model',
  'parser',
  'processing',
  'tree',
  'util',
  'code',
  'comp',
];
const OPENED = ['code', 'comp'];

const jarNamed = (jars, prefix) =>
  jars.find(
    (jar) =>
      path.basename(jar).startsWith(prefix) && /^\d/.test(path.basename(jar).slice(prefix.length)),
  );

function versionOf(jar, prefix) {
  const match = new RegExp(`^${prefix}(\\d+)\\.(\\d+)\\.(\\d+)`).exec(path.basename(jar));
  return match ? match.slice(1, 4).map(Number) : null;
}

function olderThan(version, floor) {
  for (let i = 0; i < floor.length; i += 1) {
    if (version[i] !== floor[i]) return version[i] < floor[i];
  }
  return false;
}

/*
 * Annotation processors NullAway needs to see generated code: Lombok first
 * (getters must exist before NullAway reads them), then MapStruct and
 * QueryDSL when the project uses them. A Lombok older than 1.18.30 crashes
 * JDK 21's javac, so the plugin's pinned Lombok stands in for it.
 */
function processorJars(classpath, processorPath, manifest) {
  const all = [...processorPath, ...classpath];
  const jars = [];
  const notes = [];
  const lombok = jarNamed(all, 'lombok-');
  if (lombok) {
    const version = versionOf(lombok, 'lombok-');
    if (version && olderThan(version, FIRST_LOMBOK_FOR_JDK21)) {
      jars.push(...manifest.jars.lombok);
      notes.push(
        `project Lombok ${version.join('.')} can't run on JDK 21; used the plugin's Lombok ${path
          .basename(manifest.jars.lombok[0])
          .replace(/^lombok-|\.jar$/g, '')} for NullAway`,
      );
    } else {
      jars.push(lombok);
    }
  }
  for (const prefix of ['mapstruct-processor-', 'querydsl-apt-']) {
    const jar = jarNamed(all, prefix);
    if (jar) jars.push(jar);
  }
  return { jars, notes };
}

function detectMode(classpath, configured) {
  if (configured === 'jspecify' || configured === 'spring') return configured;
  if (jarNamed(classpath, 'jspecify-')) return 'jspecify';
  if (jarNamed(classpath, 'spring-core-')) return 'spring';
  return null;
}

function buildJavacArgs({
  manifest,
  classpath,
  outputDirs,
  sourcepath,
  processors,
  files,
  mode,
  basePackage,
  javaLevel,
  outDir,
}) {
  const options =
    mode === 'jspecify'
      ? ['-XepOpt:NullAway:OnlyNullMarked=true', '-XepOpt:NullAway:JSpecifyMode=true']
      : [`-XepOpt:NullAway:AnnotatedPackages=${basePackage}`];
  return [
    ...EXPORTED.map((pkg) => `-J--add-exports=jdk.compiler/com.sun.tools.javac.${pkg}=ALL-UNNAMED`),
    ...OPENED.map((pkg) => `-J--add-opens=jdk.compiler/com.sun.tools.javac.${pkg}=ALL-UNNAMED`),
    '-XDcompilePolicy=simple',
    '--should-stop=ifError=FLOW',
    '-XDaddTypeAnnotationsToSymbol=true',
    '-proc:full',
    '-implicit:none',
    '-nowarn',
    '-Xlint:-options',
    '-encoding',
    'UTF-8',
    '--release',
    String(javaLevel),
    '-processorpath',
    [...processors, ...manifest.jars.errorprone].join(path.delimiter),
    '-cp',
    [...outputDirs, ...classpath].join(path.delimiter),
    ...(sourcepath.length > 0 ? ['-sourcepath', sourcepath.join(path.delimiter)] : []),
    '-d',
    outDir,
    ['-Xplugin:ErrorProne', '-XepDisableAllChecks', '-Xep:NullAway:ERROR', ...options].join(' '),
    ...files,
  ];
}

function parseNullAway(output) {
  const findings = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^([^:\n]+\.java):(\d+): (?:error|warning): \[NullAway\] ([^\n]*)$/.exec(line);
    if (match)
      findings.push({
        file: match[1],
        line: Number(match[2]),
        rule: 'J20',
        message: `NullAway: ${match[3]}`,
      });
  }
  return findings;
}

function runNullAway({
  manifest,
  files,
  classpath,
  processorPath,
  outputDirs,
  sourcepath,
  mode,
  basePackage,
  javaLevel,
}) {
  const { jars, notes } = processorJars(classpath, processorPath, manifest);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-plugin-nullaway-'));
  try {
    const args = buildJavacArgs({
      manifest,
      classpath,
      outputDirs,
      sourcepath,
      processors: jars,
      files,
      mode,
      basePackage,
      javaLevel,
      outDir,
    });
    const result = spawnSync(manifest.javac, args, {
      encoding: 'utf8',
      timeout: JAVAC_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error)
      return { findings: [], notes: [...notes, `javac could not run: ${result.error.message}`] };
    return { findings: parseNullAway(`${result.stdout}\n${result.stderr}`), notes };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// The changed files' common package, for Spring mode when no basePackage is configured.
function commonPackage(files) {
  const packages = files
    .map((file) => (/^\s*package\s+([\w.]+)\s*;/m.exec(fs.readFileSync(file, 'utf8')) || [])[1])
    .filter(Boolean);
  if (packages.length === 0) return null;
  let prefix = packages[0].split('.');
  for (const pkg of packages.slice(1)) {
    const parts = pkg.split('.');
    let i = 0;
    while (i < prefix.length && prefix[i] === parts[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  return prefix.length > 0 ? prefix.join('.') : null;
}

function classpathCacheDir() {
  return path.join(
    process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.cache', 'claude-java-plugin'),
    'classpath-cache',
  );
}

function runSection({ config, modules, manifest, warn }) {
  if (!config.nullaway.enabled || !manifest?.jars?.errorprone) return { findings: [] };
  const findings = [];
  for (const [moduleRoot, module] of modules) {
    const level = module.info.javaLevel;
    if (level > manifest.javaMajor) {
      warn(
        `${moduleRoot} targets Java ${level}, newer than the plugin's JDK ${manifest.javaMajor}; skipping NullAway there.`,
      );
      continue;
    }
    const resolved = resolveClasspath({
      moduleRoot,
      cacheDir: classpathCacheDir(),
      javaHome: buildJavaHome(level),
      warn,
    });
    if (!resolved) continue;
    const mode = detectMode(resolved.classpath, config.nullaway.annotations);
    if (!mode) {
      warn(
        `no JSpecify or Spring nullness annotations on the classpath of ${moduleRoot}; skipping NullAway there.`,
      );
      continue;
    }
    const basePackage = config.archunit.basePackage || commonPackage(module.files);
    if (mode === 'spring' && !basePackage) continue;
    const sourcepath = ['src/main/java', 'src/test/java']
      .map((rel) => path.join(moduleRoot, rel))
      .filter((dir) => fs.existsSync(dir));
    const result = runNullAway({
      manifest,
      files: module.files,
      ...resolved,
      sourcepath,
      mode,
      basePackage,
      javaLevel: level,
    });
    for (const note of result.notes) warn(note);
    findings.push(...result.findings);
  }
  return { findings };
}

registerSection({ name: 'NullAway', partition: true, run: runSection });

module.exports = {
  buildJavacArgs,
  detectMode,
  processorJars,
  parseNullAway,
  runNullAway,
  commonPackage,
};
