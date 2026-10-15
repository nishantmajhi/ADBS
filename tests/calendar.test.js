/* The conversion itself: src/lib/bs-calendar.js and its generated table.
 *
 *   node --test tests/
 *
 * This is the whole project. Everything else is a dropdown.
 *
 * A date converter can only be wrong in ways nobody notices, so the checks
 * here are mostly structural rather than a list of examples: every date in the
 * supported range is round-tripped, every consecutive pair is checked for a
 * one-day step, and the shipped table is re-derived from the three published
 * tables it was voted from. Spot-checked example dates are in here too, but
 * they are the weakest evidence in the file -- a table can agree with a dozen
 * remembered dates and still be wrong about the other thirty thousand.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cal = require("../src/lib/bs-calendar.js");
const data = require("../src/lib/calendar-data.js");

const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "reference-tables.json"), "utf8")
);

/* ── Gregorian arithmetic ─────────────────────────────────────────────── */

test("leap years follow the Gregorian rule, centuries included", () => {
  assert.equal(cal.isGregorianLeapYear(2024), true);
  assert.equal(cal.isGregorianLeapYear(2023), false);
  assert.equal(cal.isGregorianLeapYear(2000), true, "divisible by 400");
  assert.equal(cal.isGregorianLeapYear(1900), false, "divisible by 100, not 400");
  assert.equal(cal.isGregorianLeapYear(2100), false);
});

test("February has the right length in both kinds of year", () => {
  assert.equal(cal.gregorianDaysInMonth(2024, 2), 29);
  assert.equal(cal.gregorianDaysInMonth(2023, 2), 28);
  assert.equal(cal.gregorianDaysInMonth(1900, 2), 28);
  assert.equal(cal.gregorianDaysInMonth(2000, 2), 29);
});

test("month lengths are right for every month of a known year", () => {
  const expected = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 1; m <= 12; m++) {
    assert.equal(cal.gregorianDaysInMonth(2025, m), expected[m - 1], "month " + m);
  }
});

test("daysFromCivil is anchored on the Unix epoch", () => {
  assert.equal(cal.daysFromCivil(1970, 1, 1), 0);
  assert.equal(cal.daysFromCivil(1970, 1, 2), 1);
  assert.equal(cal.daysFromCivil(1969, 12, 31), -1);
  assert.equal(cal.daysFromCivil(2000, 3, 1), 11017);
});

test("civilFromDays inverts daysFromCivil across four centuries", () => {
  /* Walked day by day rather than sampled, because the interesting failures
   * are at month and century boundaries. */
  const start = cal.daysFromCivil(1800, 1, 1);
  const end = cal.daysFromCivil(2200, 1, 1);
  for (let d = start; d <= end; d++) {
    const civil = cal.civilFromDays(d);
    assert.equal(cal.daysFromCivil(civil.year, civil.month, civil.day), d);
  }
});

/* ── The anchor ───────────────────────────────────────────────────────── */

test("1 Baishakh 2000 BS is 14 April 1943 AD", () => {
  assert.deepEqual(
    { year: cal.adToBs(1943, 4, 14).year, month: cal.adToBs(1943, 4, 14).month, day: cal.adToBs(1943, 4, 14).day },
    { year: 2000, month: 1, day: 1 }
  );
  assert.equal(cal.bsToAd(2000, 1, 1).formatted, "1943-04-14");
});

test("Nepali New Year lands on the published Gregorian day", () => {
  /* Baishakh 1 of these years is a date people remember independently of any
   * table: 2080 and 2082 fell on 14 April, 2081 on 13 April. */
  assert.equal(cal.bsToAd(2080, 1, 1).formatted, "2023-04-14");
  assert.equal(cal.bsToAd(2081, 1, 1).formatted, "2024-04-13");
  assert.equal(cal.bsToAd(2082, 1, 1).formatted, "2025-04-14");
  assert.equal(cal.bsToAd(2083, 1, 1).formatted, "2026-04-14");
});

test("a mid-year date converts both ways", () => {
  const bs = cal.adToBs(2026, 9, 18);
  assert.equal(bs.formatted, "2083/06/02");
  assert.equal(bs.monthName, "Ashwin");
  assert.equal(cal.bsToAd(2083, 6, 2).formatted, "2026-09-18");
});

/* ── Structural properties of the whole range ─────────────────────────── */

test("every date in the supported range round-trips", () => {
  let checked = 0;
  for (let y = cal.BS_FIRST_YEAR; y <= cal.BS_LAST_YEAR; y++) {
    for (let m = 1; m <= 12; m++) {
      const length = cal.bsDaysInMonth(y, m);
      for (let d = 1; d <= length; d++) {
        const ad = cal.bsToAd(y, m, d);
        const back = cal.adToBs(ad.year, ad.month, ad.day);
        assert.equal(back.year, y);
        assert.equal(back.month, m);
        assert.equal(back.day, d);
        checked++;
      }
    }
  }
  /* Ninety-one years of dates. If this number collapses, the table did. */
  assert.ok(checked > 33000, "only " + checked + " dates round-tripped");
});

