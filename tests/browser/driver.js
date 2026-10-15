/*
 * Runs the real popup, in a real browser.
 *
 * `tests/browser/run.js` copies `src/` into a scratch directory, appends one
 * script tag to `popup.html`, and opens it in headless Chrome.
 *
 * This extension declares no permissions and its popup calls no `chrome.*` API
 * at all -- the check for that is in `run.js` -- so the popup is a plain page
 * and needs no extension host. That is what makes the manual check in
 * `review.md` reachable from here.
 *
 * What it adds over the 72 Node tests: those drive the popup's four scripts in
 * a `node:vm` context with a clock handed to them. This is the real page, in a
 * real browser, reading the real system clock, which is exactly the thing the
 * headline fix was about -- the defaults used to be one developer's test date
 * baked into four places.
 *
 * Results go into a <div id="test-results"> as JSON.
 */

(function () {
  "use strict";

  const results = [];
  const record = (name, ok, detail) =>
    results.push(Object.assign({}, detail || {}, { name: name, ok: ok }));

  const check = (name, fn) => {
    try {
      record(name, true, fn());
    } catch (err) {
      record(name, false, { error: String((err && err.stack) || err) });
    }
  };

  const publish = () => {
    const el = document.createElement("div");
    el.id = "test-results";
    el.textContent = JSON.stringify(results);
    document.body.appendChild(el);
  };

  const $ = (id) => document.getElementById(id);
  const value = (id) => {
    const el = $(id);
    if (!el) throw new Error("no field " + id);
    return el.value;
  };

  /*
   * Anything that would leave the machine. The extension used to POST every
   * date to bolpatra.gov.np and now has no host permissions at all, so the
   * direct confirmation the manual check asks for -- "open the popup's
   * devtools, convert a few dates, and confirm the Network tab stays empty" --
   * is this list staying empty.
   */
  const networkCalls = [];
  const realFetch = window.fetch;
  if (realFetch) {
    window.fetch = function (input) {
      networkCalls.push("fetch " + String((input && input.url) || input));
      return realFetch.apply(this, arguments);
    };
  }
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    networkCalls.push("xhr " + method + " " + url);
    return realOpen.apply(this, arguments);
  };
  const realSend = navigator.sendBeacon;
  if (realSend) {
    navigator.sendBeacon = function (url) {
      networkCalls.push("beacon " + url);
      return realSend.apply(this, arguments);
    };
  }

  function main() {
    const now = new Date();
    const today = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };

    /*
     * The headline fix. The AD form is asserted exactly, against the browser's
     * own clock rather than against anything this project computes, so a date
     * baked into the source cannot satisfy it on any day but one.
     */
    check("the AD form opens on today", () => {
      const got = {
        year: Number(value("adYear")),
        month: Number(value("adMonth")),
        day: Number(value("adDay")),
      };
      if (
        got.year !== today.year ||
        got.month !== today.month ||
        got.day !== today.day
      ) {
        throw new Error(
          "expected " + JSON.stringify(today) + ", the form shows " + JSON.stringify(got),
        );
      }
      return got;
    });

    /*
     * The BS form cannot be asserted against an independent source from in
     * here -- the only converter present is the one that filled the field, and
     * checking it against itself would prove nothing. Its correctness is
     * covered by the Node suite, against three independently published tables.
     *
     * What is worth asserting here is the part that was actually broken: that
     * the field is a function of the clock rather than a constant. A BS year is
     * always the AD year plus 56 or 57, the boundary being the Nepali new year
     * in mid-April, so a constant left in the source falls out of step with the
     * AD form within a year and this fails.
     */
    check("the BS form opens on a date that tracks today", () => {
      const bs = {
        year: Number(value("bsYear")),
        month: Number(value("bsMonth")),
        day: Number(value("bsDay")),
      };
      const offset = bs.year - today.year;
      if (offset !== 56 && offset !== 57) {
        throw new Error(
          "BS year " + bs.year + " is " + offset + " years after AD " +
            today.year + "; it should be 56 or 57",
        );
      }
      if (!(bs.month >= 1 && bs.month <= 12) || !(bs.day >= 1 && bs.day <= 32)) {
        throw new Error("implausible BS date " + JSON.stringify(bs));
      }
      return Object.assign({ offset: offset }, bs);
    });

    /* The three values the bug left in the source, named so a regression to
     * any one of them is reported as itself rather than as a date mismatch. */
    check("none of the old baked-in defaults is on screen", () => {
      const baked = [];
      if (Number(value("adDay")) === 8 && today.day !== 8) baked.push("AD day 8");
      if (Number(value("bsDay")) === 24 && today.day !== 24) baked.push("BS day 24");
      if (Number(value("bsYear")) === 2082 && today.year - 2082 !== -56 && today.year - 2082 !== -57) {
        baked.push("BS year 2082");
      }
      if (baked.length) throw new Error("still showing " + baked.join(", "));
      return null;
    });

    /* Convert a few dates, as the manual check says to, and watch the list. */
    check("converting in both directions issues no request", () => {
      const adBtn = $("adToBsBtn");
      const bsBtn = $("bsToAdBtn");
      if (!adBtn || !bsBtn) throw new Error("the convert buttons are not there");
      for (let i = 0; i < 3; i++) {
        adBtn.click();
        bsBtn.click();
      }
      if (networkCalls.length) {
        throw new Error("the popup made requests: " + networkCalls.join(", "));
      }
      const out = $("resultSection");
      return { resultShown: !!(out && out.textContent.trim().length) };
    });

    check("a conversion actually put an answer on screen", () => {
      const out = $("resultSection");
      if (!out) throw new Error("no result section");
      const text = out.textContent.replace(/\s+/g, " ").trim();
      if (!text) throw new Error("the result section is empty after converting");
      return { text: text.slice(0, 120) };
    });

    /*
     * Steps 2 to 4 of the manual pass in `review.md`. The answers themselves
     * are covered by the Node suite, against three independently published
     * tables; what these add is that the real selects, the real submit
     * handlers and the real result panel produce them in a browser.
     */
    const resultText = () =>
      ($("resultSection") || {}).textContent.replace(/\s+/g, " ").trim();

    /* A select only takes a value that is among its options, and the day list
     * is rebuilt from the month, so the order here matters. */
    function setDate(prefix, year, month, day) {
      const set = (id, v) => {
        const el = $(id);
        el.value = String(v);
        if (String(el.value) !== String(v)) {
          throw new Error(id + " has no option " + v);
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set(prefix + "Year", year);
      set(prefix + "Month", month);
      set(prefix + "Day", day);
    }

    check("2025-09-08 converts to 2082/05/23", () => {
      setDate("ad", 2025, 9, 8);
      $("adToBsBtn").click();
      const text = resultText();
      if (!/2082/.test(text) || !/23/.test(text) || !/5|05/.test(text)) {
        throw new Error("expected 2082/05/23, the panel says: " + text);
      }
      return { text: text.slice(0, 120) };
    });

    check("31 February is refused rather than converted", () => {
      let text;
      try {
        setDate("ad", 2025, 2, 31);
      } catch (err) {
        /* The day list is rebuilt from the month, so 31 may simply not be
         * offered for February -- which is the same defect prevented one step
         * earlier, and is a pass. */
        return { refusedBy: "the day list does not offer 31 for February" };
      }
      $("adToBsBtn").click();
      text = resultText();
      if (!/28 days|invalid|not a valid|does not/i.test(text)) {
        throw new Error("expected a refusal naming the month length, got: " + text);
      }
      if (networkCalls.length) {
        throw new Error("it reached for the network: " + networkCalls.join(", "));
      }
      return { text: text.slice(0, 120) };
    });

    check("a BS date past the confirmed tables is marked provisional", () => {
      setDate("bs", 2085, 1, 1);
      $("bsToAdBtn").click();
      const text = resultText();
      if (!/provisional/i.test(text)) {
        throw new Error("expected the provisional note, the panel says: " + text);
      }
      return { text: text.slice(0, 160) };
    });

    check("nothing reached the network across every conversion above", () => {
      if (networkCalls.length) {
        throw new Error("the popup made requests: " + networkCalls.join(", "));
      }
      return { conversions: "all" };
    });

    publish();
  }

  /*
   * `popup.js` fills the selects on DOMContentLoaded, and this script tag is
   * parsed before that fires -- so reading the fields here reads them empty.
   * Waiting for `load` puts this after the popup's own setup, which is the
   * state a person sees when the popup opens.
   */
  const start = () => {
    try {
      main();
    } catch (err) {
      record("driver", false, { error: String((err && err.stack) || err) });
      publish();
    }
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
