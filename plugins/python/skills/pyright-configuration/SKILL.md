---
name: pyright-configuration
user-invocable: false
description: Use when configuring pyright — writing pyrightconfig.json or [tool.pyright], choosing typeCheckingMode, pointing pyright at a virtualenv, overriding individual report* rules, or suppressing a type error inline.
---

# Pyright Configuration

Pyright is the type checker behind both halves of this plugin's type
checking. The `pyright-lsp` dependency runs `pyright-langserver` for the
`LSP` tool, and the Stop hook runs the `pyright` CLI on the files the
session touched, blocking on **errors** (not warnings). Both read the same
project config.

## Where config lives

- `pyrightconfig.json` in the project root, **or**
- a `[tool.pyright]` table in `pyproject.toml`.

If both exist, `pyrightconfig.json` wins. Unlike ruff, pyright uses
**one** config per run, found by walking up from the working directory or
given with `-p <dir|file>`. The plugin groups touched files by their
nearest `pyrightconfig.json` / `pyproject.toml` and runs pyright once per
group with `-p` pointed there, so per-package configs in a monorepo are
respected.

Keys are the same in both formats:

```toml
[tool.pyright]
include = ["src", "tests"]
exclude = ["**/generated"]
pythonVersion = "3.12"
typeCheckingMode = "standard"
strict = ["src/core"]             # strict mode for a subtree only
reportMissingTypeStubs = false
reportUnnecessaryTypeIgnoreComment = "warning"
```

```json
{
  "include": ["src", "tests"],
  "typeCheckingMode": "strict",
  "reportPrivateUsage": "warning"
}
```

## `typeCheckingMode`

| Mode       | What it means                                                 |
| ---------- | ------------------------------------------------------------- |
| `off`      | Only syntax and the most basic errors                         |
| `basic`    | Lenient; good for adopting pyright on an untyped codebase     |
| `standard` | The default: catches real bugs without demanding annotations  |
| `strict`   | Everything on, including "unknown type" reports; needs typing |

Individual `report*` rules override the mode. Each takes `"none"`,
`"information"`, `"warning"`, or `"error"` (or `true`/`false`). Only
`"error"` blocks the plugin's Stop hook, so demoting a rule to
`"warning"` is the project-level way to say "show it, but don't hold up
the session for it".

## Imports and virtualenvs

Most false "could not be resolved" errors (`reportMissingImports`) mean
pyright is looking at the wrong interpreter.

- `venvPath` + `venv`: `"venvPath": "."`, `"venv": ".venv"` picks a
  specific environment.
- `extraPaths`: additional import roots (e.g. `["src"]` for a src-layout
  project that isn't installed).
- `executionEnvironments`: per-subtree `root`, `pythonVersion`, and
  `extraPaths` for monorepos.

When the config names no venv and the project has a `.venv`, the plugin's
hook passes `--pythonpath <project>/.venv/bin/python`. When the config
does name one, the hook leaves the choice to the config.

`reportMissingModuleSource` (stubs found, package not installed) is a
warning by default, and it is usually the right severity.

## Inline control

Fix the code first. Suppress only when a correct fix is impossible (an
untyped third-party API, a deliberate dynamic pattern), and always scope
the suppression to the rule:

```python
value = legacy.load()  # pyright: ignore[reportUnknownVariableType]
```

- `# pyright: ignore[ruleA, ruleB]`: those rules on that line.
- `# pyright: ignore` with no rule list, or `# type: ignore`: everything
  on that line. Avoid both. `# type: ignore` is also honoured by mypy and
  hides more than you meant.
- `# pyright: basic` or `# pyright: strict` at the top of a file:
  per-file mode.
- `# pyright: reportPrivateUsage=false` at the top of a file: a per-file
  rule override.
- Turn on `reportUnnecessaryTypeIgnoreComment` to catch suppressions that
  no longer suppress anything.

The rule name for an error is printed in parentheses at the end of each
diagnostic, e.g. `(reportAssignmentType)`. The plugin's opt-in
`auto_suppress` writes exactly this form at the fix-loop cap.
