"use strict";

/* Lädt main.js mit dem Obsidian-Stub und öffnet die Board-Ansicht im Mini-DOM. */

const Module = require("node:module");
const { join } = require("node:path");
const { neuesDokument, Ereignis } = require("./mini-dom");
const { existsSync } = require("node:fs");
const { vaultLaden } = require("./vault-stub");

const repo = join(__dirname, "..", "..");
// Voreinstellung ist das Test-Vault neben dem Repo; per Argument oder
// CHANGE_BOARD_VAULT lässt sich ein anderes angeben.
const vaultPfad =
  process.argv.find((a) => !a.startsWith("-") && a.includes("Vault")) ||
  process.env.CHANGE_BOARD_VAULT ||
  join(repo, "..", "Change Board Test Vault");

// require("obsidian") auf den Stub umbiegen, bevor main.js geladen wird.
const stub = require.resolve("./obsidian-stub");
const eigentlichesAufloesen = Module._resolveFilename;
Module._resolveFilename = function (anfrage, ...rest) {
  if (anfrage === "obsidian") return stub;
  return eigentlichesAufloesen.call(this, anfrage, ...rest);
};

const ChangeBoardPlugin = require(join(repo, "main.js"));

async function boardAufbauen() {
  if (!existsSync(vaultPfad)) {
    throw new Error(
      `Kein Vault unter ${vaultPfad}.\n` +
        "Pfad als Argument übergeben oder in CHANGE_BOARD_VAULT setzen."
    );
  }
  const { vault, metadataCache, fileManager, geschrieben, angelegt, geloescht } = vaultLaden(vaultPfad);
  const geoeffnet = [];
  const blaetter = [];

  const app = {
    vault,
    metadataCache,
    fileManager,
    workspace: {
      getLeavesOfType: (typ) => (typ === "markdown" ? markdownBlaetter : blaetter),
      getLeaf: () => blatt,
      revealLeaf: () => {},
      on: () => ({}),
      onLayoutReady: (fn) => fn(),
    },
  };
  const markdownBlaetter = [];
  // openFile gehört wie in Obsidian ans Blatt, nicht an den Workspace.
  const blatt = {
    app,
    containerEl: neuesDokument(),
    setViewState: async () => {},
    openFile: async (datei, zustand) => geoeffnet.push({ pfad: datei.path, zustand }),
    view: null,
  };
  blaetter.push(blatt);

  const manifest = JSON.parse(require("node:fs").readFileSync(join(repo, "manifest.json"), "utf8"));
  const plugin = new ChangeBoardPlugin(app, manifest);
  await plugin.onload();

  const view = plugin._views.get("change-board-view")(blatt);
  blatt.view = view;
  await view.onOpen();

  return {
    plugin,
    view,
    geschrieben,
    angelegt,
    geloescht,
    geoeffnet,
    manifest,
    klick: (el) => el.dispatchEvent(new Ereignis("click")),
    rechtsklick: (el) => el.dispatchEvent(new Ereignis("contextmenu")),
    // Gibt das Ereignis zurück, damit sich preventDefault/stopPropagation prüfen lassen.
    ereignisSenden: (el, typ) => {
      const e = new Ereignis(typ);
      el.dispatchEvent(e);
      return e;
    },
    aendern: (el) => el.dispatchEvent(new Ereignis("change")),
    eingabe: (el) => el.dispatchEvent(new Ereignis("input")),
    warte: (ms = 20) => new Promise((r) => setTimeout(r, ms)),
  };
}

module.exports = { boardAufbauen, intern: ChangeBoardPlugin.__test__ };
