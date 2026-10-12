"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const OI = require("../js/importer.js");
const OC = require("../js/core.js");
const OH = require("../js/helper.js");

const LIST_VIEW = `View Registration Information
Fall 2026
Electric Circuits I | Electrical Engineering ELEE 2110U Section 001 | Class Begin: 09/08/2026 | Class End: 12/07/2026
Registration Status: **Web Registered** on Jul 10, 2026
CRN: 40123
Schedule Type: Lecture
Instructor: Jane Example (Primary)
09/08/2026 -- 12/07/2026 Monday,Wednesday 03:10 PM - 04:30 PM Type: Class Location: North Oshawa Building: Science Building Room: UA1350
Electric Circuits I | Electrical Engineering ELEE 2110U Section 101 | Class Begin: 09/14/2026 | Class End: 12/04/2026
CRN: 40124
Schedule Type: Laboratory
09/14/2026 -- 12/04/2026 Thursday 11:10 AM - 02:00 PM Type: Laboratory Building: SIRC Room: SIRC 2060
Calculus II | Mathematics MATH 1020U Section 002
CRN: 40555
09/08/2026 -- 12/07/2026 Days: TR 09:40 AM - 11:00 AM Type: Lecture Building: Shawenjigewining Hall (SHA) Room: 101
09/08/2026 -- 12/07/2026 Friday 01:10 PM - 02:00 PM Type: Tutorial Building: UB Room: UB2080
Example Dropped Course | Communications COMM 1050U Section 001
CRN: 41000
Registration Status: Web Dropped
09/08/2026 -- 12/07/2026 Monday 10:10 AM - 11:30 AM Type: Lecture
`;

test("pasted list view: courses, sections, days, rooms, term", () => {
  const r = OI.importSource(LIST_VIEW);
  assert.equal(r.term, "202609");
  assert.equal(r.termSource, "page");
  const byCrn = Object.fromEntries(r.payload.courses.map(c => [c.crn, c]));
  assert.deepEqual(Object.keys(byCrn).sort(), ["40123", "40124", "40555", "41000"]);
  const lec = byCrn["40123"].meetings[0];
  assert.deepEqual(lec.days, ["Mon", "Wed"]);
  assert.equal(lec.kind, "Lecture");         // "Type: Class" falls back to the schedule type
  assert.equal(lec.building_code, "UA");
  assert.equal(lec.instructor, "Jane Example");
  assert.equal(byCrn["40123"].title, "Electric Circuits I");
  assert.equal(byCrn["40124"].meetings[0].instructor, undefined, "instructor is not copied between sections");
  assert.deepEqual(byCrn["40555"].meetings.map(m => [m.kind, m.days.join("")]), [["Lecture", "TueThu"], ["Tutorial", "Fri"]]);
  assert.equal(byCrn["40555"].meetings[0].building_code, "SHA");

  const n = OC.normalize(r.payload);
  assert.equal(n.meetings.length, 4);
  assert.equal(n.warnings.length, 1);
  assert.match(n.warnings[0], /COMM 1050U.*excluded registration status web dropped/);
  assert.ok(OC.makeCalendar(n.meetings).count > 40);
});

test("class-search layout: trailing start/end dates and 'Class on' days", () => {
  const text = `Electric Circuits I | ELEE 2110U, 001 | 3 | 40123 | Lecture | Registered
S M T W T F S 03:10 PM - 04:30 PM Type: Class Building: Science Building Room: UA1350 Start Date: 09/08/2026 End Date: 12/07/2026
Class on: Monday, Wednesday from 03:10 PM to 04:30 PM`;
  const r = OI.importSource(text);
  const c = r.payload.courses;
  assert.equal(c.length, 1);
  assert.equal(c[0].crn, "40123");
  assert.equal(c[0].title, "Electric Circuits I");
  assert.deepEqual(c[0].meetings[0].days, ["Mon", "Wed"]);
  assert.equal(c[0].meetings[0].start_date, "09/08/2026");
  assert.equal(r.term, "202609");
  assert.equal(r.termSource, "dates");
});

