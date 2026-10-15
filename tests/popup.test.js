/* The popup: its load path, its markup, and what a press actually produces.
 *
 *   node --test tests/
 *
 * These run the real files through tests/harness.js, which loads them into one
 * node:vm context in the order popup.html lists them -- the same shared global
 * scope a browser gives four <script> tags. That is worth more than it sounds:
 * a top-level `const` declared in two of those files is a SyntaxError that
 * would only appear when the popup was opened, and this suite is the only
 * thing here that can see it.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const harness = require("./harness.js");
const cal = require("../src/lib/bs-calendar.js");
const model = require("../src/lib/popup-model.js");

const ROOT = path.join(__dirname, "..");

/* ── The load path ────────────────────────────────────────────────────── */

test("popup.html loads the library before the code that uses it", () => {
  assert.deepEqual(harness.scriptPaths(), [
    "../lib/calendar-data.js",
    "../lib/bs-calendar.js",
    "../lib/popup-model.js",
    "popup.js",
  ]);
});

test("all four scripts load into one shared scope without colliding", () => {
  /* calendar-data.js declares five top-level consts and bs-calendar.js reads
   * them. If either file reuses one of those names, this throws. */
  const popup = harness.loadPopup({ now: "2026-09-18" });
  assert.equal(popup.loaded.length, 4);

  /* A function declaration lands on the global object; a top-level const
   * lands in the global lexical scope beside it. Both have to be reachable
   * from the last script for the popup to work at all. */
  assert.equal(popup.evaluate("typeof adToBs"), "function");
  assert.equal(popup.evaluate("typeof defaultSelection"), "function");
  assert.equal(popup.evaluate("BS_FIRST_YEAR"), 2000);
  assert.equal(popup.evaluate("BS_MONTH_LENGTHS.length"), 91);
});

test("the popup needs no extension APIs at all", () => {
  /* Nothing here touches chrome.*, which is why the manifest can ask for no
   * permissions. The harness provides no chrome object, so a reference to one
   * would have thrown on load. */
  ["src/popup/popup.js", "src/lib/popup-model.js", "src/lib/bs-calendar.js"].forEach(function (file) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.equal(/\bchrome\./.test(source), false, file + " uses a chrome API");
    assert.equal(/\bbrowser\./.test(source), false, file + " uses a browser API");
  });
});

/* ── The markup agrees with the library ───────────────────────────────── */

test("the AD month options are January to December, valued 1 to 12", () => {
  const options = harness.markupOptions("adMonth");
  assert.equal(options.length, 12);
  options.forEach(function (option, i) {
    assert.equal(option.value, String(i + 1));
    assert.equal(option.label, cal.AD_MONTH_NAMES[i]);
  });
});

test("the BS month options match the names the error messages use", () => {
  /* An error says "Bhadra 2082 has 31 days." and the user looks at a dropdown
   * to find Bhadra. If the two lists ever drift, the message points at a month
   * that is not on screen. */
  const options = harness.markupOptions("bsMonth");
  assert.equal(options.length, 12);
  options.forEach(function (option, i) {
    assert.equal(option.value, String(i + 1));
    assert.equal(option.label, cal.BS_MONTH_NAMES[i]);
  });
});

test("no month is preselected in the markup any more", () => {
  /* September and Ashwin used to be hardcoded `selected` here, alongside the
   * day-8 and day-24 defaults in the script. The script sets today now. */
  const html = harness.popupHtml();
  assert.equal(/<option[^>]*\sselected/.test(html), false, "an option is still marked selected");
});

/* ── What the dropdowns end up containing ─────────────────────────────── */

test("the day dropdowns cover the longest month of each calendar", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  assert.equal(popup.document.getElementById("adDay").options.length, 31);
  assert.equal(popup.document.getElementById("bsDay").options.length, 32);
});

test("the year dropdowns cover exactly the convertible range", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });

  const adYears = popup.document.getElementById("adYear").options;
  assert.equal(adYears[0].value, "1943");
  assert.equal(adYears[adYears.length - 1].value, "2034");

  const bsYears = popup.document.getElementById("bsYear").options;
  assert.equal(bsYears[0].value, "2000");
  assert.equal(bsYears[bsYears.length - 1].value, "2090");
});

test("a clock outside the table falls back visibly rather than plausibly", () => {
  /* Landing on 1943 tells the user something is wrong. Landing on a date a
   * couple of years out, which is what a clamped or approximate default would
   * give, does not. */
  const defaults = model.defaultSelection(new Date(1800, 0, 1));
  assert.equal(defaults.inRange, false);
  assert.deepEqual(defaults.ad, { year: 1943, month: 4, day: 14 });
  assert.deepEqual(defaults.bs, { year: 2000, month: 1, day: 1 });

  const far = model.defaultSelection(new Date(2200, 0, 1));
  assert.equal(far.inRange, false);
});

