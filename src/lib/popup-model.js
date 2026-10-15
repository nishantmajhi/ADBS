/*
 * Everything the popup decides, with no DOM in it.
 *
 * popup.js is left holding only element creation and event wiring. The choices
 * that can be wrong -- which years to offer, which date to preselect, what the
 * result panel says -- live here, where a test can ask them directly.
 */

"use strict";

const CAL = (function () {
  if (typeof module !== "undefined" && module.exports) {
    return require("./bs-calendar.js");
  }
  /* In the popup, bs-calendar.js has already run as a plain <script> and left
   * these in the global scope. */
  return {
    AD_MIN_DATE: AD_MIN_DATE,
    AD_MAX_DATE: AD_MAX_DATE,
    BS_FIRST_YEAR: BS_FIRST_YEAR,
    BS_LAST_YEAR: BS_LAST_YEAR,
    adToBs: adToBs,
    bsToAd: bsToAd,
    todayAd: todayAd,
    validateAdDate: validateAdDate,
  };
})();

/* The day dropdowns are fixed lists in the markup's spirit -- 1-31 for AD and
 * 1-32 for BS -- because the longest month of either calendar is that long.
 * A day that does not exist in the chosen month is caught on submit by
 * bs-calendar's validators, which name the month and its real length. */
const AD_MAX_DAY = 31;
const BS_MAX_DAY = 32;

function adYearOptions() {
  const years = [];
  for (let y = CAL.AD_MIN_DATE.year; y <= CAL.AD_MAX_DATE.year; y++) years.push(y);
  return years;
}

function bsYearOptions() {
  const years = [];
  for (let y = CAL.BS_FIRST_YEAR; y <= CAL.BS_LAST_YEAR; y++) years.push(y);
  return years;
}

/* What the two forms start on.
 *
 * The original hardcoded this: day 8 in the AD form, day 24 in the BS form,
 * September and Ashwin in the markup, and BS year 2082 in a named constant
 * described as "approximate". Those were whatever date the author happened to
 * be testing with, and every one of them silently became a wrong default the
 * day after it was written. Today is the only defensible answer.
 *
 * `now` is injectable so this is testable on a fixed day, and so that a build
 * of the extension does not depend on when the tests are run.
 */
function defaultSelection(now) {
  const ad = CAL.todayAd(now);

  /* Today can fall outside the table -- the machine clock may be wrong, or the
   * table may simply have run out. Falling back to the first supported date is
   * visibly odd rather than quietly plausible, which is the point: a user who
   * sees 1943 knows something is off, where a user shown a date a few years
   * out does not. */
  if (CAL.validateAdDate(ad.year, ad.month, ad.day)) {
    const first = CAL.AD_MIN_DATE;
    return {
      inRange: false,
      ad: { year: first.year, month: first.month, day: first.day },
      bs: { year: CAL.BS_FIRST_YEAR, month: 1, day: 1 },
    };
  }

  const bs = CAL.adToBs(ad.year, ad.month, ad.day);
  return {
    inRange: true,
    ad: ad,
    bs: { year: bs.year, month: bs.month, day: bs.day },
  };
}

/* The three lines of the result panel, as plain strings. The popup puts each
 * one in a text node; none of this is ever parsed as markup. */
function resultLines(direction, source, converted) {
  const label = direction === "adToBs" ? "AD to BS" : "BS to AD";
  return {
    converted: converted.formatted,
    original: "Original: " + source,
    note: converted.provisional
      ? label + " · provisional calendar data"
      : label,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AD_MAX_DAY,
    BS_MAX_DAY,
    adYearOptions,
    bsYearOptions,
    defaultSelection,
    resultLines,
  };
}