test("consecutive AD days are consecutive BS days", () => {
  /* The check that catches an off-by-one at a month or year boundary, which
   * a round-trip alone cannot: a table with two months swapped round-trips
   * perfectly and still gives the wrong date. */
  const first = cal.daysFromCivil(cal.AD_MIN_DATE.year, cal.AD_MIN_DATE.month, cal.AD_MIN_DATE.day);
  const last = cal.daysFromCivil(cal.AD_MAX_DATE.year, cal.AD_MAX_DATE.month, cal.AD_MAX_DATE.day);

  let previous = null;
  for (let d = first; d <= last; d++) {
    const civil = cal.civilFromDays(d);
    const bs = cal.adToBs(civil.year, civil.month, civil.day);
    if (previous) {
      const sameMonth = bs.year === previous.year && bs.month === previous.month;
      if (sameMonth) {
        assert.equal(bs.day, previous.day + 1, "day did not advance at " + bs.formatted);
      } else {
        assert.equal(bs.day, 1, "a new month did not start on day 1 at " + bs.formatted);
        assert.equal(
          previous.day,
          cal.bsDaysInMonth(previous.year, previous.month),
          "month ended early at " + previous.formatted
        );
        if (bs.month === 1) {
          assert.equal(bs.year, previous.year + 1, "year rolled over wrongly at " + bs.formatted);
          assert.equal(previous.month, 12, "year ended before Chaitra at " + previous.formatted);
        } else {
          assert.equal(bs.month, previous.month + 1, "month skipped at " + bs.formatted);
          assert.equal(bs.year, previous.year);
        }
      }
    }
    previous = bs;
  }
});

test("every BS year is 365 or 366 days and every month 29 to 32", () => {
  for (let y = cal.BS_FIRST_YEAR; y <= cal.BS_LAST_YEAR; y++) {
    const length = cal.bsYearLength(y);
    assert.ok(length === 365 || length === 366, y + " is " + length + " days");
    for (let m = 1; m <= 12; m++) {
      const days = cal.bsDaysInMonth(y, m);
      assert.ok(days >= 29 && days <= 32, y + "/" + m + " is " + days + " days");
    }
  }
});

test("the BS year stays aligned with the Gregorian one", () => {
  /* Baishakh 1 always falls in the second half of April. A table that has
   * drifted by a month or more shows up here immediately. */
  for (let y = cal.BS_FIRST_YEAR; y <= cal.BS_LAST_YEAR; y++) {
    const ad = cal.bsToAd(y, 1, 1);
    assert.equal(ad.month, 4, "Baishakh 1 of " + y + " fell in month " + ad.month);
    assert.ok(ad.day >= 12 && ad.day <= 15, "Baishakh 1 of " + y + " fell on April " + ad.day);
    assert.equal(ad.year, y - 57, "Baishakh 1 of " + y + " fell in AD " + ad.year);
  }
});

/* ── The table against its sources ────────────────────────────────────── */

test("the shipped table is the majority vote of the three published tables", () => {
  const tables = [SNAPSHOT.tables.A, SNAPSHOT.tables.B, SNAPSHOT.tables.C];
  for (let y = cal.BS_FIRST_YEAR; y <= cal.BS_LAST_YEAR; y++) {
    const votes = tables.filter((t) => t[y]).map((t) => t[y]);
    assert.ok(votes.length >= 2, y + " has fewer than two sources");
    for (let m = 1; m <= 12; m++) {
      const tally = new Map();
      votes.forEach((v) => tally.set(v[m - 1], (tally.get(v[m - 1]) || 0) + 1));
      const winner = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      assert.ok(winner[1] * 2 > votes.length, y + "/" + m + " has no majority");
      assert.equal(
        cal.bsDaysInMonth(y, m),
        winner[0],
        y + "/" + m + " is " + cal.bsDaysInMonth(y, m) + ", majority says " + winner[0]
      );
    }
  }
});

test("all three sources agree for every year marked confirmed", () => {
  const tables = [SNAPSHOT.tables.A, SNAPSHOT.tables.B, SNAPSHOT.tables.C];
  for (let y = cal.BS_FIRST_YEAR; y <= cal.BS_LAST_CONFIRMED_YEAR; y++) {
    const votes = tables.filter((t) => t[y]).map((t) => t[y]);
    assert.equal(votes.length, 3, y + " is not covered by all three sources");
    for (let m = 1; m <= 12; m++) {
      assert.equal(votes[0][m - 1], votes[1][m - 1], y + "/" + m + " A and B disagree");
      assert.equal(votes[0][m - 1], votes[2][m - 1], y + "/" + m + " A and C disagree");
    }
  }
});

