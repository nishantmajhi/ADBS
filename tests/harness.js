/*
 * Enough of a browser to load the real popup.
 *
 * The popup's four scripts are plain <script> tags sharing one global scope,
 * which is not a detail that can be faked by requiring the files: top-level
 * `const`s from a classic script go into the global lexical environment, so a
 * name declared twice across two files is a SyntaxError that only shows up
 * when the popup is actually opened. This harness reproduces that exactly --
 * one node:vm context, the same files, in the order popup.html lists them --
 * so the load path is covered by the suite rather than by opening Chrome.
 *
 * The script list and the static <option> lists are read out of popup.html
 * rather than restated here. A script tag left out of the markup, or a month
 * renamed in one place and not the other, fails a test instead of shipping.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const POPUP_DIR = path.join(ROOT, "src", "popup");
const POPUP_HTML = path.join(POPUP_DIR, "popup.html");

function popupHtml() {
  return fs.readFileSync(POPUP_HTML, "utf8");
}

/* Ordered <script src="..."> list from popup.html. */
function scriptPaths() {
  const html = popupHtml();
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/* The <option> list of a static <select> in the markup, as {value, label}. */
function markupOptions(selectId) {
  const html = popupHtml();
  const open = html.indexOf('<select id="' + selectId + '"');
  if (open < 0) throw new Error("no <select id=\"" + selectId + "\"> in popup.html");
  const close = html.indexOf("</select>", open);
  const block = html.slice(open, close);
  const out = [];
  const re = /<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = re.exec(block)) !== null) out.push({ value: m[1], label: m[2].trim() });
  return out;
}

/* ── A minimal DOM ────────────────────────────────────────────────────── */

class TextNode {
  constructor(data) {
    this.nodeType = 3;
    this.data = String(data);
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
}

class Element {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toLowerCase();
    this.childNodes = [];
    this.attributes = {};
    this.className = "";
    this.parentNode = null;
    this.selected = false;
    this.disabled = false;
    this.listeners = {};
    this._value = undefined;
    /* Every element that was ever built by parsing a markup string, anywhere
     * in this document. The XSS regression test reads it. */
    this.parsedElements = [];
  }

