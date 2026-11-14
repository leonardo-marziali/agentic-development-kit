<!-- markdownlint-disable MD013 -->

# Esempi

Real corrections an Italian engineer made to Claude-written text, with every
system, product, company, person and hostname replaced by a generic one. Read
the _prima_ and _dopo_ side by side: the differences are small one by one, but
together they are the difference between "written by AI" and "written by the
team".

## Contents

1. Technical email to a vendor team
2. Design page ("Contesto")
3. Reference paragraph

## 1. Technical email to a vendor team

### Email: prima

> come riportato da Giulia nei requisiti non funzionali allegati, gestiremo soprattutto file di piccole dimensioni, con alcuni file grandi fino a un massimo di 10 GB.
>
> Rispetto alla situazione attuale, i requisiti chiedono due novità principali:
>
> La versione 24.3 del DMS prevede già delle API REST per il caricamento multipart a sessioni (`POST /v2/multipart` e le chiamate collegate), che dividono il file in parti inviate una alla volta. Al momento però sono disabilitate: in produzione (`dms.example.com`) la chiamata `GET /v2/multipart/settings` restituisce `is_enabled = false`.
>
> Oggi il caricamento passa da una nostra API, che a sua volta richiama la `POST /v2/nodes` del DMS con il parametro `file`. […] L'invio verso il DMS resterebbe infatti un'unica chiamata atomica: il DMS non restituisce alcun avanzamento, e il documento viene creato solo alla fine del trasferimento, oppure non viene creato affatto in caso di errore.
>
> Abbiamo valutato anche la soluzione proposta da Marco nel link precedente, cioè far caricare il file direttamente dal client verso il DMS, per evitare passaggi di rete nella piattaforma dati. Però le operazioni che oggi il nostro microservizio esegue dopo l'upload uscirebbero dal suo controllo […]
>
> Trovate l'analisi completa in questa pagina del wiki: [link].

### Email: dopo

> Come indicato da Giulia nei requisiti non funzionali allegati, il sistema gestirà prevalentemente file di piccole dimensioni, con alcune eccezioni fino a un massimo di 10 GB.
>
> Rispetto all'applicazione as-is, nei requisiti del redesign viene richiesto:
>
> La versione 24.3 del DMS prevede già delle API REST per il caricamento multipart a sessioni (`POST /v2/multipart` e le chiamate collegate), che dividono il file in parti inviate una alla volta.
>
> Al momento però risultano disabilitate. In produzione (`dms.example.com`) la chiamata `GET /v2/multipart/settings` restituisce `is_enabled = false`.
>
> Oggi il caricamento passa da una nostra API esposta dal microservizio documentale, che a sua volta richiama la `POST /v2/nodes` del DMS con il parametro `file`. […] L'invio verso il DMS resterebbe difatti un'unica chiamata della quale il DMS non restituisce alcun avanzamento. Il documento viene creato solo alla fine del trasferimento oppure non viene creato affatto in caso di errore.
>
> La soluzione menzionata invece da Marco nella mail precedente propone di caricare il file direttamente dal client verso il DMS, per evitare hop di rete nella piattaforma dati. Il problema è che ad oggi il microservizio documentale esegue anche altre operazioni: salva i metadati del documento, crea i collegamenti e invia gli eventi di notifica e di aggiornamento dei task.
>
> Potete trovare i razionali e la soluzione proposta con le API multipart su questa pagina del wiki.

### Email: what changed and why

- "gestiremo" → "il sistema gestirà": the system handles files, not "we".
- "situazione attuale" → "as-is", "passaggi di rete" → "hop di rete", "l'analisi completa" → "i razionali": the team's jargon.
- "i requisiti chiedono" → "nei requisiti del redesign viene richiesto": documents don't ask.
- Two colon hinges removed: one split into two sentences, one turned into "della quale".
- No comma before "e" / "oppure".
- "cioè far caricare" → "propone di caricare": no gloss.
- "Però le operazioni…" → "Il problema è che…"; "soprattutto" → "prevalentemente"; "riportato" → "indicato"; "infatti" → "difatti"; "Trovate" → "Potete trovare": register.
- "il nostro microservizio" → "il microservizio documentale": name the component.

## 2. Design page ("Contesto")

### Contesto: prima

