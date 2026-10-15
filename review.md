# Code Review — ADBS (Nepali Date Converter)

Reviewed 2026-09-04 against the working tree. **Remediated 2026-09-18**; that
pass is recorded below, under the original review, along with two corrections
to it.

---

## Corrections to the first review

**The first review understated the XSS.** It described the `innerHTML` write as
a risk that depended on "a site compromise, a captive-portal or ISP injection
page, or simply an error page with unusual content". All true, but it missed
the cheaper route: the error branch interpolated `error.message`, and
`error.message` was built by the code itself from strings that had already been
through the remote response. Both branches are proved in
`tests/regression.test.js`, and the error branch is the one where a `<script>`
element reaches the DOM.

**The first review missed that the fallback year ranges were wrong, not just
unexplained.** It flagged `1944-2033` and `2000-2089` as "hardcoded with no
comment explaining where those bounds came from". They were also incorrect at
both ends: the calendar starts on 14 April 1943, not in 1944, and the BS table
runs to 2090, not 2089. Those ranges were what the user got whenever the fetch
failed, which is every time they were offline — so the one code path that
existed for the offline case offered a year that could not be converted and
omitted one that could. Covered by "the original's fallback year ranges did not
cover the calendar".

---

## What this project is

A Manifest V3 extension that converts dates between the Gregorian (AD) and
Bikram Sambat (BS) calendars. It used to do that by submitting a form to
Nepal's Bolpatra portal and scraping the result out of the returned HTML. Since
2026-09-18 it does it locally, from a generated lookup table.

## Verdict

*(original, retained)*

This is an early project and it shows, mostly in the architecture rather than
the style. The code is tidy and readable. The problems are one real security
bug, several leftover development values that will silently produce wrong
defaults, and a design that depends entirely on a government website's HTML
never changing. Of everything in the archive, this is one of the better
candidates for a rewrite rather than a patch — the conversion is a pure
function over a lookup table and does not need the network at all.

**The rewrite was taken.** See "What the 2026-09-18 pass did" below.

## Critical issues

**1. HTML injection into the popup from scraped remote content.**
`src/popup/popup.js:189-197` builds `resultSection.innerHTML` by interpolating
`data.convertedDate`, `data.originalDate.formatted` and `data.type`.
`convertedDate` is text pulled out of Bolpatra's response HTML. If that
response ever contains markup it is parsed and executed inside the extension
popup, which is a privileged extension-origin context. The error branch at line
196 has the same problem with `error.message`.

**Fixed.** The panel is built from elements and text nodes. `popup.js` contains
no assignment to `innerHTML` at all, and a test fails if one reappears.

**2. The extension breaks the moment Bolpatra changes its markup.** Every
conversion depended on `select[name="year"]`, `select[name="nepYear"]`, a
`<fieldset>` whose `<legend>` reads exactly "Converted Date", and
`td[align="center"]` — attributes that have been deprecated HTML for two
decades. No version pin, no health check, and no message distinguishing "the
site changed" from "you are offline".

**Fixed, by removing the dependency.** There is no scraper any more.

## Leftover development values

- `popup.js:64` and `:74` — the AD day dropdown always preselected the 8th and
  the BS day dropdown the 24th. **Fixed**: both default to today.
- `popup.js:96` — `const currentBsYear = 2082`. **Fixed**: derived from today.
  It was already a year stale when this pass ran.
- `popup.html` also hardcoded `selected` on September and Ashwin, which the
  first review did not mention. **Fixed** with the other two; a test asserts no
  `<option>` in the markup is preselected.
- `popup.js:52-53` — fallback year ranges. **Fixed**; see the correction above.
- Five `console.log` / `console.error` calls. **Fixed**, all gone.
- `background.js` existed only to log "Extension installed". **Deleted**, along
  with the manifest `background` key.

## Other correctness bugs

- **`showLoading(buttonId, buttonText)` took a second parameter never passed
  and never used.** **Fixed** by deletion: a table lookup is synchronous, so
  there is no loading state left to show.
- **The "get the session" fetch was useless.** **Fixed** by deletion.
- **The `Referer` header was silently dropped** — a forbidden header name.
  **Fixed** by deletion.
- **No date validation.** 31 February was selectable, was posted, and came back
  as "Could not extract converted date", blaming the parser for the user's
  date. **Fixed**: both calendars are validated before conversion, and the
  message names the month and its real length — "February 2025 has 28 days."
- **`parseInt(option.value)` without a radix.** **Fixed**; a test scans for it.

## Manifest and packaging

- **Firefox instructions did not work.** **Fixed** by removing them. There is
  no background script at all now, so Firefox would probably accept the
  manifest, but nobody has loaded it there and guessing twice is worse than
  saying nothing. The README says so.
- **`"author"` is not a documented MV3 key.** **Fixed**, removed.
- **No `LICENSE`.** **Added** — MIT, matching `PrivatePages` and
  `PDF Comments` in this archive. *This chose a licence on the author's
  behalf; say if it should be something else.*
