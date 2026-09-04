---
name: marksman-lsp-usage
user-invocable: false
description: Use when navigating markdown link targets, finding what links to a heading or file before renaming/removing it, or getting a heading outline of a large markdown document. Covers which LSP tool operations marksman actually supports for markdown.
---

# Marksman LSP Usage

This plugin registers [marksman](https://github.com/artempyanykh/marksman)
as the LSP server for `.md`/`.mdx` files (see `.lsp.json`), making Claude
Code's `LSP` tool usable on markdown. This skill covers which `LSP`
operations actually work against markdown, and when to reach for them
instead of grepping or reading whole files by hand.

## Prerequisite

Marksman must be installed on the host (`brew install marksman`). If
the `LSP` tool errors saying no server is available for the file
type, marksman isn't installed or isn't on `PATH` — fall back
to `Grep`/`Read` rather than retrying.

## Operations that work for markdown

The `LSP` tool exposes 9 operations. Marksman implements the first 5
meaningfully for markdown documents; the other 4 are code-oriented
LSP methods it does not implement for prose.

| Operation         | What it does                       | Use it when                 |
| ----------------- | ---------------------------------- | --------------------------- |
| `documentSymbol`  | Heading outline of a file          | Get a doc's structure fast  |
| `workspaceSymbol` | Fuzzy-matched heading search       | Find a heading by name      |
| `goToDefinition`  | Resolves a link/anchor target      | Check a target before use   |
| `findReferences`  | Finds links to a heading/file      | Dead-link check on rename   |
| `hover`           | Preview of a link's target content | Quick look, skip opening it |

### Examples

- **Outline a long doc**: `documentSymbol` on `plugins/markdown/README.md`
  returns its headings (`## What This Plugin Provides`, `### Commands`,
  etc.) — faster than reading the full file when you only need
  structure.
- **Find a heading by fuzzy name**: `workspaceSymbol` with
  `query: "install"` surfaces the `## Installation` heading and its
  file, even without knowing which `SKILL.md`/`README.md` it's in.
- **Resolve a link target**: `goToDefinition` on a `[[Some Heading]]`
  wiki-link or a reference-style `[text][ref]` jumps straight to the
  target heading/definition instead of grepping for it.
- **Check backlinks before a rename**: `findReferences` on a heading
  in `docs/setup.md` before renaming it shows every other doc that
  links there, so you can update them all.

## Not available through this tool

Marksman supports these as an LSP server, but the `LSP` tool doesn't
expose the underlying LSP methods/notifications for them — don't try
to reach them through `LSP`, use the alternative:

- **Diagnostics** (broken wiki-link/reference detection) — no
  diagnostics passthrough exists; find broken links by
  reading/grepping, or rely on `markdownlint` (already wired via this
  plugin's hooks) for the overlap it covers.
- **Completion** — not applicable outside an interactive editor session.
- **Rename refactoring** — use `Edit`/`Grep` to rename a heading or
  file and update its references manually; `findReferences` (above)
  tells you what needs updating.
- **Code actions** (e.g. table-of-contents generation) — not
  reachable via `LSP`; write the TOC by hand if needed.

## Not applicable to markdown at all

`goToImplementation`, `prepareCallHierarchy`, `incomingCalls`,
`outgoingCalls` are code-oriented LSP methods (interfaces, call
graphs) that don't have a markdown analog. Marksman doesn't
implement them — calling these operations against a markdown file
will error or return nothing. Don't use them here.
