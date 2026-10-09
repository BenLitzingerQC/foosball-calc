# Foosball Elo Rechner

**→ [benlitzingerqc.github.io/foosball-calc](https://benlitzingerqc.github.io/foosball-calc/)**

Statische Seite zum Nachrechnen der Elo-Wertung des Tischkicker-Slackbots
([`Quantco/elo-slackbot`](https://github.com/Quantco/elo-slackbot)), gesteuert über
ein Menü mit drei Ansichten:

| Ansicht | Zweck |
| --- | --- |
| **Spiel simulieren** | Aktuelle Elo der Spieler und ein Ergebnis eintragen, Elo-Änderung pro Spieler ablesen. Beliebige Teamgrössen (1 v 1, 2 v 2, 1 v 2 …). |
| **Spiele zusammenfassen** | Mehrere gespielte Spiele eingeben und das Einzelergebnis suchen, dessen Elo-Änderung der Summe aller Spiele am nächsten kommt. |
| **Formel** | Rechenweg und Konstanten des Bots. |

## Starten

```bash
pixi run serve     # http://localhost:8000
pixi run test      # Tests der Elo-Logik
pixi run build     # dist/foosball-calc.html, alles in einer Datei
```

Lokal braucht die Seite einen Server: `assets/elo.js` wird als ES-Modul geladen, und
Browser blocken Modul-Imports über `file://`.

## Am Handy

Die Seite ist für Handybreite gebaut (ein Layout ab 320 px, daumentaugliche
Trefferflächen, 16 px Schrift in Eingabefeldern, damit iOS beim Fokussieren nicht
zoomt). Auf schmalen Bildschirmen entfallen nachrangige Tabellenspalten.

Gehostet lässt sich die Seite über „Zum Home-Bildschirm hinzufügen" wie eine App
starten: `manifest.webmanifest` liefert Name und Icon, `sw.js` macht sie nach dem
ersten Besuch offline nutzbar (stale-while-revalidate &ndash; es erscheint immer
sofort der gecachte Stand, die neue Version wird im Hintergrund geholt und beim
nächsten Start aktiv). Beim Ändern von Dateien die Konstante `CACHE` in `sw.js`
hochzählen.

Ohne Hosting hilft `pixi run build`: `dist/foosball-calc.html` enthält HTML, CSS,
JavaScript und Icon in einer Datei (~40 kB, keine externen Verweise) und lässt sich
per AirDrop oder Cloud-Ordner weitergeben und direkt öffnen. Service Worker und
Manifest greifen dort nicht &ndash; die Datei ist ohnehin schon vollständig lokal.

## Aufbau

```
index.html             Markup und Menü
assets/elo.js          Elo-Logik, reine Funktionen, ohne DOM
assets/app.js          Formulare, Menü, Ergebnisdarstellung
assets/style.css       Styles (hell und dunkel, Handy-Breakpoint bei 640 px)
assets/icon.svg        Icon, Quelle für die PNG-Grössen
manifest.webmanifest   Name und Icons für den Home-Bildschirm
sw.js                  Service Worker für den Offline-Betrieb
build.mjs              bündelt alles in eine HTML-Datei
tests/elo.test.mjs     Tests gegen Referenzwerte aus dem Original
tests/fixtures/        Referenzwerte, erzeugt mit dem echten Python-Code
```

Keine Laufzeit-Abhängigkeiten, kein Framework. Pixi liefert nur Python für den
lokalen Server und Node für Tests und Build.

## Korrektheit

`assets/elo.js` ist eine Portierung von `FoosballEloRankingSystem` aus
`elo_slackbot/ranking/foosball_ranking_system.py`. `tests/fixtures/reference.json`
enthält Elo-Änderungen, Endwertungen und Spielzähler, die direkt mit dieser
Python-Klasse erzeugt wurden &ndash; über sechs Szenarien (1 v 1, 2 v 2, 1 v 2,
Serien, Platzierungsphase). Die Tests vergleichen die JS-Portierung auf `1e-9`
dagegen.

## Wie der Bot rechnet

1. **Team-Wertung** &ndash; logarithmisches Mittel, `R = 500 · log₁₀(mittel(10^(rᵢ/500)))`.
   Ein starker Spieler zieht die Team-Wertung über den Durchschnitt.
2. **Erwartete Punktquote** &ndash; `E = 1 / (1 + 10^((R_B − R_A)/500))`.
   500 Elo Differenz heisst „zehnmal so stark“, also `10/11` der Punkte.
3. **Tatsächliche Punktquote** &ndash; `S = Punkte_A / (Punkte_A + Punkte_B)`.
   Gewertet wird das Punktverhältnis, nicht Sieg oder Niederlage.
4. **Rohe Änderung** &ndash; `Δ = 10 · Gesamtpunkte · (S − E)`.
5. **Aufteilung** &ndash; `Δ / Teamgrösse` pro Spieler, Verliererteam mit umgekehrtem
   Vorzeichen, plus `+0,5` Teilnahme-Bonus für jeden.
6. **Platzierungsphase** &ndash; unter 5 Spielen gilt eine Wertung als unfertig. Ist
   jemand in dieser Phase, werden die Änderungen aller *etablierten* Spieler mit
   `min(Spiele/5)` gedämpft. Ein 2-v-2-Spiel zählt pro Spieler als halbes Spiel.

Der Platzierungsmodus ist in der UI standardmässig aus; dann gelten alle Spieler als
etabliert. Mit der Checkbox erscheint pro Spieler ein Feld für die Anzahl Spiele.

## Zur Zusammenfassung mehrerer Spiele

Gesucht wird das Ergebnis `(x : y)`, dessen Elo-Änderungen den Zielwerten am
nächsten kommen; Zielwert ist die aufsummierte Änderung aller eingegebenen Spiele,
nacheinander gewertet. Bewertet wird der RMSE über alle Spieler, der Suchraum lässt
sich auf „Sieger hat genau N Punkte“ einschränken.

Eine exakte Übereinstimmung ist unmöglich: Der Teilnahme-Bonus fällt pro Eintrag an,
nicht pro gespieltem Spiel. Drei Spiele bringen jedem `3 × 0,5 = 1,5` Elo geschenkt,
ein einzelner Eintrag nur `0,5`. Diese Differenz von `(n − 1) · 0,5` trifft alle
Spieler gleich und lässt sich über das Ergebnis nicht ausgleichen &ndash; sie wird im
Ergebnis separat ausgewiesen. Der sportliche Teil der Änderung wird dagegen in der
Regel sehr genau getroffen.

## Referenzwerte neu erzeugen

`tests/fixtures/reference.json` ist eingecheckt, damit die Tests ohne Zugriff auf das
Bot-Repository laufen. Zum Neuerzeugen braucht es eine Arbeitskopie von
`Quantco/elo-slackbot` und eine Umgebung mit `numpy`, `pydantic` und `sqlalchemy`
(nicht Teil dieser Pixi-Umgebung):

```bash
ELO_SLACKBOT_PATH=/pfad/zu/elo-slackbot \
    python tests/fixtures/generate_reference.py > tests/fixtures/reference.json
```
