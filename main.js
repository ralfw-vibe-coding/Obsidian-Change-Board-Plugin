"use strict";

/*
 * Change Board — Veränderungsaufgaben als Notizen führen und als Board anzeigen.
 *
 * Diese Datei ist der Quellcode und wird von Obsidian direkt geladen; es gibt
 * keinen Build-Schritt und keine Abhängigkeiten außer der Obsidian-API.
 */

const {
  Plugin, ItemView, PluginSettingTab, Setting, MarkdownRenderer, Menu, Modal, Notice,
  TFile, TFolder, addIcon, debounce, normalizePath,
} = require("obsidian");

const CHANGE_BOARD_VIEW = "change-board-view";

/* ========================================================== Modell & Konstanten */

/** Die Spalten des Boards. "backlog" ist keine Spalte, sondern der Vorrat davor. */
const SPALTEN = [
  { key: "vereinbart", name: "Vereinbart", icon: "▷", untertitel: "Das machen wir.", farbe: "var(--color-yellow)" },
  { key: "angefangen", name: "Angefangen", icon: "▶", untertitel: "Läuft gerade.", farbe: "var(--interactive-accent)" },
  { key: "blockiert", name: "Blockiert", icon: "⏸", untertitel: "Wartet auf etwas.", farbe: "var(--color-red)" },
  { key: "fertig", name: "Fertig", icon: "✓", untertitel: "Erledigt.", farbe: "var(--color-green)" },
  { key: "verworfen", name: "Verworfen", icon: "✕", untertitel: "Machen wir bewusst nicht.", farbe: "var(--text-muted)" },
];

const ALLE_STATUS = ["backlog"].concat(SPALTEN.map((s) => s.key));

const ARTEN = {
  sofortmassnahme: { label: "Sofortmaßnahme", icon: "★", klasse: "cb-art-sofort" },
  massnahme: { label: "Maßnahme", icon: "◐", klasse: "cb-art-massnahme" },
  ungeloest: { label: "Ungelöst", icon: "●", klasse: "cb-art-ungeloest" },
};

const ALLE_ARTEN = Object.keys(ARTEN);

const ZOOM = { min: 50, max: 200, schritt: 10, normal: 100 };

/** Die Abschnitte, die eine Leitstern-Notiz ausfüllt. Gerüst für neue Leitsterne. */
const LEITSTERN_ABSCHNITTE = [
  "Worum es geht",
  "Wenn",
  "Im Weg steht",
  "Woran wir es gesehen haben",
  "Warum das so ist",
  "Merksatz",
  "Richtungen",
  "Aufgelöst, wenn",
];

const STANDARD_EINSTELLUNGEN = {
  boardTitel: "",
  boardUntertitel: "Veränderungsboard",
  leitsterneOrdner: "Change Board/Leitsterne",
  themenOrdner: "Change Board/Themen",
  aufgabenOrdner: "Change Board/Aufgaben",
  leitsterneUeberschrift: "Unsere Leitsterne",
  tagesfokus: true,
  // Board-Notizen werden über das Board gepflegt; das Eigenschaftenfeld im Editor
  // lädt sonst dazu ein, dieselben Felder zweimal zu setzen.
  eigenschaftenVerbergen: true,
  // Merkt sich, für welchen Tag welcher Leitstern im Fokus stand und wer im
  // laufenden Durchgang schon dran war.
  fokus: { tag: "", leitstern: null, verbraucht: [] },
  ansicht: {
    tab: "backlog",
    arten: ALLE_ARTEN.slice(),
    leitsterne: [],
    suche: "",
    offeneThemen: [],
    // Beim ersten Öffnen werden hervorgehobene Themen aufgeklappt, danach entscheidet der Nutzer.
    themenInitialisiert: false,
    offenerLeitstern: null,
    zoom: 100,
  },
};

// addIcon erwartet nur den Inhalt eines SVG mit viewBox "0 0 100 100" —
// kein umschließendes <svg>, sonst wird nichts gezeichnet.
const BOARD_ICON =
  '<rect x="10" y="14" width="22" height="62" rx="4" fill="none" stroke="currentColor" stroke-width="8"/>' +
  '<rect x="39" y="14" width="22" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="8"/>' +
  '<rect x="68" y="14" width="22" height="30" rx="4" fill="none" stroke="currentColor" stroke-width="8"/>';

/* ================================================================== Hilfsfunktionen */

