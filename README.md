# ADBS

A browser extension that converts dates between the Gregorian (AD) calendar and
Bikram Sambat (BS), the calendar in civil use in Nepal.

It works offline. The conversion is a table lookup and a day count, so the
extension asks for no permissions, contacts nothing, and answers instantly.

## Install

There is no build step and no package manager. The repository is the
extension.

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`)
2. Turn on **Developer mode**, top right
3. **Load unpacked**, and select this folder

Click the toolbar icon, and both forms open on today's date.

Firefox is not covered. The manifest is MV3 with no background script, which
Firefox will probably accept, but nobody has loaded it there and the previous
README's Firefox instructions were wrong, so saying nothing is better than
guessing twice.

## How the conversion works

BS month lengths cannot be calculated. Unlike a Gregorian leap year there is no
rule to apply: each month runs between 29 and 32 days, the lengths are fixed by
observation, and they are published year by year. So a converter is a lookup
table plus arithmetic, and all the difficulty is in the table.

Three things make this one trustworthy.

**One anchor.** 1 Baishakh 2000 BS is 14 April 1943 AD. Every conversion is a
day count from there — AD to a day number, day number to BS, or the reverse.
There is no timezone anywhere in `src/lib/bs-calendar.js`, and no `Date`
object: only integers.

**The table is generated, not typed.** `tools/gen-calendar.js` fetches three
independently maintained published tables and writes
`src/lib/calendar-data.js` from the **majority vote** of the three, month by
month. Transcribing ninety years of month lengths by hand is exactly the sort
of job where one wrong digit silently moves every later date in that year, and
nobody would notice for a decade.

**The anchor is confirmed by a table that does not share it.** One of the three
sources counts from its own epoch, 1970/01/01 BS = 13 April 1913 AD, and
carries thirty years of month lengths the other two do not have. Walking it
forward from 1913 lands on 14 April 1943 — the day the other two start from.
Two authors, two epochs, thirty years apart, the same day. The generator
refuses to write the table if that check fails.

### What it covers

| | |
| --- | --- |
| AD | 14 April 1943 to 13 April 2034 |
| BS | 2000 to 2090 |
| Confirmed | 2000 to 2083 BS — all three sources agree exactly |
| Provisional | 2084 to 2090 BS — the sources disagree |

A date in a provisional year still converts, and the result panel says
`provisional calendar data` on its last line. This is not hedging for its own
sake: BS months are published a year or two ahead, so every table's tail is a
projection, and the three consulted here diverge from 2084 in two separate
places. Showing a 2085 date with the same confidence as a 2025 one would be
the wrong kind of quiet.

### Updating the table

When the calendar committee publishes real data for the projected years and
the libraries catch up:

```sh
node tools/gen-calendar.js
node --test "tests/*.test.js"
```

The generator needs network access. It prints the confirmed range it worked
out; if `BS_LAST_CONFIRMED_YEAR` has moved up, the projected band has shrunk.
The tests re-derive the whole shipped table from the snapshot the generator
saved, so a hand-edited `calendar-data.js` fails rather than ships.

## Tests

```sh
node --test "tests/*.test.js"
```

72 checks, no dependencies and no test framework.

There is a second suite that opens the real popup in a real browser:

```sh
node tests/browser/run.js
```

Eight more checks, also with no dependencies. It needs Chrome or Edge and
exits 0 saying SKIP if neither is installed. The popup calls no `chrome.*` API
and the extension asks for no permissions, so `popup.html` is an ordinary page
and can be opened directly — the run asserts both of those facts first, because
if either stopped being true it would be testing something other than the
popup. What it adds is the part a `node:vm` harness cannot reach: the real page
reading the real system clock, which is what the day-8, day-24 and BS-year-2082
defaults were about.

The two that carry the most weight are structural rather than exemplary.
**Every date in the supported range is round-tripped** — about 33,000 of them,
BS to AD and back. And **every consecutive pair of AD days is checked for a
one-day step in BS**, including the month and year rollovers, which is the
check a round-trip cannot do: a table with two months transposed round-trips
perfectly and still gives the wrong date.

Spot-checked dates are in there too — the 2080, 2081, 2082 and 2083 new years,
which fall on days people remember independently of any table — but they are
the weakest evidence in the file. A table can agree with a dozen remembered
dates and be wrong about the other thirty thousand.

`tests/regression.test.js` is the other half. Every bug this pass fixed is
proved against the original code first, taken out of git, so that a fix cannot
quietly turn out to have been for something that was never broken.

`tests/harness.js` loads the popup's four scripts into one `node:vm` context in
the order `popup.html` lists them, which is the same shared global scope four
`<script>` tags get in a browser. That is not a detail: a top-level `const`
declared in two of those files is a `SyntaxError` that appears only when the
popup is opened, and this is the only thing here that can catch it.

## Layout

```
manifest.json
src/
  popup/            popup.html, popup.css, popup.js  -- DOM and events only
  lib/
    calendar-data.js  generated month-length table; do not edit
    bs-calendar.js    the conversion: no network, no DOM, no Date
    popup-model.js    what to offer, what to preselect, what to display
  assets/icons/
tools/
  gen-calendar.js   rebuilds calendar-data.js from three published tables
tests/
```

`src/lib/` holds everything that decides anything, and none of it touches a
browser. `popup.js` creates elements and listens for submits, and asks the
library every question it has.

## What changed in version 2

Version 1 did not convert anything itself. It posted the date to
`bolpatra.gov.np`, Nepal's government procurement portal, and scraped the
answer out of the HTML that came back — two network round trips per press, one
of whose responses was fetched and discarded unread.

That meant the extension was offline whenever the portal was, broke whenever
the portal's markup changed, needed permission to talk to a government server,
and told that server every date anyone looked up and when. The scraped text was
then written into the popup with `innerHTML`, so any markup in the response
became live elements inside the extension's own origin.

The conversion is local now, `host_permissions` is gone from the manifest, and
nothing in the popup assigns to `innerHTML`. See `review.md` for the full list
and what was deliberately left alone.

## Licence

Free for personal, non-commercial use. You may use, study and modify this
software for yourself, but you may not use it commercially, and you may not
share or publish it, in its original form or modified. See [LICENSE](LICENSE)
for the full terms.
