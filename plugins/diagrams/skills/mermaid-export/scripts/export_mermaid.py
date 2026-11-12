#!/usr/bin/env python3
"""Export Mermaid diagrams to PNG or SVG.

Mirrors the "Actions" panel of the Mermaid Live Editor:
  PNG size: auto | width | height (+ a pixel value, default 1080)
  Formats:  png | svg

Backends (tried in this order with --backend auto):
  mmdc        local @mermaid-js/mermaid-cli (no network, diagram stays local)
  mermaid-ink https://mermaid.ink public API (same service the Live Editor uses)
  kroki       https://kroki.io public API (no size control for PNG)

Stdlib only. Run with -h for usage.
"""

import argparse
import base64
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zlib

DEFAULT_SIZE = 1080


class SyntaxErr(RuntimeError):
    """Diagram source is invalid; other backends would fail too."""


UA = "mermaid-export-skill/1.0"


# ---------------------------------------------------------------- input ----
FENCE_RE = re.compile(
    r"^(```|~~~)\s*mermaid[^\n]*\n(.*?)^\1\s*$", re.DOTALL | re.MULTILINE
)


def confine(path):
    """Resolve *path* and require it to sit under the working directory.

    The arguments of this script are usually supplied by an agent, so a
    crafted path must not be able to read or write outside the project
    (e.g. exfiltrate ~/.ssh/id_rsa to a remote renderer). Symlinks are
    resolved before the check. A trailing slash (directory intent) is kept.
    """
    root = os.path.realpath(os.getcwd())
    real = os.path.realpath(path)
    if os.path.commonpath([root, real]) != root:
        sys.exit(
            f"error: {path!r} is outside the working directory ({root}); "
            "run from the target project and use a path inside it"
        )
    if path.endswith(("/", os.sep)) and not real.endswith(os.sep):
        real += os.sep
    return real


def read_diagrams(path):
    """Return a list of Mermaid sources. Markdown files yield every ```mermaid block."""
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(confine(path), encoding="utf-8") as f:
            text = f.read()
    blocks = [m.group(2).strip() for m in FENCE_RE.finditer(text)]
    if blocks:
        return blocks
    if path.lower().endswith((".md", ".markdown")):
        sys.exit(f"error: no ```mermaid blocks found in {path}")
    return [text.strip()]


# ------------------------------------------------------------- encoding ----
def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def pako_encode(code: str, theme: str) -> str:
    """Live-Editor-compatible 'pako:' token (zlib-deflated JSON state)."""
    state = {
        "code": code,
        "mermaid": json.dumps({"theme": theme}),
        "autoSync": True,
        "updateDiagram": True,
    }
    return "pako:" + b64url(zlib.compress(json.dumps(state).encode(), 9))


def pako_decode(token: str) -> dict:
    raw = token.removeprefix("pako:")
    raw += "=" * (-len(raw) % 4)
    return json.loads(zlib.decompress(base64.urlsafe_b64decode(raw)))


def kroki_encode(code: str) -> str:
    return b64url(zlib.compress(code.encode(), 9))


# ------------------------------------------------------------ url build ----
def _ink_png_params(size_mode, size, scale):
    """Query params that only apply to mermaid.ink PNG output."""
    params = {"type": "png"}  # default would be jpeg
    if size_mode in ("width", "height"):
        params[size_mode] = size
    if scale and scale != 1:
        if size_mode == "auto":
            print(
                "warning: mermaid.ink ignores scale unless width/height is set; "
                "dropping scale",
                file=sys.stderr,
            )
        else:
            params["scale"] = scale
    return params


def _ink_bg_color(bg):
    # mermaid.ink: hex without '#', or '!name' for named colours
    if re.fullmatch(r"#?[0-9a-fA-F]{3,8}", bg):
        return bg.lstrip("#")
    return "!" + bg.lstrip("!")


def mermaid_ink_url(code, fmt, size_mode, size, scale, theme, bg):
    token = pako_encode(code, theme)
    if fmt == "svg":
        base = f"https://mermaid.ink/svg/{token}"
        params = {}
    else:
        base = f"https://mermaid.ink/img/{token}"
        params = _ink_png_params(size_mode, size, scale)
    if theme and theme != "default":
        params["theme"] = theme
    if bg:
        params["bgColor"] = _ink_bg_color(bg)
    return base + ("?" + urllib.parse.urlencode(params) if params else "")


