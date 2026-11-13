---
name: italian-technical-writing
description: Write and revise Italian software-development text so it reads like an Italian engineer wrote it, not like English translated by an AI ("traduttese", LLM-ese). Use this skill whenever you write, translate or edit anything technical in Italian — README, wiki pages, design docs, ADRs, analyses, specs, runbooks, API/CLI reference, changelogs, PR and commit descriptions, code comments, docstrings, error messages, and technical emails or chat messages to colleagues and vendors — even if the user doesn't mention style. Also use it when the user asks to make Italian text "più naturale", "meno AI", "meno traduttese", or to review Italian docs for calques and AI tics.
---

<!-- markdownlint-disable MD013 -->

# Italian technical writing

Your Italian tends to be English in disguise. The words are Italian, but the
skeleton (sentence order, connectives, metaphors, how terms get introduced) is
borrowed from English, and Italian readers notice within a sentence. This skill
exists to fix that for one domain: text written by and for Italian software
teams.

The target voice is the one of an Italian enterprise IT team writing on
the company wiki or in an email to another team: precise, fairly formal, full of the
English jargon the team really uses, and built with Italian syntax. Not
literary Italian, and not the Italian of a translated marketing page.

## Before you write

1. **Compose in Italian, don't translate a draft.** If you think the sentence in
   English first, its structure leaks through. Ask yourself how a senior Italian
   engineer would say it in a meeting, then write that down more carefully.
2. **Find the register.** Default to the enterprise IT register described below.
   If the project, thread or page already has Italian text, match its register
   and its choice of _tu_ / _voi_ / impersonal instead.
3. **When revising, change form only.** Never drop or add information, sections,
   requirements or questions, even if they look redundant: content is the
   author's call. Keep identifiers, endpoints, hostnames, flags, config keys,
   error strings, links and markup (Markdown, HTML, wiki macros and storage formats) exactly as they are.

## The rules that matter most

These come from real corrections an Italian engineer made to Claude-written
documents, ranked by how often they appeared. Each has a reason; when a case
doesn't fit the letter of a rule, follow the reason.

### 1. Keep the English jargon the team actually uses

Italian IT teams say _as-is_, _to-be_, _target_, _redesign_, _solution_, _hop_,
_consumer_, _data ownership_, _razionali_, _deploy_, _branch_, _endpoint_,
_workspace_, _rollout_. Translating these into textbook Italian ("situazione
attuale", "stato di arrivo", "passaggi di rete", "chi possiede quali dati",
"soluzione" for a low-code platform solution) is as much a tell as a calque: it
shows the writer isn't part of the team. Italianised verbs that teams use are
fine too (_hostata_, _deployare_, _committare_), with "fare il deploy" in more
formal pages.

Translate only what Italian teams normally say in Italian: _file di
configurazione_, _richiesta/risposta_, _dipendenza_, _variabile d'ambiente_,
_caricamento_, _sola lettura_.

### 2. Systems and documents don't think, ask or know

English personifies freely; Italian technical prose doesn't. "I requisiti
chiedono", "il sistema di pianificazione non ne sa nulla", "il servizio vuole un token",
"ogni progetto ha un gemello", "dire agli utenti cosa succede" all read as
translated.

- "i requisiti chiedono due novità" → "nei requisiti del redesign viene richiesto"
- "un gemello nel sistema di pianificazione" → "una controparte nel sistema di pianificazione"
- "il sistema di pianificazione non ne sa nulla" → drop it, or "non ne ha visibilità"
- "dire agli utenti in ogni momento che cosa sta succedendo" → "dare agli utenti visibilità su cosa stia succedendo"

### 3. Don't gloss terms the reader already knows

Claude explains every term ("un'app low-code, cioè un'applicazione costruita con…",
"on-premises, cioè installato sui propri server…"). The readers are the team;
glossing _on-premises_ or _cluster_ is condescending and screams AI. If a gloss is
genuinely needed for an internal acronym, use a short parenthesis, never ", cioè".

### 4. Colons introduce, they don't explain