test("the confirmed range stops exactly where the sources start disagreeing", () => {
  /* If a future regeneration silently widened the confirmed range without the
   * sources actually agreeing, this is what catches it. */
  const tables = [SNAPSHOT.tables.A, SNAPSHOT.tables.B, SNAPSHOT.tables.C];
  let firstDisputed = null;
  for (let y = cal.BS_FIRST_YEAR; y <= cal.BS_LAST_YEAR && firstDisputed === null; y++) {
    const votes = tables.filter((t) => t[y]).map((t) => t[y]);
    for (let m = 1; m <= 12; m++) {
      if (!votes.every((v) => v[m - 1] === votes[0][m - 1])) {
        firstDisputed = y;
        break;
      }
    }
  }
  assert.notEqual(firstDisputed, null, "the sources agree everywhere, which they did not");
  assert.equal(cal.BS_LAST_CONFIRMED_YEAR, firstDisputed - 1);
});

test("bikram-sambat's own epoch confirms the anchor the other two assert", () => {
  /* The single most load-bearing fact in the project. bikram-sambat counts
   * from 1970/01/01 BS = 1913-04-13 AD and carries thirty years of month
   * lengths the other two tables do not have. Walking it forward has to land
   * on 14 April 1943, which is where the other two start. Two authors, two
   * epochs, thirty years apart, same day. */
  const C = SNAPSHOT.tables.C;
  let days = 0;
  for (let y = 1970; y < 2000; y++) {
    days += C[y].reduce((a, b) => a + b, 0);
  }
  assert.equal(days, 10958);
  assert.equal(cal.civilFromDays(cal.daysFromCivil(1913, 4, 13) + days).year, 1943);
  assert.deepEqual(cal.civilFromDays(cal.daysFromCivil(1913, 4, 13) + days), {
    year: 1943, month: 4, day: 14,
  });
});

test("the generated file still says what the library was built against", () => {
  assert.equal(data.BS_FIRST_YEAR, 2000);
  assert.equal(data.BS_EPOCH_AD.year, 1943);
  assert.equal(data.BS_EPOCH_AD.month, 4);
  assert.equal(data.BS_EPOCH_AD.day, 14);
  assert.equal(data.BS_MONTH_LENGTHS.length, data.BS_LAST_YEAR - data.BS_FIRST_YEAR + 1);
  data.BS_MONTH_LENGTHS.forEach((row, i) => {
    assert.equal(row.length, 12, "year " + (data.BS_FIRST_YEAR + i) + " has " + row.length + " months");
  });
});

/* ── Provisional years ────────────────────────────────────────────────── */

test("years the sources disagree about are flagged provisional", () => {
  assert.equal(cal.isProvisionalBsYear(cal.BS_LAST_CONFIRMED_YEAR), false);
  assert.equal(cal.isProvisionalBsYear(cal.BS_LAST_CONFIRMED_YEAR + 1), true);
  assert.equal(cal.isProvisionalBsYear(cal.BS_LAST_YEAR), true);
  assert.equal(cal.isProvisionalBsYear(cal.BS_LAST_YEAR + 1), false, "out of range is not provisional, it is absent");
});

test("the provisional flag reaches both conversion directions", () => {
  assert.equal(cal.bsToAd(cal.BS_LAST_CONFIRMED_YEAR, 6, 1).provisional, false);
  assert.equal(cal.bsToAd(cal.BS_LAST_CONFIRMED_YEAR + 1, 6, 1).provisional, true);

  const confirmed = cal.bsToAd(cal.BS_LAST_CONFIRMED_YEAR, 6, 1);
  assert.equal(cal.adToBs(confirmed.year, confirmed.month, confirmed.day).provisional, false);

  const provisional = cal.bsToAd(cal.BS_LAST_CONFIRMED_YEAR + 1, 6, 1);
  assert.equal(cal.adToBs(provisional.year, provisional.month, provisional.day).provisional, true);
});

/* ── Validation ───────────────────────────────────────────────────────── */

test("a day that does not exist in the chosen month is refused by name", () => {
  assert.equal(cal.validateAdDate(2025, 2, 31), "February 2025 has 28 days.");
  assert.equal(cal.validateAdDate(2024, 2, 30), "February 2024 has 29 days.");
  assert.equal(cal.validateAdDate(2025, 4, 31), "April 2025 has 30 days.");
  assert.equal(cal.validateAdDate(2025, 2, 28), null);
  assert.equal(cal.validateAdDate(2024, 2, 29), null);
});

