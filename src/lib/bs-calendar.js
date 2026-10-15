/*
 * Conversion between the Gregorian (AD) and Bikram Sambat (BS) calendars.
 *
 * This file decides everything and touches nothing: no network, no DOM, no
 * Date. Both calendars are handled as integer day counts from a single anchor
 * (1 Baishakh 2000 BS = 14 April 1943 AD), which is why there is no timezone
 * in here to get wrong. The month lengths come from src/lib/calendar-data.js,
 * which is generated rather than typed; see tools/gen-calendar.js.
 *
 * BS month lengths are not calculable. They are fixed by observation and
 * published year by year, so the whole calendar is a lookup table and the only
 * interesting questions are the anchor, the table, and the arithmetic between
 * them. The table's last few years are projections that the published sources
 * disagree about, so a conversion touching those years comes back with
 * `provisional: true` rather than pretending to the same confidence as the
 * rest.
 */

"use strict";

/* calendar-data.js is a CommonJS module under node and a plain <script> in the
 * popup. In the browser its top-level `const`s land in the global lexical
 * scope, where a later script can see them -- which is why nothing below may
 * reuse one of those five names at top level. Doing so is not a shadowing
 * nuisance but a SyntaxError that stops the popup loading. */
const CALENDAR = (function () {
  if (typeof module !== "undefined" && module.exports) {
    return require("./calendar-data.js");
  }
  return {
    BS_EPOCH_AD: BS_EPOCH_AD,
    BS_FIRST_YEAR: BS_FIRST_YEAR,
    BS_LAST_YEAR: BS_LAST_YEAR,
    BS_LAST_CONFIRMED_YEAR: BS_LAST_CONFIRMED_YEAR,
    BS_MONTH_LENGTHS: BS_MONTH_LENGTHS,
  };
})();

const AD_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* These must stay identical to the <option> labels in src/popup/popup.html,
 * because error messages name the month the user picked. tests/popup.test.js
 * asserts the two lists still match. */
const BS_MONTH_NAMES = [
  "Baishakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
];

/* ── Gregorian arithmetic ─────────────────────────────────────────────── */

function isGregorianLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function gregorianDaysInMonth(year, month) {
  if (month === 2) return isGregorianLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/* Days since 1970-01-01, by Howard Hinnant's days_from_civil. Shifting the
 * year to start in March puts the leap day last, which removes every special
 * case from the month-length arithmetic. */
function daysFromCivil(year, month, day) {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/* The exact inverse of daysFromCivil. */
function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month: month, day: day };
}

/* ── The BS table ─────────────────────────────────────────────────────── */

const EPOCH_DAYS = daysFromCivil(
  CALENDAR.BS_EPOCH_AD.year,
  CALENDAR.BS_EPOCH_AD.month,
  CALENDAR.BS_EPOCH_AD.day
);

/* Day offset of 1 Baishakh of each covered BS year from the epoch. Built once;
 * it is what makes both directions a lookup plus a short walk rather than a
 * loop over ninety years. */
const YEAR_START_OFFSETS = (function () {
  const offsets = [0];
  for (let i = 0; i < CALENDAR.BS_MONTH_LENGTHS.length; i++) {
    const total = CALENDAR.BS_MONTH_LENGTHS[i].reduce(function (a, b) { return a + b; }, 0);
    offsets.push(offsets[i] + total);
  }
  return offsets;
})();

const FIRST_YEAR = CALENDAR.BS_FIRST_YEAR;
const LAST_YEAR = CALENDAR.BS_LAST_YEAR;
const LAST_CONFIRMED_YEAR = CALENDAR.BS_LAST_CONFIRMED_YEAR;

/* The AD dates the table can express, as day counts and as civil dates. */
const AD_MIN_DAYS = EPOCH_DAYS;
const AD_MAX_DAYS = EPOCH_DAYS + YEAR_START_OFFSETS[YEAR_START_OFFSETS.length - 1] - 1;
const AD_MIN_DATE = civilFromDays(AD_MIN_DAYS);
const AD_MAX_DATE = civilFromDays(AD_MAX_DAYS);

function bsYearIsCovered(year) {
  return Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR;
}

function bsDaysInMonth(year, month) {
  if (!bsYearIsCovered(year)) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return CALENDAR.BS_MONTH_LENGTHS[year - FIRST_YEAR][month - 1];
}

function bsYearLength(year) {
  if (!bsYearIsCovered(year)) return null;
  return YEAR_START_OFFSETS[year - FIRST_YEAR + 1] - YEAR_START_OFFSETS[year - FIRST_YEAR];
}

/* True where the published tables stopped agreeing with one another, so a
 * result in this year is a projection rather than an observed calendar. */
function isProvisionalBsYear(year) {
  return bsYearIsCovered(year) && year > LAST_CONFIRMED_YEAR;
}

/* ── Formatting, used for both results and error messages ─────────────── */

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function formatAd(date) {
  return date.year + "-" + pad2(date.month) + "-" + pad2(date.day);
}

function formatBs(date) {
  return date.year + "/" + pad2(date.month) + "/" + pad2(date.day);
}