- **Name mismatch** between manifest ("Nepali Date Converter") and repo
  ("ADBS"). **Fixed**: both are ADBS now.

---

## What the 2026-09-18 pass did

### The rewrite

The verdict's suggestion was taken: the extension no longer uses the network.
`host_permissions` is gone, the background worker is gone, and
`permissions: []`.

The whole question was whether a locally shipped BS table could be trusted,
because a wrong month length silently moves every later date in that year and
nobody notices for years. It is not transcribed. `tools/gen-calendar.js`
fetches three independently maintained published tables and writes
`src/lib/calendar-data.js` from the majority vote, month by month:

| | Source | Shape |
| --- | --- | --- |
| A | `nepali-date-converter@3.4.0` | object keyed by BS year, named months |
| B | `nepali-datetime@2.0.0` | array from 2000 BS, with year totals |
| C | `bikram-sambat@1.8.1` | bit-packed, its own epoch at 1970 BS |

C is what makes this more than three copies of the same list. It counts from
1970/01/01 BS = 1913-04-13 AD and carries thirty years the other two do not
have. Walking it forward lands on 14 April 1943 — where A and B start. Two
authors, two epochs, thirty years apart, the same day. The generator refuses to
write if that fails.

**The three agree exactly for 2000–2083 BS and diverge from 2084**, in two
separate bands: C differs from A and B over 2084–2086, and B differs from A and
C over 2087–2090. The majority vote happens to select A's values throughout the
disputed band, but only because it has two votes behind it in every year.

That divergence is expected rather than alarming — BS months are published a
year or two ahead, so every table's tail is a projection. It is recorded as
`BS_LAST_CONFIRMED_YEAR = 2083`, and a conversion touching a later year comes
back `provisional: true`.

### Tests

72 checks, `node --test "tests/*.test.js"`, no dependencies.

Both mutation checks were run before the suite was believed. Moving one day
from one month of 2050 to the next — keeping the year total right and both
months in the legal 29–32 range — failed two tests. Deleting the `- 1` from the
day offset in `bsToAd` failed seven.

The load-path coverage is worth knowing about. `tests/harness.js` runs the
popup's four scripts in one `node:vm` context in the order `popup.html` lists
them, which is the same shared global scope the browser gives four `<script>`
tags. It exists because of a defect this pass introduced and caught by reading
rather than by running: `bs-calendar.js` initially declared
`const BS_FIRST_YEAR` at top level, which `calendar-data.js` had already
declared. In the browser that is a `SyntaxError` that stops the popup loading,
and no `require()`-based test can see it, because CommonJS gives each file its
own scope. Under the harness it fails. Anything added to `src/lib/` should be
loaded through it for that reason alone.

`tests/regression.test.js` proves each bug against the original first. The
original cannot be run here — every path starts with a fetch to a government
server — so `tests/original.js` transcribes the three decisions that changed
with their I/O lifted out, and pulls the original file out of git to assert the
twelve exact lines it was transcribed from are still there.

### UI and UX changes — two, both flagged

`CLAUDE.md` says business logic only. Two changes here are copy, and both are
here because leaving them would have meant the interface stating something
untrue:

1. **The popup subtitle** read "Uses Government's Bolpatra Portal". It does
   not any more. It now reads "Converts offline".
2. **The direction line in the result panel** gains
   `· provisional calendar data` for dates in 2084 BS or later. This is the
   one that is a genuine addition rather than a correction, and it was judged
   the lesser evil: the alternative was either to show a projected date with
   the same confidence as an observed one, or to refuse every date after
   April 2027, which is seven months from this pass.

The manifest `description` and `name` changed for the same reason — the old
description named the portal.

Everything else is untouched: the layout, `popup.css`, the two forms, the
button labels, the month names, the footer.

### Deliberately not done

- **The day dropdowns still offer 1–31 and 1–32 regardless of month.** With a
  local table they could be rebuilt whenever the month changes, but that is an
  interaction change rather than a bug fix, and the first review asked for
  validation before submitting, which is what it got. If you want the
  filtering instead, `bsDaysInMonth()` is already there.
- **No weekday in the result.** It is one line to add and it is new
  information the original never showed.
- **2091–2099 were not shipped**, although source B has them. One source with
  nothing to corroborate it is not evidence, and the generator stops where the
  second source does.
- **`src/assets/icons/icon.png` was left in place.** It is referenced by
  nothing — the manifest uses the 16, 48 and 128 sizes — and it is 29 KB that
  ships in the package. It is the master the other three were resized from
  though, not a build artefact, so deleting it is the author's call.

## Action checklist

