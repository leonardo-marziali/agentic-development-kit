'use strict';

/*
 * `sonarlint server` — what SonarQube Server or Cloud last recorded for the
 * files named, read through the SonarQube CLI's `sonar api`.
 *
 * Local analysis and the server answer different questions, and neither is a
 * superset of the other. The server runs whatever analyzer versions and
 * quality profile it has today, so it can report rules the pinned local
 * engine doesn't ship (the `githubactions:*` rules for workflow files, for
 * one) as well as hotspots and taint findings that never run locally. What it
 * can't see is the working tree: it knows the revision it last analyzed, so
 * the result says which revision that was and which files have changed since.
 *
 * Each file is matched to its nearest `.sonarlint/connectedMode.json`, and the
 * binding's directory is taken as the scanner's base directory: a file's
 * component key is `<projectKey>:<path from the binding dir>`.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { groupByBinding, describeGroup } = require('../scripts/hooks/connected-mode');
const { toRecord, compareRecords, displayPathFrom } = require('./format');
const { rank } = require('./severity');

// The issues endpoint's own limits: 500 per page, and never past result 10,000.
const PAGE_SIZE = 500;
const MAX_RESULTS = 10_000;
// Up to this many files are asked for by component key; more read the whole
// project and filter, rather than sending hundreds of requests.
const MAX_FILE_KEYS = 100;
const FILE_KEYS_PER_REQUEST = 25;

class ServerError extends Error {}

/*
 * `sonar api get <endpoint>`, parsed. The CLI holds the credentials (keychain
 * or SONARQUBE_CLI_TOKEN); this never sees or passes a token.
 * SONARLINT_SONAR_CLI points the tests at a stand-in.
 */
