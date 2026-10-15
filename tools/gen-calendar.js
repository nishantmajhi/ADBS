/*
 * Generates src/lib/calendar-data.js -- the Bikram Sambat month-length table.
 *
 * The table is NOT transcribed by hand. Every month length in it is the
 * majority vote of three independently maintained published tables, fetched
 * over the network at generation time:
 *
 *   A  nepali-date-converter  (npm)  -- object keyed by BS year, named months
 *   B  nepali-datetime        (npm)  -- array from 2000 BS, with year totals
 *   C  bikram-sambat          (npm)  -- bit-packed, own epoch at 1970 BS
 *
 * C is the valuable one: it carries its own epoch (1970/01/01 BS =
 * 1913-04-13 AD) and thirty years of month lengths that A and B do not have,
 * so walking C forward from its epoch to 2000/01/01 BS independently confirms
 * the anchor date the other two are built on. That check runs below, and the
 * generator refuses to write if it fails.
 *
 * The three agree exactly for 2000-2083 BS. From 2084 they diverge, which is
 * expected rather than alarming: BS month lengths are fixed by observation and
 * published only a year or two ahead, so every table's tail is a projection.
 * BS_LAST_CONFIRMED_YEAR records where unanimity stops, and bs-calendar.js
 * uses it to mark those conversions provisional.
 *
 * Usage:  node tools/gen-calendar.js
 *
 * Needs network access. Re-run it when the sources publish observed data for
 * the projected years, and check whether BS_LAST_CONFIRMED_YEAR moves up.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SOURCES = {
  A: { pkg: "nepali-date-converter", version: "3.4.0", file: "/dist/lib/date-config.js" },
  B: { pkg: "nepali-datetime", version: "2.0.0", file: "/dist/shared/nepali-datetime.CRHMYMLW.mjs" },
  C: { pkg: "bikram-sambat", version: "1.8.1", file: "/src/index.js" },
};

const ROOT = path.join(__dirname, "..");
const OUT_TABLE = path.join(ROOT, "src", "lib", "calendar-data.js");
const OUT_SNAPSHOT = path.join(ROOT, "tests", "reference-tables.json");

async function fetchSource(source) {
  const url = "https://cdn.jsdelivr.net/npm/" + source.pkg + "@" + source.version + source.file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
  return res.text();
}

/* Reads the balanced bracket expression starting at `from`. The published
 * bundles are minified onto one line, so a regex cannot find the end of a
 * table reliably. */
function sliceBracketed(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  throw new Error("unterminated bracket expression");
}

/* A: exports.dateConfigMap = { '2000': { Baisakh: 30, ... }, ... } */
function parseA(src) {
  const MONTHS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Aswin",
                  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
  const sandbox = {};
  new Function("exports", "Object", src)(sandbox, Object);
  const out = {};
  for (const entry of Object.entries(sandbox.dateConfigMap)) {
    const year = Number(entry[0]);
    const months = entry[1];
    out[year] = MONTHS.map(function (name) {
      const n = months[name];
      if (typeof n !== "number") throw new Error("A: " + year + " missing " + name);
      return n;
    });
  }
  return out;
}

/* B: N=[[[30,32,...],365],...] starting at 2000 BS. Each row carries the
 * year total as well, which is a free consistency check on the row. */
function parseB(src) {
  const at = src.indexOf("N=[[[");
  if (at < 0) throw new Error("B: table not found");
  const rows = JSON.parse(sliceBracketed(src, at + 2));
  const out = {};
  rows.forEach(function (row, i) {
    const months = row[0];
    const total = row[1];
    const sum = months.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== total) {
      throw new Error("B: " + (2000 + i) + " sums to " + sum + ", claims " + total);
    }
    out[2000 + i] = months;
  });
  return out;
}

/* C: two bits per month, offset from 29 days, one word per year from 1970 BS */
function parseC(src) {
  const at = src.indexOf("ENCODED_MONTH_LENGTHS = [");
  if (at < 0) throw new Error("C: table not found");
  const packed = JSON.parse(sliceBracketed(src, src.indexOf("[", at)));
  const out = {};
  packed.forEach(function (word, i) {
    out[1970 + i] = Array.from({ length: 12 }, function (_, m) {
      return 29 + ((word >>> (m << 1)) & 3);
    });
  });
  return out;
}

/* C's epoch is 1970/01/01 BS = 1913-04-13 AD. Walking its own month lengths
 * forward to 2000/01/01 BS must land on 1943-04-14, the anchor A and B are
 * built on. Two tables by different authors agreeing on a date thirty years
 * apart is the strongest evidence available here that the anchor and the
 * intervening month lengths are both right. */
function confirmAnchor(C) {
  let days = 0;
  for (let y = 1970; y < 2000; y++) {
    if (!C[y]) throw new Error("C: no data for " + y);
    days += C[y].reduce(function (a, b) { return a + b; }, 0);
  }
  const landed = new Date(Date.UTC(1913, 3, 13) + days * 86400000).toISOString().slice(0, 10);
  if (landed !== "1943-04-14") {
    throw new Error("anchor check failed: C puts 2000/01/01 BS at " + landed + ", expected 1943-04-14");
  }
  return days;
}