- [x] **P1** Replace both `innerHTML` writes in `showResult()` with `textContent`.
- [x] **P1** Remove the hardcoded day-8 / day-24 / BS-year-2082 defaults; use today's date.
- [x] **P2** Delete the pointless pre-fetch and the ineffective `Referer` header.
- [x] **P2** Delete `background.js` and the manifest `background` key, or give it a real job.
- [x] **P2** Validate day-of-month against the selected month before submitting.
- [x] **P2** Fix or remove the Firefox installation instructions.
- [x] **P3** Strip the remaining `console.log` calls and the unused `showLoading` parameter.
- [x] **P3** Consider the offline rewrite — it removes issue 2, the privacy leak, and the host
      permission in one move. **Taken.**
- [x] Correct the two overstated or missed findings in the first review.
- [x] Walk the five steps below in a real browser. **Done 2026-09-24, and
      automated — `node tests/browser/run.js`. All five pass.**

## The browser pass — done, and automated

**This said "nothing here can load an extension into Chrome", and that was
true and beside the point.** ADBS declares **no permissions** and its popup
calls **no `chrome.*` API at all**, so `popup.html` is an ordinary page: opened
from a `file://` URL it is the same page the popup shows, and no extension host
is needed. Nobody had asked that question — the item sat with three genuine
extensions for six days, and it was not one.

`tests/browser/run.js` walks all five steps. Twelve checks, no dependencies,
Chrome driven with `--headless=new --dump-dom`; it exits 0 and says SKIP if no
browser is installed. The first three are static and guard the reasoning above:
the manifest asks for no permissions and no hosts, no source calls a `chrome.*`
API, and nothing is loaded from a remote URL. If any of those stopped being
true, opening the page directly would silently stop being equivalent to opening
the popup — so they are checks, not assumptions.

The five steps, as automated:

1. **Both forms open on today.** The AD form is asserted *exactly*, against the
   browser's own clock rather than anything this project computes, so a date
   baked into the source cannot satisfy it on any day but one. The BS form is
   asserted as tracking the clock — a BS year is always the AD year plus 56 or
   57 — because the only converter available in the page is the one that filled
   the field, and checking it against itself would prove nothing. Its
   correctness is the Node suite's job, against three published tables. The old
   day-8, day-24 and BS-2082 values are also named individually, so a
   regression to any one of them reports as itself.
2. `2025-09-08` converts to `2082/05/23`, through the real selects and the real
   submit handler.
3. 31 February is refused with the month length rather than converted. The day
   list is a fixed 1–31 and is not month-aware, so 31 really is selectable and
   this goes through the real validation path.
4. A BS date in 2085 comes back marked provisional.
5. **Nothing reaches the network, across every conversion above.** `fetch`,
   `XMLHttpRequest` and `sendBeacon` are all recorded, and the list must be
   empty. That is the direct confirmation the scraper is gone, and it is
   stronger than watching a devtools Network tab because it cannot be missed.

**Everything passed, so each of the two checks that matter was shown to be
capable of failing.** `defaultSelection` was temporarily made to return a fixed
`{2025, 4, 8}` — the shape of the original bug — and both date checks failed
with the exact values on screen, the BS one reporting an offset of 55 where 56
or 57 was required, which is what confirms that heuristic does real work. A
`<script src="https://cdnjs…">` was temporarily added and the remote-resource
check failed. Both mutations were reverted.

One thing the run does **not** cover, and the manual step said to look at it:
the devtools **console** being silent. Nothing in `--dump-dom` reports console
output. The `console.log` strip is covered by the Node suite and by reading the
source, so this is the one fragment of the five steps still owed to a person,
and it is worth about thirty seconds if the extension is ever loaded for another
reason.

## Notes for a future session

No build step; load unpacked from the repo root.

`tools/gen-calendar.js` needs network access and is the only thing here that
does. Re-run it when the published tables catch up with the projected years,
and check whether it reports a higher confirmed year — if so, the provisional
band has shrunk and the README table needs its numbers updated.

The table runs out on **13 April 2034**. That is a long way off, but the
failure mode when it arrives is a refusal with a clear message, not a wrong
date.

## Licence, 2026-10-02

The author chose one licence for all of their projects: free for personal,
non-commercial use, modifiable for the user's own use, and not to be
distributed, original or modified. No standard licence says that, so `LICENSE`
is a short custom text, the same in every project apart from the year and what
it excludes. The README's licence section says the same. Anything above that
calls the licence an open question, or calls the project MIT, is superseded.

## CI, 2026-10-02

`.github/workflows/ci.yml` runs the node checks and the browser suite as two
jobs on `ubuntu-latest`. Nothing has been pushed, so it has not run on GitHub
yet. Every job was run before committing, from a fresh clone of this branch,
the way a runner would run it: Linux jobs in a throwaway Ubuntu 24.04 (the
image `ubuntu-latest` uses) with the same tool versions. 72 and 12, as here.

The node job fetches full history: the regression test reads the original with
`git show`, and fails in the default one-commit clone (checked). The browser
job fails if the runner prints `SKIP`, which it does when it finds no Chrome;
otherwise a missing browser would read as a pass.
