---
name: sonarqube-connected-mode
user-invocable: false
description: Use when you need a SonarQube projectKey, are setting up or debugging .sonarlint/connectedMode.json, are running the sonar CLI or MCP tools against a bound project, or are working out which project a file in a monorepo belongs to.
---

# SonarQube Connected Mode

Connected mode binds a local repository to a project on a SonarQube
Server or SonarQube Cloud instance. The binding lives in a committed file,
which means the project key is usually already on disk — you rarely need
to ask for it.

## The file

`.sonarlint/connectedMode.json`, relative to the repository (or
sub-project) root:

```json
{
  "sonarQubeUri": "https://sonarqube.example.com",
  "projectKey": "my-org_my-project"
}
```

For SonarQube Cloud, the organization replaces the server URI:

```json
{
  "sonarCloudOrganization": "my-org",
  "projectKey": "my-org_my-project"
}
```

| Field                    | Meaning                                 |
| ------------------------ | --------------------------------------- |
| `projectKey`             | The project's key on the instance       |
| `sonarQubeUri`           | Server flavour: the instance's base URL |
| `sonarCloudOrganization` | Cloud flavour: the organization key     |

It is meant to be committed. A repository that has it gives every
contributor — and every tool — the same binding for free.

## Finding the binding for a file

Walk **up** from the file's directory to the filesystem root and take the
**first** `.sonarlint/connectedMode.json` you find. The nearest one wins.

This matters in a monorepo, where several sub-projects each have their
own binding:

```text
repo/
  .sonarlint/connectedMode.json        -> projectKey: monorepo-root
  packages/api/
    .sonarlint/connectedMode.json      -> projectKey: monorepo-api
    src/handler.ts                     -> belongs to monorepo-api
  packages/web/
    src/page.tsx                       -> belongs to monorepo-root
```

`packages/api/src/handler.ts` binds to `monorepo-api`, not to the root.

## Using it with the CLI

`sonar analyze` resolves project context from its **own working
directory**, so a binding is only honoured if the CLI runs from the
directory containing `.sonarlint/`. Two sub-projects therefore need two
runs, not one:

```bash
cd packages/api && sonar analyze --file src/handler.ts --project monorepo-api
cd packages/web && sonar analyze --file src/page.tsx   --project monorepo-root
```

This plugin's Stop hook does exactly that: it groups the session's
touched files by their nearest binding directory and runs the CLI once
per group, from that directory, with that group's `--project`. Files with
no binding anywhere above them form a single group that is analysed
without `--project`.

## Using it with the MCP server

The MCP server has no default project key configured (see
`sonarqube-mcp-usage`), so tools that need one need it supplied. Read it
from `connectedMode.json` rather than guessing or searching — the
committed binding is the authoritative answer for that repository.

## When there is no binding

A missing binding is not an error, and not something to fix uninvited:

- **The CLI still works.** Local analysis runs without `--project`;
  secrets detection never needed a server at all.
- **The MCP server needs a key.** If project-search doesn't give an
  unambiguous match, ask the user rather than picking one.
- **Don't create the file unprompted.** Writing a binding commits a
  guess about someone's SonarQube instance into their repository. Offer
  it, with the exact contents, and let them decide.

## Troubleshooting

| Symptom                     | Likely cause                            |
| --------------------------- | --------------------------------------- |
| Runs but reports no project | CLI not run from the binding directory  |
| Wrong project's issues      | A parent binding shadowed a nearer one  |
| Server rejects a valid key  | Key belongs to a different instance/org |
| Nothing found walking up    | No binding committed; run without it    |

If `connectedMode.json` exists but is malformed, treat it as absent and
say so — analysing against a guessed key is worse than analysing without
one.
