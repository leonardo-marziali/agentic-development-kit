<!-- markdownlint-disable MD013 -->

# Sintassi e ritmo

How Italian technical sentences are built, with before/after pairs. The
calques in `calchi.md` are the easy part; the skeleton described here is what
makes a text sound native even when every single word is right.

## Contents

1. Join clauses the Italian way
2. Subjects: name the right one, then let it go
3. Passive and impersonal _si_
4. Gerunds
5. Connectives
6. Punctuation
7. Lists, tables and bold
8. Headings
9. Register and address (_tu_, _voi_, impersonal)
10. Revising: form only

## 1. Join clauses the Italian way

English technical prose is a chain of short subject-verb-object sentences.
Italian connects ideas with subordinate and relative clauses.

- Prima: "Il gateway applica un limite per client. Il limite è calcolato su una finestra di sessanta secondi. Quando il limite è superato, il gateway risponde con 429."
- Dopo: "Il gateway applica un rate limit per client, calcolato su una finestra scorrevole di sessanta secondi; superata la soglia, risponde con 429."

Relative pronouns _il quale / la quale / della quale_ are natural in formal
technical prose and often replace an English colon or dash:

- Prima: "L'invio resterebbe un'unica chiamata atomica: il DMS non restituisce alcun avanzamento."
- Dopo: "L'invio resterebbe un'unica chiamata della quale il DMS non restituisce alcun avanzamento."

Not _il che_, though: it hangs a clause off the whole previous sentence, the
English ", which…". Start a new sentence with an explicit subject ("Questa
soluzione…", "Questo approccio…").

Join fragments, but split claims. When a sentence carries two independent
claims, make two sentences:

- Prima: "`s3mirror` non ha un file di configurazione per le credenziali e usa la catena standard dell'SDK."
- Dopo: "`s3mirror` non ha un proprio file di configurazione per le credenziali. Usa invece la configurazione di default della credential provider chain dell'SDK AWS."

One long sentence per paragraph is plenty.

## 2. Subjects: name the right one, then let it go

Two opposite mistakes, both English-shaped:

- **Wrong actor.** "gestiremo prevalentemente file piccoli" when it's the system that handles them → "il sistema gestirà prevalentemente file di piccole dimensioni".
- **Subject repeated in every sentence.** "Il servizio riceve la richiesta. Il servizio valida il token. Il servizio inoltra…" → "Il servizio riceve la richiesta, valida il token e la inoltra…". Once the subject is clear, Italian drops it.

Be precise with components: "il microservizio documentale", not "il nostro
microservizio", when there is more than one.

## 3. Passive and impersonal _si_

"Avoid the passive" is English style advice. In Italian enterprise prose the
passive and the _si_ impersonal are normal when the agent is a document, a
process or nobody in particular:

- "nei requisiti viene richiesto un upload progressivo"
- "la migrazione viene eseguita in tre fasi"
- "il valore si può alzare dal file di configurazione"
- "risultano disabilitate"

What sounds translated is a passive with an explicit _da_ agent where the
active is obvious: "la richiesta viene inviata dal client" → "il client invia
la richiesta".

## 4. Gerunds

English _-ing_ clauses become Italian gerunds far too often.

- Prima: "Utilizzando il caricamento multipart, ogni parte viene inviata separatamente, permettendo di riprendere l'upload."
- Dopo: "Con il caricamento multipart ogni parte è una richiesta separata, che si può ritentare da sola."

One gerund per sentence at most; prefer _con_, _se_, _perché_, a relative
clause, or a new sentence.

## 5. Connectives

- _Inoltre_, _Pertanto_, _Tuttavia_ once in a document are fine. The same one opening several paragraphs is an AI pattern.
- _In conclusione_, _In sintesi_, _In definitiva_ to open a paragraph: drop them.
- Sentence-initial _Però_: in formal pages prefer "Il problema è che…", "Tuttavia…", or move _però_ after the first word ("Al momento però…").
- _invece_, _difatti_, _dal momento che_, _ad oggi_ are typical of the register and read well.
- Indirect questions take the subjunctive in this register: "visibilità su cosa stia succedendo", "chiedere se gli sviluppi comprendano/comprendessero…".

## 6. Punctuation

- **No em/en dashes** as punctuation, titles included. Use commas, parentheses, a colon, or a new sentence.
- **Colon** before an apposition or a list: yes. As a hinge between two full clauses: no (see §1).
- **No comma before _e_ / _oppure_** joining clauses with the same subject: "il documento viene creato solo alla fine del trasferimento oppure non viene creato affatto".
- **Semicolons** are fine to separate two closely linked clauses.
- _È_ with the accent, never _E'_; _é_ only in _perché_, _poiché_, _né_, _sé_…, never for the verb.
- Typographic apostrophes or straight ones: match the existing document.

## 7. Lists, tables and bold

- Use a list only when the content is a list (steps, parallel options, systems). Explanations and arguments go in prose.
- Each item of a method or procedure is a full clause ("Verifica della latenza p95 di ogni servizio sulla dashboard Grafana"), not "Label: fragment".
- "**Sistema**: descrizione" lists are fine for a short inventory of systems.
- Table cells can be short, but don't add colloquial asides ("Gli utenti del portale. Il sistema di pianificazione non ne sa nulla." → "Gli utenti del portale").
- Bold marks a term the reader must spot, a few times per page. Never a whole sentence as a lead-in.

## 8. Headings

- Sentence case: only the first word and proper nouns capitalised ("Piano di rollout", not "Piano Di Rollout").
- Noun phrases, no article teasers or counts: "Obiettivi del design" (not "Il compito di questo design"), "Tipi di campi condivisi" (not "I tre tipi di campi condivisi").
- English jargon is fine in headings when the team uses it: "Data ownership".

## 9. Register and address

- Default: enterprise IT register (see the table in SKILL.md), impersonal or first person plural for analyses and design pages ("abbiamo valutato", "è stata valutata").
- How-tos and READMEs: choose _tu_ imperative ("Esegui `make build`") or impersonal ("Si esegue `make build`") and stay consistent. If the project already has Italian docs, copy their choice.
- _voi_ for emails to a group ("Potete trovare…").
- Emails: "Ciao a tutti," then a capital letter on the next line is common and fine; close with "Grazie," and the name.
- Rejected alternatives in ADRs and analyses stay in the conditional throughout ("risolverebbe… ma introdurrebbe… il canale diventerebbe"); don't slip back into the present for their drawbacks.
- Instructions in READMEs: name the object and use the modal passive for required steps ("deve essere aggiunta l'opzione `--delete`").
- Polite requests use the imperfect: "volevamo chiedere", "volevo segnalare".

## 10. Revising: form only

When the user gives you a text to improve, rewrite sentences but keep every
piece of information, every requirement and every question. Don't add sections,
context or conclusions that weren't there. Keep identifiers, endpoints,
hostnames, flags, config keys, links and markup (Markdown, HTML, wiki
macros and storage formats) byte for byte.
