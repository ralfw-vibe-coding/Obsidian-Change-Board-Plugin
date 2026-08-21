# Change Board

Ein Obsidian-Plugin, das Veränderungsaufgaben als Notizen führt und sie als Backlog
und Kanban-Board anzeigt.

## Idee

Drei Notizarten, unterschieden über das Frontmatter-Feld `typ`:

| Notizart      | Ordner (Standard)          | wofür                                                   |
| ------------- | -------------------------- | ------------------------------------------------------- |
| `leitstern`   | `Change Board/Leitsterne`  | Die Maßstäbe, an denen Entscheidungen gemessen werden.  |
| `thema`       | `Change Board/Themen`      | Die Gruppen, in denen der Backlog sortiert ist.         |
| `aufgabe`     | `Change Board/Aufgaben`    | Die Karten.                                             |

Der Dateiname ist jeweils der Titel. Der Beschreibungstext steht im Notiz-Body, damit
er sich wie jede andere Notiz schreiben lässt.

### Aufgabe

```yaml
---
typ: aufgabe
id: A1-4                       # stabile Referenz, unabhängig vom Dateinamen
status: backlog                # backlog | vereinbart | angefangen | blockiert | fertig | verworfen
art: massnahme                 # sofortmassnahme | massnahme | ungeloest
thema: "[[IT-Infrastruktur & Backup]]"
leitsterne:
  - "[[Alles hat einen Ort]]"
reihenfolge: 4                 # Position innerhalb des Themas
kennung: a                     # optional: Kurzzeichen auf der Karte
wirkung: …                     # optional
aufwand: …                     # optional
problem: …                     # optional: die Feststellung, aus der die Aufgabe entstand
---
Beschreibungstext.
```

`status` ist das einzige Feld, das das Board selbst schreibt — beim Verschieben einer Karte.

### Thema

```yaml
---
typ: thema
id: A1
reihenfolge: 1
kritisch: true                 # optional, derzeit nur Information
hervorgehoben: true            # optional: Gruppe wird betont und beim ersten Öffnen aufgeklappt
kennzeichen: A1                # Kürzel links im Gruppenkopf
badge: zuerst anpacken         # optional
---
```

### Thema

Frontmatter: `id`, `reihenfolge`, `kennzeichen` (Kürzel im Gruppenkopf) und optional
`kritisch`, `hervorgehoben`, `badge`. Themen legt man von Hand an — dafür gibt es
im Board bislang kein `+`.

### Leitstern

Frontmatter: `nummer`, `kurzname`, `leitsatz`, `wurzelproblem`, `schluesselproblem`.
Der Body ist in H2-Abschnitte gegliedert, die das Detailfeld füllen:
`Worum es geht`, `Wenn`, `Im Weg steht`, `Woran wir es gesehen haben`,
`Warum das so ist`, `Merksatz`, `Richtungen`, `Aufgelöst, wenn`.

## Installation

Über [BRAT](https://github.com/TfTHacker/obsidian42-brat): in BRAT
*Add beta plugin* wählen und dieses Repository angeben. BRAT holt sich
`main.js`, `manifest.json` und `styles.css` aus dem jeweils neuesten Release
und hält das Plugin aktuell.

Von Hand geht es genauso: die drei Dateien aus einem Release nach
`<vault>/.obsidian/plugins/change-board/` legen und Obsidian neu laden.

## Benutzung

Ribbon-Symbol oder Befehl „Change Board öffnen". Ordner, Board-Titel und Tagesfokus
lassen sich in den Plugin-Einstellungen ändern.

**Aufgaben und Leitsterne anlegen** — ein `+` erscheint, wenn die Maus über einer
Themengruppe oder einer Board-Spalte steht; neben der Leitstern-Überschrift steht es
dauerhaft. Der Klick legt die Notiz mit vorbereitetem Frontmatter an und öffnet sie,
den Titel gleich zum Umbenennen markiert. Ausgefüllt wird sie im normalen
Markdown-Editor — das Board bringt dafür keinen eigenen mit.

Was schon feststeht, ist vorbelegt: eine Aufgabe aus einer Themengruppe bekommt dieses
Thema, eine aus einer Board-Spalte deren Status. Ein neuer Leitstern bringt das Gerüst
aller acht Abschnitte mit, damit klar ist, was hineingehört.

**Löschen** — Rechtsklick auf eine Zeile, eine Karte oder eine Leitstern-Kachel. Nach
einer Rückfrage wandert die Notiz in den Papierkorb, den Obsidian eingestellt hat.
Beim Leitstern nennt die Rückfrage, wie viele Aufgaben auf ihn verweisen.

**Zoom** — oben rechts, `[− 100 % +]` in Zehnerschritten zwischen 50 % und 200 %.
Ein Klick auf den Wert setzt auf 100 % zurück. Die Stufe gilt pro Vault, nicht pro Notiz.

Die Versionsnummer steht rechts daneben.

**Tagesfokus** — jeden Tag steht ein anderer Leitstern im Fokus. Die Auswahl bleibt
innerhalb eines Tages stehen, jeder Leitstern kommt einmal an die Reihe, bevor sich
einer wiederholt, und derselbe steht nie an zwei Tagen hintereinander. Der Stand liegt
in `data.json`; abschalten lässt sich das in den Einstellungen.

## Entwicklung

Kein Build, keine Abhängigkeiten: `main.js` ist der Quellcode und wird von Obsidian
direkt geladen. Nach einer Änderung genügt in Obsidian „Plugin neu laden" (oder
Fenster neu laden mit `Cmd+R`).

Zum Entwickeln das Repo als Plugin in ein Vault hängen:

```bash
ln -sfn "$PWD" "<pfad zum vault>/.obsidian/plugins/change-board"
```

### Prüfen

```bash
node tools/test/smoke.js [pfad zum vault]
```

Rendert die Ansicht gegen ein Vault mit Board-Notizen und prüft Anmeldung bei Obsidian,
Struktur, Leitstern-Detail, Filter, Statuswechsel, Board, Zoom und die Rotation
des Tagesfokus. Dafür gibt es unter `tools/test/` ein kleines DOM und einen
Obsidian-Ersatz — beides ohne fremde Pakete, damit das Repo abhängigkeitsfrei bleibt.

## Veröffentlichen

Ein Release entsteht durch einen Tag; alles Weitere erledigt
`.github/workflows/release.yml` auf GitHub:

```bash
git tag 0.1.0
git push origin 0.1.0
```

Der Tag muss **genau der Version in `manifest.json` entsprechen** und ohne `v`
davor stehen — danach sucht BRAT das Release. Weicht er ab, bricht der Workflow
mit einer entsprechenden Meldung ab, statt ein Release zu erzeugen, das niemand
findet. Vor dem Taggen also die Version in `manifest.json` erhöhen, committen,
und erst den Commit taggen, der auch den Workflow enthält.

## Dateien

| Datei                       | wofür                                              |
| --------------------------- | -------------------------------------------------- |
| `main.js`                   | das Plugin                                         |
| `styles.css`                | das Aussehen                                       |
| `manifest.json`             | Kenndaten für Obsidian                             |
| `tools/test/`               | Rauchtest, Mini-DOM, Obsidian-Ersatz                |
| `.github/workflows/`        | veröffentlicht Releases beim Schieben eines Tags    |
