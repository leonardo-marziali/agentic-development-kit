# Agent Instructions

Instructions for AI coding agents (Claude Code, etc.) working in this repository.

## Package manager

This repository uses **pnpm** exclusively. Do not use `npm` or `yarn`.

- Install dependencies: `pnpm install`
- Add a dependency: `pnpm add <package>`
- Add a dev dependency: `pnpm add -D <package>`
- Run a script: `pnpm run <script>` (or `pnpm <script>`)

Never run `npm install`, `npm add`, `yarn`, or commit a `package-lock.json` / `yarn.lock`. Only `pnpm-lock.yaml` should be committed as the lockfile.

## Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced via commitlint and a husky `commit-msg` hook.
