"use strict";
/* End-to-end check in a real browser (needs Playwright: `npm i --no-save playwright`).
 * Serves the site locally, imports the fictional saved page as .html and as a real
 * Chrome "Single File" (.mhtml) snapshot, and asserts that the page never touches
 * the network beyond its own files. Run: npm run test:browser
 *
 * The shared theme, settings panel and night sky live in the portfolio repo
 * (areeb-ece.github.io, public/design/). Without them the page must fall back to its own
 * light/dark switch, which is what runs by default. To check the real thing, point
 * DESIGN_DIR at a checkout's public/design:
 *   DESIGN_DIR=../areeb-ece.github.io/public/design npm run test:browser */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const opts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(opts);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otucal-"));
  try {
    // A real "Webpage, Single File" save of the fictional page, made by Chrome itself.
    const src = await browser.newPage();
    await src.route("**/*", r => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await src.goto(`${base}/samples/saved-schedule-page.example.html`);
    const cdp = await src.context().newCDPSession(src);
    const mhtml = path.join(tmp, "schedule.mhtml");
    fs.writeFileSync(mhtml, (await cdp.send("Page.captureSnapshot", { format: "mhtml" })).data);

    const page = await browser.newPage({ viewport: { width: 1300, height: 860 } });
    const errors = [], outside = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("request", r => { if (!r.url().startsWith(base) && !r.url().startsWith("blob:")) outside.push(r.url()); });
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const DESIGN = process.env.DESIGN_DIR && path.resolve(process.env.DESIGN_DIR);
    await page.route("**/design/*", r => {
      const name = path.basename(new URL(r.request().url()).pathname);
      const type = name.endsWith(".css") ? "text/css" : "text/javascript";
      r.fulfill({ status: 200, contentType: type, body: DESIGN ? fs.readFileSync(path.join(DESIGN, name)) : "" });
    });
    // /design/fonts.css loads Libre Franklin from the portfolio's /fonts/, next to /design/.
    await page.route(`${base}/fonts/*`, r => {
      const name = path.basename(new URL(r.request().url()).pathname);
      const file = DESIGN && path.join(DESIGN, "../fonts", name);
      if (file && fs.existsSync(file)) r.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(file) });
      else r.fulfill({ status: 200, contentType: "font/woff2", body: "" });
    });
    await page.goto(base + "/");
    if (DESIGN) {
      // The shared settings button replaces the light/dark switch, and the sky is drawn.
      assert.ok(await page.isVisible("#designSettings"), "settings button");
      assert.ok(await page.isHidden("#btnTheme"));
      assert.ok(await page.$$eval("#stage .sky circle", c => c.length) > 0, "stars behind the preview");
      await page.evaluate(() => SiteDesign.set({ theme: "console" }));
      await page.reload();
      assert.equal(await page.getAttribute("html", "data-theme"), "console", "theme remembered");
      await page.evaluate(() => SiteDesign.reset());
      console.log("ok shared settings button, theme and night sky");
    } else {
      assert.ok(await page.isVisible("#btnTheme"), "offline: the light/dark switch stands in for the settings button");
      await page.$eval("#btnTheme", b => b.click()); // under the start screen
      assert.equal(await page.getAttribute("html", "data-theme"), "light");
      await page.$eval("#btnTheme", b => b.click());
      console.log("ok offline light/dark switch");
    }

    for (const file of [path.join(ROOT, "samples/saved-schedule-page.example.html"), mhtml]) {
      await page.setInputFiles("#fileInput", file);
      await page.waitForSelector("#reportDlg:not([hidden])");
      const st = await page.evaluate(() => ({ n: S.meetings.length, count: S.count, term: S.term, codes: [...S.colors.keys()], kinds: S.meetings.map(m => `${m.code} ${m.kind} ${m.days.join("")}`) }));
      assert.equal(st.term, "202609", file);
      assert.deepEqual(st.codes, ["DEMO 2100U", "DEMO 2200U"], file);
      assert.deepEqual(st.kinds, ["DEMO 2100U Lecture 02", "DEMO 2100U Laboratory 1", "DEMO 2200U Lecture 13", "DEMO 2200U Tutorial 4"], file);
      assert.equal(st.count, 76, file);
      await page.click("#reportDlg footer .sd-primary");
      console.log(`ok ${path.extname(file)} import: ${st.n} meetings, ${st.count} events`);
    }

    // preview: week navigation, skipping a day, the .ics view and the download
    const week = await page.evaluate(() => S.week);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => S.week), Math.min(week + 1, 13));
    await page.evaluate(() => toggleSkip(S.weeks[S.week].start));
    assert.equal(await page.evaluate(() => S.count), 75);
    await page.click("#viewSeg [data-view=ics]");
    assert.match(await page.textContent("#icsText"), /^BEGIN:VCALENDAR/);
    const dl = page.waitForEvent("download");
    await page.click("#btnDownload");
    const d = await dl;
    assert.equal(d.suggestedFilename(), "ontario-tech-202609.ics");
    const ics = fs.readFileSync(await d.path(), "utf8");
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 75);
    console.log("ok preview, skip and download");

    // image export, with the fictional sample's alternating lab and a skipped week
    await page.click("#viewSeg [data-view=weeks]");
    await page.click("#btnHome");
    await page.click("#welcomeDlg [data-action=sample]");
    await page.click("#reportDlg footer .sd-primary");
    await page.fill("#oSkip", "2026-10-12..2026-10-16");
    await page.waitForFunction(() => S.skip.size === 5);
    await page.click("#btnImage");
    await page.waitForSelector("#imageDlg:not([hidden])");
    const scopes = await page.$$eval("#imgScope button", b => b.map(x => x.textContent));
    assert.equal(scopes[0], "Whole term");
    assert.match(scopes[1], /^Week \d+$/);
    assert.equal(scopes[2], "All 14 weeks");
    assert.equal(await page.$$eval("#imgCourses input", i => i.length), 4, "a checkbox per course");
    assert.match(await page.textContent("#imgDims"), /^[\d,]+ × [\d,]+ px$/);
    // The week table gives the alternating lab's exact dates: W2, W4 … W12, struck out when skipped;
    // the lab is drawn once, striped, with the weeks it meets in the key.
    const spec = await page.evaluate(() => buildImageSpec(imageOptions()).ops.filter(o => o.t === "text").flatMap(o => (o.parts ? o.parts.map(p => p.text) : [o.text])));
    for (const t of ["Bi-weekly: W2, W4, W6, W8, W10, W12", "bi-weekly", "W14", "Skipped (no classes)", "12–16", "made by areeb · ", "areeb-ece.github.io/otucalendar"]) assert.ok(spec.includes(t), `image has "${t}"`);
    const saveImage = async () => {
      const dl = page.waitForEvent("download");
      await page.click("#imgGo");
      const file = await dl;
      return { name: file.suggestedFilename(), data: fs.readFileSync(await file.path()) };
    };
    const png = await saveImage();
    assert.equal(png.name, "ontario-tech-202609-schedule.png");
    assert.equal(png.data.subarray(1, 4).toString(), "PNG");
    assert.equal(png.data.readUInt32BE(16), 974 * 3, "3× by default");
    await page.click("#btnImage");
    await page.click("#imgScope [data-v=all]");
    await page.click("#imgFormat [data-v=svg]");
    assert.ok(await page.$eval("#imgScale button", b => b.disabled), "no resolution for SVG");
    const svg = await saveImage();
    assert.equal(svg.name, "ontario-tech-202609-all-weeks.svg");
    assert.match(svg.data.toString(), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[\s\S]*W14[\s\S]*made by areeb[\s\S]*<\/svg>$/);
    await page.click("#btnImage");
    await page.click("#imgCourses input");
    await page.click("#imgFormat [data-v=png]");
    await page.click("#imgScope [data-v=week]");
    const one = await saveImage();
    assert.match(one.name, /^ontario-tech-202609-week-\d+\.png$/);
    console.log(`ok image export: ${png.name} (${png.data.length} bytes), ${svg.name}, ${one.name}`);

    // Banner's current paste (subjects spelled out, a bi-weekly lab as one meeting per date):
    // every class lands in its own course, the two bi-weekly sets give away reading week, and
    // confirming it leaves that week empty without making the weekly classes irregular.
    await page.click("#btnHome");
    await page.click('#welcomeDlg [data-import-tab="paste"]');
    await page.fill("#pasteText", fs.readFileSync(path.join(ROOT, "samples/schedule-details-paste.example.txt"), "utf8"));
    if (await page.isVisible("#btnPasteImport")) await page.click("#btnPasteImport");
    await page.waitForSelector("#reportDlg:not([hidden])");
    await page.click("#reportDlg footer .sd-primary");
    const p = await page.evaluate(() => ({ codes: [...S.colors.keys()], crns: [...new Set(S.meetings.map(m => m.crn))].sort(), sets: S.pat.sets, count: S.count }));
    assert.deepEqual(p.codes, ["DEMO 1800U", "DEMO 2100U"]);
    assert.deepEqual(p.crns, ["70001", "70002", "70011", "70012"]);
    assert.equal(p.sets, 2);
    assert.match(await page.textContent("#rwBar"), /Is W6, Feb 15–19, reading week\?/);
    await page.click("#rwBar .sd-primary");
    const after = await page.evaluate(() => ({ count: S.count, rw: OC.isoDay(S.readingWeek), weekly: S.pat.classes.filter(c => c.weekly).length, ev: S.weeks[5].events.length }));
    assert.deepEqual(after, { count: p.count - 4, rw: "2027-02-15", weekly: 4, ev: 0 }, "the four lectures listed in W6 are gone");
    assert.match(await page.textContent("#rwBar"), /Reading week: W6, Feb 15–19/);
    assert.equal(await page.$$eval("#track .ev.bw1, #track .ev.bw2", e => e.length), 12, "bi-weekly classes are patterned");
    // each course its colour, each of its sessions a shade of it: lecture the colour, lab the next shade
    const shades = await page.evaluate(() => [...new Set(S.meetings.map(m => `${m.code} ${m.kind} ${colorOf(m)}`))].sort());
    assert.equal(shades.length, 4, "a shade per session");
    assert.ok(shades.every(s => / Lecture var\(--c\d\)$/.test(s) || / Laboratory color-mix\(/.test(s)), shades.join("; "));
    assert.equal(await page.$$eval("#legend .sws .sw", e => e.length), 4, "the legend has a swatch per session");
    await page.click("#btnImage");
    await page.waitForSelector("#imageDlg:not([hidden])");
    await page.click("#imgScope [data-v=term]");
    const term = await page.evaluate(() => buildImageSpec(imageOptions()).ops.filter(x => x.t === "text").map(x => x.text));
    await page.click("#imageDlg [data-close]");
    for (const t of ["Bi-weekly set 1: W1, W3, W5, W8, W10, W12", "Bi-weekly set 2: W2, W4, W7, W9, W11, W13", "Reading week: W6, Feb 15–19 (no classes)", "bi-weekly · set 1"]) assert.ok(term.includes(t), `term image has "${t}"`);
    assert.deepEqual(["bi-weekly · set 1", "bi-weekly · set 2"].map(n => term.filter(t => t === n).length), [1, 1], "each bi-weekly lab is one block, not one per date");
    console.log(`ok Banner paste: ${p.crns.length} sections, reading week W6 confirmed, ${after.count} events`);

    // "by areeb" goes to the portfolio; the phone layout still has room for the image button
    assert.equal(await page.getAttribute(".brandline .by", "href"), "https://areeb-ece.github.io/");
    assert.equal(await page.getAttribute(".brandline .by", "target"), null);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.isVisible("#btnImage"));
    const wide = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(wide[0] <= wide[1] + 1, `phone: no sideways scroll (${wide})`);
    console.log("ok portfolio link, phone layout");

    assert.deepEqual(outside, [], "the page must not make network requests outside its own files");
    assert.deepEqual(await page.evaluate(() => window.__csp), [], "no Content Security Policy violations");
    assert.deepEqual(errors, []);
    console.log("ok no outside requests, no errors");
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
