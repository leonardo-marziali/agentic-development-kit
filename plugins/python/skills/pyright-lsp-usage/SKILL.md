---
name: pyright-lsp-usage
user-invocable: false
description: Use when navigating Python code — finding where a symbol is defined, every caller of a function before changing its signature, the inferred type of an expression, or an outline of a large module. Covers which LSP tool operations pyright actually supports.
---

# Pyright LSP Usage

This plugin depends on `pyright-lsp@claude-plugins-official`, which
registers `pyright-langserver` as the LSP server for `.py`/`.pyi` files.
That makes Claude Code's `LSP` tool usable on Python. This skill covers
which `LSP` operations actually work, and when to reach for them instead
of grepping.

## Prerequisite

`pyright-langserver` must be on `PATH` (`npm install -g pyright` or
`pipx install pyright` installs it along with the `pyright` CLI the Stop
hook uses). If the `LSP` tool errors because no server is available for
the file type, pyright isn't installed. In that case, fall back to
`Grep`/`Read` rather than retrying.

## Operations

All positions are 1-based (line and character as shown in an editor), and
should point **at the symbol's name**.

| Operation              | Use it when                                     |
| ---------------------- | ----------------------------------------------- |
| `hover`                | You need an inferred type or signature          |
| `goToDefinition`       | Jumping from a use to its definition, stubs too |
| `findReferences`       | Every use of a symbol before changing it        |
| `documentSymbol`       | Outlining a long module                         |
| `workspaceSymbol`      | Finding a class or function by name             |
| `prepareCallHierarchy` | Resolving the function at a position            |
| `incomingCalls`        | Who calls this function                         |
| `outgoingCalls`        | What this function calls                        |

`goToImplementation` is **not** supported: pyright rejects
`textDocument/implementation` as an unhandled method. See the caveats
below for how to find overrides instead.

### Prefer LSP over grep when

- **The name is common.** `findReferences` on `save` returns this
  `save`'s uses, not every `save` in the codebase.
- **You need a type.** `hover` reports what pyright infers, e.g.
  `(variable) items: list[Order]`, which is often not written anywhere in
  the source.
- **The definition is in a dependency.** `goToDefinition` follows imports
  into installed packages and typeshed stubs that grep won't search.

### Caveats

- **Overrides are separate symbols.** `findReferences` on an abstract
  method returns calls made through the base type, not the subclasses'
  overrides. To find implementations (since `goToImplementation` isn't
  supported), `workspaceSymbol` the method name, or grep for
  `def <name>` and check each class's bases.
- **`workspaceSymbol` only sees the workspace.** Files outside the
  project root (scratch dirs, `/tmp`) return nothing, and it needs a
  non-empty `query`.
- **Imports must resolve.** If pyright can't find the project's
  interpreter, definitions into third-party code fail and `hover` shows
  `Unknown`. See the `pyright-configuration` skill (`venvPath`/`venv`).

## Not available through this tool

- **Diagnostics.** The `LSP` tool has no diagnostics passthrough. Type
  errors come from the plugin's Stop hook, or from `/python:typecheck`
  on demand.
- **Rename, code actions, formatting.** These aren't exposed. Use `Edit`
  guided by `findReferences`, and ruff for formatting.