test("a BS day past the end of its month is refused by name", () => {
  /* Bhadra 2082 has 31 days, so 32 is offered by the dropdown and does not
   * exist. This is the case that used to reach the network and come back as
   * "Could not extract converted date". */
  assert.equal(cal.bsDaysInMonth(2082, 5), 31);
  assert.equal(cal.validateBsDate(2082, 5, 32), "Bhadra 2082 has 31 days.");
  assert.equal(cal.validateBsDate(2082, 5, 31), null);
});

test("months outside 1 to 12 are refused", () => {
  assert.equal(cal.validateAdDate(2025, 0, 1), "Month must be between 1 and 12.");
  assert.equal(cal.validateAdDate(2025, 13, 1), "Month must be between 1 and 12.");
  assert.equal(cal.validateBsDate(2082, 13, 1), "Month must be between 1 and 12.");
});

test("non-integers are refused rather than coerced", () => {
  assert.match(cal.validateAdDate(NaN, 1, 1), /Pick a year/);
  assert.match(cal.validateBsDate(2082, NaN, 1), /Pick a year/);
  assert.match(cal.validateAdDate(2025.5, 1, 1), /Pick a year/);
});

test("dates outside the table are refused, and the message says the range", () => {
  const before = cal.civilFromDays(
    cal.daysFromCivil(cal.AD_MIN_DATE.year, cal.AD_MIN_DATE.month, cal.AD_MIN_DATE.day) - 1
  );
  const after = cal.civilFromDays(
    cal.daysFromCivil(cal.AD_MAX_DATE.year, cal.AD_MAX_DATE.month, cal.AD_MAX_DATE.day) + 1
  );

  assert.match(cal.validateAdDate(before.year, before.month, before.day), /Only AD dates from/);
  assert.match(cal.validateAdDate(after.year, after.month, after.day), /Only AD dates from/);
  assert.equal(cal.validateAdDate(cal.AD_MIN_DATE.year, cal.AD_MIN_DATE.month, cal.AD_MIN_DATE.day), null);
  assert.equal(cal.validateAdDate(cal.AD_MAX_DATE.year, cal.AD_MAX_DATE.month, cal.AD_MAX_DATE.day), null);

  assert.match(cal.validateBsDate(cal.BS_FIRST_YEAR - 1, 1, 1), /Only BS dates from/);
  assert.match(cal.validateBsDate(cal.BS_LAST_YEAR + 1, 1, 1), /Only BS dates from/);
});

test("the conversions throw the validator's own sentence", () => {
  assert.throws(() => cal.adToBs(2025, 2, 31), {
    name: "RangeError",
    message: "February 2025 has 28 days.",
  });
  assert.throws(() => cal.bsToAd(2082, 5, 32), {
    name: "RangeError",
    message: "Bhadra 2082 has 31 days.",
  });
});

test("the range description names real boundary dates", () => {
  assert.equal(cal.describeAdRange(), "April 14, 1943 to April 13, 2034");
  assert.equal(cal.describeBsRange(), "2000 to 2090 BS");
});

/* ── Today ────────────────────────────────────────────────────────────── */

test("today is read from the local clock, not UTC", () => {
  /* Late on the last day of a month in a positive-offset timezone, a UTC read
   * gives yesterday. The library takes the civil date off the Date object
   * rather than its timestamp, so it cannot. */
  const lateEvening = new Date(2025, 8, 30, 23, 30, 0);
  assert.deepEqual(cal.todayAd(lateEvening), { year: 2025, month: 9, day: 30 });

  const earlyMorning = new Date(2025, 0, 1, 0, 15, 0);
  assert.deepEqual(cal.todayAd(earlyMorning), { year: 2025, month: 1, day: 1 });
});

test("todayBs converts the local date", () => {
  const bs = cal.todayBs(new Date(2026, 8, 18, 9, 0, 0));
  assert.equal(bs.formatted, "2083/06/02");
});

test("todayBs returns null rather than a wrong date when the clock is out of range", () => {
  assert.equal(cal.todayBs(new Date(1800, 0, 1)), null);
  assert.equal(cal.todayBs(new Date(2100, 0, 1)), null);
});

/* ── Month names ──────────────────────────────────────────────────────── */

test("both month name lists have twelve entries in calendar order", () => {
  assert.equal(cal.AD_MONTH_NAMES.length, 12);
  assert.equal(cal.BS_MONTH_NAMES.length, 12);
  assert.equal(cal.AD_MONTH_NAMES[0], "January");
  assert.equal(cal.AD_MONTH_NAMES[11], "December");
  assert.equal(cal.BS_MONTH_NAMES[0], "Baishakh");
  assert.equal(cal.BS_MONTH_NAMES[11], "Chaitra");
});

test("a converted date carries the month name of its own calendar", () => {
  assert.equal(cal.adToBs(2026, 9, 18).monthName, "Ashwin");
  assert.equal(cal.bsToAd(2083, 6, 2).monthName, "September");
});
