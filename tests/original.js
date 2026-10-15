/*
 * The original popup's decisions, transcribed with their I/O lifted out.
 *
 * The original cannot be run here. Every one of its code paths begins with a
 * fetch to bolpatra.gov.np, and a test suite that reaches a government server
 * to prove a bug is not a test suite. So the three decisions that changed are
 * copied out verbatim -- the result panel it built, and the two dropdown
 * defaults it picked -- with the network and the DOM removed and nothing else
 * altered.
 *
 * A transcription is only worth anything if it is still a transcription, so
 * `assertStillMatchesOriginal()` pulls the original file out of git and
 * asserts the exact lines these functions were copied from are still in it.
 * If someone rewrites history, or this file drifts, the regression tests fail
 * loudly rather than quietly proving something about code that never existed.
 */

"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/* The commit that holds the code as it was found. */
const ORIGINAL_COMMIT = "50feea9";

function originalSource(file) {
  return execFileSync("git", ["show", ORIGINAL_COMMIT + ":" + file], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

/* Lines these transcriptions were taken from, quoted exactly. */
const QUOTED_LINES = [
  /* the result panel, built by interpolation (popup.js:189-197) */
  "    resultSection.innerHTML = `",
  "      <output>${data.convertedDate}</output>",
  '      <div class="result-details">Original: ${data.originalDate.formatted}</div>',
  '      <div class="result-details">${data.type}</div>',
  "    resultSection.innerHTML = `<output>${data}</output>`;",
  /* the hardcoded dropdown defaults (popup.js:64, 74, 96) */
  "    if (i === 8) option.selected = true;",
  "    if (i === 24) option.selected = true;",
  "  const currentBsYear = 2082; // Approximate current BS year",
  /* the fallback year ranges (popup.js:52-53) */
  "  const defaultAdYears = Array.from({ length: 90 }, (_, i) => 1944 + i); // 1944-2033",
  "  const defaultBsYears = Array.from({ length: 90 }, (_, i) => 2000 + i); // 2000-2089",
  /* the discarded pre-fetch and the ignored Referer (popup.js:204, 220) */
  '    await fetch("https://www.bolpatra.gov.np/egp/openDateConverter");',
  '          Referer: "https://www.bolpatra.gov.np/egp/openDateConverter",',
];

function assertStillMatchesOriginal(assert) {
  const source = originalSource("src/popup/popup.js");
  QUOTED_LINES.forEach(function (line) {
    assert.ok(
      source.includes(line),
      "the original no longer contains the line this was transcribed from: " + line
    );
  });
}

/* ── The transcribed decisions ────────────────────────────────────────── */

/* popup.js:184-198, with the assignment to resultSection.innerHTML returned
 * instead of performed. The template literal is character for character what
 * was there. */
function originalShowResultHtml(data, isSuccess) {
  if (isSuccess === undefined) isSuccess = true;
  if (isSuccess) {
    return `
      <output>${data.convertedDate}</output>
      <div class="result-details">Original: ${data.originalDate.formatted}</div>
      <div class="result-details">${data.type}</div>
    `;
  }
  return `<output>${data}</output>`;
}

/* popup.js:58-76. The loops built 1-31 and 1-32 and marked one fixed entry
 * selected, with no reference to the date at all. */
function originalAdDaySelection() {
  let selected = null;
  for (let i = 1; i <= 31; i++) {
    if (i === 8) selected = i;
  }
  return selected;
}

function originalBsDaySelection() {
  let selected = null;
  for (let i = 1; i <= 32; i++) {
    if (i === 24) selected = i;
  }
  return selected;
}

/* popup.js:94-111. The BS year was a constant, and when it was not in the
 * list the code fell back to whichever year happened to sit in the middle. */
function originalBsYearSelection(years) {
  const currentBsYear = 2082;
  if (years.includes(currentBsYear)) return currentBsYear;
  return years[Math.floor(years.length / 2)];
}

/* popup.js:78-92. The AD year did use the real year, which is why the AD year
 * dropdown was the one part of the defaults that was right. */
function originalAdYearSelection(years, now) {
  const currentYear = (now || new Date()).getFullYear();
  if (years.includes(currentYear)) return currentYear;
  return years[Math.floor(years.length / 2)];
}

module.exports = {
  ORIGINAL_COMMIT,
  QUOTED_LINES,
  originalSource,
  assertStillMatchesOriginal,
  originalShowResultHtml,
  originalAdDaySelection,
  originalBsDaySelection,
  originalBsYearSelection,
  originalAdYearSelection,
};
