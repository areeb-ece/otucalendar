"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const OC = require("../js/core.js");

function bannerCourse() {
  return {
    term: "202609", courseReferenceNumber: "45860", subject: "ELEE",
    courseNumber: "TEST", courseTitle: "Circuits, Signals; and Systems",
    registrationStatusDescription: "Registered",
    meetingsFaculty: [{
      faculty: [{ displayName: "Example Teacher" }],
      meetingTime: {
        startDate: "10/26/2026", endDate: "11/09/2026", beginTime: "0900", endTime: "1020",
        monday: true, tuesday: "false", wednesday: false, thursday: false, friday: false, saturday: false, sunday: false,
        buildingDescription: "Example Building", room: "A;101", campusDescription: "North", scheduleTypeDescription: "Lecture",
      },
    }],
  };
}
const torontoHour = ms => OC.localOf(ms).mins / 60;

test("daylight saving: 9 am stays 9 am locally while UTC shifts", () => {
  const r = OC.normalize({ data: [bannerCourse()] });
  const cal = OC.makeCalendar(r.meetings);
  const evs = OC.parseIcs(cal.ics).events;
  assert.equal(cal.count, 3);
  assert.deepEqual(evs.map(e => new Date(e.start).getUTCHours()), [13, 14, 14]);
  assert.deepEqual(evs.map(e => torontoHour(e.start)), [9, 9, 9]);
  assert.ok(evs.every(e => e.end - e.start === 80 * 60000));
  assert.equal(evs[0].location, "Example Building A;101, North");
  assert.match(evs[0].description, /Example Teacher/);
});

test("event UIDs match the original Python exporter", () => {
  const cal = OC.makeCalendar(OC.normalize([bannerCourse()]).meetings);
  // hashlib.sha256(json.dumps(("202609","45860","Lecture","2026-10-26T13:00:00+00:00","2026-10-26T14:20:00+00:00")).encode())
  assert.equal(cal.events[0].uid, "9d1c13e672a09b901d8fc83ffff250c6ddeed34db151116b725eb6cebf8c62bd@ontario-tech-course-exporter.local");
  assert.equal(OC.pyJsonStr("Lecture é\x7f\n"), '"Lecture \\u00e9\\u007f\\n"');
});

test("multiple meeting-time entries and wrappers", () => {
  const course = bannerCourse();
  const first = course.meetingsFaculty[0].meetingTime;
  const second = { ...first, monday: false, thursday: true, beginTime: "1400", endTime: "1700" };
  course.meetingsFaculty[0].meetingTime = [first, second];
  const r = OC.normalize([course]);
  assert.equal(r.meetings.length, 2);
  assert.equal(OC.makeCalendar(r.meetings).count, 5);
  assert.equal([...OC.meetingRecords({ fmt: [{ meetingTime: [first, second] }] })].length, 2);
});

test("disjoint lab date windows are not filled in", () => {
  const course = bannerCourse();
  const raw = course.meetingsFaculty[0].meetingTime;
  course.meetingsFaculty = [
    { meetingTime: { ...raw, startDate: "10/26/2026", endDate: "10/26/2026" } },
    { meetingTime: { ...raw, startDate: "11/09/2026", endDate: "11/09/2026" } },
  ];
  assert.equal(OC.makeCalendar(OC.normalize([course]).meetings).count, 2);
});

test("exclusions, inclusive end date and exclusion text", () => {
  const skip = OC.exclusions("2026-10-26,2026-11-01..2026-11-08 # comment");
  const cal = OC.makeCalendar(OC.normalize([bannerCourse()]).meetings, { skip });
  assert.equal(cal.count, 1);
  assert.equal(OC.isoDay(OC.localOf(OC.parseIcs(cal.ics).events[0].start).day), "2026-11-09");
  assert.throws(() => OC.exclusions("2026-11-10..2026-11-01"));
  assert.equal(OC.exclusionText(skip), "2026-10-26, 2026-11-01..2026-11-08");
});

test("empty export, dropped sections and TBA meetings", () => {
  assert.throws(() => OC.makeCalendar([]), /No class occurrences/);
  const dropped = { ...bannerCourse(), registrationStatusDescription: "Web Dropped" };
  const r = OC.normalize([dropped]);
  assert.equal(r.meetings.length, 0);
  assert.match(r.warnings[0], /excluded registration status/);
  const tba = bannerCourse();
  tba.meetingsFaculty[0].meetingTime.beginTime = "TBA";
  assert.match(OC.normalize([tba]).warnings[0], /TBA/);
});

test("fallback dates only apply to meetings without their own", () => {
  const c = bannerCourse();
  delete c.meetingsFaculty[0].meetingTime.startDate;
  delete c.meetingsFaculty[0].meetingTime.endDate;
  assert.match(OC.normalize([c]).warnings[0], /missing meeting dates/);
  const r = OC.normalize([c], { start: OC.parseDate("2026-10-26"), end: OC.parseDate("2026-11-02") });
  assert.equal(OC.makeCalendar(r.meetings).count, 2);
});

