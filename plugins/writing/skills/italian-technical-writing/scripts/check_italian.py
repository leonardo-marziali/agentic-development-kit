#!/usr/bin/env python3
"""Flag translationese and AI tics in Italian technical text.

Usage:
    check_italian.py FILE [FILE ...]
    check_italian.py -            # read stdin
    check_italian.py --strict ... # exit 1 when anything is flagged

The output is a hint list for a self-review pass, not a verdict. Each line is
`path:line:col [rule] message`, followed by an indented suggestion. A flagged
phrase can be legitimate in context; the point is to look at it twice.

Code is ignored: fenced blocks, inline `code`, HTML/XML tags (wiki
storage formats) and URLs are blanked out before matching, so identifiers
and markup never produce findings.

Standard library only.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass

# --------------------------------------------------------------------------
# Phrase catalogue: (rule id, regex, message, suggestion)
# Patterns are matched case-insensitively on prose with code removed.
# --------------------------------------------------------------------------

PHRASES: list[tuple[str, str, str, str]] = [
    # Stock openers and fillers
    (
        "calco",
        r"\b(è|e') importante (notare|sottolineare|ricordare|evidenziare)\b",
        "stock opener 'È importante notare'",
        "delete it and state the fact directly",
    ),
    (
        "calco",
        r"\bvale la pena (di )?(notare|sottolineare|menzionare|ricordare)\b",
        "calque of 'it's worth noting'",
        "delete it and state the fact directly",
    ),
    (
        "calco",
        r"\b(svolge|svolgono|gioca|giocano|ricopre|ricoprono) un ruolo (cruciale|chiave|fondamentale|centrale|essenziale|importante)\b",
        "calque of 'plays a crucial role'",
        "say what it does: 'gestisce', 'decide', 'blocca'...",
    ),
    (
        "calco",
        r"\bal fine di\b",
        "'al fine di' is heavy",
        "'per', or 'così da' for a consequence",
    ),
    (
        "calco",
        r"\bnel(l')? ?(panorama|contesto|mondo) (attuale|odierno|moderno|digitale|di oggi)\b",
        "AI scene-setting",
        "delete it; start from the subject",
    ),
    (
        "calco",
        r"\bsfrutt(a|are|ando|iamo|ano|ato|ata|ati|ate)\b",
        "'sfruttare' as a calque of 'leverage'",
        "'usare', 'utilizzare', 'basarsi su'",
    ),
    (
        "calco",
        r"\brobust[aoie]\b",
        "'robusto' as a calque of 'robust'",
        "name the property: 'affidabile', 'tollerante ai guasti', 'che regge il carico'",
    ),
    (
        "calco",
        r"\bsenza soluzione di continuità\b",
        "calque of 'seamless'",
        "'senza interruzioni', or describe what doesn't break",
    ),
    (
        "calco",
        r"\bin termini di\b",
        "calque of 'in terms of'",
        "'per', 'quanto a', or rephrase",
    ),
    ("calco", r"\bfa(re|nno)? senso\b", "calque of 'makes sense'", "'ha senso'"),
    (
        "calco",
        r"\bche (tu )?sia(no)? .{1,40}? o .{1,40}?,",
        "possible calque of 'whether you're X or Y'",
        "address one reader, or drop the clause",
    ),
    (
        "calco",
        r"\b(immergiamoci|esploriamo|approfondiamo|scopriamo insieme)\b",
        "chatbot-tutorial voice",
        "drop it; technical docs don't announce the tour",
    ),
    (
        "calco",
        r"\ball'avanguardia\b|\bdi ultima generazione\b|\ba 360 gradi\b",
        "marketing filler",
        "delete it or state the measurable property",
    ),
    (
        "calco",
        r"\bin altre parole\b",
        "restating is a tic",
        "keep the clearer of the two formulations",
    ),
    (
        "il-che",
        r"\bil che\b",
        "'il che' hanging off the previous clause",
        "new sentence with an explicit subject: 'Questa soluzione...'",
    ),
    (
        "lessico",
        r"\b(in|nell'|nelle|negli) ?(orari[oe]?|or[ae]) di punta\b",
        "'ora di punta' is commuter language",
        "'durante orari di traffico elevato', 'nei picchi di carico'",
    ),
    (
        "lessico",
        r"\bfino a \d+(?:[.,]\d+)? ?(ms|millisecondi|secondi|minuti|ore|giorni)\b",
        "calque of 'up to N'",
        "'N secondi ... massimo', 'al massimo N secondi'",
    ),
    (
        "lessico",
        r"\bportare a (throttling|errori|timeout|un throttling)\b",
        "flat calque of 'lead to'",
        "'far scattare un throttling', 'causare errori'",
    ),
    (
        "virgola",
        r"(?:\A|(?<=\n)|(?<=[.!?] ))(inoltre|tuttavia|pertanto) (?=\w)",
        "sentence-initial connective without a comma",
        "'Inoltre, ...', 'Tuttavia, ...'",
    ),
    # IT false friends
    (
        "falso-amico",
        r"\bconsistent[ei]\b",
        "'consistente' means 'substantial', not 'consistent'",
        "'coerente'",
    ),
    (
        "falso-amico",
        r"\beventualmente\b",
        "'eventualmente' means 'if needed', not 'eventually'",
        "for 'eventually': 'alla fine', 'prima o poi'; for eventual consistency keep the English term",
    ),
    (
        "falso-amico",
        r"\bsupport(a|ano|are|ato|ata|ati|ate)\b",
        "'supportare' for 'support' is a calque",
        "'è compatibile con', 'gestisce', 'accetta'",
    ),
    # Over-Italianised jargon (the team says it in English)
    (
        "gergo",
        r"\bstato di arrivo\b|\bstato finale desiderato\b",
        "over-Italianised 'target state'",
        "'architettura target', 'to-be'",
    ),
    (
        "gergo",
        r"\bsituazione attuale\b|\bstato attuale\b",
        "over-Italianised 'as-is'",
        "'as-is' (e.g. 'l'applicazione as-is')",
    ),
    (
        "gergo",
        r"\bpassaggi di rete\b",
        "over-Italianised 'network hops'",
        "'hop di rete'",
    ),
    (
        "gergo",
        r"\bchi possiede quali dati\b|\bproprietà dei dati\b",
        "over-Italianised 'data ownership'",
        "'data ownership'",
    ),
    ("gergo", r"\b(il|un|nel|sul) ramo\b", "'ramo' for 'branch'", "'branch'"),
    # Anthropomorphism and colloquial images
    (
        "antropomorfismo",
        r"\b(i requisiti|il requisito|il documento|l'analisi|il design|la specifica) (chiede|chiedono|vuole|vogliono|dice|dicono|pretende)\b",
        "documents don't ask or say",
        "'nei requisiti viene richiesto', 'secondo l'analisi'",
    ),
    (
        "antropomorfismo",
        r"\bnon ne sa nulla\b|\bnon sa nulla\b|\bnon ne sa niente\b",
        "systems don't 'know'",
        "'non ne ha visibilità', 'non li gestisce', or drop it",
    ),
    (
        "antropomorfismo",
        r"\b(gemello|gemella|gemelli)\b",
        "'gemello' as an image for a linked object",
        "'controparte', 'corrispondente'",
    ),
    (
        "antropomorfismo",
        r"\bdire agli utenti\b",
        "colloquial",
        "'dare visibilità agli utenti', 'notificare agli utenti'",
    ),
    # Glosses
    (
        "glossa",
        r",\s*cioè\b",
        "gloss with 'cioè'",
        "if the reader knows the term, drop the gloss; otherwise use a short parenthesis",
    ),
    # Punchy closers
    (
        "chiusa",
        r"\b(è|sarà) (il|lo) (compito|obiettivo|cuore|punto) di questo (design|documento|capitolo)\b|\bed è (proprio )?qui che\b|\bin poche parole\b",
        "punchy wrap-up line",
        "delete it; the section already said it",
    ),
    # Typography
    ("refuso", r"(?<![\w'])é(?![\w'])", "'é' used for the verb", "'è'"),
    ("refuso", r"(?<![\w])E'(?=\s)", "apostrophe instead of the accent", "'È'"),
]

PARAGRAPH_OPENERS = [
    "inoltre",
    "pertanto",
    "in conclusione",
    "in sintesi",
    "in definitiva",
    "infine",
    "tuttavia",
    "di conseguenza",
    "in aggiunta",
    "in particolare",
    "allo stesso modo",
]
ALWAYS_FLAG_OPENERS = {"in conclusione", "in sintesi", "in definitiva", "in aggiunta"}

AI_ADJECTIVES = (
    "robust[oaie]|scalabil[ei]|affidabil[ei]|sicur[oaie]|flessibil[ei]|"
    "efficient[ei]|performant[ei]|modern[oaie]|intuitiv[oaie]|semplic[ei]|"
    "potent[ei]|innovativ[oaie]|completo|completa|complet[ie]|veloc[ei]|"
    "legger[oaie]|moderna|elegant[ei]|resilient[ei]|estendibil[ei]|"
    "manutenibil[ei]|versatil[ei]"
)
TRIPLET = re.compile(
    rf"\b({AI_ADJECTIVES}),\s+({AI_ADJECTIVES})\s+e\s+({AI_ADJECTIVES})\b",
    re.IGNORECASE,
)

OVERUSED = {
    "fornire": r"\bforni(re|sce|scono|to|ta|ti|te|amo)\b",
    "garantire": r"\bgaranti(re|sce|scono|to|ta|ti|te|amo)\b",
}
OVERUSE_LIMIT = 2

DASH = re.compile(r"\s[—–]\s|—")
BOLD_SENTENCE = re.compile(r"^\s*(?:[-*+]\s+)?\*\*[^*\n]{15,}[.:]\*\*")
# A colon mid-line, followed by a clause up to the end of its sentence. The
# clause is judged in code: long enough, has a finite verb, and is not an
# enumeration (colons introducing lists are fine).
COLON_HINGE = re.compile(
    # A period counts as the end of the clause only when followed by whitespace,
    # so hostnames like "dms.example.com" stay inside it.
    r"(?<=\S):[ \t]+([A-Za-zà-ù](?:[^\n.;]|\.(?=\S))*)"
)
HINGE_MIN_CHARS = 40
FINITE_VERB = re.compile(
    r"\b(è|sono|viene|vengono|ha|hanno|non|si|può|possono|deve|devono|"
    r"restituisce|risponde|chiama|crea|resta|rimane)\b"
)


@dataclass
class Finding:
    line: int
    col: int
    rule: str
    message: str
    hint: str


def blank(match: re.Match[str]) -> str:
    """Replace a match with spaces, keeping newlines so positions survive."""
    return re.sub(r"[^\n]", " ", match.group(0))


def strip_code(text: str) -> str:
    text = re.sub(r"```.*?```|~~~.*?~~~", blank, text, flags=re.DOTALL)
    text = re.sub(r"<!\[CDATA\[.*?\]\]>", blank, text, flags=re.DOTALL)
    text = re.sub(
        r"<(code|pre)\b.*?</\1>", blank, text, flags=re.DOTALL | re.IGNORECASE
    )
    text = re.sub(r"`[^`\n]*`", blank, text)
    text = re.sub(r"<[^>\n]+>", blank, text)
    text = re.sub(r"https?://\S+", blank, text)
    return text


def position(text: str, offset: int) -> tuple[int, int]:
    line = text.count("\n", 0, offset) + 1
    col = offset - (text.rfind("\n", 0, offset) + 1) + 1
    return line, col


Add = Callable[[int, str, str, str], None]


def check_phrases(text: str, add: Add) -> None:
    for rule, pattern, message, hint in PHRASES:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            add(m.start(), rule, f"{message}: '{m.group(0).strip()}'", hint)


def check_dashes_and_triplets(text: str, add: Add) -> None:
    for m in DASH.finditer(text):
        add(
            m.start(),
            "trattino",
            "em/en dash used as punctuation",
            "comma, parenthesis, colon or a new sentence",
        )
    for m in TRIPLET.finditer(text):
        add(
            m.start(),
            "terna",
            f"adjective triplet: '{m.group(0)}'",
            "keep the one adjective that carries information, or state facts",
        )


def check_overuse(text: str, add: Add) -> None:
    for word, pattern in OVERUSED.items():
        hits = list(re.finditer(pattern, text, re.IGNORECASE))
        if len(hits) > OVERUSE_LIMIT:
            add(
                hits[OVERUSE_LIMIT].start(),
                "ripetizione",
                f"'{word}' used {len(hits)} times",
                "vary: 'dare', 'offrire', 'restituire', 'esporre'; "
                "keep 'garantire' for real guarantees",
            )


def paragraph_openers(text: str) -> dict[str, list[int]]:
    """Map each known connective to the offsets of paragraphs it opens."""
    openers: dict[str, list[int]] = {}
    for m in re.finditer(r"(?:\A|\n\s*\n)\s*(?:<p>)?\s*([^\n]{0,40})", text):
        head = m.group(1).lower()
        for opener in PARAGRAPH_OPENERS:
            if head.startswith((opener + ",", opener + " ")):
                openers.setdefault(opener, []).append(m.start(1))
    return openers


def check_openers(text: str, add: Add) -> None:
    for opener, offsets in paragraph_openers(text).items():
        if opener in ALWAYS_FLAG_OPENERS:
            flagged = offsets
            message = f"paragraph opens with '{opener.capitalize()}'"
            hint = "delete it; the paragraph order already shows it"
        else:
            flagged = offsets[1:]
            message = f"'{opener.capitalize()}' opens {len(offsets)} paragraphs"
            hint = "one is fine; vary the others or drop the connective"
        for off in flagged:
            add(off, "apertura", message, hint)


def is_colon_hinge(text: str, m: re.Match[str]) -> bool:
    """A colon joining two full clauses, not an apposition, list or label."""
    tail = m.group(1)
    line_start = text.rfind("\n", 0, m.start()) + 1
    label = text[line_start : m.start()].strip()
    if re.match(r"^([-*+]|\d+\.)?\s*\S{0,40}$", label):
        return False
    # "salva i metadati, crea i collegamenti e invia gli eventi" lists items;
    # "il DMS non restituisce nulla, e il documento..." explains.
    first_segment = tail.split(",")[0]
    return len(tail) >= HINGE_MIN_CHARS and bool(FINITE_VERB.search(first_segment))


def check_colons(text: str, add: Add) -> None:
    for m in COLON_HINGE.finditer(text):
        if is_colon_hinge(text, m):
            add(
                m.start(),
                "due-punti",
                "colon used as an explanatory hinge",
                "split into two sentences, or use a relative clause "
                "('della quale', 'per cui'); colons are for appositions and lists",
            )


def check_lines(raw: str) -> list[Finding]:
    """Checks that need the raw Markdown: bold lead-ins and headings."""
    found: list[Finding] = []
    for lineno, line in enumerate(raw.splitlines(), start=1):
        if BOLD_SENTENCE.match(line):
            found.append(
                Finding(
                    lineno,
                    1,
                    "grassetto",
                    "whole sentence in bold as a lead-in",
                    "write it as prose; bold only key terms",
                )
            )
        heading = re.match(r"^#{1,6}\s+(\S.*)$", line)
        if heading and is_title_case(heading.group(1)):
            found.append(
                Finding(
                    lineno,
                    1,
                    "titolo",
                    "English-style Title Case heading",
                    "capitalise only the first word and proper nouns",
                )
            )
    return found


def is_title_case(heading: str) -> bool:
    words = [w for w in re.findall(r"[A-Za-zÀ-ÿ']+", heading) if len(w) > 3]
    caps = [w for w in words[1:] if w[0].isupper()]
    return len(words) >= 4 and len(caps) >= max(2, len(words) // 2 + 1)


def check(raw: str) -> list[Finding]:
    text = strip_code(raw)
    found: list[Finding] = []

    def add(offset: int, rule: str, message: str, hint: str) -> None:
        line, col = position(text, offset)
        found.append(Finding(line, col, rule, message, hint))

    for checker in (
        check_phrases,
        check_dashes_and_triplets,
        check_overuse,
        check_openers,
        check_colons,
    ):
        checker(text, add)
    found.extend(check_lines(raw))
    found.sort(key=lambda f: (f.line, f.col))
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("paths", nargs="+", help="files to check, or - for stdin")
    parser.add_argument(
        "--strict", action="store_true", help="exit 1 when anything is flagged"
    )
    args = parser.parse_args(argv)

    total = 0
    for path in args.paths:
        if path == "-":
            raw, label = sys.stdin.read(), "<stdin>"
        else:
            with open(path, encoding="utf-8") as fh:
                raw, label = fh.read(), path
        for f in check(raw):
            total += 1
            print(f"{label}:{f.line}:{f.col} [{f.rule}] {f.message}")
            print(f"    -> {f.hint}")

    print(f"{total} hint(s)." if total else "No hints.", file=sys.stderr)
    return 1 if (args.strict and total) else 0


if __name__ == "__main__":
    sys.exit(main())