/** Frontmatter abschneiden, den reinen Notiztext zurückgeben. */
function körper(inhalt) {
  return inhalt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** Aus "[[Ziel|Alias]]" das Ziel lösen; alles andere unverändert zurückgeben. */
function linkziel(wert) {
  if (typeof wert !== "string") return "";
  const treffer = wert.match(/^\s*\[\[([^\]|#]+)/);
  return (treffer ? treffer[1] : wert).trim();
}

function linkliste(wert) {
  if (Array.isArray(wert)) return wert.map(linkziel).filter(Boolean);
  const einzeln = linkziel(wert);
  return einzeln ? [einzeln] : [];
}

function text(wert) {
  if (typeof wert === "string") return wert;
  return wert === undefined || wert === null ? "" : String(wert);
}

function zahl(wert, ersatz) {
  const n = typeof wert === "number" ? wert : Number.parseFloat(String(wert === undefined || wert === null ? "" : wert));
  return Number.isFinite(n) ? n : ersatz;
}

/** Den Body einer Leitstern-Notiz an den H2-Überschriften zerlegen. */
function abschnitte(körperText) {
  const map = new Map();
  const teile = körperText.split(/^##\s+(.+?)\s*$/m);
  for (let i = 1; i < teile.length; i += 2) map.set(teile[i].trim(), teile[i + 1].trim());
  return map;
}

/** Kalendertag als YYYY-MM-DD in lokaler Zeit. */
function heutigerTag(jetzt) {
  const d = jetzt || new Date();
  const zweistellig = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`;
}

/**
 * Wählt den Leitstern des Tages.
 *
 * Innerhalb eines Tages bleibt die Wahl stehen; an jedem neuen Tag rückt ein anderer
 * nach. Jeder Leitstern kommt einmal an die Reihe, bevor sich einer wiederholt, und
 * derselbe steht nie an zwei Tagen hintereinander — auch nicht am Übergang zwischen
 * zwei Durchgängen.
 */
function fokusBestimmen(titel, zustand, tag, wuerfeln) {
  const vorhanden = new Set(titel);
  const alt = zustand || {};
  const neu = {
    tag: alt.tag || "",
    // Gelöschte oder umbenannte Leitsterne fallen aus dem Gedächtnis.
    leitstern: vorhanden.has(alt.leitstern) ? alt.leitstern : null,
    verbraucht: (alt.verbraucht || []).filter((t) => vorhanden.has(t)),
  };

  if (titel.length === 0) return { leitstern: null, zustand: neu };
  if (neu.tag === tag && neu.leitstern) return { leitstern: neu.leitstern, zustand: neu };

  let kandidaten = titel.filter((t) => !neu.verbraucht.includes(t) && t !== neu.leitstern);
  if (kandidaten.length === 0) {
    neu.verbraucht = [];                                    // Durchgang zu Ende, Topf neu füllen
    kandidaten = titel.filter((t) => t !== neu.leitstern);   // aber nicht mit demselben beginnen
  }
  if (kandidaten.length === 0) kandidaten = titel.slice();   // es gibt nur einen Leitstern

  const gewaehlt = kandidaten[Math.floor((wuerfeln || Math.random)() * kandidaten.length)];
  neu.leitstern = gewaehlt;
  neu.verbraucht.push(gewaehlt);
  neu.tag = tag;
  return { leitstern: gewaehlt, zustand: neu };
}

/** Einen Wert so ausgeben, dass YAML ihn wieder als Zeichenkette liest. */
function yamlWert(wert) {
  if (typeof wert === "number" || typeof wert === "boolean") return String(wert);
  const s = String(wert);
  const heikel =
    s === "" ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /:\s|\s#/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[-+]?[0-9.]+$/.test(s);
  return heikel ? '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' : s;
}

/** Frontmatter aus einem einfachen Objekt bauen; leere Felder bleiben als Platzhalter stehen. */
function frontmatter(felder) {
  const zeilen = ["---"];
  for (const [schluessel, wert] of Object.entries(felder)) {
    if (wert === undefined) continue;
    if (Array.isArray(wert)) {
      zeilen.push(`${schluessel}:`);
      wert.forEach((e) => zeilen.push(`  - ${yamlWert(e)}`));
    } else if (wert === null || wert === "") {
      zeilen.push(`${schluessel}:`);
    } else {
      zeilen.push(`${schluessel}: ${yamlWert(wert)}`);
    }
  }
  zeilen.push("---");
  return zeilen.join("\n");
}

/** Ein Element aus einer Liste entfernen oder hinzufügen. */
function umschalten(liste, wert) {
  const i = liste.indexOf(wert);
  if (i >= 0) liste.splice(i, 1);
  else liste.push(wert);
}

/* ======================================================================= Datenquelle */

/**
 * Liest die Notizen der konfigurierten Ordner und setzt daraus das Boardmodell zusammen.
 * Bei jeder Änderung im Vault wird komplett neu gelesen — bei einigen hundert Notizen
 * ist das aus dem Obsidian-Cache heraus günstiger als inkrementelle Pflege.
 */
class Datenquelle {
  constructor(app, einstellungen) {
    this.app = app;
    this.einstellungen = einstellungen;
  }

  /** Gehört die Datei zu einem der Board-Ordner? */
  betrifftBoard(pfad) {
    const e = this.einstellungen;
    return [e.leitsterneOrdner, e.themenOrdner, e.aufgabenOrdner].some((o) => {
      const norm = normalizePath(o);
      return pfad === norm || pfad.startsWith(norm + "/");
    });
  }

  dateienIn(ordner) {
    const eintrag = this.app.vault.getAbstractFileByPath(normalizePath(ordner));
    if (!(eintrag instanceof TFolder)) return [];
    const gefunden = [];
    const durchlaufen = (f) => {
      for (const kind of f.children) {
        if (kind instanceof TFolder) durchlaufen(kind);
        else if (kind instanceof TFile && kind.extension === "md") gefunden.push(kind);
      }
    };
    durchlaufen(eintrag);
    return gefunden;
  }

  fm(datei) {
    const cache = this.app.metadataCache.getFileCache(datei);
    return (cache && cache.frontmatter) || {};
  }

  async laden() {
    const e = this.einstellungen;

    const leitsterne = [];
    for (const datei of this.dateienIn(e.leitsterneOrdner)) {
      const fm = this.fm(datei);
      const inhalt = körper(await this.app.vault.cachedRead(datei));
      leitsterne.push({
        datei,
        titel: datei.basename,
        nummer: zahl(fm.nummer, leitsterne.length + 1),
        kurzname: text(fm.kurzname) || datei.basename,
        leitsatz: text(fm.leitsatz),
        wurzelproblem: text(fm.wurzelproblem),
        schluesselproblem: fm.schluesselproblem === true,
        abschnitte: abschnitte(inhalt),
      });
    }
    leitsterne.sort((a, b) => a.nummer - b.nummer);

    const themen = this.dateienIn(e.themenOrdner).map((datei, i) => {
      const fm = this.fm(datei);
      return {
        datei,
        titel: datei.basename,
        id: text(fm.id) || datei.basename,
        reihenfolge: zahl(fm.reihenfolge, i),
        kritisch: fm.kritisch === true,
        hervorgehoben: fm.hervorgehoben === true,
        kennzeichen: text(fm.kennzeichen),
        badge: text(fm.badge),
      };
    });
    themen.sort((a, b) => a.reihenfolge - b.reihenfolge || a.titel.localeCompare(b.titel, "de"));

    const aufgaben = [];
    for (const datei of this.dateienIn(e.aufgabenOrdner)) {
      const fm = this.fm(datei);
      if (text(fm.typ) && text(fm.typ) !== "aufgabe") continue;
      const status = text(fm.status).toLowerCase();
      const art = text(fm.art).toLowerCase();
      aufgaben.push({
        datei,
        titel: datei.basename,
        id: text(fm.id) || datei.path,
        status: ALLE_STATUS.includes(status) ? status : "backlog",
        art: ALLE_ARTEN.includes(art) ? art : "massnahme",
        beschreibung: körper(await this.app.vault.cachedRead(datei)),
        reihenfolge: zahl(fm.reihenfolge, aufgaben.length),
        themaLink: linkziel(fm.thema) || null,
        leitsternLinks: linkliste(fm.leitsterne),
        kennung: text(fm.kennung),
        wirkung: text(fm.wirkung),
        aufwand: text(fm.aufwand),
        problem: text(fm.problem),
      });
    }

    return { leitsterne, themen, aufgaben };
  }

  /** Wikilink-Ziel auf eine Notiz auflösen, ausgehend von der verweisenden Datei. */
  auflösen(ziel, quelle) {
    if (!ziel) return null;
    return this.app.metadataCache.getFirstLinkpathDest(ziel, quelle.path);
  }

  /** Status einer Aufgabe im Frontmatter ihrer Notiz setzen. */
  async statusSetzen(aufgabe, status) {
    await this.app.fileManager.processFrontMatter(aufgabe.datei, (fm) => {
      fm.status = status;
    });
  }

  /* ---- Notizen anlegen ---- */

  async ordnerSichern(pfad) {
    const norm = normalizePath(pfad);
    if (!this.app.vault.getAbstractFileByPath(norm)) await this.app.vault.createFolder(norm);
    return norm;
  }

  /** Einen freien Dateinamen im Ordner finden: "Neue Aufgabe", "Neue Aufgabe 2", … */
  freierPfad(ordner, wunsch) {
    let name = wunsch;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(`${ordner}/${name}.md`)) {
      n += 1;
      name = `${wunsch} ${n}`;
    }
    return `${ordner}/${name}.md`;
  }

  /**
   * Legt eine Aufgabennotiz an. Gefüllt wird nur, was das Board ohnehin weiß —
   * Titel und Beschreibung schreibt der Nutzer anschließend in Obsidian selbst.
   */
  async aufgabeAnlegen({ thema, status, reihenfolge }) {
    const ordner = await this.ordnerSichern(this.einstellungen.aufgabenOrdner);
    const pfad = this.freierPfad(ordner, "Neue Aufgabe");
    const kopf = frontmatter({
      typ: "aufgabe",
      status: status || "backlog",
      art: "massnahme",
      thema: thema ? `[[${thema.titel}]]` : null,
      leitsterne: null,
      reihenfolge: typeof reihenfolge === "number" ? reihenfolge : 0,
    });
    return this.app.vault.create(pfad, `${kopf}\n\n`);
  }

  /** Legt eine Leitstern-Notiz samt Abschnittsgerüst an. */
  async leitsternAnlegen(nummer) {
    const ordner = await this.ordnerSichern(this.einstellungen.leitsterneOrdner);
    const pfad = this.freierPfad(ordner, "Neuer Leitstern");
    const kopf = frontmatter({
      typ: "leitstern",
      nummer,
      kurzname: null,
      leitsatz: null,
      wurzelproblem: null,
    });
    const gerüst = LEITSTERN_ABSCHNITTE.map((h) => `## ${h}\n\n`).join("\n");
    return this.app.vault.create(pfad, `${kopf}\n\n${gerüst}`);
  }

  /** Ein Frontmatter-Feld setzen; ein leerer Wert entfernt es. */
  async feldSetzen(datei, feld, wert) {
    await this.app.fileManager.processFrontMatter(datei, (fm) => {
      if (wert === null || wert === undefined || wert === "") delete fm[feld];
      else fm[feld] = wert;
    });
  }

  /** Notiz in den Papierkorb legen — welchen, entscheidet Obsidians Einstellung. */
  async notizLoeschen(datei) {
    await this.app.fileManager.trashFile(datei);
  }
}

/**
 * Auswahlliste in einem Fenster — je nach Einstellung ein Wert oder mehrere.
 * Ab einer Handvoll Einträgen kommt ein Suchfeld dazu.
 */
class AuswahlModal extends Modal {
  constructor(app, { titel, eintraege, gewaehlt, mehrfach, beiAuswahl }) {
    super(app);
    this.titel = titel;
    this.eintraege = eintraege;
    this.gewaehlt = new Set(gewaehlt || []);
    this.mehrfach = mehrfach === true;
    this.beiAuswahl = beiAuswahl;
    this.suche = "";
  }

  onOpen() {
    this.titleEl.setText(this.titel);
    if (this.eintraege.length > 8) {
      const feld = this.contentEl.createEl("input", { cls: "cb-auswahl-suche", type: "search" });
      feld.setAttribute("placeholder", "Suchen …");
      feld.addEventListener("input", () => {
        this.suche = feld.value.trim().toLowerCase();
        this.listeZeichnen();
      });
    }
    this.listeEl = this.contentEl.createDiv({ cls: "cb-auswahl-liste" });
    this.listeZeichnen();

    if (this.mehrfach) {
      const knoepfe = this.contentEl.createDiv({ cls: "cb-modal-knoepfe" });
      const abbrechen = knoepfe.createEl("button", { text: "Abbrechen" });
      abbrechen.addEventListener("click", () => this.close());
      const uebernehmen = knoepfe.createEl("button", { cls: "mod-cta", text: "Übernehmen" });
      uebernehmen.addEventListener("click", () => {
        this.close();
        void this.beiAuswahl([...this.gewaehlt]);
      });
    }
  }

  listeZeichnen() {
    this.listeEl.empty();
    const sichtbar = this.eintraege.filter(
      (e) => !this.suche || e.beschriftung.toLowerCase().includes(this.suche)
    );
    if (sichtbar.length === 0) {
      this.listeEl.createDiv({ cls: "cb-auswahl-leer", text: "Nichts gefunden." });
      return;
    }
    for (const eintrag of sichtbar) {
      const aktiv = this.gewaehlt.has(eintrag.schluessel);
      const zeile = this.listeEl.createEl("button", { cls: "cb-auswahl-eintrag" });
      zeile.toggleClass("cb-auswahl-aktiv", aktiv);
      zeile.createSpan({ cls: "cb-auswahl-haken", text: aktiv ? "✓" : "" });
      zeile.createSpan({ cls: "cb-auswahl-text", text: eintrag.beschriftung });
      if (eintrag.hinweis) zeile.createSpan({ cls: "cb-auswahl-hinweis", text: eintrag.hinweis });
      zeile.addEventListener("click", () => {
        if (this.mehrfach) {
          if (aktiv) this.gewaehlt.delete(eintrag.schluessel);
          else this.gewaehlt.add(eintrag.schluessel);
          this.listeZeichnen();
        } else {
          this.close();
          void this.beiAuswahl(eintrag.schluessel);
        }
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Rückfrage vor dem Löschen. */
class LoeschModal extends Modal {
  constructor(app, titel, hinweis, beiBestaetigung) {
    super(app);
    this.titel = titel;
    this.hinweis = hinweis;
    this.beiBestaetigung = beiBestaetigung;
  }

  onOpen() {
    this.titleEl.setText("Notiz löschen");
    this.contentEl.createEl("p", { text: `„${this.titel}“ in den Papierkorb verschieben?` });
    if (this.hinweis) this.contentEl.createEl("p", { cls: "cb-modal-hinweis", text: this.hinweis });

    const knoepfe = this.contentEl.createDiv({ cls: "cb-modal-knoepfe" });
    const abbrechen = knoepfe.createEl("button", { text: "Abbrechen" });
    abbrechen.addEventListener("click", () => this.close());
    const loeschen = knoepfe.createEl("button", { cls: "mod-warning", text: "Löschen" });
    loeschen.addEventListener("click", () => {
      this.close();
      void this.beiBestaetigung();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ============================================================================ Ansicht */

class ChangeBoardView extends ItemView {
  constructor(leaf, plugin, quelle) {
    super(leaf);
    this.plugin = plugin;
    this.quelle = quelle;
    this.daten = { leitsterne: [], themen: [], aufgaben: [] };
    this.themaVonPfad = new Map();
    this.leitsternVonPfad = new Map();
    this.fokusLeitstern = null;
    this.laufendesLaden = null;
    this.aktualisieren = debounce(() => void this.datenLaden(), 250, true);
  }

  getViewType() {
    return CHANGE_BOARD_VIEW;
  }

  getDisplayText() {
    return this.plugin.einstellungen.boardTitel || this.app.vault.getName();
  }

  getIcon() {
    return "change-board";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("change-board");
    this.wurzel = this.contentEl.createDiv({ cls: "cb-wrap" });
    // Bleibt das Board über Mitternacht offen, rückt der Tagesfokus trotzdem weiter.
    this.registerInterval(
      setInterval(() => {
        if (this.plugin.einstellungen.fokus.tag !== heutigerTag()) void this.datenLaden();
      }, 30 * 60 * 1000)
    );
    await this.datenLaden();
  }

  async onClose() {
    this.contentEl.empty();
  }

  async datenLaden() {
    if (this.laufendesLaden) return this.laufendesLaden;
    this.laufendesLaden = (async () => {
      this.daten = await this.quelle.laden();
      this.themaVonPfad.clear();
      this.daten.themen.forEach((t) => this.themaVonPfad.set(t.datei.path, t));
      this.leitsternVonPfad.clear();
      this.daten.leitsterne.forEach((l) => this.leitsternVonPfad.set(l.datei.path, l));

      if (!this.ansicht.themenInitialisiert && this.daten.themen.length > 0) {
        this.ansicht.themenInitialisiert = true;
        this.ansicht.offeneThemen = this.daten.themen.filter((t) => t.hervorgehoben).map((t) => t.datei.path);
        await this.ansichtSpeichern();
      }
      await this.fokusPruefen();
      this.zeichnen();
    })();
    try {
      await this.laufendesLaden;
    } finally {
      this.laufendesLaden = null;
    }
  }

  /** Den Leitstern des Tages festlegen und den Rotationsstand sichern. */
  async fokusPruefen() {
    const einstellungen = this.plugin.einstellungen;
    if (!einstellungen.tagesfokus) {
      this.fokusLeitstern = null;
      return;
    }
    const titel = this.daten.leitsterne.map((l) => l.titel);
    const vorher = JSON.stringify(einstellungen.fokus);
    const ergebnis = fokusBestimmen(titel, einstellungen.fokus, heutigerTag(), Math.random);
    this.fokusLeitstern = ergebnis.leitstern;
    if (JSON.stringify(ergebnis.zustand) !== vorher) {
      einstellungen.fokus = ergebnis.zustand;
      await this.plugin.einstellungenSpeichern();
    }
  }

  /* ---- Zuordnung ---- */

  themaVon(aufgabe) {
    if (!aufgabe.themaLink) return null;
    const datei = this.quelle.auflösen(aufgabe.themaLink, aufgabe.datei);
    return datei ? this.themaVonPfad.get(datei.path) || null : null;
  }

  leitsterneVon(aufgabe) {
    const treffer = [];
    for (const link of aufgabe.leitsternLinks) {
      const datei = this.quelle.auflösen(link, aufgabe.datei);
      const stern = datei ? this.leitsternVonPfad.get(datei.path) : undefined;
      if (stern) treffer.push(stern);
    }
    return treffer.sort((a, b) => a.nummer - b.nummer);
  }

  /* ---- Filter ---- */

  get ansicht() {
    return this.plugin.einstellungen.ansicht;
  }

  async ansichtSpeichern() {
    await this.plugin.einstellungenSpeichern();
  }

  filterAktiv() {
    const a = this.ansicht;
    return a.arten.length !== ALLE_ARTEN.length || a.leitsterne.length > 0 || a.suche !== "";
  }

  passt(aufgabe) {
    const a = this.ansicht;
    if (aufgabe.status !== "backlog") return false;
    if (!a.arten.includes(aufgabe.art)) return false;
    if (a.leitsterne.length > 0) {
      const eigene = this.leitsterneVon(aufgabe).map((l) => l.titel);
      if (!eigene.some((t) => a.leitsterne.includes(t))) return false;
    }
    if (a.suche) {
      const thema = this.themaVon(aufgabe);
      const heu = [aufgabe.titel, aufgabe.beschreibung, aufgabe.problem, thema ? thema.titel : ""]
        .join(" ")
        .toLowerCase();
      if (!heu.includes(a.suche.toLowerCase())) return false;
    }
    return true;
  }

  gruppieren(aufgaben) {
    const gruppen = new Map();
    const reihenfolge = new Map();
    this.daten.themen.forEach((t, i) => reihenfolge.set(t.datei.path, i));

    for (const aufgabe of aufgaben) {
      const thema = this.themaVon(aufgabe);
      const schluessel = thema ? thema.datei.path : "cb-ohne-thema";
      if (!gruppen.has(schluessel)) {
        gruppen.set(schluessel, {
          schluessel,
          thema,
          titel: thema ? thema.titel : "Ohne Thema",
          kennzeichen: thema ? thema.kennzeichen : "",
          badge: thema ? thema.badge : "",
          hervorgehoben: thema ? thema.hervorgehoben : false,
          aufgaben: [],
        });
      }
      gruppen.get(schluessel).aufgaben.push(aufgabe);
    }

    const liste = Array.from(gruppen.values());
    const MAX = Number.MAX_SAFE_INTEGER;
    liste.sort((a, b) => {
      const ra = reihenfolge.has(a.schluessel) ? reihenfolge.get(a.schluessel) : MAX;
      const rb = reihenfolge.has(b.schluessel) ? reihenfolge.get(b.schluessel) : MAX;
      return ra - rb;
    });
    liste.forEach((g) => g.aufgaben.sort((x, y) => x.reihenfolge - y.reihenfolge));
    return liste;
  }

  /* ---- Zeichnen ---- */

  zeichnen() {
    if (!this.wurzel) return;   // ein Ereignis kann eintreffen, bevor onOpen gelaufen ist
    const scroll = this.contentEl.scrollTop;
    this.zoomAnzeige = null;    // wird in der Kopfzeile neu aufgebaut
    this.wurzel.empty();
    this.kopfzeileZeichnen();
    this.leitsterneZeichnen();
    this.tabsZeichnen();
    if (this.ansicht.tab === "backlog") this.backlogZeichnen();
    else this.boardZeichnen();
    this.contentEl.scrollTop = scroll;
  }

  kopfzeileZeichnen() {
    const kopf = this.wurzel.createDiv({ cls: "cb-kopf" });
    const marke = kopf.createDiv({ cls: "cb-marke" });
    marke.createSpan({ text: this.plugin.einstellungen.boardTitel || this.app.vault.getName() });
    if (this.plugin.einstellungen.boardUntertitel) {
      marke.createSpan({ cls: "cb-marke-zusatz", text: " · " + this.plugin.einstellungen.boardUntertitel });
    }
    kopf.createDiv({ cls: "cb-luecke" });
    kopf.createSpan({ cls: "cb-kopf-zahl", text: `${this.daten.aufgaben.length} Aufgaben` });
    this.zoomZeichnen(kopf);
    kopf.createSpan({ cls: "cb-version", text: "v" + this.plugin.manifest.version });
  }

  /* ---- Zoom ---- */

  zoomZeichnen(eltern) {
    const gruppe = eltern.createDiv({ cls: "cb-zoom" });
    const minus = gruppe.createEl("button", { cls: "cb-zoom-knopf", text: "−" });
    minus.setAttribute("aria-label", "Kleiner");
    const anzeige = gruppe.createEl("button", { cls: "cb-zoom-wert" });
    anzeige.setAttribute("aria-label", "Auf 100 % zurücksetzen");
    const plus = gruppe.createEl("button", { cls: "cb-zoom-knopf", text: "+" });
    plus.setAttribute("aria-label", "Größer");

    this.zoomAnzeige = { minus, anzeige, plus };
    this.zoomAnwenden();

    minus.addEventListener("click", () => void this.zoomSetzen(this.ansicht.zoom - ZOOM.schritt));
    plus.addEventListener("click", () => void this.zoomSetzen(this.ansicht.zoom + ZOOM.schritt));
    anzeige.addEventListener("click", () => void this.zoomSetzen(ZOOM.normal));
  }

  /** Zoomstufe auf das Board legen und die Knöpfe an den Grenzen stumpf schalten. */
  zoomAnwenden() {
    const wert = this.ansicht.zoom;
    this.wurzel.style.setProperty("zoom", String(wert / 100));
    if (!this.zoomAnzeige) return;
    this.zoomAnzeige.anzeige.setText(`${wert} %`);
    this.zoomAnzeige.minus.disabled = wert <= ZOOM.min;
    this.zoomAnzeige.plus.disabled = wert >= ZOOM.max;
    this.zoomAnzeige.anzeige.toggleClass("cb-zoom-geaendert", wert !== ZOOM.normal);
  }

  async zoomSetzen(wert) {
    const begrenzt = Math.max(ZOOM.min, Math.min(ZOOM.max, Math.round(wert)));
    if (begrenzt === this.ansicht.zoom) return;
    this.ansicht.zoom = begrenzt;
    this.zoomAnwenden();
    await this.ansichtSpeichern();
  }

  leitsterneZeichnen() {
    if (this.daten.leitsterne.length === 0) return;
    const sektion = this.wurzel.createDiv({ cls: "cb-sterne" });
    const beschriftung = sektion.createDiv({ cls: "cb-sterne-kopf" });
    beschriftung.createEl("h1", { text: this.plugin.einstellungen.leitsterneUeberschrift });
    beschriftung.createEl("p", { text: "Woran wir jede Entscheidung messen. Anklicken öffnet das Problem dahinter." });
    this.plusKnopf(beschriftung, "Leitstern hinzufügen", () => this.leitsternAnlegen());

    const reihe = sektion.createDiv({ cls: "cb-sternreihe" });

    for (const stern of this.daten.leitsterne) {
      const offen = this.ansicht.offenerLeitstern === stern.titel;
      const kachel = reihe.createEl("button", { cls: "cb-stern" });
      kachel.toggleClass("cb-stern-fokus", this.fokusLeitstern === stern.titel);
      kachel.setAttribute("aria-expanded", String(offen));
      if (this.fokusLeitstern === stern.titel) kachel.createSpan({ cls: "cb-fokus", text: "IM FOKUS" });
      kachel.createSpan({ cls: "cb-stern-pfeil", text: offen ? "▲" : "▼" });
      kachel.createSpan({ cls: "cb-stern-nr", text: `LEITSTERN ${stern.nummer}` });
      kachel.createSpan({ cls: "cb-stern-titel", text: stern.titel });
      if (stern.leitsatz) kachel.createSpan({ cls: "cb-stern-satz", text: stern.leitsatz });
      kachel.addEventListener("click", async () => {
        this.ansicht.offenerLeitstern = offen ? null : stern.titel;
        await this.ansichtSpeichern();
        this.zeichnen();
      });
      this.kontextmenue(kachel, stern.datei, () => {
        const betroffen = this.daten.aufgaben.filter((a) =>
          this.leitsterneVon(a).some((l) => l.datei.path === stern.datei.path)
        ).length;
        return betroffen > 0
          ? `${betroffen} Aufgaben verweisen darauf; die Zuordnung geht dabei verloren.`
          : "";
      });
    }

    const offener = this.daten.leitsterne.find((l) => l.titel === this.ansicht.offenerLeitstern);
    if (offener) this.leitsternDetailZeichnen(sektion, offener);
  }

  leitsternDetailZeichnen(eltern, stern) {
    const detail = eltern.createDiv({ cls: "cb-sterndetail" });

    if (stern.wurzelproblem) detail.createEl("p", { cls: "cb-sd-titel", text: stern.wurzelproblem });
    detail.createEl("p", {
      cls: "cb-sd-unter",
      text: `Wurzelproblem ${stern.nummer} · hinter dem Leitstern „${stern.titel}“`,
    });

    const wenn = stern.abschnitte.get("Wenn");
    const imWeg = stern.abschnitte.get("Im Weg steht");
    if (wenn || imWeg) {
      const karte = detail.createDiv({ cls: "cb-sd-wenn" });
      if (wenn) {
        karte.createEl("b", { text: "Wenn " });
        karte.createSpan({ text: wenn });
      }
      if (imWeg) {
        karte.createEl("b", { text: " — dann steht im Weg, " });
        karte.createSpan({ text: imWeg + "." });
      }
    }

    const raster = detail.createDiv({ cls: "cb-sd-raster" });
    for (const ueberschrift of ["Woran wir es gesehen haben", "Richtungen"]) {
      const inhalt = stern.abschnitte.get(ueberschrift);
      if (!inhalt) continue;
      const spalte = raster.createDiv();
      spalte.createEl("h4", { text: ueberschrift });
      this.markdown(inhalt, spalte.createDiv({ cls: "cb-md" }), stern.datei);
    }

    for (const paar of [["Warum das so ist", "cb-sd-warum"], ["Merksatz", "cb-sd-merksatz"]]) {
      const inhalt = stern.abschnitte.get(paar[0]);
      if (!inhalt) continue;
      const block = detail.createDiv({ cls: paar[1] });
      block.createEl("h4", { text: paar[0] });
      this.markdown(inhalt, block.createDiv({ cls: "cb-md" }), stern.datei);
    }

    const geloest = stern.abschnitte.get("Aufgelöst, wenn");
    if (geloest) {
      const fuss = detail.createDiv({ cls: "cb-sd-geloest" });
      fuss.createEl("b", { text: "Aufgelöst, wenn: " });
      fuss.createSpan({ text: geloest });
    }

    const link = detail.createDiv({ cls: "cb-sd-link" });
    const oeffnen = link.createEl("a", { text: "Notiz öffnen", href: "#" });
    oeffnen.addEventListener("click", (e) => {
      e.preventDefault();
      void this.app.workspace.getLeaf("tab").openFile(stern.datei);
    });
  }

  tabsZeichnen() {
    const imBacklog = this.daten.aufgaben.filter((a) => a.status === "backlog").length;
    const imBoard = this.daten.aufgaben.length - imBacklog;
    const tabs = this.wurzel.createDiv({ cls: "cb-tabs" });

    const knopf = (name, beschriftung, anzahl) => {
      const b = tabs.createEl("button", { cls: "cb-tab" });
      b.setAttribute("aria-selected", String(this.ansicht.tab === name));
      b.createSpan({ text: beschriftung });
      b.createSpan({ cls: "cb-tab-zahl", text: String(anzahl) });
      b.addEventListener("click", async () => {
        this.ansicht.tab = name;
        await this.ansichtSpeichern();
        this.zeichnen();
      });
    };
    knopf("backlog", "Backlog", imBacklog);
    knopf("board", "Umsetzung", imBoard);
  }

  /* ---- Backlog ---- */

  backlogZeichnen() {
    const panel = this.wurzel.createDiv({ cls: "cb-panel" });
    this.filterZeichnen(panel);

    const gruppen = this.gruppieren(this.daten.aufgaben.filter((a) => this.passt(a)));

    if (gruppen.length === 0) {
      const leer = panel.createDiv({ cls: "cb-leer" });
      const etwasDa = this.daten.aufgaben.length > 0;
      leer.createDiv({
        text: etwasDa
          ? "Nichts gefunden. Filter zurücksetzen oder Suchbegriff ändern."
          : "Noch keine Aufgaben im Backlog.",
      });
      if (!etwasDa) {
        const knopf = leer.createEl("button", { cls: "cb-btn cb-btn-akzent", text: "+ Aufgabe anlegen" });
        knopf.addEventListener("click", () => void this.aufgabeAnlegen(null));
      }
      return;
    }

    const liste = panel.createDiv();
    for (const gruppe of gruppen) {
      const offen =
        this.ansicht.offeneThemen.includes(gruppe.schluessel) ||
        this.ansicht.suche !== "" ||
        this.ansicht.leitsterne.length > 0;

      const block = liste.createDiv({ cls: "cb-gruppe" });
      block.toggleClass("cb-gruppe-hervor", gruppe.hervorgehoben);

      const kopf = block.createDiv({ cls: "cb-gruppe-kopf" });
      kopf.setAttribute("role", "button");
      kopf.tabIndex = 0;
      kopf.createSpan({ cls: "cb-gruppe-id", text: gruppe.kennzeichen });
      kopf.createSpan({ cls: "cb-gruppe-name", text: gruppe.titel });
      if (gruppe.badge) kopf.createSpan({ cls: "cb-gruppe-badge", text: gruppe.badge });
      kopf.createSpan({ cls: "cb-gruppe-zahl", text: String(gruppe.aufgaben.length) });
      this.plusKnopf(kopf, "Aufgabe in diesem Thema anlegen", () => this.aufgabeAnlegen(gruppe.thema));

      const auf = async () => {
        umschalten(this.ansicht.offeneThemen, gruppe.schluessel);
        await this.ansichtSpeichern();
        this.zeichnen();
      };
      kopf.addEventListener("click", () => void auf());
      kopf.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void auf();
        }
      });

      if (!offen) continue;
      const koerper = block.createDiv({ cls: "cb-gruppe-koerper" });
      for (const aufgabe of gruppe.aufgaben) this.zeileZeichnen(koerper, aufgabe);
    }

    const hinweis = panel.createDiv({ cls: "cb-hinweis" });
    hinweis.createEl("b", { text: "So läuft es: " });
    hinweis.createSpan({
      text:
        "Was ihr als Nächstes anpackt, schiebt ihr mit „→ Vereinbart“ ins Board. Es verschwindet dann aus dem Backlog. " +
        "Was ihr bewusst nicht macht, kommt auf „Verworfen“ — das ist keine Niederlage, sondern schafft Platz für das Wesentliche.",
    });
  }

  zeileZeichnen(eltern, aufgabe) {
    const zeile = eltern.createDiv({ cls: "cb-zeile" });
    const mitte = zeile.createDiv({ cls: "cb-zeile-mitte" });

    const titel = mitte.createDiv({ cls: "cb-zeile-titel" });
    if (aufgabe.kennung) titel.createSpan({ cls: "cb-kennung", text: aufgabe.kennung });
    this.titelLink(titel, aufgabe);

    if (aufgabe.beschreibung) {
      this.markdown(aufgabe.beschreibung, mitte.createDiv({ cls: "cb-zeile-text cb-md" }), aufgabe.datei);
    }
    if (aufgabe.wirkung || aufgabe.aufwand) {
      const zusatz = [];
      if (aufgabe.wirkung) zusatz.push("Wirkung: " + aufgabe.wirkung);
      if (aufgabe.aufwand) zusatz.push("Aufwand: " + aufgabe.aufwand);
      this.markdown(zusatz.join(" · "), mitte.createDiv({ cls: "cb-zeile-zusatz cb-md" }), aufgabe.datei);
    }
    if (aufgabe.problem) {
      mitte.createDiv({ cls: "cb-zeile-problem", text: "Ausgangslage: " + aufgabe.problem });
    }
    this.markierungenZeichnen(mitte.createDiv({ cls: "cb-marken" }), aufgabe);
    this.aufgabenMenue(zeile, aufgabe);

    const aktionen = zeile.createDiv({ cls: "cb-aktionen" });
    const knopf = (beschriftung, ziel, primaer) => {
      const b = aktionen.createEl("button", {
        cls: "cb-akt" + (primaer ? " cb-akt-primaer" : ""),
        text: beschriftung,
      });
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.statusSetzen(aufgabe, ziel);
      });
    };
    knopf("→ Vereinbart", "vereinbart", true);
    knopf("✓ Fertig", "fertig", false);
    knopf("✕ Verworfen", "verworfen", false);
  }

  titelLink(eltern, aufgabe) {
    const link = eltern.createEl("a", { cls: "cb-titel-link", text: aufgabe.titel, href: "#" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      void this.app.workspace.getLeaf("tab").openFile(aufgabe.datei);
    });
  }

  markierungenZeichnen(eltern, aufgabe) {
    const art = ARTEN[aufgabe.art];
    eltern.createSpan({ cls: `cb-marke ${art.klasse}`, text: `${art.icon} ${art.label}` });
    for (const stern of this.leitsterneVon(aufgabe)) {
      const marke = eltern.createSpan({
        cls: "cb-marke cb-marke-stern",
        text: `L${stern.nummer} ${stern.kurzname}`,
      });
      marke.addEventListener("click", async (e) => {
        e.stopPropagation();
        umschalten(this.ansicht.leitsterne, stern.titel);
        this.ansicht.tab = "backlog";
        await this.ansichtSpeichern();
        this.zeichnen();
      });
    }
  }

  filterZeichnen(eltern) {
    const leiste = eltern.createDiv({ cls: "cb-filter" });
    const imBacklog = this.daten.aufgaben.filter((a) => a.status === "backlog");

    leiste.createSpan({ cls: "cb-filter-label", text: "Art" });
    for (const art of ALLE_ARTEN) {
      const def = ARTEN[art];
      const chip = leiste.createEl("button", { cls: "cb-chip" });
      chip.setAttribute("aria-pressed", String(this.ansicht.arten.includes(art)));
      chip.createSpan({ text: `${def.icon} ${def.label}` });
      chip.createSpan({ cls: "cb-chip-zahl", text: String(imBacklog.filter((a) => a.art === art).length) });
      chip.addEventListener("click", async () => {
        umschalten(this.ansicht.arten, art);
        await this.ansichtSpeichern();
        this.zeichnen();
      });
    }

    if (this.daten.leitsterne.length > 0) {
      leiste.createSpan({ cls: "cb-filter-label", text: "Leitstern" });
      for (const stern of this.daten.leitsterne) {
        const chip = leiste.createEl("button", { cls: "cb-chip", text: `L${stern.nummer} ${stern.kurzname}` });
        chip.setAttribute("aria-pressed", String(this.ansicht.leitsterne.includes(stern.titel)));
        chip.addEventListener("click", async () => {
          umschalten(this.ansicht.leitsterne, stern.titel);
          await this.ansichtSpeichern();
          this.zeichnen();
        });
      }
    }

    const suchfeld = leiste.createDiv({ cls: "cb-suche" }).createEl("input", {
      type: "search",
      placeholder: "Suchen …",
    });
    suchfeld.value = this.ansicht.suche;
    suchfeld.addEventListener(
      "input",
      debounce(async () => {
        this.ansicht.suche = suchfeld.value.trim();
        await this.ansichtSpeichern();
        this.zeichnen();
        const feld = this.wurzel.querySelector(".cb-suche input");
        if (feld) {
          feld.focus();
          feld.setSelectionRange(feld.value.length, feld.value.length);
        }
      }, 220, false)
    );

    if (this.filterAktiv()) {
      const zuruecksetzen = leiste.createEl("button", { cls: "cb-btn cb-btn-akzent", text: "✕ Filter zurücksetzen" });
      zuruecksetzen.addEventListener("click", async () => {
        this.ansicht.arten = ALLE_ARTEN.slice();
        this.ansicht.leitsterne = [];
        this.ansicht.suche = "";
        await this.ansichtSpeichern();
        this.zeichnen();
      });
    }

    const sichtbareGruppen = this.gruppieren(this.daten.aufgaben.filter((a) => this.passt(a)));
    const alleOffen = sichtbareGruppen.every((g) => this.ansicht.offeneThemen.includes(g.schluessel));
    const auf = leiste.createEl("button", { cls: "cb-btn", text: alleOffen ? "Alle zuklappen" : "Alle aufklappen" });
    auf.addEventListener("click", async () => {
      this.ansicht.offeneThemen = alleOffen ? [] : sichtbareGruppen.map((g) => g.schluessel);
      await this.ansichtSpeichern();
      this.zeichnen();
    });
  }

  /* ---- Board ---- */

  boardZeichnen() {
    const panel = this.wurzel.createDiv({ cls: "cb-panel" });
    const board = panel.createDiv({ cls: "cb-board" });
    board.style.setProperty("--cb-spalten", String(SPALTEN.length));

    for (const spalte of SPALTEN) {
      const aufgaben = this.daten.aufgaben
        .filter((a) => a.status === spalte.key)
        .sort((a, b) => a.reihenfolge - b.reihenfolge);

      const el = board.createDiv({ cls: "cb-spalte" });
      el.style.setProperty("--cb-farbe", spalte.farbe);

      const kopf = el.createDiv({ cls: "cb-spalte-kopf" });
      const titel = kopf.createDiv({ cls: "cb-spalte-titel" });
      titel.createSpan({ cls: "cb-spalte-icon", text: spalte.icon });
      titel.createSpan({ text: spalte.name });
      titel.createSpan({ cls: "cb-spalte-zahl", text: String(aufgaben.length) });
      kopf.createDiv({ cls: "cb-spalte-unter", text: spalte.untertitel });
      this.plusKnopf(titel, `Aufgabe in „${spalte.name}“ anlegen`, () =>
        this.aufgabeAnlegen(null, spalte.key)
      );

      const koerper = el.createDiv({ cls: "cb-spalte-koerper" });
      if (aufgaben.length === 0) {
        koerper.createDiv({ cls: "cb-spalte-leer", text: "leer" });
        continue;
      }
      for (const aufgabe of aufgaben) this.karteZeichnen(koerper, aufgabe, spalte.key);
    }

    const hinweis = panel.createDiv({ cls: "cb-hinweis" });
    hinweis.createEl("b", { text: "Weniger gleichzeitig anfangen. " });
    hinweis.createSpan({
      text:
        "Wenn in „Angefangen“ mehr als eine Handvoll Karten liegen, ist das ein Warnsignal: Angefangenes bindet Zeit, " +
        "Geld und Aufmerksamkeit, bis es fertig ist. Erst fertig machen, dann Neues ziehen.",
    });
  }

  karteZeichnen(eltern, aufgabe, aktuell) {
    const karte = eltern.createDiv({ cls: "cb-karte" });

    const titel = karte.createDiv({ cls: "cb-karte-titel" });
    if (aufgabe.kennung) titel.createSpan({ cls: "cb-kennung", text: aufgabe.kennung });
    this.titelLink(titel, aufgabe);

    if (aufgabe.beschreibung) {
      this.markdown(aufgabe.beschreibung, karte.createDiv({ cls: "cb-karte-text cb-md" }), aufgabe.datei);
    }
    this.markierungenZeichnen(karte.createDiv({ cls: "cb-marken" }), aufgabe);
    this.aufgabenMenue(karte, aufgabe);

    const fuss = karte.createDiv({ cls: "cb-karte-fuss" });
    const auswahl = fuss.createEl("select", { cls: "cb-verschieben" });
    auswahl.setAttribute("aria-label", "Karte verschieben");
    for (const s of SPALTEN) {
      const option = auswahl.createEl("option", { value: s.key, text: `${s.icon} ${s.name}` });
      if (s.key === aktuell) option.selected = true;
    }
    auswahl.createEl("option", { value: "backlog", text: "← zurück ins Backlog" });
    auswahl.addEventListener("change", () => void this.statusSetzen(aufgabe, auswahl.value));
  }

  /* ---- Anlegen und Löschen ---- */

  /** Ein unauffälliges "+" mit Beschriftung als Tooltip. */
  plusKnopf(eltern, beschreibung, beiKlick) {
    const knopf = eltern.createEl("button", { cls: "cb-plus", text: "+" });
    knopf.setAttribute("aria-label", beschreibung);
    knopf.setAttribute("title", beschreibung);
    knopf.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      void beiKlick();
    });
    return knopf;
  }

  /**
   * Legt eine Aufgabennotiz an und öffnet sie zum Ausfüllen — mit aktivem
   * Umbenennen des Titels, denn der Dateiname ist der Aufgabentitel.
   */
  async aufgabeAnlegen(thema, status) {
    try {
      const imThema = thema
        ? this.daten.aufgaben.filter((a) => {
            const t = this.themaVon(a);
            return t && t.datei.path === thema.datei.path;
          })
        : [];
      const reihenfolge = imThema.reduce((max, a) => Math.max(max, a.reihenfolge + 1), 0);
      const datei = await this.quelle.aufgabeAnlegen({ thema, status, reihenfolge });
      await this.notizOeffnen(datei);
    } catch (fehler) {
      new Notice("Aufgabe konnte nicht angelegt werden: " + fehler.message);
    }
  }

  async leitsternAnlegen() {
    try {
      const nummer = this.daten.leitsterne.reduce((max, l) => Math.max(max, l.nummer + 1), 1);
      const datei = await this.quelle.leitsternAnlegen(nummer);
      await this.notizOeffnen(datei);
    } catch (fehler) {
      new Notice("Leitstern konnte nicht angelegt werden: " + fehler.message);
    }
  }

  /** Notiz öffnen; bei neuen Notizen steht der Titel gleich zum Umbenennen bereit. */
  async notizOeffnen(datei, neu = true) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(datei, neu ? { eState: { rename: "all" } } : undefined);
  }

  /**
   * Rechtsklick auf eine Aufgabe: alles, was sonst nur im Frontmatter stünde —
   * Art, Thema und Leitsterne — plus öffnen und löschen.
   */
  aufgabenMenue(element, aufgabe) {
    element.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menü = new Menu();

      menü.addItem((eintrag) =>
        eintrag
          .setTitle("Notiz öffnen")
          .setIcon("file-text")
          .onClick(() => void this.notizOeffnen(aufgabe.datei, false))
      );

      menü.addSeparator();
      for (const art of ALLE_ARTEN) {
        const def = ARTEN[art];
        menü.addItem((eintrag) =>
          eintrag
            .setTitle(`${def.icon} ${def.label}`)
            .setChecked(aufgabe.art === art)
            .onClick(() => void this.feldSetzen(aufgabe, "art", art))
        );
      }

      menü.addSeparator();
      menü.addItem((eintrag) =>
        eintrag
          .setTitle("Thema wählen …")
          .setIcon("folder")
          .onClick(() => this.themaWaehlen(aufgabe))
      );
      menü.addItem((eintrag) =>
        eintrag
          .setTitle("Leitsterne wählen …")
          .setIcon("star")
          .onClick(() => this.leitsterneWaehlen(aufgabe))
      );

      menü.addSeparator();
      menü.addItem((eintrag) =>
        eintrag
          .setTitle("Notiz löschen")
          .setIcon("trash")
          .onClick(() => this.loeschenFragen(aufgabe.datei))
      );

      menü.showAtMouseEvent(e);
    });
  }

  themaWaehlen(aufgabe) {
    const aktuell = this.themaVon(aufgabe);
    new AuswahlModal(this.app, {
      titel: "Thema wählen",
      mehrfach: false,
      gewaehlt: aktuell ? [aktuell.titel] : ["cb-ohne"],
      eintraege: [{ schluessel: "cb-ohne", beschriftung: "Ohne Thema" }].concat(
        this.daten.themen.map((t) => ({
          schluessel: t.titel,
          beschriftung: t.titel,
          hinweis: t.kennzeichen,
        }))
      ),
      beiAuswahl: (titel) =>
        this.feldSetzen(aufgabe, "thema", titel === "cb-ohne" ? null : `[[${titel}]]`),
    }).open();
  }

  leitsterneWaehlen(aufgabe) {
    new AuswahlModal(this.app, {
      titel: "Leitsterne wählen",
      mehrfach: true,
      gewaehlt: this.leitsterneVon(aufgabe).map((l) => l.titel),
      eintraege: this.daten.leitsterne.map((l) => ({
        schluessel: l.titel,
        beschriftung: l.titel,
        hinweis: `L${l.nummer} ${l.kurzname}`,
      })),
      beiAuswahl: (titel) =>
        this.feldSetzen(aufgabe, "leitsterne", titel.map((t) => `[[${t}]]`)),
    }).open();
  }

  /** Feld schreiben und die Ansicht sofort nachziehen. */
  async feldSetzen(aufgabe, feld, wert) {
    try {
      await this.quelle.feldSetzen(aufgabe.datei, feld, wert);
      await this.datenLaden();
    } catch (fehler) {
      new Notice("Änderung konnte nicht gespeichert werden: " + fehler.message);
    }
  }

  loeschenFragen(datei, hinweisGeber) {
    const hinweis = hinweisGeber ? hinweisGeber() : "";
    new LoeschModal(this.app, datei.basename, hinweis, async () => {
      try {
        await this.quelle.notizLoeschen(datei);
        new Notice(`„${datei.basename}“ in den Papierkorb verschoben.`);
      } catch (fehler) {
        new Notice("Löschen fehlgeschlagen: " + fehler.message);
      }
    }).open();
  }

  /** Rechtsklick auf eine Leitstern-Kachel: öffnen oder löschen. */
  kontextmenue(element, datei, hinweisGeber) {
    element.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menü = new Menu();
      menü.addItem((eintrag) =>
        eintrag
          .setTitle("Notiz öffnen")
          .setIcon("file-text")
          .onClick(() => void this.notizOeffnen(datei, false))
      );
      menü.addItem((eintrag) =>
        eintrag
          .setTitle("Notiz löschen")
          .setIcon("trash")
          .onClick(() => this.loeschenFragen(datei, hinweisGeber))
      );
      menü.showAtMouseEvent(e);
    });
  }

  /* ---- Hilfen ---- */

  async statusSetzen(aufgabe, status) {
    await this.quelle.statusSetzen(aufgabe, status);
    aufgabe.status = status;
    this.zeichnen();
  }

  markdown(quelltext, ziel, herkunft) {
    void MarkdownRenderer.render(this.app, quelltext, ziel, herkunft.path, this);
  }
}

/* ====================================================================== Einstellungen */

class ChangeBoardEinstellungenTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Titel des Boards")
      .setDesc("Erscheint oben links. Leer lassen, um den Namen des Vaults zu verwenden.")
      .addText((t) =>
        t
          .setPlaceholder(this.app.vault.getName())
          .setValue(this.plugin.einstellungen.boardTitel)
          .onChange(async (wert) => {
            this.plugin.einstellungen.boardTitel = wert;
            await this.plugin.einstellungenSpeichern();
          })
      );

    new Setting(containerEl).setName("Untertitel").addText((t) =>
      t.setValue(this.plugin.einstellungen.boardUntertitel).onChange(async (wert) => {
        this.plugin.einstellungen.boardUntertitel = wert;
        await this.plugin.einstellungenSpeichern();
      })
    );

    new Setting(containerEl).setName("Ordner").setHeading();

    const ordner = [
      ["leitsterneOrdner", "Leitsterne", "Notizen mit typ: leitstern"],
      ["themenOrdner", "Themen", "Notizen mit typ: thema — die Gruppen im Backlog"],
      ["aufgabenOrdner", "Aufgaben", "Notizen mit typ: aufgabe — die Karten"],
    ];
    for (const [schluessel, name, beschreibung] of ordner) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(beschreibung)
        .addText((t) =>
          t.setValue(this.plugin.einstellungen[schluessel]).onChange(async (wert) => {
            this.plugin.einstellungen[schluessel] = wert.trim();
            await this.plugin.einstellungenSpeichern();
            this.plugin.ansichtenAktualisieren();
          })
        );
    }

    new Setting(containerEl).setName("Darstellung").setHeading();

    new Setting(containerEl).setName("Überschrift über den Leitsternen").addText((t) =>
      t.setValue(this.plugin.einstellungen.leitsterneUeberschrift).onChange(async (wert) => {
        this.plugin.einstellungen.leitsterneUeberschrift = wert;
        await this.plugin.einstellungenSpeichern();
        this.plugin.ansichtenAktualisieren();
      })
    );

    new Setting(containerEl)
      .setName("Eigenschaften in Board-Notizen verbergen")
      .setDesc(
        "Blendet das Eigenschaftenfeld im Editor aus, solange eine Notiz aus den " +
          "Board-Ordnern offen ist. Status, Art, Thema und Leitsterne werden über das " +
          "Board gesetzt; die Notiz bleibt für Titel und Beschreibung."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.einstellungen.eigenschaftenVerbergen).onChange(async (wert) => {
          this.plugin.einstellungen.eigenschaftenVerbergen = wert;
          await this.plugin.einstellungenSpeichern();
          this.plugin.notizenMarkieren();
        })
      );

    new Setting(containerEl)
      .setName("Tagesfokus")
      .setDesc(
        "Hebt jeden Tag einen anderen Leitstern hervor. Jeder kommt einmal an die Reihe, " +
          "bevor sich einer wiederholt."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.einstellungen.tagesfokus).onChange(async (wert) => {
          this.plugin.einstellungen.tagesfokus = wert;
          await this.plugin.einstellungenSpeichern();
          this.plugin.ansichtenAktualisieren();
        })
      );
  }
}

