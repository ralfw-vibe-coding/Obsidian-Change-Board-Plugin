"use strict";

/*
 * Rauchtest: rendert die Board-Ansicht im Mini-DOM und prüft Struktur, Filter
 * und das Schreiben des Status. Ohne Abhängigkeiten — nur Node.
 *
 *   node tools/test/smoke.js
 */

const { boardAufbauen, intern } = require("./harness");
const { registriert } = require("./obsidian-stub");

let fehler = 0;
const pruefe = (bedingung, beschreibung) => {
  console.log((bedingung ? "  ✓ " : "  ✗ ") + beschreibung);
  if (!bedingung) fehler++;
};

(async () => {
  const { view, geschrieben, angelegt, geloescht, geoeffnet, manifest, klick, aendern, eingabe, rechtsklick, ereignisSenden, warte } =
    await boardAufbauen();
  const el = () => view.contentEl;
  const zahlen = (selektor) => el().querySelectorAll(selektor).map((e) => Number(e.textContent));

  console.log("\nAnmeldung bei Obsidian");
  const ribbon = registriert.ribbon[0];
  pruefe(ribbon !== undefined, "Ribbon-Symbol wird angemeldet");
  pruefe(ribbon && registriert.icons.has(ribbon.icon), `Symbol "${ribbon && ribbon.icon}" ist registriert`);
  const svg = ribbon ? registriert.icons.get(ribbon.icon) : "";
  pruefe(!svg.includes("<svg"), "Symbol ist SVG-Inhalt ohne umschließendes <svg>");
  pruefe(/^\s*<(rect|path|circle|line|polygon|g)\b/.test(svg), "Symbol beginnt mit einer Zeichenform");
  pruefe(view.getIcon() === ribbon.icon, "die Ansicht benutzt dasselbe Symbol");

  console.log("\nStruktur");
  pruefe(el().querySelectorAll(".cb-stern").length === 5, "fünf Leitstern-Kacheln");
  pruefe(el().querySelectorAll(".cb-tab").length === 2, "zwei Tabs");
  pruefe(el().querySelector(".cb-filter") !== null, "Filterleiste vorhanden");

  const tabZahlen = zahlen(".cb-tab-zahl");
  pruefe(tabZahlen[0] === 152, `Backlog zählt 152 Aufgaben (ist: ${tabZahlen[0]})`);
  pruefe(tabZahlen[1] === 32, `Umsetzung zählt 32 Aufgaben (ist: ${tabZahlen[1]})`);
  pruefe(el().querySelectorAll(".cb-gruppe").length === 24, "24 Themengruppen mit offenen Aufgaben");
  pruefe(el().querySelector(".cb-gruppe-hervor") !== null, "Sofortmaßnahmen sind hervorgehoben");
  pruefe(el().querySelector(".cb-gruppe-hervor .cb-zeile") !== null, "und beim ersten Öffnen aufgeklappt");

  const artZahlen = zahlen(".cb-chip-zahl");
  pruefe(
    artZahlen[0] === 9 && artZahlen[1] === 68 && artZahlen[2] === 75,
    `Artenzähler 9 / 68 / 75 (ist: ${artZahlen.join(" / ")})`
  );

  console.log("\nLeitstern-Detail");
  klick(el().querySelectorAll(".cb-stern")[0]);
  await warte();
  const detail = el().querySelector(".cb-sterndetail");
  pruefe(detail !== null, "Detail öffnet sich");
  pruefe(detail !== null && detail.textContent.includes("Wurzelproblem 1"), "Detail nennt das Wurzelproblem");
  pruefe(el().querySelectorAll(".cb-sd-raster h4").length === 2, "Belege und Richtungen als Spalten");
  pruefe(el().querySelector(".cb-sd-geloest") !== null, "„Aufgelöst, wenn“ wird gezeigt");

  console.log("\nFilter");
  const suchfeld = el().querySelector(".cb-suche input");
  suchfeld.value = "Packliste";
  eingabe(suchfeld);
  await warte();
  const treffer = el().querySelectorAll(".cb-zeile");
  pruefe(treffer.length > 0 && treffer.length < 20, `Suche grenzt ein (${treffer.length} Treffer)`);
  pruefe(el().textContent.includes("Packliste"), "Treffer enthalten den Suchbegriff");

  const zuruecksetzen = el().querySelectorAll(".cb-btn").find((b) => b.textContent.includes("Filter zurücksetzen"));
  pruefe(zuruecksetzen !== undefined, "Zurücksetzen erscheint bei aktivem Filter");
  klick(zuruecksetzen);
  await warte();
  pruefe(el().querySelectorAll(".cb-gruppe").length === 24, "nach Zurücksetzen wieder alle Gruppen");

  const sternMarke = el().querySelector(".cb-marke-stern");
  const sternText = sternMarke.textContent;
  klick(sternMarke);
  await warte();
  const aktiveChips = el().querySelectorAll(".cb-chip").filter((c) => c.getAttribute("aria-pressed") === "true");
  pruefe(aktiveChips.length === 4, `Klick auf eine Leitstern-Marke setzt den Filter (${sternText})`);
  klick(el().querySelectorAll(".cb-btn").find((b) => b.textContent.includes("Filter zurücksetzen")));
  await warte();

  console.log("\nStatus schreiben");
  const ersteZeile = el().querySelector(".cb-zeile");
  const titelVorher = ersteZeile.querySelector(".cb-titel-link").textContent;
  klick(ersteZeile.querySelectorAll(".cb-akt").find((b) => b.textContent.includes("Vereinbart")));
  await warte();
  pruefe(geschrieben.length === 1, "genau ein Frontmatter-Schreibvorgang");
  pruefe(geschrieben[0].fm.status === "vereinbart", `Status ist "vereinbart" (ist: ${geschrieben[0].fm.status})`);
  const nachher = zahlen(".cb-tab-zahl");
  pruefe(nachher[0] === 151 && nachher[1] === 33, `Zähler wandern mit (${nachher.join(" / ")})`);
  pruefe(!el().querySelector(".cb-zeile").textContent.includes(titelVorher), "Karte verlässt das Backlog");

  console.log("\nBoard");
  klick(el().querySelectorAll(".cb-tab")[1]);
  await warte();
  pruefe(el().querySelectorAll(".cb-spalte").length === 5, "fünf Spalten");
  const spaltenZahlen = zahlen(".cb-spalte-zahl");
  pruefe(spaltenZahlen[0] === 1, `"Vereinbart" enthält die verschobene Karte (${spaltenZahlen[0]})`);
  pruefe(spaltenZahlen[3] === 32, `"Fertig" enthält die 32 erledigten Punkte (${spaltenZahlen[3]})`);
  pruefe(el().querySelector(".cb-karte") !== null, "Karten werden gezeichnet");

  const auswahl = el().querySelector(".cb-verschieben");
  pruefe(auswahl.querySelectorAll("option").length === 6, "Verschiebe-Menü mit 5 Spalten plus Backlog");
  auswahl.value = "backlog";
  aendern(auswahl);
  await warte();
  pruefe(geschrieben[1] && geschrieben[1].fm.status === "backlog", "Zurück ins Backlog schreibt den Status");

  console.log("\nZoom");
  const zoomKnoepfe = el().querySelectorAll(".cb-zoom button");
  pruefe(zoomKnoepfe.length === 3, "Steuerung aus Minus, Wert und Plus");
  const wertFeld = () => el().querySelector(".cb-zoom-wert");
  const minus = () => el().querySelectorAll(".cb-zoom-knopf")[0];
  const plus = () => el().querySelectorAll(".cb-zoom-knopf")[1];
  pruefe(wertFeld().textContent === "100 %", `Startwert 100 % (ist: ${wertFeld().textContent})`);

  klick(plus());
  await warte();
  pruefe(wertFeld().textContent === "110 %", `Plus vergrößert auf 110 % (ist: ${wertFeld().textContent})`);
  pruefe(view.wurzel.style.werte.get("zoom") === "1.1", "Zoom liegt auf dem Board");

  for (let i = 0; i < 10; i++) klick(minus());
  await warte();
  pruefe(wertFeld().textContent === "50 %", `Minus stoppt bei 50 % (ist: ${wertFeld().textContent})`);
  pruefe(minus().disabled === true, "Minus ist an der unteren Grenze stumpf");
  klick(minus());
  pruefe(wertFeld().textContent === "50 %", "und lässt sich nicht weiter drücken");

  klick(wertFeld());
  await warte();
  pruefe(wertFeld().textContent === "100 %", "Klick auf den Wert setzt auf 100 % zurück");

  klick(plus());
  klick(el().querySelectorAll(".cb-tab")[0]);
  await warte();
  pruefe(wertFeld().textContent === "110 %", "Zoomstufe übersteht den Tabwechsel");

  console.log("\nTagesfokus");
  const sterne = ["A", "B", "C", "D", "E"];
  // Fester Würfel, damit die Prüfung wiederholbar bleibt.
  let saat = 7;
  const wuerfeln = () => ((saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648);

  let zustand = { tag: "", leitstern: null, verbraucht: [] };
  const verlauf = [];
  for (let t = 1; t <= 21; t++) {
    const tag = `2026-08-${String(t).padStart(2, "0")}`;
    // zweimal am selben Tag: die Wahl darf sich nicht ändern
    const erst = intern.fokusBestimmen(sterne, zustand, tag, wuerfeln);
    const zweit = intern.fokusBestimmen(sterne, erst.zustand, tag, wuerfeln);
    if (erst.leitstern !== zweit.leitstern) fehler++;
    zustand = zweit.zustand;
    verlauf.push(zweit.leitstern);
  }
  pruefe(verlauf.length === 21, "innerhalb eines Tages bleibt die Wahl stehen");
  pruefe(verlauf.every((s, i) => i === 0 || s !== verlauf[i - 1]), `nie zweimal derselbe hintereinander (${verlauf.slice(0, 11).join(" ")} …)`);
  const zyklen = [verlauf.slice(0, 5), verlauf.slice(5, 10), verlauf.slice(10, 15), verlauf.slice(15, 20)];
  pruefe(
    zyklen.every((z) => new Set(z).size === 5),
    "in je fünf Tagen kommt jeder Leitstern genau einmal"
  );

  const nachLoeschen = intern.fokusBestimmen(["A", "B"], { tag: "2026-08-21", leitstern: "E", verbraucht: ["D", "E"] }, "2026-08-21", () => 0);
  pruefe(nachLoeschen.leitstern === "A", "ein entfernter Leitstern fällt aus dem Gedächtnis");
  pruefe(nachLoeschen.zustand.verbraucht.join() === "A", "und aus dem laufenden Durchgang");

  const einziger = intern.fokusBestimmen(["A"], { tag: "", leitstern: "A", verbraucht: ["A"] }, "2026-08-22", () => 0);
  pruefe(einziger.leitstern === "A", "bei nur einem Leitstern bleibt es bei diesem");

  pruefe(intern.heutigerTag(new Date(2026, 7, 3)) === "2026-08-03", "Tagesschlüssel in lokaler Zeit");

  console.log("\nVersion");
  const version = el().querySelector(".cb-version");
  pruefe(version !== null, "Version steht in der Kopfzeile");
  pruefe(
    version.textContent === "v" + manifest.version,
    `Version stimmt mit manifest.json überein (${version && version.textContent})`
  );

  console.log("\nAufgabe anlegen");
  klick(el().querySelectorAll(".cb-tab")[0]);
  await warte();
  const gruppenkopf = el().querySelector(".cb-gruppe-kopf");
  const gruppenPlus = gruppenkopf.querySelector(".cb-plus");
  pruefe(gruppenPlus !== null, "jede Themengruppe hat ein +");
  pruefe(gruppenPlus.getAttribute("title") !== null, "das + erklärt sich per Tooltip");

  const vorher = angelegt.length;
  const ereignis = ereignisSenden(gruppenPlus, "click");
  await warte();
  pruefe(ereignis.propagationStopped, "der Klick klappt die Gruppe nicht mit zu");
  pruefe(angelegt.length === vorher + 1, "eine Notiz wurde angelegt");

  const neueAufgabe = angelegt[angelegt.length - 1];
  pruefe(neueAufgabe.pfad === "Change Board/Aufgaben/Neue Aufgabe.md", `im Aufgabenordner (${neueAufgabe.pfad})`);
  pruefe(/^---\ntyp: aufgabe\n/.test(neueAufgabe.inhalt), "Frontmatter beginnt mit typ: aufgabe");
  pruefe(/\nstatus: backlog\n/.test(neueAufgabe.inhalt), "Status ist backlog");
  pruefe(/\nart: massnahme\n/.test(neueAufgabe.inhalt), "Art ist massnahme");
  pruefe(/\nthema: "\[\[.+\]\]"\n/.test(neueAufgabe.inhalt), "Thema ist als Wikilink gesetzt");
  pruefe(/\nleitsterne:\n/.test(neueAufgabe.inhalt), "leitsterne steht als leeres Feld bereit");
  const zuletztGeoeffnet = geoeffnet[geoeffnet.length - 1];
  pruefe(zuletztGeoeffnet.pfad === neueAufgabe.pfad, "die neue Notiz wird zum Ausfüllen geöffnet");
  pruefe(
    zuletztGeoeffnet.zustand && zuletztGeoeffnet.zustand.eState.rename === "all",
    "und ihr Titel steht gleich zum Umbenennen bereit"
  );

  klick(el().querySelector(".cb-gruppe-kopf .cb-plus"));
  await warte();
  pruefe(
    angelegt[angelegt.length - 1].pfad === "Change Board/Aufgaben/Neue Aufgabe 2.md",
    `zweite Notiz weicht dem Namen aus (${angelegt[angelegt.length - 1].pfad})`
  );

  klick(el().querySelectorAll(".cb-tab")[1]);
  await warte();
  const spaltenPlus = el().querySelector(".cb-spalte-titel .cb-plus");
  pruefe(spaltenPlus !== null, "auch jede Board-Spalte hat ein +");
  klick(spaltenPlus);
  await warte();
  pruefe(
    /\nstatus: vereinbart\n/.test(angelegt[angelegt.length - 1].inhalt),
    "eine Karte aus der Spalte startet in deren Status"
  );

  console.log("\nLeitstern anlegen");
  const sternPlus = el().querySelector(".cb-sterne-kopf .cb-plus");
  pruefe(sternPlus !== null, "die Leitstern-Überschrift trägt ein +");
  klick(sternPlus);
  await warte();
  const neuerStern = angelegt[angelegt.length - 1];
  pruefe(neuerStern.pfad === "Change Board/Leitsterne/Neuer Leitstern.md", `im Leitsternordner (${neuerStern.pfad})`);
  pruefe(/\nnummer: 6\n/.test(neuerStern.inhalt), "bekommt die nächste freie Nummer");
  pruefe(
    (neuerStern.inhalt.match(/^## /gm) || []).length === 8,
    "bringt das Gerüst aller acht Abschnitte mit"
  );
  pruefe(neuerStern.inhalt.includes("## Aufgelöst, wenn"), "einschließlich „Aufgelöst, wenn“");

  console.log("\nLöschen");
  registriert.menues.length = 0;
  registriert.modale.length = 0;
  klick(el().querySelectorAll(".cb-tab")[0]);
  await warte();
  const zeile = el().querySelector(".cb-zeile");
  const menüEreignis = ereignisSenden(zeile, "contextmenu");
  pruefe(menüEreignis.defaultPrevented, "Rechtsklick unterdrückt das Standardmenü");
  const menü = registriert.menues[0];
  pruefe(menü !== undefined && menü.eintraege.length === 2, "Kontextmenü mit zwei Einträgen");
  pruefe(
    menü.eintraege.map((e) => e.titel).join(" | ") === "Notiz öffnen | Notiz löschen",
    'die Einträge heißen „Notiz öffnen“ und „Notiz löschen“'
  );

  menü.eintraege[1].klick();
  const modal = registriert.modale[0];
  pruefe(modal !== undefined, "Löschen fragt erst nach");
  pruefe(modal.contentEl.textContent.includes("Papierkorb"), "die Rückfrage nennt den Papierkorb");

  const abbrechen = modal.contentEl.querySelectorAll("button").find((b) => b.textContent === "Abbrechen");
  klick(abbrechen);
  await warte();
  pruefe(geloescht.length === 0, "Abbrechen löscht nichts");

  menü.eintraege[1].klick();
  const modal2 = registriert.modale[registriert.modale.length - 1];
  klick(modal2.contentEl.querySelectorAll("button").find((b) => b.textContent === "Löschen"));
  await warte();
  pruefe(geloescht.length === 1, "Bestätigen legt die Notiz in den Papierkorb");
  pruefe(
    registriert.hinweise.some((h) => h.includes("Papierkorb")),
    "und meldet das per Notice"
  );

  registriert.menues.length = 0;
  ereignisSenden(el().querySelector(".cb-stern"), "contextmenu");
  registriert.menues[0].eintraege[1].klick();
  const sternModal = registriert.modale[registriert.modale.length - 1];
  pruefe(
    /\d+ Aufgaben verweisen darauf/.test(sternModal.contentEl.textContent),
    "beim Leitstern warnt die Rückfrage vor verwaisten Zuordnungen"
  );
  klick(sternModal.contentEl.querySelectorAll("button").find((b) => b.textContent === "Abbrechen"));

  console.log(fehler === 0 ? "\nAlle Prüfungen bestanden." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
  process.exit(fehler === 0 ? 0 : 1);
})();
