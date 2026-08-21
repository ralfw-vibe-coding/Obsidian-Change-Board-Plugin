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
  pruefe(
    el().querySelectorAll(".cb-stern").length === view.daten.leitsterne.length,
    `eine Kachel je Leitstern (${view.daten.leitsterne.length})`
  );
  pruefe(el().querySelectorAll(".cb-tab").length === 2, "zwei Tabs");
  pruefe(el().querySelector(".cb-filter") !== null, "Filterleiste vorhanden");

  // Die Erwartungen kommen aus den geladenen Notizen, nicht aus festen Zahlen —
  // sonst schlägt der Test fehl, sobald jemand im Vault gearbeitet hat.
  const alle = view.daten.aufgaben;
  const mitStatus = (st) => alle.filter((a) => a.status === st).length;
  const imBacklog = mitStatus("backlog");

  const tabZahlen = zahlen(".cb-tab-zahl");
  pruefe(tabZahlen[0] === imBacklog, `Backlog zählt die offenen Aufgaben (${tabZahlen[0]} von ${alle.length})`);
  pruefe(tabZahlen[0] + tabZahlen[1] === alle.length, "Backlog und Umsetzung ergeben zusammen alle Aufgaben");

  const themenMitOffenen = new Set(
    alle.filter((a) => a.status === "backlog").map((a) => {
      const t = view.themaVon(a);
      return t ? t.datei.path : "ohne";
    })
  );
  pruefe(
    el().querySelectorAll(".cb-gruppe").length === themenMitOffenen.size,
    `eine Gruppe je Thema mit offenen Aufgaben (${themenMitOffenen.size})`
  );
  pruefe(el().querySelector(".cb-gruppe-hervor") !== null, "Sofortmaßnahmen sind hervorgehoben");
  pruefe(el().querySelector(".cb-gruppe-hervor .cb-zeile") !== null, "und beim ersten Öffnen aufgeklappt");

  const artZahlen = zahlen(".cb-chip-zahl");
  const erwarteteArten = ["sofortmassnahme", "massnahme", "ungeloest"].map(
    (art) => alle.filter((a) => a.status === "backlog" && a.art === art).length
  );
  pruefe(
    artZahlen.join("/") === erwarteteArten.join("/"),
    `Artenzähler stimmen (${artZahlen.join(" / ")})`
  );
  pruefe(
    erwarteteArten.reduce((s, n) => s + n, 0) === imBacklog,
    "und ergeben zusammen den Backlog"
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
  pruefe(
    el().querySelectorAll(".cb-gruppe").length === themenMitOffenen.size,
    "nach Zurücksetzen wieder alle Gruppen"
  );

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
  pruefe(
    nachher[0] === tabZahlen[0] - 1 && nachher[1] === tabZahlen[1] + 1,
    `Zähler wandern mit (${tabZahlen.join(" / ")} → ${nachher.join(" / ")})`
  );
  pruefe(!el().querySelector(".cb-zeile").textContent.includes(titelVorher), "Karte verlässt das Backlog");

  console.log("\nBoard");
  klick(el().querySelectorAll(".cb-tab")[1]);
  await warte();
  pruefe(el().querySelectorAll(".cb-spalte").length === 5, "fünf Spalten");
  const spaltenZahlen = zahlen(".cb-spalte-zahl");
  const erwarteteSpalten = ["vereinbart", "angefangen", "blockiert", "fertig", "verworfen"].map(mitStatus);
  pruefe(
    spaltenZahlen.join("/") === erwarteteSpalten.join("/"),
    `jede Spalte zeigt ihren Bestand (${spaltenZahlen.join(" / ")})`
  );
  pruefe(spaltenZahlen[0] >= 1, "die eben verschobene Karte liegt in „Vereinbart“");
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

  console.log("\nKommentare");
  pruefe(
    intern.textTeilen("Beschreibung.\n\n# Kommentare\n\n- erster").beschreibung === "Beschreibung.",
    "die Beschreibung endet an der Überschrift"
  );
  pruefe(
    intern.textTeilen("Beschreibung.\n\n# Kommentare\n\n- erster").kommentare === "- erster",
    "was darunter steht, gilt als Kommentar"
  );
  pruefe(
    intern.textTeilen("Nur Beschreibung.").kommentare === "",
    "ohne Überschrift gibt es keine Kommentare"
  );
  pruefe(
    intern.textTeilen("Text\n\n## Kommentare\n\nx").kommentare === "x",
    "auch eine zweite Ebene wird erkannt"
  );
  pruefe(
    intern.textTeilen("Text\n\n# Kommentare zur Lage\n\nx").kommentare === "",
    "eine Überschrift mit Zusatz zählt nicht"
  );

  // Eine Aufgabe mit Kommentaren zeigt den Inhalt nirgends, ist aber auffindbar.
  klick(el().querySelectorAll(".cb-tab")[0]);   // in den Backlog
  await warte();
  const mitKommentar = view.daten.aufgaben.find((a) => a.status === "backlog");
  mitKommentar.kommentare = "Rückruf am Freitag vereinbart";
  view.zeichnen();
  const alleAufklappen = el().querySelectorAll(".cb-btn").find((b) => b.textContent === "Alle aufklappen");
  if (alleAufklappen) {
    klick(alleAufklappen);
    await warte();
  }
  const zeileMitKommentar = el()
    .querySelectorAll(".cb-zeile")
    .find((z) => z.textContent.includes(mitKommentar.titel));
  if (zeileMitKommentar) {
    pruefe(
      !zeileMitKommentar.textContent.includes("Rückruf am Freitag"),
      "der Kommentartext steht nicht auf der Karte"
    );
    pruefe(
      zeileMitKommentar.querySelector(".cb-marke-kommentar") !== null,
      "eine Marke zeigt aber, dass es Kommentare gibt"
    );
  } else {
    pruefe(false, "Aufgabe mit Kommentar im Backlog gefunden");
    pruefe(false, "—");
  }
  mitKommentar.kommentare = "";
  view.zeichnen();

  console.log("\nSpalten zuklappen");
  klick(el().querySelectorAll(".cb-tab")[1]);
  await warte();
  const chevrons = () => el().querySelectorAll(".cb-chevron");
  pruefe(chevrons().length === 5, `jede Spalte hat ein Chevron (${chevrons().length})`);
  pruefe(el().querySelectorAll(".cb-spalte-zu").length === 0, "anfangs ist keine zugeklappt");

  klick(chevrons()[0]);
  await warte();
  pruefe(el().querySelectorAll(".cb-spalte-zu").length === 1, "ein Klick klappt die Spalte zu");
  const zugeklappt = el().querySelector(".cb-spalte-zu");
  pruefe(zugeklappt.querySelector(".cb-spalte-koerper") === null, "zugeklappt zeigt sie keine Karten");
  pruefe(zugeklappt.querySelector(".cb-spalte-name") !== null, "der Name bleibt stehen");
  pruefe(zugeklappt.querySelector(".cb-spalte-zahl") !== null, "und die Anzahl auch");
  pruefe(
    view.plugin.einstellungen.ansicht.zugeklappteSpalten.includes("vereinbart"),
    "der Zustand wird gespeichert"
  );

  klick(el().querySelectorAll(".cb-tab")[0]);
  await warte();
  klick(el().querySelectorAll(".cb-tab")[1]);
  await warte();
  pruefe(el().querySelectorAll(".cb-spalte-zu").length === 1, "und übersteht den Tabwechsel");
  klick(chevrons()[0]);
  await warte();
  pruefe(el().querySelectorAll(".cb-spalte-zu").length === 0, "nochmal klicken klappt wieder auf");

  console.log("\nKarten je Spalte");
  const grenze = view.plugin.einstellungen.kartenProSpalte;
  pruefe(grenze === 10, `voreingestellt sind ${grenze} Karten`);
  const fertigIndex = 3;
  const fertigAnzahl = view.daten.aufgaben.filter((a) => a.status === "fertig").length;
  const spalteFertig = () => el().querySelectorAll(".cb-spalte")[fertigIndex];
  pruefe(fertigAnzahl > grenze, `„Fertig“ hat mehr als ${grenze} Karten (${fertigAnzahl})`);
  pruefe(
    spalteFertig().querySelectorAll(".cb-karte").length === grenze,
    `es werden nur ${grenze} gezeigt (${spalteFertig().querySelectorAll(".cb-karte").length})`
  );
  pruefe(
    spalteFertig().querySelector(".cb-spalte-zahl").textContent === String(fertigAnzahl),
    "der Zähler nennt weiterhin den vollen Bestand"
  );
  const mehr = spalteFertig().querySelector(".cb-mehr");
  pruefe(mehr !== null && mehr.textContent === `${fertigAnzahl - grenze} weitere zeigen`, `der Knopf sagt, wie viele fehlen (${mehr && mehr.textContent})`);

  klick(mehr);
  await warte();
  pruefe(
    spalteFertig().querySelectorAll(".cb-karte").length === fertigAnzahl,
    "der Klick zeigt alle"
  );
  pruefe(spalteFertig().querySelector(".cb-mehr").textContent === "weniger zeigen", "und lässt sich zurücknehmen");
  klick(spalteFertig().querySelector(".cb-mehr"));
  await warte();
  pruefe(spalteFertig().querySelectorAll(".cb-karte").length === grenze, "wieder auf die Voreinstellung");

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

  console.log("\nArt, Thema und Leitsterne zuweisen");
  registriert.menues.length = 0;
  registriert.modale.length = 0;
  klick(el().querySelectorAll(".cb-tab")[0]);   // zurück in den Backlog
  await warte();
  const zuweisZeile = el().querySelector(".cb-zeile");
  const zuweisTitel = zuweisZeile.querySelector(".cb-titel-link").textContent;
  ereignisSenden(zuweisZeile, "contextmenu");
  const zMenü = registriert.menues[0];
  const zEintrag = (titel) => zMenü.eintraege.find((e) => e.titel === titel);

  pruefe(zMenü.eintraege.filter((e) => e.trenner).length === 3, "das Menü ist in Blöcke geteilt");
  const arten = zMenü.eintraege.filter((e) => /Sofortmaßnahme|Maßnahme|Ungelöst/.test(e.titel || ""));
  pruefe(arten.length === 3, "alle drei Arten stehen zur Wahl");
  pruefe(arten.filter((e) => e.angehakt).length === 1, "die aktuelle Art ist angehakt");

  const vorherGeschrieben = geschrieben.length;
  zEintrag("● Ungelöst").klick();
  await warte(60);
  pruefe(geschrieben.length === vorherGeschrieben + 1, "die Wahl schreibt ins Frontmatter");
  pruefe(geschrieben[geschrieben.length - 1].fm.art === "ungeloest", "art steht auf ungeloest");
  pruefe(
    el().textContent.includes("● Ungelöst"),
    "und die Ansicht zeigt es sofort"
  );

  pruefe(zEintrag("Thema wählen …") !== undefined, "„Thema wählen“ steht im Menü");
  zEintrag("Thema wählen …").klick();
  const themaModal = registriert.modale[registriert.modale.length - 1];
  pruefe(themaModal.contentEl.querySelector(".cb-auswahl-suche") !== null, "bei vielen Themen gibt es ein Suchfeld");
  const themaEintraege = themaModal.contentEl.querySelectorAll(".cb-auswahl-eintrag");
  pruefe(
    themaEintraege.length === view.daten.themen.length + 1,
    `„Ohne Thema“ plus alle Themen (${themaEintraege.length})`
  );
  pruefe(
    themaModal.contentEl.querySelectorAll(".cb-auswahl-aktiv").length === 1,
    "das aktuelle Thema ist markiert"
  );
  klick(themaEintraege.find((e) => e.textContent.includes("IT-Infrastruktur")));
  await warte(60);
  pruefe(
    geschrieben[geschrieben.length - 1].fm.thema === "[[IT-Infrastruktur & Backup]]",
    `Thema wird als Wikilink gesetzt (${geschrieben[geschrieben.length - 1].fm.thema})`
  );

  registriert.menues.length = 0;
  ereignisSenden(el().querySelectorAll(".cb-zeile").find((z) => z.textContent.includes(zuweisTitel)) || el().querySelector(".cb-zeile"), "contextmenu");
  registriert.menues[0].eintraege.find((e) => e.titel === "Leitsterne wählen …").klick();
  const sternAuswahl = registriert.modale[registriert.modale.length - 1];
  const sternZeilen = sternAuswahl.contentEl.querySelectorAll(".cb-auswahl-eintrag");
  pruefe(
    sternZeilen.length === view.daten.leitsterne.length,
    `alle Leitsterne stehen zur Wahl (${sternZeilen.length})`
  );
  const vorherAktiv = sternAuswahl.contentEl.querySelectorAll(".cb-auswahl-aktiv").length;
  klick(sternZeilen[0]);
  const nachherAktiv = sternAuswahl.contentEl.querySelectorAll(".cb-auswahl-aktiv").length;
  pruefe(nachherAktiv !== vorherAktiv, "ein Klick schaltet die Auswahl um, ohne zu schließen");
  klick(sternAuswahl.contentEl.querySelectorAll("button").find((b) => b.textContent === "Übernehmen"));
  await warte(60);
  const gesetzt = geschrieben[geschrieben.length - 1].fm.leitsterne;
  pruefe(Array.isArray(gesetzt), "Leitsterne werden als Liste geschrieben");
  pruefe(
    gesetzt.every((w) => /^\[\[.+\]\]$/.test(w)),
    `als Wikilinks (${JSON.stringify(gesetzt)})`
  );

  console.log("\nLöschen");
  registriert.menues.length = 0;
  registriert.modale.length = 0;
  klick(el().querySelectorAll(".cb-tab")[0]);
  await warte();
  const zeile = el().querySelector(".cb-zeile");
  const menüEreignis = ereignisSenden(zeile, "contextmenu");
  pruefe(menüEreignis.defaultPrevented, "Rechtsklick unterdrückt das Standardmenü");
  const menü = registriert.menues[0];
  const eintrag = (m, titel) => m.eintraege.find((e) => e.titel === titel);
  pruefe(menü !== undefined, "Rechtsklick öffnet ein Menü");
  pruefe(eintrag(menü, "Notiz öffnen") !== undefined, "mit „Notiz öffnen“");
  pruefe(eintrag(menü, "Notiz löschen") !== undefined, "und „Notiz löschen“");

  eintrag(menü, "Notiz löschen").klick();
  const modal = registriert.modale[0];
  pruefe(modal !== undefined, "Löschen fragt erst nach");
  pruefe(modal.contentEl.textContent.includes("Papierkorb"), "die Rückfrage nennt den Papierkorb");

  const abbrechen = modal.contentEl.querySelectorAll("button").find((b) => b.textContent === "Abbrechen");
  klick(abbrechen);
  await warte();
  pruefe(geloescht.length === 0, "Abbrechen löscht nichts");

  eintrag(menü, "Notiz löschen").klick();
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
  registriert.menues[0].eintraege.find((e) => e.titel === "Notiz löschen").klick();
  const sternModal = registriert.modale[registriert.modale.length - 1];
  pruefe(
    /\d+ Aufgaben verweisen darauf/.test(sternModal.contentEl.textContent),
    "beim Leitstern warnt die Rückfrage vor verwaisten Zuordnungen"
  );
  klick(sternModal.contentEl.querySelectorAll("button").find((b) => b.textContent === "Abbrechen"));

  console.log(fehler === 0 ? "\nAlle Prüfungen bestanden." : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
  process.exit(fehler === 0 ? 0 : 1);
})();