def kroki_url(code, fmt):
    return f"https://kroki.io/mermaid/{fmt}/{kroki_encode(code)}"


def live_editor_url(code, theme):
    return f"https://mermaid.live/edit#{pako_encode(code, theme)}"


# -------------------------------------------------------------- helpers ----
def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def fetch(url, out):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        raise RuntimeError(
            f"HTTP {e.code} from {urllib.parse.urlsplit(url).netloc}: {body}"
        )
    except OSError as e:  # also covers URLError and TimeoutError
        raise RuntimeError(f"network error: {e}")
    with open(out, "wb") as f:
        f.write(data)


def validate(out, fmt):
    with open(out, "rb") as f:
        head = f.read(512)
    if fmt == "png" and not head.startswith(b"\x89PNG"):
        raise RuntimeError("response is not a PNG (syntax error in diagram?)")
    if fmt == "svg" and b"<svg" not in head and b"<?xml" not in head:
        raise RuntimeError("response is not an SVG (syntax error in diagram?)")


# ------------------------------------------------------------- backends ----
def _mmdc_run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def _mmdc_failed(r, dst):
    return r.returncode != 0 or not os.path.exists(dst)


def _mmdc_raise(log):
    lines = [
        ln
        for ln in log.splitlines()
        if ln.strip() and not ln.lstrip().startswith("at ")
    ]
    i = next((k for k, ln in enumerate(lines) if "Error" in ln), 0)
    err = SyntaxErr if "Parse error" in log else RuntimeError
    raise err("mmdc failed: " + "\n    ".join(lines[i : i + 4]))


def _mmdc_render(exe, src, pcfg, dst, scale, theme, bg):
    cmd = [exe, "-q", "-i", src, "-o", dst, "-t", theme, "-s", str(scale)]
    if bg:
        cmd += ["-b", bg]
    r = _mmdc_run(cmd)
    log = r.stderr + r.stdout
    if _mmdc_failed(r, dst) and "Parse error" not in log:
        # Common in containers running as root: Chromium needs --no-sandbox.
        r = _mmdc_run([*cmd, "-p", pcfg])
        if not _mmdc_failed(r, dst):
            return
        log = r.stderr + r.stdout
    if _mmdc_failed(r, dst):
        _mmdc_raise(log)


def run_mmdc(code, fmt, size_mode, size, scale, theme, bg, out):
    exe = shutil.which("mmdc")
    if not exe:
        raise RuntimeError("mmdc not installed (npm i -g @mermaid-js/mermaid-cli)")
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "d.mmd")
        with open(src, "w", encoding="utf-8") as f:
            f.write(code)
        pcfg = os.path.join(tmp, "p.json")
        with open(pcfg, "w", encoding="utf-8") as f:
            json.dump({"args": ["--no-sandbox"]}, f)

        def render(dst, s):
            _mmdc_render(exe, src, pcfg, dst, s, theme, bg)

        if fmt == "svg" or size_mode == "auto":
            render(out, scale or 1)
            return
        # Width/height mode: render at scale 1, measure, then re-render with the
        # scale factor that hits the requested dimension (aspect ratio preserved).
        probe = os.path.join(tmp, "probe.png")
        render(probe, 1)
        dims = png_size(probe)
        if dims is None:
            raise RuntimeError("mmdc did not produce a PNG to measure")
        natural = dims[0] if size_mode == "width" else dims[1]
        render(out, round(size / natural * (scale or 1), 4))


def run_mermaid_ink(code, fmt, size_mode, size, scale, theme, bg, out):
    fetch(mermaid_ink_url(code, fmt, size_mode, size, scale, theme, bg), out)


def run_kroki(code, fmt, size_mode, size, scale, theme, bg, out):
    if fmt == "png" and size_mode != "auto":
        print(
            "warning: kroki cannot size PNGs; output will be natural size",
            file=sys.stderr,
        )
    fetch(kroki_url(code, fmt), out)


BACKENDS = {"mmdc": run_mmdc, "mermaid-ink": run_mermaid_ink, "kroki": run_kroki}
AUTO_ORDER = ["mmdc", "mermaid-ink", "kroki"]


