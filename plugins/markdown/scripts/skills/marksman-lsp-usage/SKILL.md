---
name: marksman-lsp-usage
user-invocable: false
description: Use when navigating markdown link targets, finding what links to a heading or file before renaming/removing it, or getting a heading outline of a large markdown document. Covers which LSP tool operations marksman actually supports for markdown.
allowed-tools:
  - LSP
  - Read
  - Grep
  - Glob
---

# Marksman LSP Usage

This plugin registers [marksman](https://github.com/artempyanykh/marksman) as the LSP server for
`.md`/`.mdx` files (see `.lsp.json`), making Claude Code's `LSP` tool usable on markdown. This
skill covers which `LSP` operations actually work against markdown, and when to reach for them
instead of grepping or reading whole files by hand.

## Prerequisite

Marksman must be installed on the host (`brew install marksman`). If the `LSP` tool errors saying
no server is available for the file type, marksman isn't installed or isn't on `PATH` — fall back
to `Grep`/`Read` rather than retrying.

## Operations that work for markdown

The `LSP` tool exposes 9 operations. Marksman implements the first 5 meaningfully for markdown
documents; the other 4 are code-oriented LSP methods it does not implement for prose.

| Operation         | What it does for markdown                                                                                                      | Use it when                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `documentSymbol`  | Returns the heading outline of one file                                                                                        | You need a large doc's structure without reading the whole file                        |
| `workspaceSymbol` | Subsequence-matched search over headings across the whole workspace (`query: "lsp"` matches "LSP" or "Low Seismic Profile")    | You want to find a heading/doc by fuzzy name and don't know the file path              |
| `goToDefinition`  | Resolves a link (inline `[text](target)`, reference-style, or `[[wiki-link]]`) or heading anchor to the file/line it points to | You need to know exactly what a link target is before following or editing it          |
| `findReferences`  | Finds every link in the workspace that points to a given heading or file                                                       | Before renaming a heading or deleting/moving a file, so you don't leave dangling links |
| `hover`           | Returns a preview of a link's target content                                                                                   | You want a quick look at what a link resolves to without opening the file              |

### Examples

- **Outline a long doc**: `documentSymbol` on `plugins/markdown/README.md` returns its headings
  (`## What This Plugin Provides`, `### Commands`, etc.) — faster than reading the full file when
  you only need structure.
- **Find a heading by fuzzy name**: `workspaceSymbol` with `query: "install"` surfaces the
  `## Installation` heading and its file, even without knowing which `SKILL.md`/`README.md` it's in.
- **Resolve a link target**: `goToDefinition` on a `[[Some Heading]]` wiki-link or a reference-style
  `[text][ref]` jumps straight to the target heading/definition instead of grepping for it.
- **Check backlinks before a rename**: `findReferences` on a heading in `docs/setup.md` before
  renaming it shows every other doc that links there, so you can update them all.

## Not available through this tool

Marksman supports these as an LSP server, but the `LSP` tool doesn't expose the underlying
LSP methods/notifications for them — don't try to reach them through `LSP`, use the alternative:

- **Diagnostics** (broken wiki-link/reference detection) — no diagnostics passthrough exists;
  find broken links by reading/grepping, or rely on `markdownlint` (already wired via this
  plugin's hooks) for the overlap it covers.
- **Completion** — not applicable outside an interactive editor session.
- **Rename refactoring** — use `Edit`/`Grep` to rename a heading or file and update its
  references manually; `findReferences` (above) tells you what needs updating.
- **Code actions** (e.g. table-of-contents generation) — not reachable via `LSP`; write the TOC
  by hand if needed.

## Not applicable to markdown at all

`goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls` are code-oriented
LSP methods (interfaces, call graphs) that don't have a markdown analog. Marksman doesn't
implement them — calling these operations against a markdown file will error or return nothing.
Don't use them here.