  get firstChild() {
    return this.childNodes.length ? this.childNodes[0] : null;
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i < 0) throw new Error("removeChild: not a child");
    this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }

  get textContent() {
    return this.childNodes.map(function (n) { return n.textContent; }).join("");
  }

  set textContent(text) {
    this.childNodes = [];
    if (text !== "" && text !== null && text !== undefined) {
      this.appendChild(new TextNode(text));
    }
  }

  /* Deliberately implemented, and deliberately noisy. Assigning to innerHTML
   * is what the original did, and a test needs to be able to watch markup in
   * a data string become elements. Nothing in the shipped popup uses it. */
  set innerHTML(html) {
    this.childNodes = [];
    this.parsedElements = [];
    const re = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*\/?>/g;
    let m;
    let text = html;
    while ((m = re.exec(html)) !== null) {
      const attrs = {};
      const attrRe = /([a-zA-Z-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
      let a;
      while ((a = attrRe.exec(m[2])) !== null) {
        if (!a[1]) continue;
        attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] || "";
      }
      this.parsedElements.push({ tag: m[1].toLowerCase(), attributes: attrs });
    }
    text = html.replace(/<[^>]*>/g, "");
    this.appendChild(new TextNode(text));
  }

  get innerHTML() {
    return this.childNodes.map(function (n) {
      return n.nodeType === 3 ? n.data : "<" + n.tagName + ">";
    }).join("");
  }

  get options() {
    return this.childNodes.filter(function (n) { return n.tagName === "option"; });
  }

  /* A <select> reports the value of its selected <option>, defaulting to the
   * first one, the way a real one does. Setting it selects the matching
   * option. Everything else stores a plain value. */
  get value() {
    if (this.tagName !== "select") return this._value === undefined ? "" : this._value;
    const options = this.options;
    for (let i = 0; i < options.length; i++) if (options[i].selected) return options[i].value;
    return options.length ? options[0].value : "";
  }

  set value(v) {
    if (this.tagName !== "select") {
      this._value = String(v);
      return;
    }
    const wanted = String(v);
    this.options.forEach(function (option) {
      option.selected = option.value === wanted;
    });
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  dispatch(type, event) {
    (this.listeners[type] || []).forEach(function (fn) {
      fn(event || { preventDefault: function () {} });
    });
  }
}

/* The popup's static markup, built from popup.html's own option lists. */
function createDocument() {
  const byId = {};
  const document = {
    listeners: {},
    createElement: function (tag) {
      return new Element(tag);
    },
    createTextNode: function (text) {
      return new TextNode(text);
    },
    getElementById: function (id) {
      return byId[id] || null;
    },
    addEventListener: function (type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    dispatch: function (type) {
      (this.listeners[type] || []).forEach(function (fn) { fn(); });
    },
  };

  ["adYear", "adDay", "bsYear", "bsDay"].forEach(function (id) {
    byId[id] = new Element("select");
  });

  [["adMonth", "adMonth"], ["bsMonth", "bsMonth"]].forEach(function (pair) {
    const select = new Element("select");
    markupOptions(pair[1]).forEach(function (o) {
      const option = new Element("option");
      option.value = o.value;
      option.textContent = o.label;
      select.appendChild(option);
    });
    byId[pair[0]] = select;
  });

  ["adToBsForm", "bsToAdForm"].forEach(function (id) {
    byId[id] = new Element("form");
  });
  ["adToBsBtn", "bsToAdBtn"].forEach(function (id) {
    byId[id] = new Element("button");
  });

  const result = new Element("section");
  result.className = "result-section";
  const initial = new Element("output");
  initial.textContent = "Select a date and convert!";
  result.appendChild(initial);
  byId.resultSection = result;

  return document;
}

/* Loads the popup exactly as the browser would, optionally on a fixed day.
 * `now` is an ISO date string, e.g. "2026-09-18". */
function loadPopup(options) {
  const opts = options || {};
  const document = createDocument();

  const sandbox = { document: document, console: console };
  if (opts.now) {
    const fixed = new Date(opts.now + "T12:00:00");
    /* Only `new Date()` with no arguments is pinned; everything else behaves
     * normally, because the library does real arithmetic with it. */
    const RealDate = Date;
    function FakeDate(...args) {
      if (args.length === 0) return new RealDate(fixed.getTime());
      return new RealDate(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = function () { return fixed.getTime(); };
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    sandbox.Date = FakeDate;
  }

  const context = vm.createContext(sandbox);
  const loaded = [];
  scriptPaths().forEach(function (src) {
    const file = path.join(POPUP_DIR, src);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    loaded.push(src);
  });

  document.dispatch("DOMContentLoaded");

  return {
    document: document,
    context: context,
    loaded: loaded,
    /* Top-level `const`s go into the context's global lexical scope rather
     * than onto the sandbox object, so they are invisible on `context` and
     * have to be asked for by evaluating in the same scope -- which is also
     * the only way to demonstrate that one script can see another's. */
    evaluate: function (expression) {
      return vm.runInContext(expression, context);
    },
    submit: function (formId) {
      let prevented = false;
      document.getElementById(formId).dispatch("submit", {
        preventDefault: function () { prevented = true; },
      });
      return prevented;
    },
    result: function () {
      const section = document.getElementById("resultSection");
      return {
        className: section.className,
        lines: section.childNodes.map(function (n) { return n.textContent; }),
        elements: section.childNodes.map(function (n) { return n.tagName; }),
        parsedElements: section.parsedElements,
      };
    },
  };
}

module.exports = {
  Element,
  TextNode,
  createDocument,
  loadPopup,
  markupOptions,
  popupHtml,
  scriptPaths,
  ROOT,
};
