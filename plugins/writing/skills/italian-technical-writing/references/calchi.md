<!-- markdownlint-disable MD013 -->

# Calchi, falsi amici e gergo

Catalogue of the phrases that make Italian technical text sound translated,
with what an Italian team would write instead. Grouped by why the phrase is
wrong, because the reason is what lets you handle variants that aren't listed.

## Contents

1. Stock phrases and fillers
2. Verbs and adjectives used as English calques
3. False friends common in IT
4. Over-Italianised jargon (translate less)
5. Personification and colloquial images
6. Glosses
7. Everyday words where a technical one exists
8. Overused verbs

## 1. Stock phrases and fillers

They announce a sentence instead of saying it. Italian technical prose states
the fact.

| Calco                                               | Perché suona tradotto         | Alternativa                                                |
| --------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| È importante notare che…                            | "It's important to note that" | elimina e scrivi il fatto                                  |
| Vale la pena sottolineare/menzionare                | "It's worth noting"           | elimina                                                    |
| svolge un ruolo cruciale/chiave                     | "plays a crucial role"        | di' cosa fa: "gestisce", "decide", "blocca"                |
| al fine di                                          | pesante, burocratico          | per; così da (conseguenza)                                 |
| nel panorama attuale / nel mondo di oggi            | scene-setting da AI           | elimina, parti dal soggetto                                |
| in termini di                                       | "in terms of"                 | per, quanto a, oppure riformula                            |
| senza soluzione di continuità                       | "seamless"                    | senza interruzioni, oppure descrivi cosa non si interrompe |
| fa senso                                            | "makes sense"                 | ha senso                                                   |
| In altre parole, …                                  | riformulazione inutile        | tieni la formulazione più chiara                           |
| Che tu sia X o Y, …                                 | "Whether you're X or Y"       | rivolgiti a un lettore, o elimina                          |
| Immergiamoci / Esploriamo / Scopriamo insieme       | tono da tutorial chatbot      | elimina                                                    |
| all'avanguardia, di ultima generazione, a 360 gradi | marketing                     | elimina o dai la proprietà misurabile                      |
| In conclusione / In sintesi (a inizio paragrafo)    | ritmo da AI                   | elimina; l'ordine dei paragrafi basta                      |

## 2. Verbs and adjectives used as English calques

| Calco                                 | Problema                                     | Alternativa                                                                                         |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| sfruttare (leverage)                  | in italiano ha una sfumatura di approfittare | usare, utilizzare, basarsi su; "sfruttare" solo per una vulnerabilità o una risorsa sottoutilizzata |
| robusto (robust)                      | aggettivo vuoto                              | affidabile, tollerante ai guasti, che regge il carico; meglio ancora il dato (p99, retry, failover) |
| indirizzare un problema (address)     | calco puro                                   | affrontare, risolvere, gestire                                                                      |
| realizzare che (realize)              | in italiano significa "costruire"            | rendersi conto che, accorgersi che                                                                  |
| assumere che (assume)                 | accettabile, ma spesso è meglio              | supporre, dare per scontato                                                                         |
| applicare per (apply for)             | calco                                        | richiedere, fare domanda                                                                            |
| essere in carica di (be in charge of) | calco                                        | essere responsabile di, occuparsi di                                                                |

## 3. False friends common in IT

| Parola        | Significato in italiano                  | Per dire l'inglese…                                                         |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| consistente   | sostanzioso, cospicuo                    | consistent → coerente; per "eventual consistency" lascia il termine inglese |
| eventualmente | se necessario, nel caso                  | eventually → alla fine, prima o poi                                         |
| attualmente   | in questo momento (corretto)             | actually → in realtà, di fatto                                              |
| supportare    | sostenere                                | support (una versione, un formato) → è compatibile con, gestisce, accetta   |
| implementare  | va bene per codice e funzionalità        | implement a policy → applicare, adottare                                    |
| performante   | diffuso nel gergo aziendale, accettabile | in testi più curati: efficiente, veloce, con buone prestazioni              |
| rilasciare    | corretto per una release                 | release a lock/resource → liberare, rilasciare (ok)                         |
| libreria      | corretto nel gergo (library)             | —                                                                           |
| argomento     | corretto per una funzione                | —                                                                           |