test("a course title containing 'Dropped' does not drop its neighbour", () => {
  const text = `Stats | DEMO 2200U Section 002\nCRN: 90021\n09/08/2026 -- 12/07/2026 Tuesday 11:10 AM - 12:30 PM Type: Lecture\nExample Dropped Course | DEMO 2900U Section 001\nCRN: 90091\nStatus: Registered\n09/08/2026 -- 12/07/2026 Friday 03:10 PM - 04:30 PM Type: Lecture`;
  const n = OC.normalize(OI.importSource(text).payload);
  assert.equal(n.meetings.length, 2);
  assert.deepEqual(n.warnings, []);
});

test("JSON passes straight through (helper output and saved schedules)", () => {
  const helper = { format: "banner-capture-v1", term: "202609", courses: [{ courseReferenceNumber: "40123", subject: "ELEE", courseNumber: "2110U", courseTitle: "Electric Circuits I", scheduleDescription: "Lecture", term: "202609",
    meetingsFaculty: [{ meetingTime: { beginTime: "1510", endTime: "1630", monday: true, wednesday: true, startDate: "09/08/2026", endDate: "12/07/2026", building: "UA", room: "1350" } }] }] };
  const r = OI.importSource(JSON.stringify(helper));
  assert.equal(r.kind, "json");
  assert.equal(r.term, "202609");
  const n = OC.normalize(r.payload);
  assert.equal(n.meetings[0].kind, "Lecture");
  assert.equal(n.meetings[0].code, "ELEE 2110U");
  assert.equal(OC.renderEvent(n.meetings[0], OC.PRESETS.Minimal).description, "UA 1350");
  assert.throws(() => OI.importSource("{ not json"), /could not be read/);
  assert.throws(() => OI.importSource("   "), /empty/);
});

test("HTML needs a DOM parser; MHTML quoted-printable is decoded", () => {
  assert.throws(() => OI.importSource("<!doctype html><html><body></body></html>"), /needs a browser/);
  const mhtml = [
    "From: <Saved by Blink>", "Snapshot-Content-Location: https://ssp.mycampus.ca/x", "Subject: View Registration Information",
    "MIME-Version: 1.0", 'Content-Type: multipart/related; type="text/html"; boundary="----MultipartBoundary--abc----"', "",
    "------MultipartBoundary--abc----", "Content-Type: text/html", "Content-Transfer-Encoding: quoted-printable", "",
    '<html><body><div class=3D"x">Caf=C3=A9 ELEE 2110U 03:10 PM - 04:30=', " PM</div></body></html>",
    "------MultipartBoundary--abc------", "",
  ].join("\r\n");
  assert.equal(OI.decodeMHTML(mhtml), '<html><body><div class="x">Café ELEE 2110U 03:10 PM - 04:30 PM</div></body></html>');
  let seen = "";
  OI.importSource(mhtml, { parseHtml: html => { seen = html; return { querySelectorAll: () => [], body: null, documentElement: { nodeType: 1, tagName: "HTML", getAttribute: () => null, childNodes: [] } }; } });
  assert.match(seen, /Café/);
});

test("term names and dates map to Banner term codes", () => {
  assert.equal(OI.termFromName("Winter", "2027"), "202701");
  assert.equal(OI.termFromName("Spring/Summer", "2027"), "202705");
  assert.equal(OI.termFromDate("2027-01-06"), "202701");
  assert.equal(OI.findTerm("Term: 202609").term, "202609");
});

test("helper snippet and bookmarklet are valid JavaScript that only talks to the schedule site", () => {
  assert.doesNotThrow(() => new Function(OH.SOURCE));
  const bm = OH.bookmarklet();
  assert.ok(bm.startsWith("javascript:"));
  assert.doesNotThrow(() => new Function(decodeURIComponent(bm.slice("javascript:".length))));
  const urls = OH.SOURCE.match(/https?:\/\/[^\s"'`]+/g) || [];
  assert.deepEqual(urls, [], "no absolute URLs: every request is same-origin");
  assert.match(OH.SOURCE, /location\.hostname !== "ssp\.mycampus\.ca"/);
});