# ----------------------------------------------------------------- main ----
def build_parser():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("input", help=".mmd / .md file, or '-' for stdin")
    ap.add_argument("-f", "--format", choices=["png", "svg"], default="png")
    ap.add_argument(
        "--size",
        choices=["auto", "width", "height"],
        default="auto",
        help="PNG size mode (ignored for SVG). Default: auto",
    )
    ap.add_argument(
        "--px",
        type=int,
        default=DEFAULT_SIZE,
        help=f"pixel value for --size width/height (default {DEFAULT_SIZE})",
    )
    ap.add_argument(
        "--scale", type=float, default=None, help="extra scale 1-3 (PNG only)"
    )
    ap.add_argument(
        "-t",
        "--theme",
        default="default",
        choices=["default", "neutral", "dark", "forest"],
    )
    ap.add_argument(
        "-b",
        "--bg",
        default=None,
        help="background, e.g. white, transparent, '#F0F0F0'",
    )
    ap.add_argument(
        "-o",
        "--output",
        help="output file (or directory / name stem for multi-diagram .md)",
    )
    ap.add_argument("--backend", choices=["auto", *AUTO_ORDER], default="auto")
    ap.add_argument(
        "--url-only",
        action="store_true",
        help="print mermaid.ink / kroki / Live Editor URLs and markdown, "
        "download nothing",
    )
    return ap


def print_urls(a, diagrams):
    for i, code in enumerate(diagrams, 1):
        ink = mermaid_ink_url(code, a.format, a.size, a.px, a.scale, a.theme, a.bg)
        info = {
            "index": i,
            "mermaid_ink": ink,
            "kroki": kroki_url(code, a.format),
            "live_editor": live_editor_url(code, a.theme),
            "markdown": f"![]({ink})",
        }
        print(json.dumps(info, indent=2))


def output_paths(a, count, stem):
    if count == 1:
        o = a.output or f"{stem}.{a.format}"
        if os.path.isdir(o):
            o = os.path.join(o, f"{stem}.{a.format}")
        return [o]
    is_dir = a.output and (os.path.isdir(a.output) or a.output.endswith("/"))
    d = a.output if is_dir else "."
    if not a.output or d != ".":
        base = stem
    else:
        base = os.path.splitext(os.path.basename(a.output))[0]
    os.makedirs(d, exist_ok=True)
    return [os.path.join(d, f"{base}-{i}.{a.format}") for i in range(1, count + 1)]


def export_one(a, code, out, order):
    """Try each backend in turn. Return the list of errors ([] on success)."""
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    errors = []
    for name in order:
        try:
            BACKENDS[name](code, a.format, a.size, a.px, a.scale, a.theme, a.bg, out)
            validate(out, a.format)
        except Exception as e:  # noqa: BLE001 - try next backend
            errors.append(f"{name}: {e}")
            if os.path.exists(out):
                os.remove(out)
            if isinstance(e, SyntaxErr):
                break
            continue
        dims = png_size(out) if a.format == "png" else None
        size = f"{dims[0]}x{dims[1]}" if dims else None
        print(json.dumps({"output": out, "backend": name, "size": size}))
        return []
    return errors


def main():
    a = build_parser().parse_args()

    if a.format == "svg" and a.size != "auto":
        print(
            "note: --size applies to PNG only; "
            "SVG is vector and exported at natural size",
            file=sys.stderr,
        )
        a.size = "auto"
    if a.scale is not None and not (1 <= a.scale <= 3):
        sys.exit("error: --scale must be between 1 and 3")
    if a.output:
        a.output = confine(a.output)

    diagrams = read_diagrams(a.input)
    stem = (
        "diagram" if a.input == "-" else os.path.splitext(os.path.basename(a.input))[0]
    )

    if a.url_only:
        print_urls(a, diagrams)
        return

    outs = output_paths(a, len(diagrams), stem)
    order = AUTO_ORDER if a.backend == "auto" else [a.backend]
    failures = 0
    for code, out in zip(diagrams, outs, strict=True):
        errors = export_one(a, code, out, order)
        if errors:
            failures += 1
            print(
                f"error: export failed for {out}\n  " + "\n  ".join(errors),
                file=sys.stderr,
            )
            print(
                "hint: fix syntax errors in the source, "
                "or use --url-only to get browser links",
                file=sys.stderr,
            )
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
