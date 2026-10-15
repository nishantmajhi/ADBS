/*
 * Popup wiring. Element creation and event handlers only -- every decision it
 * makes is asked of ../lib/popup-model.js or ../lib/bs-calendar.js.
 *
 * Two rules hold throughout this file:
 *
 *   Nothing is ever assigned to innerHTML. The result panel used to be built
 *   by interpolating a converted date into a template string, and that date
 *   came out of a remote web page, so any markup in the response was parsed
 *   and run inside the extension's own origin. The conversion is local now and
 *   there is no remote content left to inject, but building the panel out of
 *   elements and text nodes is what makes that true permanently rather than
 *   for as long as nobody adds another source. tests/popup.test.js fails if
 *   the string "innerHTML" reappears here.
 *
 *   Nothing here talks to the network. The extension has no host permissions.
 */

"use strict";

/* ── Small DOM helpers ────────────────────────────────────────────────── */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function replaceChildren(node, children) {
  while (node.firstChild) node.removeChild(node.firstChild);
  children.forEach(function (child) {
    node.appendChild(child);
  });
}

function fillSelect(select, values, selectedValue) {
  values.forEach(function (value) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    if (value === selectedValue) option.selected = true;
    select.appendChild(option);
  });
}

function selectValue(select, value) {
  select.value = String(value);
}

function readInt(id) {
  return parseInt(document.getElementById(id).value, 10);
}

/* ── Startup ──────────────────────────────────────────────────────────── */

function initializeDropdowns() {
  const defaults = defaultSelection();

  const adDays = [];
  for (let i = 1; i <= AD_MAX_DAY; i++) adDays.push(i);
  const bsDays = [];
  for (let i = 1; i <= BS_MAX_DAY; i++) bsDays.push(i);

  fillSelect(document.getElementById("adDay"), adDays, defaults.ad.day);
  fillSelect(document.getElementById("bsDay"), bsDays, defaults.bs.day);
  fillSelect(document.getElementById("adYear"), adYearOptions(), defaults.ad.year);
  fillSelect(document.getElementById("bsYear"), bsYearOptions(), defaults.bs.year);

  /* The month lists are in the markup, so they are selected rather than
   * built. */
  selectValue(document.getElementById("adMonth"), defaults.ad.month);
  selectValue(document.getElementById("bsMonth"), defaults.bs.month);
}

/* ── The result panel ─────────────────────────────────────────────────── */

function showResult(lines) {
  const section = document.getElementById("resultSection");
  section.className = "result-section success";
  replaceChildren(section, [
    el("output", null, lines.converted),
    el("div", "result-details", lines.original),
    el("div", "result-details", lines.note),
  ]);
}

function showError(message) {
  const section = document.getElementById("resultSection");
  section.className = "result-section error";
  replaceChildren(section, [el("output", null, message)]);
}

/* ── Conversion ───────────────────────────────────────────────────────── */

/* The conversion is a table lookup, so there is no longer anything to wait
 * for and no loading state to show. What used to happen here was two network
 * round trips to bolpatra.gov.np per press -- one that fetched the converter
 * page and threw the response away, and one that posted the date and scraped
 * the answer out of the returned HTML. */

function convert(direction) {
  try {
    if (direction === "adToBs") {
      const year = readInt("adYear");
      const month = readInt("adMonth");
      const day = readInt("adDay");
      const converted = adToBs(year, month, day);
      showResult(resultLines("adToBs", formatAd({ year: year, month: month, day: day }), converted));
    } else {
      const year = readInt("bsYear");
      const month = readInt("bsMonth");
      const day = readInt("bsDay");
      const converted = bsToAd(year, month, day);
      showResult(resultLines("bsToAd", formatBs({ year: year, month: month, day: day }), converted));
    }
  } catch (error) {
    showError(error.message);
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", function () {
  initializeDropdowns();

  document.getElementById("adToBsForm").addEventListener("submit", function (event) {
    event.preventDefault();
    convert("adToBs");
  });

  document.getElementById("bsToAdForm").addEventListener("submit", function (event) {
    event.preventDefault();
    convert("bsToAd");
  });
});