/* ============================================================================= Plugin */

class ChangeBoardPlugin extends Plugin {
  async onload() {
    await this.einstellungenLaden();
    addIcon("change-board", BOARD_ICON);

    this.quelle = new Datenquelle(this.app, this.einstellungen);

    this.registerView(CHANGE_BOARD_VIEW, (leaf) => new ChangeBoardView(leaf, this, this.quelle));

    this.addRibbonIcon("change-board", "Change Board öffnen", () => void this.boardOeffnen());

    this.addCommand({
      id: "open-change-board",
      name: "Change Board öffnen",
      callback: () => void this.boardOeffnen(),
    });

    this.addSettingTab(new ChangeBoardEinstellungenTab(this.app, this));

    this.registerEvent(this.app.workspace.on("file-open", () => this.notizenMarkieren()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.notizenMarkieren()));
    this.app.workspace.onLayoutReady(() => this.notizenMarkieren());

    // Änderungen an Board-Notizen schlagen unmittelbar auf die geöffneten Ansichten durch.
    this.registerEvent(
      this.app.metadataCache.on("changed", (datei) => {
        if (this.quelle.betrifftBoard(datei.path)) this.ansichtenAktualisieren();
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (datei) => {
        if (this.quelle.betrifftBoard(datei.path)) this.ansichtenAktualisieren();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (datei) => {
        if (this.quelle.betrifftBoard(datei.path)) this.ansichtenAktualisieren();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (datei, alterPfad) => {
        if (this.quelle.betrifftBoard(datei.path) || this.quelle.betrifftBoard(alterPfad)) {
          this.ansichtenAktualisieren();
        }
      })
    );
  }

  onunload() {
    // Obsidian räumt registrierte Views und Events selbst ab; die Markierung an
    // fremden Ansichten muss dagegen von Hand verschwinden.
    for (const blatt of this.app.workspace.getLeavesOfType("markdown")) {
      blatt.view.containerEl.removeClass("cb-notiz");
    }
  }

  /**
   * Markiert die Editor-Ansichten von Board-Notizen. Das Stylesheet blendet darin
   * das Eigenschaftenfeld aus — gepflegt werden diese Felder über das Board.
   */
  notizenMarkieren() {
    const verbergen = this.einstellungen.eigenschaftenVerbergen;
    for (const blatt of this.app.workspace.getLeavesOfType("markdown")) {
      const datei = blatt.view && blatt.view.file;
      const gehoertDazu = !!datei && this.quelle.betrifftBoard(datei.path);
      blatt.view.containerEl.toggleClass("cb-notiz", verbergen && gehoertDazu);
    }
  }

  async boardOeffnen() {
    const vorhanden = this.app.workspace.getLeavesOfType(CHANGE_BOARD_VIEW);
    let leaf = vorhanden[0] || null;
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: CHANGE_BOARD_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  ansichtenAktualisieren() {
    for (const leaf of this.app.workspace.getLeavesOfType(CHANGE_BOARD_VIEW)) {
      if (leaf.view instanceof ChangeBoardView) leaf.view.aktualisieren();
    }
  }

  async einstellungenLaden() {
    const gespeichert = (await this.loadData()) || {};
    this.einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, gespeichert, {
      ansicht: Object.assign({}, STANDARD_EINSTELLUNGEN.ansicht, gespeichert.ansicht || {}),
    });
  }

  async einstellungenSpeichern() {
    await this.saveData(this.einstellungen);
  }
}

// Obsidian erwartet die Plugin-Klasse als Modul-Export; je nach Ladeweg als
// module.exports selbst oder als dessen "default".
module.exports = ChangeBoardPlugin;
module.exports.default = ChangeBoardPlugin;

// Für den Rauchtest, der diese Datei außerhalb von Obsidian lädt.
module.exports.__test__ = {
  CHANGE_BOARD_VIEW, ChangeBoardView, Datenquelle,
  körper, linkziel, abschnitte, fokusBestimmen, heutigerTag, ZOOM,
};
