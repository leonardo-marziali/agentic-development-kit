#!/usr/bin/env node
'use strict';

/*
 * `sonarlint` — local SonarQube for IDE analysis from a terminal, for Claude.
 *
 * A thin, stateless front end: it resolves paths, finds the project root,
 * and asks that project's daemon (cli/daemon.js, which owns a warm SLOOP) to
 * do the work. See `sonarlint --help` for commands and exit codes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, UsageError, USAGE } = require('./args');
const { dataDir: resolveDataDir, projectRoot } = require('./paths');
const { buildResult, render, exitCodeFor } = require('./format');
const { request, readPid, DaemonNotRunning, NotInstalled } = require('./client');
const { runDoctor, renderChecks } = require('./doctor');

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;

/*
 * Directories expand to the files git would consider part of the project
 * (tracked, plus untracked-but-not-ignored), which already leaves out
 * node_modules, build output and anything else the repo ignores. Outside git,
 * a plain walk that skips dot-directories and node_modules.
 */
function expandDirectory(dir) {
  const git = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', '.'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!git.error && git.status === 0) {
    return git.stdout
      .split('\0')
      .filter(Boolean)
      .map((rel) => path.join(dir, rel))
      .filter((file) => fs.existsSync(file));
  }
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function collectFiles(paths, cwd) {
  const files = [];
  const skipped = [];
  for (const p of paths) {
    const abs = path.resolve(cwd, p);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      skipped.push({ file: abs, reason: 'not found' });
      continue;
    }
    if (stat.isDirectory()) files.push(...expandDirectory(abs));
    else files.push(abs);
  }
  return { files: [...new Set(files)], skipped };
}

/*
 * One daemon per project root, so files from two repositories (or a git
 * submodule) are analyzed by two daemons and merged back into one result.
 */
function groupByRoot(files) {
  const groups = new Map();
  const rootOf = new Map();
  for (const file of files) {
    const dir = path.dirname(file);
    if (!rootOf.has(dir)) rootOf.set(dir, projectRoot(dir));
    const root = rootOf.get(dir);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(file);
  }
  return groups;
}

async function analyzeFiles(parsed, ctx) {
  const { files, skipped } = collectFiles(parsed.paths, ctx.cwd);
  const merged = { issues: [], analyzed: [], skipped, failed: [], logs: [] };
  for (const [root, group] of groupByRoot(files)) {
    const reply = await request(
      {
        op: 'analyze',
        files: group,
        timeoutMs: parsed.options.timeoutMs,
        verbose: parsed.options.verbose,
      },
      {
        root,
        dataDir: ctx.dataDir,
        noStart: parsed.options.noStart,
        timeoutMs: parsed.options.timeoutMs + 60_000,
      },
    );
    mergeReply(merged, reply);
  }
  return finish(merged, parsed, ctx);
}

async function analyzeStdin(parsed, ctx) {
  const content = fs.readFileSync(0, 'utf8');
  const virtualAbs = path.resolve(ctx.cwd, parsed.options.path);
  // Always the cwd's project: the virtual path is a claim about where the
  // content *would* live, and the daemon refuses it if that's outside.
  const root = projectRoot(ctx.cwd);
  const reply = await request(
    {
      op: 'analyze',
      virtual: { path: virtualAbs, content },
      timeoutMs: parsed.options.timeoutMs,
      verbose: parsed.options.verbose,
    },
    {
      root,
      dataDir: ctx.dataDir,
      noStart: parsed.options.noStart,
      timeoutMs: parsed.options.timeoutMs + 60_000,
    },
  );
  const merged = { issues: [], analyzed: [], skipped: [], failed: [], logs: [] };
  mergeReply(merged, reply);
  return finish(merged, parsed, ctx);
}

function mergeReply(merged, reply) {
  merged.issues.push(...reply.issues);
  merged.analyzed.push(...reply.analyzed);
  merged.skipped.push(...reply.skipped);
  merged.failed.push(
    ...reply.failed.map((uri) => (uri.startsWith('file:') ? new URL(uri).pathname : uri)),
  );
  if (reply.logs) merged.logs.push(...reply.logs);
  for (const s of reply.skippedLanguages || []) {
    merged.skippedLanguages = merged.skippedLanguages || [];
    if (!merged.skippedLanguages.some((x) => x.language === s.language))
      merged.skippedLanguages.push(s);
  }
}

function finish(merged, parsed, ctx) {
  const result = buildResult({ ...merged, minSeverity: parsed.options.minSeverity, cwd: ctx.cwd });
  if (merged.skippedLanguages?.length) result.skippedAnalyzers = merged.skippedLanguages;
  process.stdout.write(render(result, parsed.options.format));
  if (parsed.options.verbose && merged.logs.length)
    process.stderr.write(`${merged.logs.join('\n')}\n`);
  return exitCodeFor(result);
}

