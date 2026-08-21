"use strict";

/*
 * Ein sehr kleines DOM, das genau die Fähigkeiten hat, die das Plugin benutzt:
 * Obsidians createDiv/createEl-Helfer, Klassen, Attribute, Events und einfache
 * Selektoren. Damit lässt sich die Ansicht ohne Obsidian und ohne fremde Pakete prüfen.
 */

class Klassenliste {
  constructor(el) {
    this.el = el;
    this.werte = new Set();
  }
  add(...c) { c.forEach((x) => x && this.werte.add(x)); }
  remove(...c) { c.forEach((x) => this.werte.delete(x)); }
  contains(c) { return this.werte.has(c); }
  toggle(c, an) {
    const soll = an === undefined ? !this.werte.has(c) : !!an;
    if (soll) this.werte.add(c);
    else this.werte.delete(c);
  }
  toString() { return [...this.werte].join(" "); }
}

class Ereignis {
  constructor(typ) {
    this.type = typ;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class Element {
  constructor(tag) {
    this.tagName = tag.toLowerCase();
    this.children = [];
    this.parent = null;
    this.attribute = new Map();
    this.classList = new Klassenliste(this);
    this.style = { werte: new Map(), setProperty: (k, v) => this.style.werte.set(k, v) };
    this.eigenerText = "";
    this.horcher = new Map();
    this.value = "";
    this.selected = false;
    this.disabled = false;
    this.tabIndex = 0;
  }

  /* --- Struktur --- */

  appendChild(kind) {
    kind.parent = this;
    this.children.push(kind);
    return kind;
  }
  removeChild(kind) {
    const i = this.children.indexOf(kind);
    if (i >= 0) this.children.splice(i, 1);
    return kind;
  }
  remove() { if (this.parent) this.parent.removeChild(this); }
  get firstChild() { return this.children[0] || null; }

  /* --- Inhalt --- */

  get textContent() {
    return this.eigenerText + this.children.map((k) => k.textContent).join("");
  }
  set textContent(wert) {
    this.children = [];
    this.eigenerText = String(wert);
  }
  setText(wert) { this.textContent = wert; }

  /* --- Attribute und Klassen --- */

  setAttribute(name, wert) { this.attribute.set(name, String(wert)); }
  getAttribute(name) { return this.attribute.has(name) ? this.attribute.get(name) : null; }
  get className() { return this.classList.toString(); }
  addClass(...c) { this.classList.add(...c); }
  removeClass(...c) { this.classList.remove(...c); }
  toggleClass(c, an) { this.classList.toggle(c, an); }

  /* --- Obsidian-Helfer --- */

  createEl(tag, o) {
    const el = new Element(tag);
    const opt = o || {};
    if (opt.cls) String(opt.cls).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    if (opt.text !== undefined) el.textContent = String(opt.text);
    if (opt.type) el.setAttribute("type", opt.type);
    if (opt.href) el.setAttribute("href", opt.href);
    if (opt.value !== undefined) {
      el.setAttribute("value", opt.value);
      el.value = String(opt.value);
    }
    if (opt.attr) for (const [k, v] of Object.entries(opt.attr)) el.setAttribute(k, String(v));
    return this.appendChild(el);
  }
  createDiv(o) { return this.createEl("div", o); }
  createSpan(o) { return this.createEl("span", o); }
  empty() { this.children = []; this.eigenerText = ""; }
  detach() { this.remove(); }

  /* --- Fokus und Auswahl (im Test ohne Wirkung) --- */

  focus() {}
  setSelectionRange() {}

  /* --- Events --- */

  addEventListener(typ, fn) {
    if (!this.horcher.has(typ)) this.horcher.set(typ, []);
    this.horcher.get(typ).push(fn);
  }
  dispatchEvent(ereignis) {
    const e = typeof ereignis === "string" ? new Ereignis(ereignis) : ereignis;
    if (this.disabled && (e.type === "click" || e.type === "change")) return false;
    for (const fn of this.horcher.get(e.type) || []) fn(e);
    return !e.defaultPrevented;
  }

  /* --- Selektoren: nur ".klasse", "tag" und Nachfahren mit Leerzeichen --- */

  passtAuf(teil) {
    if (teil.startsWith(".")) return this.classList.contains(teil.slice(1));
    return this.tagName === teil.toLowerCase();
  }
  alleNachfahren(treffer = []) {
    for (const kind of this.children) {
      treffer.push(kind);
      kind.alleNachfahren(treffer);
    }
    return treffer;
  }
  querySelectorAll(selektor) {
    const teile = selektor.trim().split(/\s+/);
    let ebene = [this];
    for (const teil of teile) {
      const naechste = [];
      for (const el of ebene) {
        for (const kandidat of el.alleNachfahren()) {
          if (kandidat.passtAuf(teil) && !naechste.includes(kandidat)) naechste.push(kandidat);
        }
      }
      ebene = naechste;
    }
    return ebene;
  }
  querySelector(selektor) {
    return this.querySelectorAll(selektor)[0] || null;
  }

}

/** Ein Wurzelelement, das als Container dient. */
function neuesDokument() {
  return new Element("body");
}

module.exports = { Element, Ereignis, neuesDokument };
