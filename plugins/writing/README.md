# writing

A Claude Code plugin for writing style. More skills (other languages, other
kinds of prose) can be added alongside the first one.

## Installation

```text
/plugin install writing --marketplace leonardo-marziali/agentic-development-kit
```

## Skills

### `italian-technical-writing`

Makes Claude write and revise Italian software-development text (READMEs,
wiki pages, design docs, ADRs, analyses, API reference, PR descriptions,
code comments, technical emails) so it doesn't read as English translated by
an AI ("traduttese").

- Rules are drawn from real corrections an Italian engineer made to
  Claude-written documents: keep the team's English jargon, no
  personification, no glosses of known terms, colons only for appositions and
  lists, prose instead of telegraphic bold fragments, enterprise IT register,
  no AI rhythm (punchy closers, dashes, adjective triplets, repeated openers).
- When revising, it changes form only: information, identifiers and markup
  (Markdown, HTML, wiki storage formats) are kept as they are.
- `scripts/check_italian.py` (Python standard library only) flags calques,
  over-Italianised jargon, colon hinges, bold lead-ins, dashes and similar
  tics as a hint list for the self-review pass. Code, URLs and markup are
  ignored.

References in `skills/italian-technical-writing/references/`: `calchi.md`
(calques and false friends), `sintassi-e-ritmo.md` (syntax and rhythm),
`esempi.md` (anonymised before/after documents).
