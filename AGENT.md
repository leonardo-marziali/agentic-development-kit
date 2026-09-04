# Agent Instructions

Instructions for AI coding agents (Claude Code, etc.) working in this repository.

## Package manager

This repository uses **pnpm** exclusively. Do not use `npm` or `yarn`.

- Install dependencies: `pnpm install`
- Add a dependency: `pnpm add <package>`
- Add a dev dependency: `pnpm add -D <package>`
- Run a script: `pnpm run <script>` (or `pnpm <script>`)

Never run `npm install`, `npm add`, `yarn`, or commit a `package-lock.json`
/ `yarn.lock`. Only `pnpm-lock.yaml` should be committed as the lockfile.

## Plugin skill naming

Prefix a skill's `name` with the most specific subject it documents, not
mechanically with the owning plugin's name:

- Skills about the plugin's general domain use that domain as the prefix
  (e.g. `markdown-tables` in the `markdown` plugin).
- Skills about a specific tool within the plugin use that tool's name
  instead (e.g. `markdownlint-configuration`, `marksman-lsp-usage`) — the
  tool name disambiguates better than the plugin name when skills are
  matched from a flat, cross-plugin list.
- User-invocable skills (slash commands) get short verb names with no
  prefix (e.g. `lint`).

## Commits

Commit messages must follow [Conventional Commits][cc] — enforced via
commitlint and a husky `commit-msg` hook.

[cc]: https://www.conventionalcommits.org/
