---
name: sonarqube-connected-mode
user-invocable: false
description: Use when you need a SonarQube projectKey, are setting up or debugging .sonarlint/connectedMode.json, are calling `sonar api` against a bound project, need the Cloud organization, or are working out which project a file in a monorepo belongs to.
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

## Local analysis and bindings

The plugin's local analysis (SonarQube for IDE's engine, run offline)
doesn't need a binding: it uses the analyzers' default rules for every
file. Its hooks still read the nearest binding for each touched file and
label findings with that project, so in a monorepo the report says which
SonarQube project a finding belongs to. That project key is what to use
for a follow-up `sonar api` call.

Server-side quality profiles are not applied locally yet, so a rule your
organization turned off can still be reported locally. See the README's
known limitations.

## Using it with `sonar api`

The Web API needs the project key on almost every call, and SonarQube
Cloud also needs the organization — the CLI does not add either for you
(see `sonarqube-web-api`). Read both from `connectedMode.json`
(`projectKey`, `sonarCloudOrganization`) rather than guessing or
searching: the committed binding is the authoritative answer for that
repository.

## When there is no binding

A missing binding is not an error, and not something to fix uninvited:

- **Local analysis still works.** It never needed a binding or a
  server.
- **`sonar api` needs a key.** If a project search doesn't give an
  unambiguous match, ask the user rather than picking one.
- **Don't create the file unprompted.** Writing a binding commits a
  guess about someone's SonarQube instance into their repository. Offer
  it, with the exact contents, and let them decide.

## Troubleshooting

| Symptom                    | Likely cause                            |
| -------------------------- | --------------------------------------- |
| Wrong project's issues     | A parent binding shadowed a nearer one  |
| Server rejects a valid key | Key belongs to a different instance/org |
| Nothing found walking up   | No binding committed; run without it    |

If `connectedMode.json` exists but is malformed, treat it as absent and
say so — analysing against a guessed key is worse than analysing without
one.
