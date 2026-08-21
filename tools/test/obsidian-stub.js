"use strict";

/* Minimaler Ersatz für das Obsidian-Modul, damit main.js außerhalb der App läuft. */

const { neuesDokument } = require("./mini-dom");

const registriert = { icons: new Map(), ribbon: [], intervalle: [], hinweise: [], menues: [], modale: [] };

class TAbstractFile {
  constructor(path) {
    this.path = path;
    this.name = path.split("/").pop();
  }
}
class TFile extends TAbstractFile {
  constructor(path, inhalt) {
    super(path);
    this.inhalt = inhalt;
    this.extension = path.split(".").pop();
    this.basename = this.name.replace(/\.[^.]+$/, "");
  }
}
class TFolder extends TAbstractFile {
  constructor(path) {
    super(path);
    this.children = [];
  }
}

class Component {
  registerEvent() {}
  addChild(c) { return c; }
  /** Wie in Obsidian: das Intervall gehört der Komponente. Im Test darf es den
   *  Prozess nicht offen halten. */
  registerInterval(id) {
    if (id && typeof id.unref === "function") id.unref();
    registriert.intervalle.push(id);
    return id;
  }
}

class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.contentEl = neuesDokument();
    this.contentEl.scrollTop = 0;
  }
}

class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
    this._daten = null;
    this._views = new Map();
    this._befehle = [];
  }
  registerView(typ, fabrik) { this._views.set(typ, fabrik); }
  addRibbonIcon(icon, titel) { registriert.ribbon.push({ icon, titel }); return neuesDokument(); }
  addCommand(b) { this._befehle.push(b); }
  addSettingTab() {}
  registerEvent() {}
  async loadData() { return this._daten; }
  async saveData(d) { this._daten = JSON.parse(JSON.stringify(d)); }
}

class PluginSettingTab {
  constructor(app) {
    this.app = app;
    this.containerEl = neuesDokument();
  }
}
class Setting {
  constructor(el) { this.el = el; }
  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addText(cb) { cb({ setPlaceholder: () => this, setValue: () => this, onChange: () => this }); return this; }
  addToggle(cb) { cb({ setValue: () => this, onChange: () => this }); return this; }
}

const MarkdownRenderer = {
  /** Statt echter Markdown-Verarbeitung genügt hier der Rohtext im DOM. */
  async render(_app, quelltext, ziel) {
    ziel.createEl("p", { text: quelltext });
  },
};

function addIcon(name, svg) { registriert.icons.set(name, svg); }
function normalizePath(p) { return p.replace(/\\/g, "/").replace(/\/+$/, ""); }
function debounce(fn) {
  const f = (...args) => fn(...args);
  f.cancel = () => {};
  return f;
}
class WorkspaceLeaf {}
class Notice {
  constructor(text) {
    this.text = text;
    registriert.hinweise.push(text);
  }
}

/** Kontextmenü: die Einträge werden gesammelt, statt sie anzuzeigen. */
class Menu {
  constructor() { this.eintraege = []; }
  addItem(aufbau) {
    const eintrag = {
      titel: "", icon: "", klick: null, angehakt: false,
      setTitle(t) { this.titel = t; return this; },
      setIcon(i) { this.icon = i; return this; },
      setChecked(v) { this.angehakt = v; return this; },
      onClick(fn) { this.klick = fn; return this; },
    };
    aufbau(eintrag);
    this.eintraege.push(eintrag);
    return this;
  }
  addSeparator() { this.eintraege.push({ trenner: true }); return this; }
  showAtMouseEvent() { registriert.menues.push(this); return this; }
}

class Modal {
  constructor(app) {
    this.app = app;
    this.titleEl = neuesDokument();
    this.contentEl = neuesDokument();
  }
  open() { registriert.modale.push(this); if (this.onOpen) this.onOpen(); }
  close() { if (this.onClose) this.onClose(); }
}

module.exports = {
  TAbstractFile, TFile, TFolder, Component, ItemView, Plugin, PluginSettingTab,
  Setting, MarkdownRenderer, addIcon, normalizePath, debounce, WorkspaceLeaf, Notice, Menu, Modal, registriert,
};
