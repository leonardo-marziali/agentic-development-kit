---
name: sonarqube-issue-triage
user-invocable: false
description: Use when acting on SonarQube findings — deciding what to fix first, whether something is a real defect or a false positive, how to handle a detected secret, what a quality gate failure means, or whether a NOSONAR suppression is ever justified.
---

# SonarQube Issue Triage

How to act on what SonarQube reports. The analysis tells you what it
found; this is about deciding what it means and what to do.

## Order of work

1. **Secrets.** Always first, always non-negotiable — see below.
2. **Security hotspots.** Security-sensitive code needing a human
   decision. Read and explain; don't silently mark them safe.
3. **Bugs.** Code that is wrong: null dereferences, unreachable
   branches, resource leaks, broken comparisons.
4. **Vulnerabilities.** Injection, unsafe deserialization, weak crypto,
   path traversal.
5. **Code smells.** Maintainability. Real, but never a reason to hold up
   a security fix.

Within a tier, prefer findings in code this session touched: they are
freshest in context, and they are what a session-scoped hook is gating
on.

## Secrets

A detected secret is a different kind of finding from everything else,
because the damage is already done by the time you see it.

- **Remove it from the source.** Move it to an environment variable, a
  secret manager, or the platform's own secret store. Do not merely move
  it to another file in the repository.
- **Tell the user it must be rotated.** The value has been written to
  disk, is likely in git history, and may already be pushed. Deleting the
  line does not un-leak it. Say this explicitly, every time.
- **Never suppress it.** No `NOSONAR`, no exclusion, no "it's just a
  test value" unless the user says so themselves.
- **Don't paste it back.** When reporting, refer to the finding by file
  and line; don't reproduce the credential in your output.

The one legitimate false positive is a value that is genuinely a fixture
or a documented example (`AKIAIOSFODNN7EXAMPLE` and friends). Even then,
confirm with the user rather than deciding alone.

## Deciding whether a finding is real

Fetch the rule when the message isn't self-explanatory — the rationale
usually distinguishes a defect from a preference, and that decides
whether to change the code.

A finding is **real** when the rule's rationale describes something that
can actually happen in this code path. Fix it in the source.

A finding is a **false positive** when the analyzer lacks context you
have: a framework guarantee it doesn't model, a check performed in a
caller it can't see, a value constrained by something outside the file.
Then:

- Say which finding, and why it can't happen here. Be specific — "the
  caller validates this" with the caller named, not "this is fine".
- Let the user decide. Marking an issue won't-fix on the server changes
  shared state everyone sees (see `sonarqube-mcp-usage`).

**Never** rewrite working code purely to make a rule stop firing. A
contorted workaround is worse than the finding it silences, and it hides
the fact that a human ever disagreed with the analyzer.

## Suppressions

`NOSONAR` exists, and this plugin's hooks deliberately never write one.
The reason is simple: a hook that auto-suppresses turns a security
finding into silence, and nobody reviews silence.

If a suppression is genuinely warranted, it should be a human's explicit
decision, with a comment saying **why** — not a mechanical response to a
loop that got tired. Prefer, in order:

1. Fix the code.
2. Report it as a false positive and let the user resolve it on the
   server, where the decision is visible and reviewable.
3. Only then, an inline suppression the user has asked for, with a
   reason attached.

Never suppress a secret. Ever.

## Quality gates

A failing quality gate is a **project-level** verdict — coverage on new
code, duplication, a count of open issues — not a specific line of code.
Read which condition failed before acting: "fix the quality gate" usually
means "add tests for new code", not "fix an issue".

Never resolve or won't-fix issues in bulk to make a gate go green. That
changes the number without changing the code, and it is visible to
everyone on the project.

## Reporting back

Group findings by severity, name the file and line, and say what you did
about each. Be explicit about two things people otherwise assume:

- **What could not be checked.** An unauthenticated CLI or an unreachable
  server means a stage did not run. "Not checked" is not "clean", and
  saying so is the difference between a useful report and a misleading
  one.
- **What you left alone, and why.** A finding you judged a false positive
  is a claim the user may want to disagree with. Make it visible.

## Related skills

- `analyze` (`/sonarqube:analyze`) — run the CLI over chosen files.
- `sonarqube-mcp-usage` — server-side issues, rules, quality gates.
- `sonarqube-connected-mode` — where the project key comes from.
