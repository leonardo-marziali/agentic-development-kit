# diagrams

A Claude Code plugin for diagram and charting work. More skills (other diagram
languages, chart generation) can be added alongside the first one.

## Skills

### `mermaid-export`

Renders Mermaid source to PNG or SVG with `scripts/export_mermaid.py`
(Python standard library only).

- Input is a `.mmd` file, stdin, or a Markdown file — every ` ```mermaid `
  fence in it is exported as `<stem>-1`, `<stem>-2`, …
- Exposes the Mermaid Live Editor's options: format, PNG size mode (`auto`,
  `width`, `height`) with a pixel value, extra scale, theme and background.
- Backends, tried in order: local `mmdc` (`@mermaid-js/mermaid-cli`, nothing
  leaves the machine), `mermaid.ink`, then `kroki.io`. The two remote
  services receive the diagram text, so prefer `mmdc` for confidential
  diagrams.
- `--url-only` prints shareable mermaid.ink, Kroki and `mermaid.live` links
  plus ready-to-paste Markdown when nothing can render locally.
- A Mermaid syntax error stops immediately with the parser message.

Remote URL formats and encoding details are in
`skills/mermaid-export/references/api.md`.