/*
 * Rule descriptions arrive as HTML (monolithic, or split into tabs). Claude
 * reads text better than markup, so tags are stripped and the common entities
 * decoded; code blocks keep their line breaks.
 */
function htmlToText(html) {
  return String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h\d|li|pre|div|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectHtml(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /html/i.test(key)) out.push(value);
    else if (key === 'title' && typeof value === 'string') out.push(`<h3>${value}</h3>`);
    else if (typeof value === 'object') collectHtml(value, out);
  }
  return out;
}

async function rules(parsed, ctx) {
  const root = projectRoot(ctx.cwd);
  const { options } = parsed;
  const reply = await request(
    { op: 'rules', key: options.key, search: options.search, lang: options.lang },
    { root, dataDir: ctx.dataDir, noStart: options.noStart, timeoutMs: options.timeoutMs },
  );
  if (options.key) {
    const def = reply.rule.ruleDefinition;
    const description = htmlToText(collectHtml(reply.rule.description).join('\n'));
    if (options.format === 'json') {
      process.stdout.write(`${JSON.stringify({ ...def, description })}\n`);
    } else {
      const impacts = (def.softwareImpacts || [])
        .map((i) => `${i.softwareQuality}:${i.impactSeverity}`)
        .join(', ');
      process.stdout.write(
        `${def.key} — ${def.name}\n${def.language}; ${impacts}\n\n${description}\n`,
      );
    }
    return EXIT_CLEAN;
  }
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(reply.rules)}\n`);
  } else {
    const shown = reply.rules.slice(0, 50);
    const lines = shown.map((r) => `${r.key}  ${r.name}`);
    if (reply.rules.length > shown.length)
      lines.push(`… ${reply.rules.length - shown.length} more; narrow with --search or --lang`);
    if (!reply.rules.length) lines.push('no matching rules');
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return EXIT_CLEAN;
}

async function daemon(parsed, ctx) {
  const root = projectRoot(
    parsed.options.root ? path.resolve(ctx.cwd, parsed.options.root) : ctx.cwd,
  );
  const opts = { root, dataDir: ctx.dataDir, timeoutMs: 10_000 };
  if (parsed.action === 'status' || parsed.action === 'stop') {
    try {
      const reply = await request({ op: parsed.action }, { ...opts, noStart: true });
      process.stdout.write(
        parsed.action === 'stop'
          ? `stopping daemon ${readPid(root) || ''} for ${root}\n`
          : `${JSON.stringify(reply, null, parsed.options.format === 'json' ? 0 : 2)}\n`,
      );
      return EXIT_CLEAN;
    } catch (error) {
      if (!(error instanceof DaemonNotRunning)) throw error;
      process.stdout.write(`no daemon running for ${root}\n`);
      return parsed.action === 'stop' ? EXIT_CLEAN : EXIT_FINDINGS;
    }
  }
  // `daemon start` always counts as an explicit retry after a crash marker.
  const reply = await request({ op: 'status' }, { ...opts, warm: true });
  process.stdout.write(`daemon ${reply.pid} ${reply.state} for ${root}\n`);
  return EXIT_CLEAN;
}

async function doctor(parsed, ctx) {
  const checks = await runDoctor({ dataDir: ctx.dataDir, root: projectRoot(ctx.cwd) });
  process.stdout.write(
    parsed.options.format === 'json' ? `${JSON.stringify(checks)}\n` : renderChecks(checks),
  );
  return checks.some((c) => c.ok === false) ? EXIT_ERROR : EXIT_CLEAN;
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`sonarlint: ${error.message}\n\n${USAGE}\n`);
    return EXIT_ERROR;
  }
  if (parsed.command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return EXIT_CLEAN;
  }

  const ctx = { cwd: process.cwd(), dataDir: resolveDataDir(parsed.options.dataDir) };
  try {
    switch (parsed.command) {
      case 'files':
        return await analyzeFiles(parsed, ctx);
      case 'stdin':
        return await analyzeStdin(parsed, ctx);
      case 'rules':
        return await rules(parsed, ctx);
      case 'daemon':
        return await daemon(parsed, ctx);
      case 'doctor':
        return await doctor(parsed, ctx);
      default:
        return EXIT_ERROR;
    }
  } catch (error) {
    const hint =
      error instanceof NotInstalled || error instanceof DaemonNotRunning
        ? ''
        : ' (run `sonarlint doctor`)';
    process.stderr.write(`sonarlint: ${error.message}${hint}\n`);
    return EXIT_ERROR;
  }
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`sonarlint: ${error.stack || error.message}\n`);
      process.exitCode = EXIT_ERROR;
    },
  );
}

module.exports = {
  main,
  htmlToText,
  collectFiles,
  groupByRoot,
  expandDirectory,
  EXIT_CLEAN,
  EXIT_FINDINGS,
  EXIT_ERROR,
};
