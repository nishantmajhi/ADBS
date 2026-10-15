/* The bugs that were actually there, proved against the original code.
 *
 *   node --test tests/
 *
 * Every test in this file does the same two things: run the original
 * decision, from tests/original.js, and assert it is wrong; then run the
 * current one and assert it is not. A test that only checks the new code
 * proves the new code does something. It does not prove there was ever
 * anything to fix, and two of the findings in this project's review turned
 * out to be worth less than they looked.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const original = require("./original.js");
const harness = require("./harness.js");
const cal = require("../src/lib/bs-calendar.js");
const model = require("../src/lib/popup-model.js");

const ROOT = path.join(__dirname, "..");

/* Several checks below ask what the code does, and the comments in these files
 * discuss the very things being banned -- innerHTML, fetch, bolpatra. Scanning
 * the raw text would fail on the explanation of the fix rather than the fix.
 * Comments come out first. */
function codeOf(file) {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* Every parseInt call in a file, with its arguments, matched by balancing the
 * parentheses -- a regex stopping at the first ")" reports
 * parseInt(foo(x), 10) as having no radix. */
function parseIntCalls(source) {
  const calls = [];
  let at = source.indexOf("parseInt(");
  while (at >= 0) {
    let depth = 0;
    let i = at + "parseInt".length;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(at, i + 1));
    at = source.indexOf("parseInt(", i);
  }
  return calls;
}

test("the transcriptions still match the original in git", () => {
  original.assertStillMatchesOriginal(assert);
});

/* ── P1: markup from a remote page reached the popup's DOM ────────────── */

test("the original built the result panel by interpolating into innerHTML", () => {
  /* convertedDate was scraped out of bolpatra.gov.np's response. Anything in
   * that response was markup by the time it reached here. */
  const payload = '<img src=x onerror="stealEverything()">';
  const html = original.originalShowResultHtml(
    {
      convertedDate: payload,
      originalDate: { formatted: "2025-09-08" },
      type: "AD to BS",
    },
    true
  );

  assert.ok(html.includes(payload), "the payload was interpolated verbatim");

  /* Assigning that to innerHTML is what turns it into elements. */
  const node = new harness.Element("section");
  node.innerHTML = html;

  const injected = node.parsedElements.filter(function (e) { return e.tag === "img"; });
  assert.equal(injected.length, 1, "an <img> element reached the DOM");
  assert.equal(
    injected[0].attributes.onerror,
    "stealEverything()",
    "carrying an event handler attribute, inside the extension's own origin"
  );
});

test("the original's error branch had the same hole", () => {
  const html = original.originalShowResultHtml("<script>bad()</script>", false);
  const node = new harness.Element("section");
  node.innerHTML = html;
  assert.ok(
    node.parsedElements.some(function (e) { return e.tag === "script"; }),
    "a <script> element reached the DOM from an error message"
  );
});

test("the popup now puts the same payload on screen as text", () => {
  const payload = '<img src=x onerror="stealEverything()">';
  const popup = harness.loadPopup({ now: "2026-09-18" });

  /* There is no remote content left to inject, so the payload has to be fed
   * in as an error message -- which is the branch that took error.message
   * straight into innerHTML. */
  popup.context.showError(payload);

  const result = popup.result();
  assert.deepEqual(result.elements, ["output"], "one output element, built not parsed");
  assert.equal(result.lines[0], payload, "the payload is the text of it, verbatim");
  assert.deepEqual(
    popup.document.getElementById("resultSection").parsedElements,
    [],
    "nothing was ever parsed as markup"
  );
});

test("the shipped popup never assigns to innerHTML at all", () => {
  /* The rule is easier to keep than to remember: the file never assigns to
   * it. The comment at the top of popup.js explains why, which is the reason
   * this looks at the code rather than the raw text. */
  assert.equal(
    /\.innerHTML\s*=/.test(codeOf("src/popup/popup.js")),
    false,
    "popup.js assigns to innerHTML"
  );

  const originalSource = original.originalSource("src/popup/popup.js");
  const originalCount = originalSource.split("innerHTML").length - 1;
  assert.ok(originalCount >= 4, "the original used it " + originalCount + " times");
});

/* ── P1: hardcoded development defaults ───────────────────────────────── */