function sonarGet(endpoint, { cwd, timeoutMs }) {
  const bin = process.env.SONARLINT_SONAR_CLI || 'sonar';
  const result = spawnSync(bin, ['api', 'get', endpoint], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const route = endpoint.split('?')[0];
  if (result.error?.code === 'ENOENT')
    throw new ServerError(
      'the SonarQube CLI (`sonar`) is not installed; see the sonarqube-web-api skill',
    );
  if (result.error) throw new ServerError(`sonar api get ${route}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n')[0];
    throw new ServerError(`sonar api get ${route} exited ${result.status}: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new ServerError(`sonar api get ${route}: response is not JSON`);
  }
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  return search.toString();
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/*
 * Every open issue for one component list, following pages until the total
 * or the endpoint's 10,000-result ceiling.
 */
function searchIssues(componentKeys, scope, get) {
  const issues = [];
  let total = 0;
  for (let page = 1; page * PAGE_SIZE <= MAX_RESULTS; page += 1) {
    const reply = get(
      `/api/issues/search?${query({
        componentKeys,
        organization: scope.organization,
        branch: scope.branch,
        pullRequest: scope.pullRequest,
        resolved: 'false',
        ps: PAGE_SIZE,
        p: page,
      })}`,
    );
    const batch = reply.issues || [];
    issues.push(...batch);
    total = reply.paging?.total ?? reply.total ?? issues.length;
    if (batch.length < PAGE_SIZE || issues.length >= total) break;
  }
  return { issues, truncated: total > issues.length };
}

/*
 * The server's latest analysis of the scope: { date, revision }, or null with
 * the reason when there is none. It doubles as the existence check: the
 * issues endpoint answers an unknown project key, branch or pull request
 * with an empty 200, so only this lookup can tell "no issues" from "never
 * analyzed".
 *
 * Pull requests read the pull-request list: SonarQube Cloud ignores
 * `pullRequest` on project_analyses/search and returns the main branch's.
 */
function latestAnalysis(scope, get) {
  try {
    if (scope.pullRequest) {
      const reply = get(`/api/project_pull_requests/list?${query({ project: scope.projectKey })}`);
      const pr = (reply.pullRequests || []).find((p) => p.key === String(scope.pullRequest));
      return pr
        ? { analysis: { date: pr.analysisDate || null, revision: pr.commit?.sha || null } }
        : { analysis: null, reason: 'no such pull request on the server' };
    }
    const reply = get(
      `/api/project_analyses/search?${query({
        project: scope.projectKey,
        organization: scope.organization,
        branch: scope.branch,
        ps: 1,
      })}`,
    );
    const latest = reply.analyses?.[0];
    return latest
      ? { analysis: { date: latest.date || null, revision: latest.revision || null } }
      : { analysis: null, reason: 'the server has no analysis yet' };
  } catch (error) {
    if (!(error instanceof ServerError)) throw error;
    return { analysis: null, reason: error.message };
  }
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

/*
 * How the working tree relates to the analyzed revision: HEAD, whether they
 * match, and which of the queried files differ from what the server saw
 * (null when that revision isn't in the local clone, so it can't be told).
 */
function freshness(dir, files, revision) {
  const head = git(['rev-parse', 'HEAD'], dir);
  if (!revision || !head) return { head, upToDate: null, changedSinceAnalysis: null };
  if (git(['cat-file', '-e', `${revision}^{commit}`], dir) === null)
    return { head, upToDate: head === revision, changedSinceAnalysis: null };
  // --name-only paths are relative to the top level, whatever the cwd.
  const top = git(['rev-parse', '--show-toplevel'], dir) || dir;
  const changed = git(['diff', '--name-only', '-z', revision, '--', ...files], dir);
  return {
    head,
    upToDate: head === revision,
    changedSinceAnalysis:
      changed === null
        ? null
        : changed
            .split('\0')
            .filter(Boolean)
            .map((rel) => path.join(top, rel)),
  };
}

function relativeKey(dir, file) {
  return path.relative(dir, file).split(path.sep).join('/');
}

/*
 * One server issue into the shape toRecord reads, located by stripping the
 * project key off its component key.
 */
function toLocalIssue(issue, group) {
  const prefix = `${group.binding.projectKey}:`;
  const component = String(issue.component || '');
  const rel = component.startsWith(prefix) ? component.slice(prefix.length) : null;
  const range = issue.textRange || (issue.line ? { startLine: issue.line } : {});
  return {
    rel,
    issue: {
      file: rel === null ? null : path.join(group.dir, ...rel.split('/')),
      ruleKey: issue.rule,
      primaryMessage: issue.message,
      severity: issue.severity,
      type: issue.type,
      impacts: issue.impacts,
      textRange: { startLine: range.startLine ?? null, endLine: range.endLine ?? null },
    },
  };
}

function queryGroup(group, options, get) {
  const scope = {
    projectKey: group.binding.projectKey,
    organization: group.binding.sonarCloudOrganization,
    branch: options.branch,
    pullRequest: options.pullRequest,
  };
  const wanted = new Map(group.files.map((file) => [relativeKey(group.dir, file), file]));

  const found = [];
  let truncated = false;
  const lists =
    wanted.size <= MAX_FILE_KEYS
      ? chunk([...wanted.keys()], FILE_KEYS_PER_REQUEST).map((rels) =>
          rels.map((rel) => `${scope.projectKey}:${rel}`).join(','),
        )
      : [scope.projectKey];
  for (const componentKeys of lists) {
    const reply = searchIssues(componentKeys, scope, get);
    found.push(...reply.issues);
    truncated = truncated || reply.truncated;
  }

  const issues = [];
  const seen = new Set();
  for (const raw of found) {
    if (seen.has(raw.key)) continue;
    seen.add(raw.key);
    const { rel, issue } = toLocalIssue(raw, group);
    if (rel !== null && wanted.has(rel)) issues.push({ issue, key: raw.key, status: raw.status });
  }

  const { analysis, reason } = latestAnalysis(scope, get);
  return {
    issues,
    noAnalysis: analysis ? null : reason,
    project: {
      projectKey: scope.projectKey,
      binding: describeGroup(group),
      branch: options.branch || null,
      pullRequest: options.pullRequest || null,
      analysis,
      truncated,
      ...freshness(group.dir, group.files, analysis?.revision),
    },
  };
}

/*
 * One bound group's issues, project entry and failure (if any), merged into
 * the result being built.
 */
function addGroup(acc, group, options, run, displayPath) {
  const projectKey = group.binding.projectKey;
  let reply;
  try {
    reply = queryGroup(group, options, run);
  } catch (error) {
    if (!(error instanceof ServerError)) throw error;
    acc.failed.push({ project: projectKey, error: error.message });
    return;
  }
  const { issues, project, noAnalysis } = reply;
  if (noAnalysis)
    acc.failed.push({
      project: projectKey,
      error: `no analysis of ${target(options)} found (${noAnalysis}); the project key, branch or pull request may not exist, so an empty issue list proves nothing`,
    });
  else acc.queried += group.files.length;
  for (const { issue, key, status } of issues) {
    // Quick fixes are an IDE-engine notion the server never reports.
    const record = { ...toRecord(issue, displayPath), key, status };
    delete record.hasQuickFix;
    acc.records.push(record);
  }
  acc.projects.push({
    ...project,
    changedSinceAnalysis: project.changedSinceAnalysis?.map(displayPath) ?? null,
  });
}

/*
 * Queries the server for `files` (absolute paths) and builds the result both
 * formats render from. `get` defaults to `sonar api get`; tests replace it.
 */
function serverResult({ files, skipped = [], minSeverity, cwd, options = {}, get }) {
  const run = get || ((endpoint) => sonarGet(endpoint, { cwd, timeoutMs: options.timeoutMs }));
  const displayPath = displayPathFrom(cwd);
  const acc = { records: [], projects: [], failed: [], queried: 0 };
  const notBound = [];

  for (const group of groupByBinding(files, { fallbackDir: cwd })) {
    if (group.binding?.projectKey) addGroup(acc, group, options, run, displayPath);
    else
      for (const file of group.files)
        notBound.push({ file, reason: 'no .sonarlint/connectedMode.json binding' });
  }

  const { records, projects, failed, queried } = acc;
  records.sort(compareRecords);
  const threshold = rank(minSeverity);
  return {
    issues: records,
    summary: {
      queried,
      withIssues: new Set(records.map((r) => r.file)).size,
      atOrAboveThreshold: records.filter((r) => rank(r.severity) >= threshold).length,
      minSeverity,
    },
    projects,
    skipped: [...skipped, ...notBound].map((s) => ({
      file: displayPath(s.file),
      reason: s.reason,
    })),
    failed,
  };
}

function target({ pullRequest, branch }) {
  if (pullRequest) return `pull request ${pullRequest}`;
  return branch ? `branch ${branch}` : 'the main branch';
}

function describeAnalysis(project) {
  if (!project.analysis) return `${project.binding}, ${target(project)}: no analysis found`;
  const { date, revision } = project.analysis;
  const short = (sha) => (sha ? sha.slice(0, 7) : 'unknown revision');
  let line = `${project.binding}, ${target(project)}: last analysis ${date || 'undated'} of ${short(revision)}`;
  if (project.upToDate === true) line += ' (= HEAD)';
  else if (project.head) line += `; HEAD is ${short(project.head)}`;
  if (project.changedSinceAnalysis?.length)
    line += `; changed since: ${project.changedSinceAnalysis.join(', ')}`;
  else if (project.changedSinceAnalysis === null && revision && project.upToDate === false)
    line += '; analyzed revision not in this clone, changes unknown';
  if (project.truncated) line += `; only the first ${MAX_RESULTS} issues were read`;
  return line;
}

function renderServerText(result) {
  const lines = result.issues.map((r) => {
    const where = r.line ? `${r.file}:${r.line}` : r.file;
    return `${where}  ${r.severity}  ${r.rule}  ${r.message}`;
  });
  for (const project of result.projects) lines.push(describeAnalysis(project));
  const s = result.summary;
  const parts = [
    `${s.queried} file(s) queried on the server`,
    `${result.issues.length} open issue(s) in ${s.withIssues} file(s)`,
    `${s.atOrAboveThreshold} at/above ${s.minSeverity}`,
  ];
  lines.push(parts.join(', '));
  for (const skip of result.skipped) lines.push(`skipped ${skip.file}: ${skip.reason}`);
  for (const f of result.failed) lines.push(`server query failed for ${f.project}: ${f.error}`);
  return `${lines.join('\n')}\n`;
}

function renderServer(result, format) {
  return format === 'json' ? `${JSON.stringify(result)}\n` : renderServerText(result);
}

/*
 * 2 when any project couldn't be read or nothing was bound — "the server had
 * nothing to say" must never be mistaken for "the server says it's clean".
 */
function serverExitCode(result) {
  if (result.failed.length || result.summary.queried === 0) return 2;
  return result.summary.atOrAboveThreshold > 0 ? 1 : 0;
}

module.exports = {
  ServerError,
  sonarGet,
  serverResult,
  renderServer,
  renderServerText,
  serverExitCode,
};
