"use strict";

/* Ein Vault-Ersatz, der die Notizen direkt von der Platte liest. */

const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");
const { TFile, TFolder } = require("./obsidian-stub");

/** Sehr einfacher YAML-Leser für das Frontmatter-Format, das der Generator schreibt. */
function frontmatterLesen(inhalt) {
  const treffer = inhalt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!treffer) return null;
  const fm = {};
  let listenSchluessel = null;
  for (const zeile of treffer[1].split(/\r?\n/)) {
    const listeneintrag = zeile.match(/^\s+-\s+(.*)$/);
    if (listeneintrag && listenSchluessel) {
      fm[listenSchluessel].push(wert(listeneintrag[1]));
      continue;
    }
    const paar = zeile.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!paar) continue;
    if (paar[2] === "") {
      listenSchluessel = paar[1];
      fm[paar[1]] = [];
    } else {
      listenSchluessel = null;
      fm[paar[1]] = wert(paar[2]);
    }
  }
  return fm;
}

function wert(roh) {
  const s = roh.trim();
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function vaultLaden(wurzel) {
  const dateien = new Map();
  const ordner = new Map();

  const holeOrdner = (pfad) => {
    if (!ordner.has(pfad)) ordner.set(pfad, new TFolder(pfad));
    return ordner.get(pfad);
  };
  holeOrdner("");

  const durchlaufen = (absolut) => {
    for (const eintrag of readdirSync(absolut)) {
      if (eintrag.startsWith(".")) continue;
      const voll = join(absolut, eintrag);
      const rel = relative(wurzel, voll).split(sep).join("/");
      const elternPfad = rel.split("/").slice(0, -1).join("/");
      if (statSync(voll).isDirectory()) {
        holeOrdner(elternPfad).children.push(holeOrdner(rel));
        durchlaufen(voll);
      } else if (eintrag.endsWith(".md")) {
        const datei = new TFile(rel, readFileSync(voll, "utf8"));
        dateien.set(rel, datei);
        holeOrdner(elternPfad).children.push(datei);
      }
    }
  };
  durchlaufen(wurzel);

  const vault = {
    getName: () => "Change Board Test Vault",
    getAbstractFileByPath: (p) => ordner.get(p) || dateien.get(p) || null,
    cachedRead: async (datei) => datei.inhalt,
    on: () => ({}),
  };

  const metadataCache = {
    getFileCache: (datei) => ({ frontmatter: frontmatterLesen(datei.inhalt) }),
    getFirstLinkpathDest: (link) => {
      for (const datei of dateien.values()) {
        if (datei.basename === link || datei.path === link || datei.path === link + ".md") return datei;
      }
      return null;
    },
    on: () => ({}),
  };

  // Geschrieben wird nur im Arbeitsspeicher — der Test fasst das Vault nicht an.
  const geschrieben = [];
  const fileManager = {
    processFrontMatter: async (datei, cb) => {
      const fm = frontmatterLesen(datei.inhalt) || {};
      cb(fm);
      geschrieben.push({ pfad: datei.path, fm: Object.assign({}, fm) });
      datei.inhalt = datei.inhalt.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_m, a, koerper, c) =>
        a + koerper.replace(/^status:.*$/m, `status: ${fm.status}`) + c
      );
    },
  };

  return { vault, metadataCache, fileManager, dateien, geschrieben };
}

module.exports = { vaultLaden, frontmatterLesen };
