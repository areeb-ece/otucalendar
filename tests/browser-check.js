"use strict";
/* End-to-end check in a real browser (needs Playwright: `npm i --no-save playwright`).
 * Serves the site locally, imports the fictional saved page as .html and as a real
 * Chrome "Single File" (.mhtml) snapshot, and asserts that the page never touches
 * the network beyond its own files. Run: npm run test:browser */
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
    // The shared master palette lives on the portfolio site, not in this repo; locally the
    // page falls back to the colours in css/style.css, so serve it as an empty stylesheet.
    await page.route("**/design/tokens.css", r => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await page.goto(base + "/");

    for (const file of [path.join(ROOT, "samples/saved-schedule-page.example.html"), mhtml]) {
      await page.setInputFiles("#fileInput", file);
      await page.waitForSelector("#reportDlg:not([hidden])");
      const st = await page.evaluate(() => ({ n: S.meetings.length, count: S.count, term: S.term, codes: [...S.colors.keys()], kinds: S.meetings.map(m => `${m.code} ${m.kind} ${m.days.join("")}`) }));
      assert.equal(st.term, "202609", file);
      assert.deepEqual(st.codes, ["DEMO 2100U", "DEMO 2200U"], file);
      assert.deepEqual(st.kinds, ["DEMO 2100U Lecture 02", "DEMO 2100U Laboratory 1", "DEMO 2200U Lecture 13", "DEMO 2200U Tutorial 4"], file);
      assert.equal(st.count, 76, file);
      await page.click("#reportDlg footer .btn.primary");
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

    assert.deepEqual(outside, [], "the page must not make network requests outside its own files");
    assert.deepEqual(errors, []);
    console.log("ok no outside requests, no errors");
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