test("alternating labs and the fictional sample (32 events, as before)", () => {
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "../samples/sample_schedule.json"), "utf8"));
  const lab = OC.normalize(sample).meetings.find(m => m.crn === "99902");
  assert.equal(lab.intervalWeeks, 2);
  assert.equal(OC.makeCalendar([lab]).count, 6);
  const original = { ...sample, courses: sample.courses.slice(0, 2) };
  assert.equal(OC.makeCalendar(OC.normalize(original).meetings).count, 32);
  assert.deepEqual(require("../js/sample.js"), sample, "js/sample.js must match samples/sample_schedule.json");
});

test("term weeks for an exported image: which classes aren't weekly, and when they meet", () => {
  const meetings = OC.normalize(require("../js/sample.js")).meetings;
  const t = OC.termWeeks(meetings, OC.exclusions("2026-10-12..2026-10-16"));
  assert.equal(t.weeks.length, 14);
  assert.equal(OC.isoDay(t.weeks[0]), "2026-09-07");
  const by = (code, kind) => t.patterns[meetings.findIndex(m => m.code === code && m.kind === kind)];
  // The alternating lab: W2, W4 … W12, on the Thursday of each.
  const lab = by("DEMO 1000U", "Laboratory");
  assert.equal(lab.weekly, false);
  assert.deepEqual(lab.weeks, [1, 3, 5, 7, 9, 11]);
  assert.equal(OC.weekList(lab.weeks), "alternate weeks, W2–W12");
  assert.deepEqual(lab.days[1].map(OC.isoDay), ["2026-09-17"]);
  // A skipped date keeps its week in the pattern, listed apart.
  assert.deepEqual(lab.days[5], []);
  assert.deepEqual(lab.skipped[5].map(OC.isoDay), ["2026-10-15"]);
  // Starting in week 2 makes a class irregular; the term ending on a Monday doesn't.
  assert.equal(by("DEMO 1100U", "Tutorial").weekly, false);
  assert.equal(OC.weekList(by("DEMO 1100U", "Tutorial").weeks), "W2–W13");
  assert.equal(by("DEMO 1100U", "Lecture").weekly, true);
  assert.equal(by("DEMO 1000U", "Lecture").weekly, true);
  assert.deepEqual(OC.termWeeks([]), { weeks: [], patterns: [] });
  assert.equal(OC.weekList([0, 1, 2, 4, 7]), "W1–W3, W5, W8");
  assert.equal(OC.weekList([9, 0, 3, 6]), "every 3 weeks, W1–W10");
  assert.equal(OC.weekList([4]), "W5 only");
});

test("templates: presets, case-insensitive fields, literal braces, errors", () => {
  const m = OC.normalize(require("../js/sample.js")).meetings[0];
  const r = OC.renderEvent(m, OC.PRESETS.Minimal);
  assert.equal(r.title, "DEMO 1000U · Lecture");
  assert.equal(r.description, "EX 101");
  assert.equal(r.location, "");
  assert.equal(OC.renderTemplate("{{x}} {coursecode}", OC.valuesFor(m)).text, "{x} DEMO 1000U");
  assert.throws(() => OC.templateParts("{Nope}"), /Unknown/);
  assert.throws(() => OC.templateParts("{CourseCode"), /Unmatched/);
  assert.throws(() => OC.templateParts("a } b"), /Unmatched/);
  assert.throws(() => OC.renderEvent({ ...m, instructor: "" }, { title: "{Instructor}", description: "", location: "" }), /title is empty/);
  assert.equal(OC.roomLabel("UA", "UA1350"), "UA1350");
  assert.equal(OC.roomLabel("UA", "1350"), "UA 1350");
});