/* ── Converting ──────────────────────────────────────────────────────── */

function convertAd(popup, year, month, day) {
  popup.document.getElementById("adYear").value = String(year);
  popup.document.getElementById("adMonth").value = String(month);
  popup.document.getElementById("adDay").value = String(day);
  popup.submit("adToBsForm");
  return popup.result();
}

function convertBs(popup, year, month, day) {
  popup.document.getElementById("bsYear").value = String(year);
  popup.document.getElementById("bsMonth").value = String(month);
  popup.document.getElementById("bsDay").value = String(day);
  popup.submit("bsToAdForm");
  return popup.result();
}

test("AD to BS fills the panel with the date, the original and the direction", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  const result = convertAd(popup, 2025, 9, 8);

  assert.equal(result.className, "result-section success");
  assert.deepEqual(result.elements, ["output", "div", "div"]);
  assert.deepEqual(result.lines, ["2082/05/23", "Original: 2025-09-08", "AD to BS"]);
});

test("BS to AD does the same in the other direction", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  const result = convertBs(popup, 2082, 5, 23);

  assert.equal(result.className, "result-section success");
  assert.deepEqual(result.lines, ["2025-09-08", "Original: 2082/05/23", "BS to AD"]);
});

test("the two directions agree with each other", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  const forward = convertAd(popup, 2026, 9, 18);
  const back = convertBs(popup, 2083, 6, 2);
  assert.equal(forward.lines[0], "2083/06/02");
  assert.equal(back.lines[0], "2026-09-18");
});

test("the form submit is prevented, so the popup never navigates", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  assert.equal(popup.submit("adToBsForm"), true);
  assert.equal(popup.submit("bsToAdForm"), true);
});

test("a second conversion replaces the panel rather than adding to it", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  convertAd(popup, 2025, 9, 8);
  const second = convertAd(popup, 2025, 9, 9);
  assert.equal(second.elements.length, 3, "the first result was left behind");
  assert.equal(second.lines[0], "2082/05/24");
});

test("an error replaces a successful result, and the class changes with it", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  convertAd(popup, 2025, 9, 8);
  const failed = convertAd(popup, 2025, 2, 31);

  assert.equal(failed.className, "result-section error");
  assert.deepEqual(failed.elements, ["output"]);
  assert.equal(failed.lines[0], "February 2025 has 28 days.");

  const recovered = convertAd(popup, 2025, 2, 28);
  assert.equal(recovered.className, "result-section success");
  assert.equal(recovered.lines.length, 3);
});

test("a date past the table is refused with the range in the message", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  const result = convertBs(popup, 2090, 12, 30);
  assert.equal(result.className, "result-section success", "the last day of the table converts");

  const tooFar = convertAd(popup, 2034, 12, 31);
  assert.equal(tooFar.className, "result-section error");
  assert.match(tooFar.lines[0], /^Only AD dates from April 14, 1943 to April 13, 2034/);
});

/* ── Provisional years ────────────────────────────────────────────────── */

test("a provisional year says so on the direction line", () => {
  /* The published tables disagree from 2084 BS. Showing that date with the
   * same confidence as a 2083 one would be the wrong kind of quiet. */
  const popup = harness.loadPopup({ now: "2026-09-18" });

  const confirmed = convertBs(popup, 2083, 6, 2);
  assert.equal(confirmed.lines[2], "BS to AD");

  const provisional = convertBs(popup, 2085, 6, 2);
  assert.equal(provisional.lines[2], "BS to AD · provisional calendar data");
  assert.equal(provisional.className, "result-section success", "it is still an answer");
});

test("the provisional note appears in the AD to BS direction too", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  const provisional = cal.bsToAd(2085, 6, 2);
  const result = convertAd(popup, provisional.year, provisional.month, provisional.day);
  assert.equal(result.lines[2], "AD to BS · provisional calendar data");
});

test("resultLines labels each direction and carries the note through", () => {
  const plain = model.resultLines("adToBs", "2025-09-08", {
    formatted: "2082/05/23",
    provisional: false,
  });
  assert.deepEqual(plain, {
    converted: "2082/05/23",
    original: "Original: 2025-09-08",
    note: "AD to BS",
  });

  const flagged = model.resultLines("bsToAd", "2085/06/02", {
    formatted: "2028-09-17",
    provisional: true,
  });
  assert.equal(flagged.note, "BS to AD · provisional calendar data");
});