function describeAdRange() {
  return (
    AD_MONTH_NAMES[AD_MIN_DATE.month - 1] + " " + AD_MIN_DATE.day + ", " + AD_MIN_DATE.year +
    " to " +
    AD_MONTH_NAMES[AD_MAX_DATE.month - 1] + " " + AD_MAX_DATE.day + ", " + AD_MAX_DATE.year
  );
}

function describeBsRange() {
  return FIRST_YEAR + " to " + LAST_YEAR + " BS";
}

/* ── Validation ───────────────────────────────────────────────────────── */

/* Both validators return null when the date is fine, and a finished sentence
 * when it is not. The popup shows that sentence unchanged, so it has to read
 * as something a person would write.
 *
 * The day check matters more than it looks: the popup's day dropdown offers
 * 1-31 for AD and 1-32 for BS regardless of the month, so 31 February is
 * selectable. Before this existed it was posted to the remote converter and
 * came back as "Could not extract converted date", which blamed the wrong
 * thing entirely. */

function validateAdDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return "Pick a year, a month and a day.";
  }
  if (month < 1 || month > 12) return "Month must be between 1 and 12.";
  if (day < 1) return "Day must be 1 or more.";
  const limit = gregorianDaysInMonth(year, month);
  if (day > limit) {
    return AD_MONTH_NAMES[month - 1] + " " + year + " has " + limit + " days.";
  }
  const days = daysFromCivil(year, month, day);
  if (days < AD_MIN_DAYS || days > AD_MAX_DAYS) {
    return "Only AD dates from " + describeAdRange() + " can be converted.";
  }
  return null;
}

function validateBsDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return "Pick a year, a month and a day.";
  }
  if (month < 1 || month > 12) return "Month must be between 1 and 12.";
  if (day < 1) return "Day must be 1 or more.";
  if (!bsYearIsCovered(year)) {
    return "Only BS dates from " + describeBsRange() + " can be converted.";
  }
  const limit = bsDaysInMonth(year, month);
  if (day > limit) {
    return BS_MONTH_NAMES[month - 1] + " " + year + " has " + limit + " days.";
  }
  return null;
}

/* ── Conversion ───────────────────────────────────────────────────────── */

/* Both directions throw RangeError carrying the validator's sentence, so the
 * popup has one error path whether the complaint came from validation or from
 * the conversion itself. */

function adToBs(year, month, day) {
  const problem = validateAdDate(year, month, day);
  if (problem) throw new RangeError(problem);

  let remaining = daysFromCivil(year, month, day) - EPOCH_DAYS;

  let index = 0;
  while (
    index + 1 < YEAR_START_OFFSETS.length &&
    YEAR_START_OFFSETS[index + 1] <= remaining
  ) {
    index++;
  }
  remaining -= YEAR_START_OFFSETS[index];

  const months = CALENDAR.BS_MONTH_LENGTHS[index];
  let m = 0;
  while (remaining >= months[m]) {
    remaining -= months[m];
    m++;
  }

  const bsYear = FIRST_YEAR + index;
  return {
    year: bsYear,
    month: m + 1,
    day: remaining + 1,
    monthName: BS_MONTH_NAMES[m],
    formatted: formatBs({ year: bsYear, month: m + 1, day: remaining + 1 }),
    provisional: isProvisionalBsYear(bsYear),
  };
}

function bsToAd(year, month, day) {
  const problem = validateBsDate(year, month, day);
  if (problem) throw new RangeError(problem);

  const offset =
    YEAR_START_OFFSETS[year - FIRST_YEAR] +
    CALENDAR.BS_MONTH_LENGTHS[year - FIRST_YEAR]
      .slice(0, month - 1)
      .reduce(function (a, b) { return a + b; }, 0) +
    (day - 1);

  const date = civilFromDays(EPOCH_DAYS + offset);
  return {
    year: date.year,
    month: date.month,
    day: date.day,
    monthName: AD_MONTH_NAMES[date.month - 1],
    formatted: formatAd(date),
    provisional: isProvisionalBsYear(year),
  };
}

/* ── Today ────────────────────────────────────────────────────────────── */

/* The one impure function, and it takes its clock as an argument so the tests
 * can hand it a fixed day. Local time is deliberate: "today" means the user's
 * today, not UTC's. Returns null outside the table's range rather than a
 * clamped date, so the caller decides what to fall back to. */
function todayAd(now) {
  const d = now || new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function todayBs(now) {
  const ad = todayAd(now);
  if (validateAdDate(ad.year, ad.month, ad.day)) return null;
  return adToBs(ad.year, ad.month, ad.day);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AD_MONTH_NAMES,
    BS_MONTH_NAMES,
    BS_FIRST_YEAR: FIRST_YEAR,
    BS_LAST_YEAR: LAST_YEAR,
    BS_LAST_CONFIRMED_YEAR: LAST_CONFIRMED_YEAR,
    AD_MIN_DATE,
    AD_MAX_DATE,
    isGregorianLeapYear,
    gregorianDaysInMonth,
    daysFromCivil,
    civilFromDays,
    bsDaysInMonth,
    bsYearLength,
    isProvisionalBsYear,
    formatAd,
    formatBs,
    describeAdRange,
    describeBsRange,
    validateAdDate,
    validateBsDate,
    adToBs,
    bsToAd,
    todayAd,
    todayBs,
  };
}