test(".ics text: escaping, folding, reminders and a round trip", () => {
  const c = bannerCourse();
  c.courseTitle = "Ünïcode, title; with \\ and a very long name that will certainly need folding at seventy-five octets";
  const cal = OC.makeCalendar(OC.normalize([c]).meetings, { reminder: 15, name: "Fall, 2026" });
  for (const line of cal.ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(cal.ics, /X-WR-CALNAME:Fall\\, 2026/);
  assert.match(cal.ics, /TRIGGER:-PT15M/);
  const ev = OC.parseIcs(cal.ics).events[0];
  assert.ok(ev.summary.startsWith("ELEE TEST · Ünïcode, title; with \\ and a very long"));
  assert.deepEqual(ev.alarms, ["-PT15M"]);
  assert.match(OC.makeCalendar(OC.normalize([c]).meetings, { reminder: 0 }).ics, /TRIGGER:PT0S/);
});

test("time parsing and zone conversion edge cases", () => {
  assert.equal(OC.parseTime("03:10 PM"), 15 * 60 + 10);
  assert.equal(OC.parseTime("12:00 AM"), 0);
  assert.equal(OC.parseTime("0940"), 9 * 60 + 40);
  assert.throws(() => OC.parseTime("25:00"));
  assert.equal(OC.parseDate("Sep 8, 2026"), OC.parseDate("2026-09-08"));
  assert.throws(() => OC.parseDate("02/30/2026"));
  // 02:30 does not exist on 2027-03-14; like Python's fold=0 it lands at 03:30 EDT.
  assert.equal(OC.localOf(OC.zonedToUtc(OC.dayNum(2027, 3, 14), 150)).mins, 210);
});

test("editable schedule saves and reloads to the same meetings", () => {
  const meetings = OC.normalize(require("../js/sample.js")).meetings;
  const again = OC.normalize(JSON.parse(JSON.stringify(OC.editableSchedule(meetings)))).meetings;
  assert.deepEqual(again, meetings);
});

test("classes and bi-weekly sets: one class per course, section, day and time; reading week", () => {
  const mt = (kind, days, from, to, time = ["11:10 AM", "12:30 PM"], room = "SCI1350") => ({ kind, days, start_time: time[0], end_time: time[1], start_date: from, end_date: to, building_code: "SCI", room });
  const dates = (list, day, kind, room) => list.map((d, i) => mt(kind, [day], `${d}/2027`, `${d}/2027`, undefined, room && i % 2 ? room : "SCI3420"));
  const schedule = courses => OC.normalize({ format: "ontario-tech-calendar-v1", timezone: "America/Toronto", term: "202701", courses }).meetings;
  const meetings = schedule([
    { crn: "70001", code: "DEMO 2100U", title: "Lecture", meetings: [mt("Lecture", ["Tue", "Thu"], "01/11/2027", "04/09/2027")] },
    // two labs a fortnight apart; one changes room every other time, which is still one class
    { crn: "70002", code: "DEMO 2100U", title: "Lab", meetings: dates(["01/13", "01/27", "02/10", "03/03", "03/17", "03/31"], "Wed", "Laboratory", "SCI2120") },
    { crn: "70003", code: "DEMO 2200U", title: "Lab", meetings: dates(["01/18", "02/01", "02/22", "03/08", "03/22", "04/05"], "Mon", "Laboratory") },
  ]);
  const cp = OC.classPatterns(meetings);
  assert.equal(cp.classes.length, 3);
  const lab = cp.classes.find(c => meetings[c.members[0]].crn === "70002");
  assert.equal(lab.members.length, 6);
  assert.deepEqual(lab.rooms, ["SCI 3420", "SCI 2120"].map(r => r.replace(" ", "")));
  assert.deepEqual([lab.biweekly, lab.set, OC.weekList(lab.weeks)], [true, 1, "W1, W3, W5, W8, W10, W12"]);
  const other = cp.classes.find(c => meetings[c.members[0]].crn === "70003");
  assert.deepEqual([other.biweekly, other.set, OC.weekList(other.weeks)], [true, 2, "W2, W4, W7, W9, W11, W13"]);
  assert.equal(cp.sets, 2);
  assert.equal(cp.classes.find(c => meetings[c.members[0]].kind === "Lecture").weekly, true);
  // Neither set meets in W6, though the lecture is still listed then: that's reading week.
  assert.equal(OC.readingWeek(cp), 5);
  // Skipping it leaves every class as it was: weekly classes stay weekly.
  const skipped = OC.classPatterns(meetings, OC.exclusions("2027-02-15..2027-02-19"));
  assert.deepEqual(skipped.classes.map(c => [c.weekly, c.set]), cp.classes.map(c => [c.weekly, c.set]));

  // A lecture Banner lists in two parts around a week with nothing in it: still weekly, and the gap is the break.
  const split = OC.classPatterns(schedule([{ crn: "70004", code: "DEMO 2300U", title: "x", meetings: [mt("Lecture", ["Mon"], "01/11/2027", "02/12/2027"), mt("Lecture", ["Mon"], "02/22/2027", "04/09/2027")] }]));
  assert.deepEqual([split.classes.length, split.classes[0].weekly, split.empty, OC.readingWeek(split)], [1, true, [5], 5]);
  // Two parts of term with a week between them aren't a break: nothing to detect, so the page asks.
  const parts = OC.classPatterns(schedule([
    { crn: "70005", code: "DEMO 2400U", title: "x", meetings: [mt("Lecture", ["Tue"], "05/05/2025", "06/13/2025")] },
    { crn: "70006", code: "DEMO 2500U", title: "x", meetings: [mt("Lecture", ["Tue"], "06/23/2025", "08/05/2025")] },
  ]));
  assert.deepEqual([parts.empty, OC.readingWeek(parts)], [[], -1]);
});