test("the original always preselected the 8th and the 24th, whatever the date", () => {
  assert.equal(original.originalAdDaySelection(), 8);
  assert.equal(original.originalBsDaySelection(), 24);
});

test("the original's BS year was a constant that had already drifted", () => {
  const years = [];
  for (let y = 2000; y <= 2090; y++) years.push(y);
  assert.equal(original.originalBsYearSelection(years), 2082);

  /* 2082 BS ended on 2026-04-13. The constant was already a year out on the
   * day this pass ran. */
  assert.equal(cal.todayBs(new Date(2026, 8, 18)).year, 2083);
});

test("the defaults are now today's date, in both calendars", () => {
  const onADate = model.defaultSelection(new Date(2026, 8, 18, 10, 0, 0));
  assert.equal(onADate.inRange, true);
  assert.deepEqual(onADate.ad, { year: 2026, month: 9, day: 18 });
  assert.deepEqual(onADate.bs, { year: 2083, month: 6, day: 2 });

  /* A different day gives a different answer, which is the entire point and
   * the thing the original could not do. */
  const onAnother = model.defaultSelection(new Date(2024, 0, 1, 10, 0, 0));
  assert.deepEqual(onAnother.ad, { year: 2024, month: 1, day: 1 });
  assert.deepEqual(onAnother.bs, { year: 2080, month: 9, day: 16 });
});

test("the loaded popup preselects today in every dropdown", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  const value = function (id) { return popup.document.getElementById(id).value; };

  assert.equal(value("adYear"), "2026");
  assert.equal(value("adMonth"), "9");
  assert.equal(value("adDay"), "18");
  assert.equal(value("bsYear"), "2083");
  assert.equal(value("bsMonth"), "6");
  assert.equal(value("bsDay"), "2");
});

test("a different day loads different defaults", () => {
  const popup = harness.loadPopup({ now: "2024-01-01" });
  const value = function (id) { return popup.document.getElementById(id).value; };

  assert.equal(value("adYear"), "2024");
  assert.equal(value("adMonth"), "1");
  assert.equal(value("adDay"), "1");
  assert.equal(value("bsYear"), "2080");
  assert.equal(value("bsMonth"), "9");
  assert.equal(value("bsDay"), "16");
});

/* ── P2: the fallback year ranges were wrong as well as unexplained ───── */

test("the original's fallback year ranges did not cover the calendar", () => {
  /* 1944-2033 and 2000-2089, with no comment saying where they came from.
   * Both ends were wrong: the table starts in April 1943, not 1944, and the
   * BS range stopped a year short. Whenever the fetch failed -- offline, or
   * the site changed -- these were the dropdowns the user got. */
  const source = original.originalSource("src/popup/popup.js");
  assert.ok(source.includes("1944 + i"));
  assert.ok(source.includes("2000 + i"));

  assert.equal(cal.AD_MIN_DATE.year, 1943, "the calendar starts in 1943");
  assert.equal(cal.BS_LAST_YEAR, 2090, "and the BS table runs to 2090");

  const adYears = model.adYearOptions();
  assert.equal(adYears[0], 1943);
  assert.equal(adYears[adYears.length - 1], 2034);

  const bsYears = model.bsYearOptions();
  assert.equal(bsYears[0], 2000);
  assert.equal(bsYears[bsYears.length - 1], 2090);
});

test("the year dropdowns now offer exactly what can be converted", () => {
  /* Every offered year has to contain at least one convertible date, and no
   * convertible year may be missing. */
  model.adYearOptions().forEach(function (y) {
    const ok = [1, 6, 12].some(function (m) {
      return cal.validateAdDate(y, m, 15) === null;
    });
    assert.ok(ok, "AD " + y + " is offered but has no convertible date");
  });

  model.bsYearOptions().forEach(function (y) {
    assert.equal(cal.validateBsDate(y, 1, 1), null, "BS " + y + " is offered but not convertible");
  });
});

/* ── P2: the network round trips ──────────────────────────────────────── */

test("the original fetched the converter page and threw the response away", () => {
  const source = original.originalSource("src/popup/popup.js");
  const discarded = source.split('await fetch("https://www.bolpatra.gov.np/egp/openDateConverter");').length - 1;
  assert.equal(discarded, 2, "once before each conversion, response unread");
});

