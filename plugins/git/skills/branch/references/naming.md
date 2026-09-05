# Branch naming

Reference for the `branch` skill: how to find the convention a project
actually uses, what to fall back to when there isn't one, and what makes a
name valid, short, and meaningful.

## 1. Detecting the project's convention

Check in this order and stop at the first real answer. A convention declared
in a file always beats one inferred from history, and both beat the default.

### Declared conventions

Grep these for branch-naming rules:

- `CLAUDE.md`, `AGENT.md`, `AGENTS.md` — agent instructions; a branch rule
  here is authoritative and usually written as an explicit pattern.
- `CONTRIBUTING.md` — the human-facing equivalent.
- `.github/` — `PULL_REQUEST_TEMPLATE.md`, workflow files with `branches:`
  filters (a workflow keyed on `release/**` tells you `release/` is real).
- `README.md` — occasionally carries a "Branching" section.

Useful search:

```bash
grep -rniE 'branch (naming|name|convention|prefix)|feature/|hotfix/|release/' \
  CLAUDE.md AGENT.md AGENTS.md CONTRIBUTING.md README.md .github/ 2>/dev/null
```

### Inferred conventions

With nothing declared, read the existing branches:

```bash
git branch -a --format='%(refname:short)' | head -50
```

Look for three things:

- **Prefix vocabulary** — is it `feature/` or `feat/`? `fix/` or `bugfix/`?
- **Separator** — `-` between words, or `_`?
- **Ticket placement** — `feat/PROJ-123-thing`, `PROJ-123/thing`, or absent?

Inference needs a real signal. Three branches sharing a prefix is a
convention; two branches, one of which is `main`, is not. When the signal is
weak, use the default and say which was used rather than half-copying a
pattern from a single old branch.

### Type vocabulary from commitlint