function majorityVote(tables) {
  const years = [];
  for (let y = 2000; ; y++) {
    const present = tables.filter(function (t) { return t[y]; });
    if (present.length < 2) break; /* one source alone corroborates nothing */
    years.push(y);
  }

  const lengths = [];
  const disputed = [];
  years.forEach(function (y) {
    const votes = tables.filter(function (t) { return t[y]; }).map(function (t) { return t[y]; });
    const months = [];
    let unanimous = true;
    for (let m = 0; m < 12; m++) {
      const tally = new Map();
      votes.forEach(function (v) { tally.set(v[m], (tally.get(v[m]) || 0) + 1); });
      if (tally.size > 1) unanimous = false;
      const ranked = Array.from(tally.entries()).sort(function (a, b) {
        return b[1] - a[1] || a[0] - b[0];
      });
      const winner = ranked[0];
      if (winner[1] * 2 <= votes.length) {
        throw new Error(y + "/" + (m + 1) + ": no majority among " +
          votes.map(function (v) { return v[m]; }).join(","));
      }
      months.push(winner[0]);
    }
    const sum = months.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== 365 && sum !== 366) {
      throw new Error(y + ": majority vote produces a " + sum + "-day year");
    }
    lengths.push(months);
    if (!unanimous) disputed.push(y);
  });

  const firstDisputed = disputed.length ? disputed[0] : null;
  return {
    firstYear: years[0],
    lastYear: years[years.length - 1],
    lengths: lengths,
    lastConfirmedYear: firstDisputed === null ? years[years.length - 1] : firstDisputed - 1,
    disputed: disputed,
  };
}

function render(result, provenance) {
  const rows = result.lengths.map(function (months, i) {
    return "  /* " + (result.firstYear + i) + " */ [" + months.join(", ") + "],";
  }).join("\n");

  const firstProjected = result.lastConfirmedYear + 1;

  return [
    "/*",
    " * GENERATED FILE - do not edit by hand.",
    " *",
    " * Produced by tools/gen-calendar.js, which fetches three independently",
    " * maintained Bikram Sambat tables and takes the majority vote for every",
    " * month. Editing this file by hand breaks that guarantee, and it is",
    " * checked: tests/calendar.test.js re-derives the whole table from the",
    " * snapshot in tests/reference-tables.json and compares.",
    " *",
    " * Generated from:",
    provenance.map(function (p) { return " *   " + p; }).join("\n"),
    " *",
    " * The three sources agree exactly for " + result.firstYear + "-" + result.lastConfirmedYear + " BS. From " + firstProjected + " they",
    " * diverge, because BS month lengths are fixed by observation and are",
    " * published only a year or two ahead - every table's tail is a projection.",
    " * Conversions touching " + firstProjected + " BS or later are flagged provisional by",
    " * bs-calendar.js.",
    " */",
    "",
    '"use strict";',
    "",
    "/* 1 Baishakh " + result.firstYear + " BS is 14 April 1943 AD. Confirmed independently by",
    " * walking bikram-sambat's own epoch (1970/01/01 BS = 1913-04-13 AD) forward",
    " * thirty years; see the anchor check in tools/gen-calendar.js. */",
    "const BS_EPOCH_AD = { year: 1943, month: 4, day: 14 };",
    "",
    "const BS_FIRST_YEAR = " + result.firstYear + ";",
    "const BS_LAST_YEAR = " + result.lastYear + ";",
    "",
    "/* Beyond this year the published tables disagree with one another. */",
    "const BS_LAST_CONFIRMED_YEAR = " + result.lastConfirmedYear + ";",
    "",
    "/* Days in each of the twelve months, one row per BS year from BS_FIRST_YEAR. */",
    "const BS_MONTH_LENGTHS = [",
    rows,
    "];",
    "",
    'if (typeof module !== "undefined" && module.exports) {',
    "  module.exports = {",
    "    BS_EPOCH_AD,",
    "    BS_FIRST_YEAR,",
    "    BS_LAST_YEAR,",
    "    BS_LAST_CONFIRMED_YEAR,",
    "    BS_MONTH_LENGTHS,",
    "  };",
    "}",
    "",
  ].join("\n");
}

async function main() {
  const raw = {};
  const provenance = [];
  for (const key of Object.keys(SOURCES)) {
    const source = SOURCES[key];
    raw[key] = await fetchSource(source);
    provenance.push(key + "  " + source.pkg + "@" + source.version + source.file);
    process.stdout.write("fetched " + source.pkg + "@" + source.version + "\n");
  }

  const A = parseA(raw.A);
  const B = parseB(raw.B);
  const C = parseC(raw.C);

  const walked = confirmAnchor(C);
  process.stdout.write("anchor confirmed: " + walked + " days from 1913-04-13 lands on 1943-04-14\n");

  const result = majorityVote([A, B, C]);
  process.stdout.write(
    result.firstYear + "-" + result.lastYear + " BS; unanimous through " +
    result.lastConfirmedYear + "; disputed: " + (result.disputed.join(", ") || "none") + "\n"
  );

  fs.writeFileSync(OUT_TABLE, render(result, provenance));
  fs.writeFileSync(OUT_SNAPSHOT, JSON.stringify({
    note: "Snapshot of the three published tables the shipped calendar is voted from. Rewritten by tools/gen-calendar.js. tests/calendar.test.js uses it so the differential runs without network access.",
    sources: Object.keys(SOURCES).reduce(function (acc, k) {
      acc[k] = SOURCES[k].pkg + "@" + SOURCES[k].version + SOURCES[k].file;
      return acc;
    }, {}),
    tables: { A: A, B: B, C: C },
  }, null, 1));

  process.stdout.write("wrote " + path.relative(ROOT, OUT_TABLE) + " and " + path.relative(ROOT, OUT_SNAPSHOT) + "\n");
}

main().catch(function (err) {
  process.stderr.write("gen-calendar: " + err.message + "\n");
  process.exit(1);
});
