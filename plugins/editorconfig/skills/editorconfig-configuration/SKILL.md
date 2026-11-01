---
name: editorconfig-configuration
description: Use when writing or debugging a .editorconfig file — choosing properties, section globs, root = true, per-language overrides, or working out why a rule does or doesn't apply to a file. Also covers editorconfig-checker's excludes and inline disable comments.
---

# EditorConfig Configuration

## How a file gets its settings

For each file, tools read every `.editorconfig` from the file's directory
upward, stopping at one with `root = true` or at the filesystem root. Closer
files win, and within a file later matching sections win. Put `root = true` at
the top of the project's root config, outside any section.

## Properties

- `indent_style`: `tab` or `space`
- `indent_size`: a whole number
- `tab_width`: a whole number; defaults to `indent_size`
- `end_of_line`: `lf`, `cr` or `crlf`
- `charset`: `latin1`, `utf-8`, `utf-8-bom`, `utf-16be` or `utf-16le`
- `trim_trailing_whitespace`: `true` or `false`
- `insert_final_newline`: `true` or `false`

Values are case-insensitive, and `unset` removes a property's effect.
`max_line_length` isn't in the core list, but `editorconfig-checker` enforces
it and Prettier reads it.

## Section globs

| Glob     | Matches                            |
| -------- | ---------------------------------- |
| `*`      | any characters except `/`          |
| `**`     | any characters, including `/`      |
| `?`      | one character except `/`           |
| `[abc]`  | one of the listed characters       |
| `{a,b}`  | any of the comma-separated strings |
| `{1..3}` | any whole number in the range      |

A glob without `/` matches at any depth. One with `/` is relative to the
directory holding the config.

## A typical root config

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

`trim_trailing_whitespace = false` for Markdown keeps two-space hard line
breaks, which the rule would otherwise delete.

## Exempting code from editorconfig-checker

Prefer a narrower `.editorconfig` section, since editors and every other tool
respect it. For checker-only exceptions:

- `editorconfig-checker-disable-line` in a comment skips that line.
- `editorconfig-checker-disable-file` in a comment skips the file.
- `.editorconfig-checker.json` in the project root holds `Exclude` patterns and
  per-check `Disable` settings.

The checker also skips default excludes, such as lockfiles and `*.min.js`,
without saying so. A file that never gets reported may be one of those: run it
with `-dry-run` to see what would be checked.
