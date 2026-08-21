"use strict";

/* Lädt main.js mit dem Obsidian-Stub und öffnet die Board-Ansicht im Mini-DOM. */

const Module = require("node:module");
const { join } = require("node:path");
const { neuesDokument, Ereignis } = require("./mini-dom");
const { vaultLaden } = require("./vault-stub");

const repo = join(__dirname, "..", "..");
const vaultPfad = join(repo, "..", "Change Board Test Vault");

// require("obsidian") auf den Stub umbiegen, bevor main.js geladen wird.
const stub = require.resolve("./obsidian-stub");
const eigentlichesAufloesen = Module._resolveFilename;
Module._resolveFilename = function (anfrage, ...rest) {
  if (anfrage === "obsidian") return stub;
  return eigentlichesAufloesen.call(this, anfrage, ...rest);
};

const ChangeBoardPlugin = require(join(repo, "main.js"));

async function boardAufbauen() {
  const { vault, metadataCache, fileManager, geschrieben } = vaultLaden(vaultPfad);
  const geoeffnet = [];
  const blaetter = [];

  const app = {
    vault,
    metadataCache,
    fileManager,
    workspace: {
      getLeavesOfType: () => blaetter,
      getLeaf: () => blatt,
      revealLeaf: () => {},
      openFile: (d) => geoeffnet.push(d.path),
    },
  };
  const blatt = { app, containerEl: neuesDokument(), setViewState: async () => {}, view: null };
  blaetter.push(blatt);

  const plugin = new ChangeBoardPlugin(app, { id: "change-board" });
  await plugin.onload();

  const view = plugin._views.get("change-board-view")(blatt);
  blatt.view = view;
  await view.onOpen();

  return {
    plugin,
    view,
    geschrieben,
    geoeffnet,
    klick: (el) => el.dispatchEvent(new Ereignis("click")),
    aendern: (el) => el.dispatchEvent(new Ereignis("change")),
    eingabe: (el) => el.dispatchEvent(new Ereignis("input")),
    warte: (ms = 20) => new Promise((r) => setTimeout(r, ms)),
  };
}

module.exports = { boardAufbauen, intern: ChangeBoardPlugin.__test__ };