When the repo has a commitlint config (`commitlint.config.js`,
`.commitlintrc*`, or a `commitlint` key in `package.json`), that config's type
list is the better source for branch type prefixes than any generic list —
it's the vocabulary the team already uses in commit messages. A repo on
`@commitlint/config-conventional` gets: `build`, `chore`, `ci`, `docs`,
`feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

## 2. The default pattern (GitHub flow)

With no convention declared and none inferable:

```text
<type>/<short-description>
```

or, with an issue/ticket reference:

```text
<type>/<ticket-id>-<short-description>
```

Types mirror Conventional Commits:

| Type                  | Use for                                        |
| --------------------- | ---------------------------------------------- |
| `feature/` or `feat/` | A new capability                               |
| `fix/` or `bugfix/`   | A bug fix in existing behavior                 |
| `hotfix/`             | An urgent production fix, often cut from a tag |
| `chore/`              | Maintenance with no user-visible behavior      |
| `docs/`               | Documentation only                             |
| `refactor/`           | Restructuring without behavior change          |
| `test/`               | Tests only                                     |
| `release/`            | Release preparation                            |

Pick the prefix the repo already uses when both spellings are plausible
(`feature/` vs `feat/`): consistency across the branch list matters more than
which one is "right". Absent any signal, prefer the spelling that matches the
commit types in use — a repo committing `feat:` should branch `feat/`.

## 3. Format rules

Enforce these before proposing a name. `git check-ref-format --branch <name>`
is the authoritative check — run it, don't eyeball it.

- **Lowercase kebab-case** in the description slug: `add-oauth-login`, not
  `Add_OAuth_Login`. Case-insensitive filesystems (macOS, Windows) make
  `Feature/X` and `feature/x` collide unpredictably.
- **No spaces.**
- **None of** `~` `^` `:` `?` `*` `[` `\` — git rejects these outright, and
  shells and CI mangle several of them.
- **No `..`** anywhere, and no `@{` sequence.
- **No leading `-`** (it parses as a flag), and no leading or trailing `/`.
- **No trailing `.lock`**, and no path component starting with `.`.
- **No consecutive slashes**; at most one `/` for the type prefix keeps
  tooling and terminal prompts readable.
- **ASCII only.** Non-ASCII names technically work but break URLs, CI
  matchers, and shell completion in practice.

## 4. Length

Aim for **under ~40 characters total**, with a **2–5 word** description slug.
Longer names get truncated in PR lists, branch pickers, and terminal prompts —
precisely where the name has to do its job.

Trim by dropping filler, not meaning:

- Drop articles and verbs of doing: `add-`, `implement-`, `update-`,
  `the-`, `-changes`, `-stuff`.
- Keep the noun that identifies the concern and the qualifier that
  distinguishes it.

| Too long                                    | Better                     |
| ------------------------------------------- | -------------------------- |
| `feat/implement-the-new-oauth-login-flow`   | `feat/oauth-login`         |
| `fix/fix-the-bug-where-cache-never-expires` | `fix/cache-expiry`         |
| `refactor/refactoring-of-payment-service`   | `refactor/payment-service` |

## 5. Ambiguous and generic names

Apply the six-week test: **would this name still identify the work six weeks
from now, to someone who wasn't there?** If not, it needs more specificity.

Reject outright:

`wip` · `test` · `temp` · `tmp` · `dev` · `updates` · `changes` · `patch-1` ·
`fix/bug` · `feat/feature` · `my-branch` · a bare date · a bare username

These name the _state_ of the branch, not its subject. Replace them by asking
what the change is _for_:

| Rejected     | Ask                  | Result                       |
| ------------ | -------------------- | ---------------------------- |
| `wip`        | What is being built? | `feat/csv-export`            |
| `fix/bug`    | Which bug?           | `fix/null-session-on-logout` |
| `test`       | Testing what?        | `test/retry-backoff`         |
| `chore/misc` | Which maintenance?   | `chore/bump-node-24`         |

A name that can't be made specific usually signals a branch covering more than
one concern — split it.

## 6. Worked examples

### From a diff ("move this work to a new branch")

Read what the diff _does_, not which files it touches. Files named in the
diff are a poor source: `src/auth/session.ts` could be a feature, a fix, or a
refactor.

| Diff                                      | Name                        |
| ----------------------------------------- | --------------------------- |
| Adds a `retry` wrapper to the HTTP client | `feat/http-retry`           |
| Corrects an off-by-one in pagination      | `fix/pagination-offset`     |
| Renames a module, no behavior change      | `refactor/rename-scheduler` |
| Adds a `PostToolUse` hook to a plugin     | `feat/format-on-edit-hook`  |
| Bumps dev dependencies and the lockfile   | `chore/bump-dev-deps`       |

### From a described task ("start new development")

| Request                              | Name                              |
| ------------------------------------ | --------------------------------- |
| "Add dark mode to the settings page" | `feat/dark-mode`                  |
| "Password reset fails on mobile"     | `fix/mobile-password-reset`       |
| "Document the plugin export script"  | `docs/export-plugins`             |
| "Prep the 2.0 release"               | `release/2.0.0`                   |
| "ABC-412: rate-limit webhooks"       | `feat/ABC-412-webhook-rate-limit` |

Ticket IDs keep their upstream casing (`ABC-412`, not `abc-412`) — trackers
and CI matchers are usually case-sensitive on the key.

## 7. Linking the branch to its work item

The branch name is the cheapest place to carry the link: Jira, Linear, and
GitHub all auto-transition tickets from a branch name containing the ID, and
most hosts turn `#123` in a PR body into a live reference.

- **Convention has an ID slot** → put the ID there:
  `<type>/<ticket-id>-<short-description>`.
- **No slot, or no ID at branch time** → leave the name clean and put the
  reference in the PR description instead (`Closes #123`, `Fixes ABC-412`).
  Do not bolt an ID onto a name whose convention has no place for it.
- **No ID exists** → never invent one. Ask, or use the ID-less form and say
  so.
