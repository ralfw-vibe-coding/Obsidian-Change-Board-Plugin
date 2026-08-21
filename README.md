# Change Board

Ein Obsidian-Plugin, das Veränderungsaufgaben als Notizen führt und sie als Backlog
und Kanban-Board anzeigt. Vorlage ist `requirements/changeboard.html`.

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

### Leitstern

Frontmatter: `nummer`, `kurzname`, `leitsatz`, `wurzelproblem`, `schluesselproblem`.
Der Body ist in H2-Abschnitte gegliedert, die das Detailfeld füllen:
`Worum es geht`, `Wenn`, `Im Weg steht`, `Woran wir es gesehen haben`,
`Warum das so ist`, `Merksatz`, `Richtungen`, `Aufgelöst, wenn`.

## Benutzung

Ribbon-Symbol oder Befehl „Change Board öffnen". Ordner, Board-Titel und Tagesfokus
lassen sich in den Plugin-Einstellungen ändern.

**Zoom** — oben rechts, `[− 100 % +]` in Zehnerschritten zwischen 50 % und 200 %.
Ein Klick auf den Wert setzt auf 100 % zurück. Die Stufe gilt pro Vault, nicht pro Notiz.

**Tagesfokus** — jeden Tag steht ein anderer Leitstern im Fokus. Die Auswahl bleibt
innerhalb eines Tages stehen, jeder Leitstern kommt einmal an die Reihe, bevor sich
einer wiederholt, und derselbe steht nie an zwei Tagen hintereinander. Der Stand liegt
in `data.json`; abschalten lässt sich das in den Einstellungen.

## Entwicklung

Kein Build, keine Abhängigkeiten: `main.js` ist der Quellcode und wird von Obsidian
direkt geladen. Nach einer Änderung genügt in Obsidian „Plugin neu laden" (oder
Fenster neu laden mit `Cmd+R`).

Einbindung ins Test-Vault:

```bash
ln -sfn "$PWD" "../Change Board Test Vault/.obsidian/plugins/change-board"
```

### Notizen erzeugen

Der Bestand im Test-Vault wurde einmalig aus einer HTML-Vorlage erzeugt. Das
Werkzeug dafür liegt bei der Vorlage in `requirements/generator/`, nicht hier —
es wird für den Betrieb des Plugins nicht gebraucht.

### Prüfen

```bash
node tools/test/smoke.js
```

Rendert die Ansicht gegen das Test-Vault und prüft Anmeldung bei Obsidian,
Struktur, Leitstern-Detail, Filter, Statuswechsel, Board, Zoom und die Rotation
des Tagesfokus. Dafür gibt es unter `tools/test/` ein kleines DOM und einen
Obsidian-Ersatz — beides ohne fremde Pakete, damit das Repo abhängigkeitsfrei bleibt.

## Dateien

| Datei                       | wofür                                              |
| --------------------------- | -------------------------------------------------- |
| `main.js`                   | das Plugin                                         |
| `styles.css`                | das Aussehen                                       |
| `manifest.json`             | Kenndaten für Obsidian                             |
| `tools/test/`               | Rauchtest, Mini-DOM, Obsidian-Ersatz                |
