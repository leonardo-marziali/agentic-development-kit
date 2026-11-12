---
name: mermaid-export
description: Export Mermaid diagram source to PNG or SVG image files, with Mermaid Live Editor–style PNG sizing (auto, fixed width, or fixed height in pixels). Use this skill whenever the user wants to render, export, convert, or save a Mermaid diagram (flowchart, sequence, class, ER, gantt, pie, state, mindmap, etc.) as an image, wants a PNG/SVG from a .mmd file or from ```mermaid blocks inside a Markdown file, asks for a mermaid.ink or Kroki image link, or wants an embeddable Markdown image for a diagram — even if they just say "make this diagram a picture" or paste Mermaid code and ask for "an image".
---

<!-- markdownlint-disable MD013 -->

# Mermaid export

Render Mermaid source to PNG or SVG using `scripts/export_mermaid.py` (Python stdlib only). It exposes the same knobs as the Live Editor's _Actions_ panel:

| Parameter      | Flag          | Values                                 | Default          |
| -------------- | ------------- | -------------------------------------- | ---------------- |
| Format         | `-f/--format` | `png`, `svg`                           | `png`            |
| PNG size mode  | `--size`      | `auto`, `width`, `height`              | `auto`           |
| PNG size value | `--px`        | integer pixels                         | `1080`           |
| Extra scale    | `--scale`     | 1–3 (PNG only, multiplies the result)  | none             |
| Theme          | `-t`          | `default`, `neutral`, `dark`, `forest` | `default`        |
| Background     | `-b`          | `white`, `transparent`, `#F0F0F0`…     | renderer default |

Size semantics, matching the Live Editor:

- **auto** – the diagram's natural rendered size.
- **width N** – output is exactly N px wide; height follows the aspect ratio.
- **height N** – output is exactly N px tall; width follows the aspect ratio.
- SVG is vector, so size modes are ignored for it (the script says so).

## Workflow

1. **Get the source into a file.** If the user pasted Mermaid code, write it to `<name>.mmd` next to where the image should go (or in a scratch directory if the user didn't say). Markdown files work directly: every ```mermaid fence is exported, numbered `<stem>-1`, `<stem>-2`, …
2. **Map the request to flags.** "1920 wide" → `--size width --px 1920`; "500px tall" → `--size height --px 500`; "high-res" with no number → `--size width --px 2160` is a sensible choice; nothing said → `auto`. If the user asks for both formats, run the script twice.
3. **Run it:**

   ```bash
   python3 scripts/export_mermaid.py diagram.mmd -f png --size width --px 1080 -o out/diagram.png
   python3 scripts/export_mermaid.py notes.md -f svg -o out/      # all blocks
   cat src.mmd | python3 scripts/export_mermaid.py - -o out.png                     # stdin
   ```

   Each success prints one JSON line: `{"output": ..., "backend": ..., "size": "1080x436"}`. Check `size` against what the user asked for and report it.

4. **Tell the user where the files are** and mention the final pixel size for PNGs.

## Backends

`--backend auto` (default) tries, in order:

1. **mmdc** – local `@mermaid-js/mermaid-cli`. No network, diagram never leaves the machine, exact width/height (it renders once to measure, then re-renders at the right scale). The script retries with `--no-sandbox` automatically if Chromium refuses to start as root.
2. **mermaid-ink** – the public API behind the Live Editor's PNG/SVG buttons (`https://mermaid.ink/img/…?type=png&width=…` and `/svg/…`). Needs outbound network.
3. **kroki** – `https://kroki.io/mermaid/{png|svg}/…`. Cannot size PNGs; a warning is printed.

Force one with `--backend mmdc|mermaid-ink|kroki`. The two remote services receive the diagram text, so prefer `mmdc` (or ask first) when the diagram looks confidential. URL formats and encoding details are in `references/api.md` — read it only if you need to hand-build URLs or debug a remote backend.

A Mermaid **syntax error** stops immediately with the parser message (other backends would fail the same way). Fix the source — or show the user the error line — rather than retrying.

## When nothing can render

If mmdc is missing and the sandbox has no network, don't give up — run with `--url-only`. It prints, per diagram, a mermaid.ink URL (with the chosen size/format), a Kroki URL, a `mermaid.live/edit#pako:…` link that opens the diagram in the Live Editor, and ready-to-paste Markdown `![](…)` — the same thing the Live Editor's _Copy Markdown_ button gives. Share those so the user can download the image in their browser. Installing mmdc (`npm i -g @mermaid-js/mermaid-cli`) is the other option when npm has network access.
