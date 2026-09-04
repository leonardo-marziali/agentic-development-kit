---
name: conventional-commits
user-invocable: false
description: This skill should be used whenever the wording/formatting of a commit message itself is the task — writing one from a diff or description, formatting one as Conventional Commits, checking what type/scope/breaking-change marker to use, or another skill (such as the sibling `commit` skill in this plugin) needs message text to hand to `git commit`. Triggers on "write a commit message", "generate a conventional commit", "format this as a conventional commit", "what type should this be", "conventional commits", "commitlint", "semantic commit messages". Produces messages complying with the Conventional Commits v1.0.0 specification (type, optional scope, optional breaking-change marker, description, body, footers) and explains the reasoning behind each choice. This skill only produces message text — it never stages files or runs `git commit` itself; for "commit this" / "commit these changes" style requests where the user wants the commit actually created, that's the `commit` skill's job.
---

# Conventional Commits

Generate a single commit message that complies with the [Conventional
Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
specification. The full, verbatim rule text and spec examples live in
`references/specification.md` — consult it whenever a rule's exact wording
matters (e.g. footer syntax, breaking-change formatting) rather than relying
on the summary below.

This skill produces one message for one already-decided, cohesive set of
changes. It does not decide _how_ to split a larger changeset into multiple
commits, stage files, or run `git commit` — a calling workflow (or the user)
owns that decision and supplies the diff/description for one commit at a
time.

## Why the spec matters

Conventional Commits exists so tooling can read history mechanically:
changelog generators, semver bumpers, and CI all key off the `type` and the
breaking-change marker. A message that "reads fine" to a human but bends the
grammar (wrong separator, casing on the wrong token, a breaking change
buried in prose instead of the footer) silently breaks that tooling. Treat
the grammar as load-bearing, not stylistic.

## Workflow

### 1. Gather the actual change

Read the diff (or the description of the change provided) in enough detail
to state, in one sentence, what the change _does_ — not just which files it
touched. The type and description both flow from this sentence, so get it
right before writing anything.

### 2. Choose the type

- Use `feat` only if the change adds a new capability visible to the
  library/application's consumers.
- Use `fix` only if it corrects a bug in existing behavior.
- For anything else, only `feat` and `fix` are mandated by the spec itself
  (see `references/specification.md`) — every other type (`build`, `chore`,
  `ci`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`, ...) is a
  convention, not a spec rule. If the repo has a commitlint config or other
  documented type list, follow it exactly. Otherwise the Angular-derived
  list above is the de facto standard — pick the closest match rather than
  inventing a new type.
- If the change genuinely spans more than one type (e.g. a feature plus
  unrelated docs cleanup), say so and recommend splitting into separate
  commits instead of picking one type or stacking descriptions — this is
  the spec's own guidance (see the FAQ entry in the reference file), and a
  mixed-type commit produces a misleading changelog entry either way.

### 3. Decide the scope (optional)

Include a scope only when the change clearly concerns one identifiable
area — a package, module, or directory name a reader would recognize.
Lowercase, no spaces, e.g. `fix(parser):`. Omit it rather than forcing one
when the change is cross-cutting or the repo has no natural scope
boundaries.

### 4. Decide whether it's a breaking change

A breaking change is one that requires consumers to change their own code
or config to keep working. If so:

- Add `!` immediately before the colon in the prefix (`feat!:` or
  `feat(api)!:`), AND/OR
- Add a `BREAKING CHANGE: <description>` footer.

If `!` is used alone, the commit description itself must convey the
breaking change — don't use `!` as a silent flag with no explanation
anywhere in the message. When the breaking change needs more than one
sentence of explanation, use the footer (with or without `!`) rather than
cramming it into the description.

### 5. Write the description

One line, immediately after `type[(scope)][!]:`. Imperative mood ("add",
not "added"/"adds"), no trailing period, specific enough that someone
skimming `git log --oneline` knows what changed without opening the diff.

### 6. Add a body when it earns its place

Add a body (one blank line after the description) when the _why_ isn't
obvious from the description alone, or the change has enough moving parts
that a reader benefits from a walkthrough. Free-form prose or a bullet
list are both fine; multiple newline-separated paragraphs are allowed.
Skip the body entirely for small, self-explanatory changes — an empty body
is correct far more often than a padded one.

### 7. Add footers when there's metadata to attach

One blank line after the body (or after the description if there's no
body). Each footer is `Token: value` or `Token #value`, with the token
using `-` for spaces (`Reviewed-by:`, `Refs:`) — except `BREAKING CHANGE`,
which stays as two words in uppercase. Common footers: `BREAKING CHANGE:`,
issue references (`Refs: #123`, `Closes: #123`), `Reviewed-by:`,
`Co-authored-by:`. Only include footers that carry real information; don't
manufacture one for its own sake.

### 8. Assemble and self-check

Put the pieces together in order: prefix line, blank line, body, blank
line, footers. Before presenting the final message, re-check it against
`references/specification.md` rules 1, 4-5 (prefix/description grammar),
8-10 (footer grammar), and 11-13 (breaking-change placement) — these are
the rules most likely to be violated by a rushed draft (wrong separator,
scope without parens, `!` in the wrong position, breaking change mentioned
only in prose).

## Output

Present the finished message in a fenced code block so whitespace/line
breaks are unambiguous, e.g.:

```text
feat(auth): add refresh-token rotation

Rotate refresh tokens on every use instead of reusing them until
expiry, closing the replay window described in the security review.

Refs: #482
```

If the caller only needs the raw text (e.g. to pass to `git commit -m`),
state that explicitly rather than leaving it ambiguous whether the code
fence is illustrative or literal.