A colon before an apposition or a list is fine ("una controparte nel sistema
di pianificazione: il piano di lavoro"; "esegue anche altre operazioni: salva i metadati, crea i
collegamenti e invia gli eventi"). Using it as a hinge between two full clauses,
the way English uses a colon or dash, is a tic:

- "Al momento però sono disabilitate: in produzione la chiamata … restituisce …" → "Al momento però risultano disabilitate. In produzione la chiamata … restituisce …"
- "un'unica chiamata atomica: il DMS non restituisce alcun avanzamento" → "un'unica chiamata della quale il DMS non restituisce alcun avanzamento"

Split into two sentences or use a relative clause that refers to a noun (_il
quale_, _della quale_, _per cui_). Don't swap the colon for _il che_: a clause
hanging off the whole previous sentence is the same English ", which…" in
disguise. Start a new sentence with an explicit subject instead:

- "…su una connessione che resta aperta, il che risolverebbe sia il carico sia la latenza." → "…su una connessione che resta aperta. Questa soluzione risolverebbe sia il carico sia la latenza, ma…"

More generally, one claim per sentence: when a sentence adds a second,
independent claim after "e" or "il che", split it.

### 5. Prose, not telegrams

- No whole sentences in bold as lead-ins ("**Il rollout è diviso in tre fasi.**"). Bold is for a key term, rarely.
- No "Label: fragment" metadata lines ("Versione: 2. Stato: bozza. Owner: team piattaforma.") in the body of a page; write a sentence, or leave metadata to the page properties.
- Method steps and list items are full clauses: "Grafana: dashboard latenza p95" → "Verificata su Grafana la latenza p95 di ogni servizio nella dashboard `api-latency`."
- A short "**Term**: description" list is fine when it really is a glossary of systems.
- An order of precedence or a sequence (credential resolution, fallback chain, startup steps) is list-shaped: introduce it with a full sentence ending in "rispettando il seguente ordine:" and give one item per step, instead of packing it into one long sentence of commas.

### 6. Enterprise register

Formal connectives and verbs, as in corporate Italian:

| Neutral / English-shaped    | Enterprise register                                       |
| --------------------------- | --------------------------------------------------------- |
| soprattutto                 | prevalentemente                                           |
| riportato da                | indicato da                                               |
| infatti                     | difatti, infatti (both fine)                              |
| sono disabilitate           | risultano disabilitate                                    |
| oggi                        | ad oggi                                                   |
| alcuni file grandi          | alcune eccezioni                                          |
| vorremmo chiedere           | volevamo chiedere (imperfetto di cortesia)                |
| Però, … (sentence start)    | Il problema è che…                                        |
| Trovate l'analisi qui       | Potete trovare i razionali su questa pagina               |
| che cosa sta succedendo     | cosa stia succedendo (subjunctive in indirect questions)  |
| il redesign dismette        | l'attività di redesign dismette                           |
| Attenzione: X può causare Y | Va tenuto presente che X potrebbe causare Y. In tal caso… |

The passive and _si_ impersonal are natural here when the agent is a process, a
document or "the analysis". Don't force everything into the active voice.

### 7. Name the right actor

Don't default to "we" or drop the subject when the actor is a system:
"gestiremo soprattutto file piccoli" → "il sistema gestirà prevalentemente file
di piccole dimensioni". Name components precisely ("il microservizio
documentale", not "il nostro microservizio") when the reader needs to know which
one.

The same goes for features: don't call something by a bare noun when it
doesn't exist yet. A planned feature is "la futura funzionalità di chat", not
"la chat"; a deprecated one is "l'attuale funzionalità di export, che verrà
dismessa". The reader should never have to guess whether a thing is live.

Warnings follow the same logic: state the risk in the conditional and the
required action explicitly. "Un valore troppo alto può portare a throttling" →
"Va tenuto presente che un valore di concurrency troppo alto potrebbe far
scattare un throttling da parte di S3. In tal caso il valore deve essere
necessariamente ridotto."

### 8. No AI rhythm

- No punchy closing line that restates the section ("Tenerli coerenti è il compito di questo design.").
- No paragraph-initial "In conclusione", "In sintesi", "In definitiva". One "Inoltre" or "Pertanto" is fine; the same connective opening several paragraphs is not.
- No adjective triplets ("robusto, scalabile e affidabile").
- No em or en dashes as punctuation, including in titles ("Migrazione storage – Piano di rollout"). Use commas, parentheses, a colon or a new sentence.
- No comma before _e_ / _oppure_ joining two clauses with the same subject.
- A comma after a sentence-initial connective: "Inoltre, la futura funzionalità di chat richiederà…", "Tuttavia, …", "In tal caso, …" (short ones like "Per questo" can go without).
- Never a comma between subject and verb, even after a long subject.
- Headings are Italian sentence case and noun phrases: "Obiettivi del design", not "Il compito di questo design"; "Tipi di campi condivisi", not "I tre tipi di campi condivisi".

### 9. Technical words, not everyday ones

Claude reaches for the everyday word where a team would use the technical one,
and for English number phrasing:

- "quando non ci sono novità" → "quando non ci sono aggiornamenti" (_novità_ is fine only as a changelog heading)
- "in orario di punta" → "durante orari di traffico elevato" (rush hour is for commuters)
- "può portare a throttling" → "può far scattare un throttling"
- "fino a 10 secondi di ritardo" → "10 secondi di ritardo massimo"; "fino a 30 minuti di downtime" → "30 minuti di downtime massimo"
- "errori 503" → "errori di tipo `503 Slow Down`"
- "la catena standard dell'SDK" → "la credential provider chain dell'SDK": the name the docs use

In instructions, name the thing and prefer the formal modal passive over a bare
_si_: "si aggiunge `--delete`" → "deve essere aggiunta l'opzione `--delete`".
"Permette di…" to introduce what a tool does is natural; keep it.

### 10. Alternatives and trade-offs in the conditional

In ADRs and analyses, a rejected alternative is hypothetical: keep every verb
about it in the conditional, and state its drawback as an explicit
consequence instead of a bare fact.

- "SSE risolverebbe il problema. Il canale però è monodirezionale." → "Questa soluzione risolverebbe il problema, ma introdurrebbe una limitazione nella comunicazione tra client e server. Il canale infatti diventerebbe monodirezionale, solamente dal server verso il client."

### 11. Classic calques and false friends

"È importante notare che", "svolge un ruolo cruciale", "al fine di", "nel
panorama attuale", "sfruttare", "robusto", "in termini di", "fare senso",
"consistente" (for _coerente_), "eventualmente" (for _alla fine_), "supportare"
(for _è compatibile con_), "fornire" and "garantire" on every line. The full
list with alternatives is in `references/calchi.md`.

## Workflow

1. Draft in Italian following the rules above.
2. Run the checker on the draft (save it to a temp file first if it only exists
   in the conversation):

   ```bash
   python3 <skill-dir>/scripts/check_italian.py draft.md
   ```

   It flags known calques, over-Italianised jargon, personification, `cioè`
   glosses, colon hinges, _il che_, "fino a N secondi", "ora di punta",
   bold lead-ins, dashes, repeated paragraph openers, triplets, overused
   _fornire_/_garantire_, Title Case headings and `é`/`E'`
   typos. Code, inline code, URLs and HTML/XML tags and wiki macros are ignored. Every
   hit is a prompt to look again, not an order: keep a flagged phrase when it is
   genuinely right in context.

3. Reread once for what a script can't see: English word order, a subject
   repeated in every sentence, chains of short subject-verb-object sentences
   that Italian would join with a subordinate clause, gerunds stacked where a
   relative or a _perché_ would read better.
4. Fix and deliver. Don't append a list of the changes you made unless asked.

## Reference files

- `references/calchi.md`: catalogue of calques, false friends and
  over-Italianised jargon with alternatives. Read it when revising someone
  else's text or when the checker flags something you're unsure about.
- `references/sintassi-e-ritmo.md`: syntax and rhythm with before/after
  sentence pairs (subordination, _si_, passives, connectives, punctuation,
  register, _tu_ vs. impersonal). Read it for longer documents: design pages,
  ADRs, analyses.
- `references/esempi.md`: full before/after paragraphs from real corrections
  (an email to a vendor team, a design page) and a reference
  paragraph. Read it once to calibrate the voice before a long document.