## 4. Over-Italianised jargon: translate less

Italian IT teams use English terms for many concepts. Translating them sounds
like an outsider wrote the text. Keep the English term:

| Non scrivere                                           | Scrivi                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| situazione attuale, stato attuale (di un'applicazione) | as-is ("l'applicazione as-is")                                |
| stato di arrivo, stato finale desiderato               | to-be, architettura target                                    |
| passaggi di rete                                       | hop di rete                                                   |
| chi possiede quali dati, proprietà dei dati (titolo)   | data ownership                                                |
| ramo                                                   | branch                                                        |
| impegno, commissione (commit)                          | commit                                                        |
| richiesta di unione                                    | pull request, merge request                                   |
| distribuzione (deploy)                                 | deploy, rilascio (solo per release)                           |
| soluzione (piattaforme low-code, Visual Studio)        | solution                                                      |
| analisi delle motivazioni                              | razionali                                                     |
| ospitata                                               | hostata (informale), ospitata (formale): entrambe accettabili |

Translate what Italian teams really say in Italian: file di configurazione,
variabile d'ambiente, richiesta/risposta, intestazione (or header), dipendenza,
caricamento, sola lettura, ambiente di produzione (or PROD), sviluppo.

When unsure, look at how the existing project or thread says it and copy that.

## 5. Personification and colloquial images

English lets systems and documents act and know. Italian technical prose
doesn't, and colloquial images read as translated.

| Prima                         | Dopo                                                |
| ----------------------------- | --------------------------------------------------- |
| i requisiti chiedono          | nei requisiti viene richiesto                       |
| il documento dice             | secondo il documento, nel documento è indicato      |
| il sistema X non ne sa nulla  | elimina, oppure: il sistema X non ne ha visibilità  |
| ogni progetto ha un gemello   | ogni progetto ha una controparte                    |
| dire agli utenti cosa succede | dare agli utenti visibilità su cosa stia succedendo |
| il servizio vuole un token    | il servizio richiede un token                       |

## 6. Glosses

Don't explain terms the team already knows (on-premises, cluster, app low-code,
workspace, endpoint). If an internal acronym needs it, use a parenthesis:

- Prima: "un'**app low-code**, cioè un'applicazione costruita con un editor visuale, che usa…"
- Dopo: "un'app low-code (applicazione costruita con un editor visuale), che usa…"
- Prima: "L'azienda lo usa on-premises, cioè installato sui propri server e non come servizio cloud."
- Dopo: "Si tratta di una soluzione on-premises."

## 7. Everyday words where a technical one exists

| Prima                                  | Dopo                                                    |
| -------------------------------------- | ------------------------------------------------------- |
| novità (in a running text)             | aggiornamenti, nuovi dati, nuovi eventi                 |
| in orario di punta, nelle ore di punta | durante orari di traffico elevato, nei picchi di carico |
| portare a throttling / a errori        | far scattare un throttling, causare errori              |
| fino a N secondi di ritardo            | N secondi di ritardo massimo                            |
| errori 503                             | errori di tipo `503 Slow Down`                          |
| catena standard delle credenziali      | credential provider chain                               |
| si aggiunge `--flag`                   | deve essere aggiunta l'opzione `--flag`                 |

## 8. Overused verbs

_Fornire_ and _garantire_ appear on every line of AI Italian. Use them only
when they're the right word.

- fornire → dare, offrire, restituire (un'API), esporre (un endpoint), mettere a disposizione
- garantire → only for real guarantees (SLA, transazionalità); otherwise assicurare, permettere, fare in modo che
- permettere di → natural to introduce what a tool does ("Permette di copiare…"); don't strip it
