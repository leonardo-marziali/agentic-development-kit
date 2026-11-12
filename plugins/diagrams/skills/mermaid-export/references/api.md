<!-- markdownlint-disable MD013 -->

# Remote rendering APIs

Both are free public GET endpoints; no key needed. Both receive the diagram text.

## mermaid.ink (used by mermaid.live)

```text
PNG: https://mermaid.ink/img/<token>?type=png[&width=N|&height=N][&scale=S][&theme=T][&bgColor=C]
SVG: https://mermaid.ink/svg/<token>[?theme=T&bgColor=C]
PDF: https://mermaid.ink/pdf/<token>   (not used by this skill)
```

- `/img/` defaults to **JPEG** – always send `type=png` (also accepts `jpeg`, `webp`).
- `width` / `height` resize proportionally; set one of them, like the Live Editor.
- `scale` (1–3) is only honoured when `width` or `height` is set; the image is then `width × scale`.
- `bgColor`: hex without `#` (`FF0000`) or a named colour with `!` prefix (`!white`).
- `<token>` is either:
  - plain: `base64url(source)`, or
  - `pako:` + `base64url(zlib.deflate(JSON))` where JSON is the Live Editor state
    `{"code": "<source>", "mermaid": "{\"theme\":\"default\"}"}`. Shorter for big diagrams, and the
    same token works after `https://mermaid.live/edit#`.
- Errors come back as HTTP 400 with a message body (usually a syntax error).

## Kroki

```text
GET  https://kroki.io/mermaid/{svg|png}/<base64url(zlib.deflate(source))>
POST https://kroki.io/mermaid/{svg|png}   body: raw source, Content-Type: text/plain
```

No width/height/scale control for Mermaid PNGs; resize afterwards if needed (e.g. render SVG and rasterise).

## Local: mermaid-cli (mmdc)

`mmdc -i in.mmd -o out.png -t theme -b bg -s scale`. Note `-w/-H` set the _browser page_ size, not the
output image size — that's why the script measures a scale-1 render and re-renders with
`-s target/natural` to hit an exact width or height.