> Ogni ordine del portale ha un gemello nel sistema di pianificazione: il suo piano di lavoro. La maggior parte dei dati vive solo nel portale, ma un piccolo insieme di campi, i **campi condivisi**, e le attività del piano esistono in entrambi i sistemi e possono cambiare da entrambi i lati. Tenerli coerenti è il compito di questo design.
>
> Oggi una parte dell'interfaccia del portale è un'**app low-code**, cioè un'applicazione costruita con un editor visuale, che usa anche dei **flussi automatici**. Il redesign dismette l'app low-code e la sostituisce con una nuova sezione della soluzione esistente (`orders-portal-app`, un'applicazione Angular). Questo design descrive lo stato di arrivo e non deve restare compatibile con l'implementazione di oggi.
>
> Il sistema di pianificazione è lo strumento in cui vivono i piani di lavoro. L'azienda lo usa _on-premises_, cioè installato sui propri server e non come servizio cloud. L'insieme di questi server si chiama **cluster**: i nodi applicativi, i database e il load balancer davanti.
>
> ## Chi possiede quali dati
>
> | Dati              | Dove vivono      | Chi li modifica                                                       |
> | ----------------- | ---------------- | --------------------------------------------------------------------- |
> | Dati solo portale | Solo nel portale | Gli utenti del portale. Il sistema di pianificazione non ne sa nulla. |
>
> ## Il compito di questo design
>
> Mantenere coerenti i campi condivisi e le attività in entrambe le direzioni, […] senza che una parte sovrascriva le modifiche dell'altra, e dire agli utenti in ogni momento che cosa sta succedendo.

### Contesto: dopo

> Ogni ordine del portale ha una controparte nel sistema di pianificazione: il piano di lavoro. La maggior parte dei dati vive solo nel portale, ma un piccolo insieme di campi, i **campi condivisi**, e le attività del piano esistono in entrambi i sistemi e possono cambiare da entrambi i lati.
>
> Ad oggi l'interfaccia del portale è un'**app low-code** (applicazione costruita con un editor visuale), che usa anche dei **flussi automatici**. L'attività di redesign dismette l'app low-code e la sostituisce con una nuova sezione della solution esistente (`orders-portal-app`). Questo design descrive l'architettura target e non deve restare compatibile con l'implementazione di oggi.
>
> Il sistema di pianificazione è lo strumento in cui vivono i piani di lavoro. Si tratta di una soluzione _on-premises_ e l'insieme dei server sui quali è hostata si chiama **cluster**.
>
> ## Data ownership
>
> | Dati              | Dove vivono      | Chi li modifica        |
> | ----------------- | ---------------- | ---------------------- |
> | Dati solo portale | Solo nel portale | Gli utenti del portale |
>
> ## Obiettivi del design
>
> Mantenere coerenti i campi condivisi e le attività in entrambe le direzioni, […] senza che una parte sovrascriva le modifiche dell'altra e dare agli utenti visibilità su cosa stia succedendo.

### Contesto: what changed and why

- "un gemello" → "una controparte"; "non ne sa nulla" removed; "dire agli utenti" → "dare agli utenti visibilità": no personification or colloquial images.
- "Tenerli coerenti è il compito di questo design." removed: punchy closer.
- "cioè un'applicazione…" → parenthesis; the _on-premises_ gloss and the list of what a cluster contains removed: the readers know the terms.
- "soluzione" → "solution", "stato di arrivo" → "architettura target", "Chi possiede quali dati" → "Data ownership", "hostata": jargon.
- "Il compito di questo design" → "Obiettivi del design": noun-phrase heading.
- "che cosa sta succedendo" → "cosa stia succedendo": subjunctive in the indirect question.
- The colon in "una controparte nel sistema di pianificazione: il piano di lavoro" stays: it introduces an apposition.

## 3. Reference paragraph

The voice to aim for in a design or reference page:

> Quando un servizio riceve più richieste di quante riesca a smaltire, conviene rifiutarne una parte subito invece di accodarle tutte. Una coda che cresce senza limiti non salva le richieste in eccesso, si limita a rimandarne il fallimento e nel frattempo rallenta anche quelle che sarebbero andate a buon fine. Per questo il gateway applica un rate limit per client, calcolato su una finestra scorrevole di sessanta secondi. Superata la soglia, risponde con 429 e indica nell'header `Retry-After` quanto attendere. Il valore di default risulta adeguato nella maggior parte dei casi; se tuttavia si integra un sistema batch che genera picchi brevi e intensi, è possibile alzarlo dal file di configurazione senza riavviare il processo.

Note the subordinate clauses, the dropped subject after the second sentence,
the _si_ impersonal, the semicolon, the jargon (_rate limit_, _header_,
_default_), and the absence of colon hinges, dashes, triplets and stock
openers.
