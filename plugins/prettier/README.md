# Prettier

[![prettier plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=prettier-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that formats files with [Prettier][prettier] as Claude edits them.

[prettier]: https://prettier.io/

## What This Plugin Provides

### Formatting Hook

- A `PostToolUse` hook (on `Edit`/`Write`) runs `prettier --write
--ignore-unknown` on the exact file Claude just touched, immediately —
  no session-tracking, no batching. Prettier is fast and deterministic per
  file, so this keeps diffs clean as you go.
- `--ignore-unknown` lets Prettier itself decide whether it has a parser
  for the file; files it doesn't recognize are left untouched.
- Runs from the file's own working directory, so Prettier's own
  `.prettierrc*`/`.prettierignore` discovery (including per-package configs
  in a monorepo) behaves exactly as it would from the command line.
- Non-blocking: if Prettier fails (a parse error, no parser, not
  installed), the hook logs a warning to stderr and exits `0`. A
  formatting failure never blocks the session.
- Paths under `node_modules/` or `.git/` are always skipped.
- Uses `npx prettier`, so it resolves the target project's own installed
  version if present, and still works in a project that hasn't installed
  Prettier itself. The `npx` shim is located next to the running Node
  binary (hooks don't inherit a login shell, so PATH may not have it),
  falling back to a PATH lookup — and on Windows it resolves `npx.cmd` and
  routes through a shell, which Node requires for a batch shim.

### Skills

#### Formatting

- **format** (`/prettier:format [path]`): explicitly format files at
  `path` (or the whole project if omitted), including files this session
  never touched. This is the deliberate escape hatch for formatting
  pre-existing files. Manual invocation only — Claude won't trigger it on
  its own.

## Installation

Add this repository as a plugin marketplace in Claude Code and install
the `prettier` plugin from it, or copy the `plugins/prettier` directory
into your own plugin setup.

## Usage

Once installed, this plugin automatically formats every file Claude edits
or writes. Pre-existing files are never touched by the hook. Run
`/prettier:format [path]` to explicitly format pre-existing files.

### Configuration

Configure Prettier the normal way, by adding a configuration file to
directories you want formatted a particular way — see [Prettier's
configuration docs][prettier-config]. A `.prettierignore` file excludes
paths from formatting entirely.

[prettier-config]: https://prettier.io/docs/configuration

## Testing

The hook (`scripts/hooks/format.js`) has a versioned test suite under
`scripts/hooks/__tests__/`, using Node's built-in test runner. The hook's
one runtime dependency, `@leonardo-marziali/ad-lfl-kit`, is pinned in
`package-lock.json`; install it with `npm ci` first — the same install
Claude Code runs when it caches the plugin.

```bash
cd plugins/prettier
npm ci
pnpm test
```

It covers the `Edit`/`Write` matcher, the `node_modules`/`.git` guard,
`--ignore-unknown` behavior for files Prettier can't parse, the
non-blocking exit behavior when Prettier fails, and cross-platform
resolution and quoting of the `npx` shim. These are integration
tests that shell out to the real `npx prettier` (same as the hook does at
runtime). Test scratch directories are created under this repo's own
`.scratch/` (gitignored) rather than the OS temp dir, so `npx`'s local-bin
lookup walks up and finds this repo's root-level `prettier` devDependency
directly — no network access needed to run the suite here.

Coverage uses Node's built-in test-runner coverage (no extra dependency):

```bash
pnpm test:coverage
```

This writes `coverage/lcov.info`, which the
[Plugin Tests](../../.github/workflows/plugin-tests.yml) GitHub Actions
workflow uploads to Codecov under the `prettier-plugin` flag — that's what
the badge above reflects.
