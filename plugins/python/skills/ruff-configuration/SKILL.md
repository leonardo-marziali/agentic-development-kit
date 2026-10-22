---
name: ruff-configuration
user-invocable: false
description: Use when configuring ruff — writing [tool.ruff] in pyproject.toml or a ruff.toml, selecting or ignoring rule codes, per-file-ignores, formatter options, suppressing a finding with noqa, or sharing config via extend.
---

# Ruff Configuration

Ruff is both a linter (`ruff check`) and a formatter (`ruff format`) for
Python. This plugin runs `ruff format` on every Python file Claude edits,
and runs `ruff check --fix` plus a final `ruff check` on the session's
files when it tries to stop. Both read the project's config, so changing
how the plugin behaves for a project means changing that config, not the
plugin.

## Where config lives

Ruff uses the **closest** config file to each file it checks, so a
monorepo can have one per package. These are the candidates, in priority
order within one directory:

1. `.ruff.toml`
2. `ruff.toml`
3. `pyproject.toml`, but only if it has a `[tool.ruff]` table

In `ruff.toml` / `.ruff.toml` the keys are top-level, so drop the
`tool.ruff` prefix.

Without any config, ruff uses a line length of 88 and its built-in default
rule set. That set is version-dependent. Ruff 0.16 grew it from 59 rules
(`E4`, `E7`, `E9`, `F`) to several hundred across `F`, `B`, `UP`, `RUF`,
`SIM`, `PL*`, and more. It also dropped some opinionated `E`/`F` rules,
such as `E402`, `E731`, and `E741`. Don't assume a rule is on by
default. Check what the installed ruff actually enables instead:

```bash
ruff check --show-settings <file>   # see linter.rules.enabled
```

The same command shows which config file applies to a file
(`Settings path`) and every resolved option.

## The three tables

```toml
[tool.ruff]                      # shared by linter and formatter
line-length = 100
target-version = "py312"         # otherwise inferred from requires-python
extend-exclude = ["migrations", "generated"]

[tool.ruff.lint]
extend-select = ["E501", "N"]    # defaults + line length + pep8-naming
ignore = ["SIM102"]              # drop one default rule (collapsible-if)
fixable = ["ALL"]
unfixable = ["F401"]             # report unused imports, never delete them

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = ["S101"]       # assert is fine in tests
"__init__.py" = ["F401"]         # re-exports

[tool.ruff.format]
quote-style = "double"
docstring-code-format = true
```

### `select` vs `extend-select`

- `select` **replaces** the default rule set. Write `select = ["I"]` and
  you get import sorting only, without pyflakes or anything else.
- `extend-select` **adds** to whatever is already selected. It is usually
  the right choice, because it keeps the default set as ruff upgrades
  evolve it and adds only what you name.
- `ignore` always wins over `select`. A more specific code beats a
  prefix, so `select = ["E"]` with `ignore = ["E501"]` disables only
  E501.
- Rules also belong to categories (`correctness`, `suspicious`,
  `complexity`, `performance`, `style`, `security`, `formatting`,
  `pedantic`, and `restriction`). Selecting by category name requires
  `preview = true`. `ruff rule <CODE> --output-format json` shows a rule's
  category and whether it is stable or preview.

To look up what a code means, run `ruff rule <CODE>`. To list every
rule, run `ruff rule --all`.

### `exclude` vs `extend-exclude`

`exclude` replaces ruff's built-in list (`.git`, `.venv`, `venv`,
`node_modules`, `site-packages`, `dist`, `_build`, and others; note that
`build` is not on it). You almost always want `extend-exclude` instead.
Ruff also respects `.gitignore` by default.

Explicitly passed paths bypass `exclude` unless you pass
`--force-exclude`. The plugin's hooks always pass it, so an excluded
file is never formatted or linted just because Claude edited it.

## Sharing config: `extend`

```toml
# packages/api/pyproject.toml
[tool.ruff]
extend = "../../pyproject.toml"   # inherit the root config, then override
line-length = 120
```

A nested config does **not** inherit from a parent automatically. Without
`extend`, the closest config is the _only_ config.

## Formatter compatibility

Some lint rules fight the formatter, and ruff's
[formatter docs](https://docs.astral.sh/ruff/formatter/#conflicting-lint-rules)
recommend leaving them off whenever `ruff format` is in use:

- `W191`, `E111`, `E114`, `E117` (indentation)
- `D203`, `D206`, `D300` (docstrings)
- `Q000` through `Q004` (quotes)
- `COM812`, `COM819` (trailing commas)
- `ISC002`, but only when used without `ISC001` and with
  `flake8-implicit-str-concat.allow-multiline = false`

`ruff format` itself only warns about the combinations that actually
conflict with your settings. For example, it always warns about `COM812`,
but warns about `Q000`/`Q003` only when the quote settings disagree with
`format.quote-style`, and about `W191`/`D206` only with
`format.indent-style = "tab"`.

`E501` is compatible but noisy. The formatter wraps at `line-length` on a
best-effort basis, so `E501` can still fire on formatted code (long
strings, comments, URLs). It isn't in the default set, so enable it
deliberately with `extend-select` if you want it.

## Suppressing findings

Fix the code first. Suppress only when the "fix" would make the code
wrong, and always name the code:

```python
import sideeffect_module  # noqa: F401  (imported for its registration side effect)
```

- `# noqa: F401,E501`: several codes on one line.
- `# ruff: noqa: F401` at the top of a file: that code for the whole file.
- A bare `# noqa` or `# ruff: noqa` silences everything. Avoid both.
- `RUF100` flags `noqa` comments that no longer suppress anything. Enable
  it to keep suppressions honest.
- `ruff check --add-noqa <paths>` writes a `noqa` for every current
  finding. It is the mechanical "baseline" escape hatch, and the plugin's
  opt-in `auto_suppress` uses it at the fix-loop cap.

## Fix safety

`ruff check --fix` applies only **safe** fixes. Unsafe ones, which may
change behaviour (e.g. removing an unused variable with a side-effecting
right-hand side), need `--unsafe-fixes` or an `extend-safe-fixes` /
`extend-unsafe-fixes` entry in `[tool.ruff.lint]`. The plugin never
applies unsafe fixes on its own, so those findings come back to Claude to
fix by hand.
