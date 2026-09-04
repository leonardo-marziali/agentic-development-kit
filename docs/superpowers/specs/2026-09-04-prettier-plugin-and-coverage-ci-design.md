# Prettier plugin + repo-wide coverage CI

Date: 2026-09-04

## Summary

Add a `prettier` plugin (mirroring the existing `markdown` plugin's structure)
that formats files as Claude edits them, and generalize this repo's
per-plugin test/coverage CI so it scales to more plugins without either
running everything on every push or assuming every plugin uses the same
test tooling.

## Prettier plugin

### Layout

```text
plugins/prettier/
  .claude-plugin/plugin.json
  hooks/hooks.json
  scripts/hooks/format.js
  scripts/hooks/__tests__/format.test.js
  scripts/hooks/__tests__/helpers.js
  scripts/skills/format/SKILL.md
  package.json
  README.md
```

### Hook behavior

- Event: `PostToolUse`, `matcher: "Edit|Write"` — same trigger point as the
  markdown plugin's tracking hook, but this hook formats immediately rather
  than recording state for a later batch pass.
- `scripts/hooks/format.js`:
  1. Read the hook payload from stdin; pull `tool_input.file_path` and `cwd`.
  2. Resolve to an absolute path; return silently if the file doesn't exist.
  3. Skip paths under `node_modules/` or `.git/` (Prettier doesn't ignore
     these by default).
  4. Run `npx prettier --write --ignore-unknown "<file>"` from `cwd` —
     `--ignore-unknown` lets Prettier decide whether it has a parser for the
     extension; running from `cwd` means Prettier's own `.prettierrc*` /
     `.prettierignore` discovery (including per-package configs in a
     monorepo) behaves exactly as it would from the command line.
  5. Non-blocking: a non-zero exit (parse error, no parser, not installed)
     is logged to stderr; the hook always exits 0. Formatting failures never
     block the session — unlike the markdown plugin's lint loop, there's no
     "still-violating" state to resolve here.
- No state-tracking file, no `Stop`/`SubagentStop` hook, no attempt-cap
  loop — Prettier either formats a file or leaves it alone; there's nothing
  to loop on.
- `npx prettier` (not a local-binary check), matching the markdown plugin's
  `npx markdownlint-cli` convention: resolves the target project's own
  installed version if present, and still works in a project that hasn't
  installed Prettier itself.

### Manual escape hatch

A `format` skill (`scripts/skills/format/SKILL.md`, `disable-model-invocation:
true`, exposed as `/prettier:format [path]`) mirrors `/markdown:lint`:
explicitly formats pre-existing files the session never touched. Manual
invocation only.

### Testing

`node --test` suite under `scripts/hooks/__tests__/format.test.js` (plus a
`helpers.js` matching the markdown plugin's `runHook`/scratch-dir helpers),
covering: stdin parsing, path resolution, the `node_modules`/`.git` guard,
and non-blocking exit behavior when Prettier fails. `package.json` gets
`test` and `test:coverage` scripts matching the markdown plugin's.

### Registration

- Add `prettier` to `.claude-plugin/marketplace.json`.
- `plugins/prettier/README.md` documents the plugin, following the markdown
  plugin's structure, with its own scoped Codecov badge
  (`?flag=prettier-plugin`).

## Repo-wide coverage CI

### Constraints established during design

- Plugin hook code in this repo is Node.js/`node --test` only — plugins
  named after other languages (e.g. a future `java` plugin) ship
  skills/config _for_ that language; their own hook glue is still Node,
  since Claude Code hooks are just stdin/stdout shell commands and Node is
  guaranteed present in the environment. CI does not need to support
  heterogeneous test toolchains.
- Plugin count and suite size over time are unknown, so CI cost should scale
  with what actually changed, not run every plugin's suite on every push.

### Workflow

Replace `.github/workflows/markdown-plugin-tests.yml` with a single
`.github/workflows/plugin-tests.yml`:

1. A `detect` job uses `dorny/paths-filter` (no checkout — it falls back to
   the GitHub API to diff changed files) with filters per plugin directory
   (`plugins/markdown/**`, `plugins/prettier/**`) plus a `workflow` filter on
   the workflow file itself. It builds a JSON array of affected plugin names
   (a workflow-file change forces the full set) and exposes it as a job
   output.
2. A `test` job runs only if that array is non-empty, with
   `strategy.matrix.plugin` set from the detected array. Each matrix entry:
   checkout, `actions/setup-node@v4` (Node 24), `npm run test:coverage` in
   `plugins/<plugin>`, then `codecov/codecov-action@v4` uploading
   `plugins/<plugin>/coverage/lcov.info` under flag `<plugin>-plugin`.
3. Adding a future plugin means adding one filter entry and one line to the
   matrix-building step — no new workflow file, no shared-step abstraction
   for a toolchain difference that isn't expected to materialize.

### `codecov.yml`

Add a root `codecov.yml` with `flag_management.default_rules.carryforward:
true`, so a commit that only uploads one plugin's flag doesn't make Codecov
treat every other flag as having dropped to zero for that commit — necessary
because uploads are now independent per plugin (not all-at-once).

### Root README indicator

Add Codecov's plain aggregate badge (no `flag=` query param) near the top of
the root `README.md` — it reflects combined coverage across every flag
Codecov has on record for the default branch, kept accurate by carryforward.
Each plugin's own README keeps its own scoped badge.

## Out of scope

- No self-test-enforcement hooks (the markdown plugin's
  `track-touched-hook-code.js` / `verify-tests.js` pair, which blocks a
  session from ending if edits to the plugin's _own_ hook source haven't
  been run against its test suite) — not requested for the prettier plugin
  in this pass.
- No coverage-threshold status checks in `codecov.yml` — only what's needed
  for the badges to be accurate.
