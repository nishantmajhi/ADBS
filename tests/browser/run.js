/*
 * Opens the real popup in a real browser.
 *
 * `review.md` has carried a manual check since 2026-09-18: open the popup and
 * confirm both forms land on today's date in both calendars, then open the
 * popup's devtools, convert a few dates, and confirm the Network tab stays
 * empty. It was listed as one of four extensions waiting for somebody with a
 * browser open.
 *
 * This one does not need a person, and it does not even need an extension
 * host. ADBS declares no permissions and its popup calls no `chrome.*` API at
 * all, so `popup.html` is a plain page: copied to a scratch directory and
 * opened from a `file://` URL, it is the same page the popup shows. Both
 * facts are asserted below rather than assumed, because if either stopped
 * being true this run would quietly become a test of something else.
 *
 * Chrome is driven with `--headless=new --dump-dom`, no driver and no
 * dependency; the technique is MDview's. With no browser installed this exits
 * 0 and says SKIP.
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const POPUP = path.join(ROOT, "src", "popup", "popup.html");

const CANDIDATES = [
  process.env.ADBS_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findBrowser() {
  for (const candidate of CANDIDATES) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not there */
    }
  }
  return null;
}

const APPENDED = '\n<script src="driver.js"></script>\n';

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adbs-browser-"));
  /* The whole of src/, because popup.html reaches up into ../lib/. */
  copyTree(path.join(ROOT, "src"), path.join(dir, "src"));

  const popupDir = path.join(dir, "src", "popup");
  fs.copyFileSync(path.join(__dirname, "driver.js"), path.join(popupDir, "driver.js"));

  const original = fs.readFileSync(POPUP, "utf8");
  fs.writeFileSync(path.join(popupDir, "popup.html"), original + APPENDED, "utf8");

  /* The page under test must be the page it claims to be. */
  const staged = fs.readFileSync(path.join(popupDir, "popup.html"), "utf8");
  if (
    staged.slice(0, original.length) !== original ||
    staged.slice(original.length) !== APPENDED
  ) {
    throw new Error("the staged copy is not the popup plus exactly one script tag");
  }
  return path.join(popupDir, "popup.html");
}

function run(browser, page) {
  const profile = path.join(path.dirname(page), "profile");
  const result = spawnSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      "--disable-extensions",
      "--user-data-dir=" + profile,
      "--virtual-time-budget=60000",
      "--dump-dom",
      "file:///" + page.replace(/\\/g, "/"),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 },
  );

  if (result.error) throw result.error;
  const dom = result.stdout || "";
  const match = dom.match(/<div id="test-results">([\s\S]*?)<\/div>/);
  if (!match) {
    throw new Error(
      "the page produced no results. Last of the dumped DOM:\n" +
        dom.slice(-1500) +
        "\n--- stderr ---\n" +
        (result.stderr || "").slice(-1500),
    );
  }
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded);
}

/*
 * The two assumptions this whole approach rests on. If the popup ever starts
 * calling a `chrome.*` API, or the manifest ever asks for a host, then opening
 * `popup.html` from a file:// URL stops being equivalent to opening the popup
 * and these checks quietly become worthless. So they are checks.
 */
function staticChecks(report) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
  );

  const hosts = []
    .concat(manifest.host_permissions || [])
    .concat(manifest.permissions || [])
    .concat((manifest.content_scripts || []).flatMap((c) => c.matches || []));
  report(
    "the manifest asks for no permissions and no hosts",
    hosts.length === 0,
    hosts.length ? "it asks for: " + hosts.join(", ") : null,
  );

  const sources = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html)$/i.test(entry.name)) sources.push(full);
    }
  })(path.join(ROOT, "src"));

  const usingChrome = sources.filter((file) =>
    /\bchrome\s*\./.test(fs.readFileSync(file, "utf8")),
  );
  report(
    "no popup source calls a chrome.* API, so the page runs standalone",
    usingChrome.length === 0,
    usingChrome.length
      ? "these do: " + usingChrome.map((f) => path.relative(ROOT, f)).join(", ")
      : null,
  );

  /*
   * Remote things the page would *load*, which is what "works offline" means.
   *
   * Deliberately not every remote URL in the source: the popup's footer credits
   * two links a person can click, and an `<a href>` is a destination rather
   * than a resource. The extension has no host permissions, so a fetch could
   * not reach anywhere in any case; what this catches is a stylesheet, script,
   * font or image creeping back onto a CDN, which is how the CDN dependency
   * got into a sibling project.
   */
  const LOADS_REMOTE = /(?:\bsrc\s*=|<link\b[^>]*\bhref\s*=|url\()\s*['"]?\s*https?:\/\//i;
  const remote = sources.filter((file) =>
    LOADS_REMOTE.test(fs.readFileSync(file, "utf8")),
  );
  report(
    "nothing is loaded from a remote URL",
    remote.length === 0,
    remote.length
      ? "these do: " + remote.map((f) => path.relative(ROOT, f)).join(", ")
      : null,
  );
}

function main() {
  let failed = 0;
  const report = (name, ok, why) => {
    if (ok) {
      console.log("  ok   " + name);
    } else {
      failed++;
      console.log("  FAIL " + name + (why ? "\n       " + why : ""));
    }
  };

  staticChecks(report);

  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chrome or Edge found. Set ADBS_BROWSER to one.");
    return failed === 0 ? 0 : 1;
  }
  console.log("browser: " + browser);

  for (const r of run(browser, stage())) {
    report(r.name, r.ok, r.error || null);
  }

  console.log(failed === 0 ? "\nbrowser: all checks passed" : "\nbrowser: " + failed + " failed");
  return failed === 0 ? 0 : 1;
}

process.exit(main());