test("the original set a Referer header, which fetch is required to ignore", () => {
  /* Referer is a forbidden header name. The browser drops it silently, so the
   * code read as though it were doing something it was not. */
  const source = original.originalSource("src/popup/popup.js");
  assert.equal(source.includes("Referer:"), true);
});

test("nothing in the extension talks to the network any more", () => {
  const files = ["src/popup/popup.js", "src/lib/bs-calendar.js", "src/lib/popup-model.js", "src/lib/calendar-data.js"];
  files.forEach(function (file) {
    const source = codeOf(file);
    assert.equal(/\bfetch\s*\(/.test(source), false, file + " calls fetch");
    assert.equal(/\bXMLHttpRequest\b/.test(source), false, file + " uses XMLHttpRequest");
    assert.equal(/https?:\/\//.test(source), false, file + " has a URL in it");
    assert.equal(/bolpatra/i.test(source), false, file + " still names bolpatra in code");
  });
});

test("the manifest asks for no host permissions and no background worker", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, []);
  assert.equal(manifest.host_permissions, undefined, "host_permissions is still declared");
  assert.equal(manifest.background, undefined, "a background service worker is still declared");

  const originalManifest = JSON.parse(original.originalSource("manifest.json"));
  assert.deepEqual(
    originalManifest.host_permissions,
    ["https://www.bolpatra.gov.np/*"],
    "the original did ask for it"
  );
  assert.ok(originalManifest.background, "and did declare a service worker");
});

/* ── P2: no date validation ───────────────────────────────────────────── */

test("the original had no day-of-month check anywhere", () => {
  const source = original.originalSource("src/popup/popup.js");
  assert.equal(/daysInMonth|isValidDate|validate/i.test(source), false);

  /* So 31 February was submitted, and came back as this, which blames the
   * parser for the user's impossible date. */
  assert.ok(source.includes('throw new Error("Could not extract converted date")'));
});

test("an impossible date is now refused before anything else happens", () => {
  const popup = harness.loadPopup({ now: "2026-09-18" });
  popup.document.getElementById("adYear").value = "2025";
  popup.document.getElementById("adMonth").value = "2";
  popup.document.getElementById("adDay").value = "31";

  assert.equal(popup.submit("adToBsForm"), true, "the form submit was not prevented");

  const result = popup.result();
  assert.match(result.className, /error/);
  assert.equal(result.lines[0], "February 2025 has 28 days.");
});

/* ── P3: leftovers ────────────────────────────────────────────────────── */

test("the console logging is gone", () => {
  const originalSource = original.originalSource("src/popup/popup.js");
  const originalCount = (originalSource.match(/console\.(log|error)/g) || []).length;
  assert.ok(originalCount >= 5, "the original had " + originalCount + " of them");

  ["src/popup/popup.js", "src/lib/bs-calendar.js", "src/lib/popup-model.js"].forEach(function (file) {
    assert.equal(/console\.(log|error|warn)/.test(codeOf(file)), false, file + " still logs");
  });
});

test("the dead showLoading parameter is gone with the function", () => {
  const originalSource = original.originalSource("src/popup/popup.js");
  assert.ok(
    originalSource.includes("function showLoading(buttonId, buttonText)"),
    "the original declared a second parameter"
  );
  assert.equal(
    originalSource.includes('showLoading("adToBsBtn", '),
    false,
    "and never passed it"
  );

  assert.equal(codeOf("src/popup/popup.js").includes("showLoading"), false,
    "a synchronous lookup has nothing to wait for");
});

test("the background service worker file is gone", () => {
  assert.equal(
    fs.existsSync(path.join(ROOT, "src", "background", "background.js")),
    false,
    "background.js is still on disk"
  );
  const originalBackground = original.originalSource("src/background/background.js");
  assert.ok(
    originalBackground.includes('console.log("Nepali Date Converter Extension installed")'),
    "and all it ever did was log a line"
  );
});

test("parseInt is always called with a radix", () => {
  const originalSource = original.originalSource("src/popup/popup.js");
  assert.ok(
    /parseInt\(option\.value\)/.test(originalSource),
    "the original omitted it"
  );

  ["src/popup/popup.js", "src/lib/bs-calendar.js", "src/lib/popup-model.js"].forEach(function (file) {
    parseIntCalls(codeOf(file)).forEach(function (call) {
      assert.match(call, /,\s*\d+\s*\)$/, file + ": " + call + " has no radix");
    });
  });
});
