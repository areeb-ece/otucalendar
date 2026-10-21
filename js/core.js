/* OTU/CALENDAR core: normalizes Banner meeting data, expands class occurrences in
 * Toronto time and writes / reads .ics text. Pure functions, no DOM; shared by the
 * page and the tests. A port of the original calendar_core.py + event_style.py, so
 * event identifiers (UIDs) match files made by the earlier Python exporter. */
const OC = (() => {
  "use strict";

  const TZ = "America/Toronto";
  const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MISSING = new Set(["", "tba", "tbd", "none", "null", "n/a", "arr", "arranged"]);
  const DAY_MS = 86400000;

  const text = v => (v === null || v === undefined ? "" : String(v).trim());
  const validCrn = v => /^[0-9]{5}$/.test(text(v));
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  function pick(obj, keys, dflt = "") {
    for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== null && obj[k] !== undefined && text(obj[k]) !== "") return obj[k];
    return dflt;
  }
  const truth = v => v === true || ["true", "1", "y", "yes"].includes(text(v).toLowerCase());
  const pad = (n, w = 2) => String(n).padStart(w, "0");

  // ── dates as day numbers (days since 1970-01-01, timezone free) ───────────
  const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  function ymd(n) { const t = new Date(n * DAY_MS); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
  const isoDay = n => { const p = ymd(n); return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`; };
  const weekday = n => (new Date(n * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
  function validDay(y, m, d) { if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null; const n = dayNum(y, m, d); const p = ymd(n); return p.m === m && p.d === d ? n : null; }

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function parseDate(value) {
    const v = text(value);
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/);
    let n = null;
    if (m) n = validDay(+m[1], +m[2], +m[3]);
    else if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) n = validDay(+m[3], +m[1], +m[2]);
    else if ((m = v.match(/^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/))) { const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (i >= 0) n = validDay(+m[3], i + 1, +m[2]); }
    else if ((m = v.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) { const i = MONTHS.indexOf(m[2].toLowerCase()); if (i >= 0) n = validDay(+m[3], i + 1, +m[1]); }
    if (n === null) throw new Error(`Missing or unrecognized date: '${v}'`);
    return n;
  }

  // times as minutes after midnight
  function parseTime(value) {
    let v = text(value).toUpperCase().replace(/\./g, "");
    if (MISSING.has(v.toLowerCase())) throw new Error("no scheduled time (TBA / asynchronous)");
    let m;
    if (/^\d{1,4}$/.test(v)) { v = v.padStart(4, "0"); const h = +v.slice(0, 2), mi = +v.slice(2); if (h < 24 && mi < 60) return h * 60 + mi; }
    else if ((m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/))) { if (+m[1] < 24 && +m[2] < 60) return +m[1] * 60 + +m[2]; }
    else if ((m = v.match(/^(\d{1,2}):(\d{2}) ?([AP])M$/))) { const h = +m[1]; if (h >= 1 && h <= 12 && +m[2] < 60) return (h % 12 + (m[3] === "P" ? 12 : 0)) * 60 + +m[2]; }
    throw new Error(`Unrecognized time: '${text(value)}'`);
  }
  const hhmm = mins => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

  function parseDays(obj) {
    if (WEEKDAYS.some(k => k in obj)) return WEEKDAYS.map((k, i) => truth(obj[k]) ? i : -1).filter(i => i >= 0);
    let raw = pick(obj, ["days", "daysOfWeek"], []);
    if (typeof raw === "string") {
      raw = raw.trim().split(/[, /]+/).filter(Boolean);
      if (raw.length === 1 && /^[MTWRFSU]+$/.test(raw[0])) raw = raw[0].split("");
    }
    if (!Array.isArray(raw)) throw new Error("Unrecognized weekdays");
    const names = {};
    WEEKDAYS.forEach((w, i) => { names[w.slice(0, 2)] = i; });
    "mtwrfsu".split("").forEach((c, i) => { names[c] = i; });
    const days = new Set();
    for (const item of raw) {
      if (Number.isInteger(item) && item >= 0 && item <= 6) { days.add(item); continue; }
      let key = text(item).toLowerCase();
      key = key.length === 1 ? key : key.slice(0, 2);
      if (!(key in names)) throw new Error(`Unrecognized weekday: '${text(item)}'`);
      days.add(names[key]);
    }
    return [...days].sort((a, b) => a - b);
  }

  // ── Banner / editable record discovery ───────────────────────────────────
  const COURSE_KEYS = ["courseTitle", "courseNumber", "subject", "subjectCourse", "meetingsFaculty", "meetings", "title"];
  function* courseRecords(payload) {
    if (Array.isArray(payload)) { for (const item of payload) yield* courseRecords(item); return; }
    if (!isObj(payload)) return;
    const crn = pick(payload, ["courseReferenceNumber", "crn"]);
    const isCourse = COURSE_KEYS.some(k => k in payload);
    // Editable records (our own format) may lack a CRN when it was not on the imported page.
    const editable = Array.isArray(payload.meetings) && text(payload.code) !== "" && text(crn) === "";
    if ((validCrn(crn) && isCourse) || editable) { yield payload; return; }
    for (const [k, item] of Object.entries(payload)) if (!["faculty", "meetingTime", "meetingTimes"].includes(k) && item && typeof item === "object") yield* courseRecords(item);
  }

  function* meetingRecords(payload, inherited = {}) {
    if (Array.isArray(payload)) { for (const item of payload) yield* meetingRecords(item, inherited); return; }
    if (!isObj(payload)) return;
    const meta = { ...inherited };
    for (const k of ["faculty", "scheduleTypeDescription", "scheduleType", "startDate", "endDate"]) if (k in payload) meta[k] = payload[k];
    if (["beginTime", "start_time", "endTime", "end_time"].some(k => k in payload)) { yield { ...meta, ...payload }; return; }
    for (const k of ["meetingTime", "meetingTimes", "meetingsFaculty", "meetings", "fmt", "data"]) if (k in payload) yield* meetingRecords(payload[k], meta);
  }

  function instructors(raw) {
    if (typeof raw === "string") return raw;
    if (isObj(raw)) raw = [raw];
    if (!Array.isArray(raw)) return "";
    const names = [];
    for (const p of raw) {
      if (!isObj(p)) continue;
      let name = text(pick(p, ["displayName", "name"]));
      if (!name) name = [text(p.firstName), text(p.lastName)].filter(Boolean).join(" ");
      if (name && !names.includes(name)) names.push(name);
    }
    return names.join(", ");
  }

  function label(m) { return [m.code, m.title, m.kind].filter(Boolean).join(" · "); }

  /** payload → {meetings, warnings, courseCount}. start/end are fallback day numbers. */
  function normalize(payload, { term = "", start = null, end = null } = {}) {
    const result = { meetings: [], warnings: [], courseCount: 0 };
    const seen = new Set();
    for (const course of courseRecords(payload)) {
      const courseTerm = text(pick(course, ["term", "termCode"], term));
      if (term && courseTerm && courseTerm !== term) continue;
      result.courseCount++;
      const crn = text(pick(course, ["courseReferenceNumber", "crn"]));
      let code = text(pick(course, ["code", "subjectCourse"]));
      if (!code) code = [text(course.subject), text(course.courseNumber)].filter(Boolean).join(" ");
      const title = text(pick(course, ["courseTitle", "title"], crn ? `CRN ${crn}` : code));
      const lbl = `${code || title}${crn ? ` (CRN ${crn})` : ""}`;
      // Registration-history pages can contain dropped or waitlisted sections.
      const status = text(pick(course, ["registrationStatusDescription", "statusDescription", "status"])).toLowerCase();
      const statusCode = text(pick(course, ["registrationStatus", "registrationStatusCode"])).toUpperCase();
      if (["drop", "withdraw", "waitlist", "cancel"].some(w => status.includes(w)) || ["DD", "DW", "DC", "WL", "WD"].includes(statusCode)) {
        result.warnings.push(`${lbl}: excluded registration status ${status || statusCode}.`);
        continue;
      }
      const raws = [...meetingRecords(course)];
      if (!raws.length) result.warnings.push(`${lbl}: no meeting data found.`);
      raws.forEach((raw, i) => {
        try {
          const begin = parseTime(pick(raw, ["start_time", "beginTime"]));
          const finish = parseTime(pick(raw, ["end_time", "endTime"]));
          if (finish === begin) throw new Error("start and end times are identical");
          const days = parseDays(raw);
          if (!days.length) throw new Error("no scheduled weekdays (TBA / asynchronous)");
          const rawStart = pick(raw, ["start_date", "startDate"], pick(course, ["startDate", "start_date"]));
          const rawEnd = pick(raw, ["end_date", "endDate"], pick(course, ["endDate", "end_date"]));
          const first = rawStart ? parseDate(rawStart) : start;
          const last = rawEnd ? parseDate(rawEnd) : end;
          if (first === null || last === null) throw new Error("missing meeting dates; enter the first and last class dates");
          if (last < first || last - first > 400) throw new Error("invalid meeting date range (maximum 400 days)");
          const interval = parseInt(pick(raw, ["interval_weeks"], 1), 10);
          if (!(interval >= 1 && interval <= 52)) throw new Error("interval_weeks must be between 1 and 52");
          const buildingCode = text(pick(raw, ["building_code", "buildingCode", "building"]));
          const buildingName = text(pick(raw, ["building_name", "buildingDescription"]));
          const room = text(pick(raw, ["room", "roomNumber"]));
          const campus = text(pick(raw, ["campusDescription", "campus"]));
          let location = text(raw.location);
          if (!location) location = [[buildingName || buildingCode, room].filter(Boolean).join(" "), campus].filter(Boolean).join(", ");
          const m = {
            term: courseTerm, crn, code, title,
            kind: text(pick(raw, ["kind", "scheduleTypeDescription", "scheduleType"], pick(course, ["scheduleTypeDescription", "scheduleType", "scheduleDescription"], raw.meetingTypeDescription))),
            startDate: first, endDate: last, startTime: begin, endTime: finish, days, location,
            instructor: instructors(pick(raw, ["instructor", "faculty"], course.faculty)),
            intervalWeeks: interval, buildingCode, buildingName, room, campus,
          };
          const key = JSON.stringify(m);
          if (!seen.has(key)) { seen.add(key); result.meetings.push(m); }
        } catch (e) {
          result.warnings.push(`${lbl}, meeting ${i + 1}: ${e.message}.`);
        }
      });
    }
    return result;
  }

  /** Comma/newline-separated ISO dates or inclusive YYYY-MM-DD..YYYY-MM-DD; # comments. */
  function exclusions(spec) {
    const out = new Set();
    const clean = String(spec || "").split(/\r?\n/).map(l => l.split("#")[0]).join("\n");
    for (const token of clean.trim().split(/[,\s]+/)) {
      if (!token) continue;
      const b = token.split("..");
      if (b.length > 2) throw new Error(`Invalid excluded range: ${token}`);
      const first = parseDate(b[0]), last = parseDate(b[b.length - 1]);
      if (last < first || last - first > 400) throw new Error(`Invalid excluded range: ${token}`);
      for (let n = first; n <= last; n++) out.add(n);
    }
    return out;
  }
  /** Set of day numbers → compact text with ranges. */
  function exclusionText(set) {
    const days = [...set].sort((a, b) => a - b), parts = [];
    for (let i = 0; i < days.length; i++) {
      let j = i;
      while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
      parts.push(j > i ? `${isoDay(days[i])}..${isoDay(days[j])}` : isoDay(days[i]));
      i = j;
    }
    return parts.join(", ");
  }

  // ── time zones ───────────────────────────────────────────────────────────
  const fmtCache = {};
  function zoneParts(ms, tz = TZ) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
    return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  }
  function zoneOffset(ms, tz = TZ) { const p = zoneParts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
  /** Local wall time in tz → UTC milliseconds. Gap times use the pre-transition offset (as Python's fold=0). */
  function zonedToUtc(day, mins, tz = TZ) {
    const guess = day * DAY_MS + mins * 60000;
    const before = zoneOffset(guess - 3 * 3600000, tz);
    const after = zoneOffset(guess + 3 * 3600000, tz);
    const a = guess - before, b = guess - after;
    if (zoneOffset(a, tz) === before) return a;   // valid with the earlier offset (or ambiguous: first)
    if (zoneOffset(b, tz) === after) return b;
    return a;
  }
  function localOf(ms, tz = TZ) { const p = zoneParts(ms, tz); return { day: dayNum(p.y, p.m, p.d), mins: p.h * 60 + p.mi }; }

  function* occurrences(m, skip = new Set()) {
    const anchor = m.startDate - weekday(m.startDate);
    for (let day = m.startDate; day <= m.endDate; day++) {
      const week = Math.floor((day - anchor) / 7);
      if (m.days.includes(weekday(day)) && week % m.intervalWeeks === 0 && !skip.has(day)) {
        const endDay = day + (m.endTime < m.startTime ? 1 : 0);
        // Each occurrence is converted separately, retaining local class times over DST.
        yield [zonedToUtc(day, m.startTime), zonedToUtc(endDay, m.endTime), day];
      }
    }
  }

  // ── term weeks (for exported images) ─────────────────────────────────────
  /** The term's weeks (Monday day numbers, first class to last, as the preview numbers them
   * W1, W2…) and, for each meeting, the dates it meets in each week. A meeting is weekly
   * when it meets in every week in which one of its weekdays falls inside the term (so a
   * Tuesday class isn't irregular because the term ends on a Monday). Skipped dates don't
   * change that; they're listed apart so an image can show both. */
  function termWeeks(meetings, skip = new Set()) {
    let lo = Infinity, hi = -Infinity;
    for (const m of meetings) { lo = Math.min(lo, m.startDate); hi = Math.max(hi, m.endDate); }
    if (lo === Infinity) return { weeks: [], patterns: [] };
    const first = lo - weekday(lo), weeks = [];
    for (let w = first; w <= hi && weeks.length < 60; w += 7) weeks.push(w);
    const patterns = meetings.map(m => {
      const days = weeks.map(() => []), skipped = weeks.map(() => []);
      for (const [, , day] of occurrences(m)) {
        const i = Math.floor((day - first) / 7);
        if (i < weeks.length) (skip.has(day) ? skipped : days)[i].push(day);
      }
      const met = weeks.map((_, i) => i).filter(i => days[i].length || skipped[i].length);
      const possible = weeks.filter(w => m.days.some(d => w + d >= lo && w + d <= hi)).length;
      return { days, skipped, weeks: met, weekly: met.length === possible };
    });
    return { weeks, patterns };
  }

  /** Meetings grouped into classes (same course, section, type, days and times; the room may
   * change from week to week), each with the dates it meets in each week. Banner lists a
   * bi-weekly lab as one meeting per date, so a class is often several meetings. A week in
   * the middle of the term in which nothing meets at all is a break: it doesn't make a class
   * irregular. A class that meets every other week (a break may stretch one gap to three) is
   * bi-weekly; bi-weekly classes are sorted into two sets, the classes in a set meeting in the
   * same weeks, set 1 being the one that starts first.
   * → { weeks, classes: [{ members, rooms, days, skipped, weeks, weekly, biweekly, set }],
   *     of, sets, empty } where `of[k]` is the class of meetings[k] and `empty` the break weeks. */
  function classPatterns(meetings, skip = new Set()) {
    const tw = termWeeks(meetings, skip);
    const classes = [], byKey = new Map(), of = [];
    meetings.forEach((m, k) => {
      const key = [m.code, m.kind, m.crn, m.days.join(","), m.startTime, m.endTime].join("|");
      let c = byKey.get(key);
      if (!c) { c = { members: [], rooms: [], lo: Infinity, hi: -Infinity }; byKey.set(key, c); classes.push(c); }
      c.members.push(k); c.lo = Math.min(c.lo, m.startDate); c.hi = Math.max(c.hi, m.endDate);
      const room = roomLabel(m.buildingCode, m.room) || text(m.location);
      if (room && !c.rooms.includes(room)) c.rooms.push(room);
      of[k] = c;
    });
    for (const c of classes) {
      const merge = key => tw.weeks.map((_, i) => c.members.flatMap(k => tw.patterns[k][key][i]).sort((a, b) => a - b));
      c.days = merge("days"); c.skipped = merge("skipped");
      c.weeks = tw.weeks.map((_, i) => i).filter(i => c.days[i].length || c.skipped[i].length);
    }
    // A week in which nothing meets, though some class meets both before and after it, is a
    // break (Banner already left it out). A gap between two parts of term isn't.
    const busy = tw.weeks.map((_, i) => classes.some(c => c.weeks.includes(i)));
    const empty = tw.weeks.map((_, i) => i).filter(i => !busy[i] && classes.some(c => c.weeks.some(w => w < i) && c.weeks.some(w => w > i)));
    for (const c of classes) {
      const m = meetings[c.members[0]];
      const possible = tw.weeks.filter((w, i) => !empty.includes(i) && m.days.some(d => w + d >= c.lo && w + d <= c.hi)).length;
      c.weekly = c.weeks.length >= possible;
      c.biweekly = !c.weekly && c.weeks.length >= 2 && c.weeks.every((w, j) => !j || (w - c.weeks[j - 1] >= 2 && w - c.weeks[j - 1] <= 3));
      c.set = 0;
    }
    const sets = [];
    for (const c of classes.filter(x => x.biweekly).sort((a, b) => a.weeks[0] - b.weeks[0])) {
      // in step with a set when at least half the weeks either meets in are shared
      let s = sets.findIndex(set => 2 * c.weeks.filter(w => set.has(w)).length >= Math.min(set.size, c.weeks.length));
      if (s < 0 && sets.length < 2) { sets.push(new Set(c.weeks)); s = sets.length - 1; }
      c.set = s + 1;
    }
    return { weeks: tw.weeks, classes, of, sets: sets.length, empty };
  }

  /** The reading week, when the schedule gives it away: the one week mid-term in which nothing
   * meets, or, with two bi-weekly sets, the one week between their first and last meetings in
   * which neither meets (Banner often still lists lectures that week). → week index or -1. */
  function readingWeek(cp) {
    if (cp.empty.length === 1) return cp.empty[0];
    if (cp.empty.length > 1 || cp.sets < 2) return -1;
    const bi = cp.classes.filter(c => c.set);
    const met = new Set(bi.flatMap(c => c.weeks));
    const lo = Math.min(...met), hi = Math.max(...met);
    const gaps = [];
    for (let i = lo + 1; i < hi; i++) if (!met.has(i)) gaps.push(i);
    return gaps.length === 1 ? gaps[0] : -1;
  }

  /** Week indexes (0-based) → "W1, W3, W5, W8": every week named, as a bi-weekly class lists them. */
  const weekNames = idx => [...idx].sort((a, b) => a - b).map(i => `W${i + 1}`).join(", ");

  /** Week indexes (0-based) → "W2–W14", "alternate weeks, W2–W12", "every 3 weeks, W1–W13"
   * or "W1–W3, W5, W8" (W numbers as the preview's week chips show them). */
  function weekList(idx) {
    const w = [...idx].sort((a, b) => a - b).map(i => i + 1);
    if (!w.length) return "";
    if (w.length === 1) return `W${w[0]} only`;
    const step = w[1] - w[0];
    if (w.every((x, i) => !i || x - w[i - 1] === step)) {
      const span = `W${w[0]}–W${w[w.length - 1]}`;
      return step === 1 ? span : `${step === 2 ? "alternate weeks" : `every ${step} weeks`}, ${span}`;
    }
    const runs = [];
    for (let i = 0; i < w.length; i++) {
      let j = i;
      while (j + 1 < w.length && w[j + 1] === w[j] + 1) j++;
      runs.push(j > i ? `W${w[i]}–W${w[j]}` : `W${w[i]}`);
      i = j;
    }
    return runs.join(", ");
  }

  // ── templates ────────────────────────────────────────────────────────────
  const DEFAULT_STYLE = { title: "{DefaultTitle}", description: "{DefaultDescription}", location: "{Location}" };
  const PRESETS = {
    "Minimal": { title: "{CourseCode} · {Type}", description: "{RoomCodeandNumber}", location: "" },
    "Room in location": { title: "{CourseCode} · {TypeShort}", description: "{CourseName}", location: "{RoomCodeandNumber}" },
    "Full details": { ...DEFAULT_STYLE },
  };
  const PLACEHOLDERS = ["CourseCode", "CourseName", "Type", "TypeShort", "RoomCodeandNumber", "RoomNumber",
    "BuildingCode", "BuildingName", "Campus", "Instructor", "CRN", "Term", "Days",
    "StartTime", "EndTime", "StartDate", "EndDate", "Location", "DefaultTitle", "DefaultDescription"];

  function roomLabel(buildingCode, room) {
    const code = text(buildingCode); room = text(room);
    if (!room) return "";
    // Banner may already supply a prefixed room such as UA1234 or UA 1234.
    const prefix = code ? room.slice(0, code.length).toLowerCase() : "";
    const tail = code ? room.slice(code.length) : room;
    if (!code || (prefix === code.toLowerCase() && (!tail || /[0-9 \-]/.test(tail[0])))) return room;
    return `${code} ${room}`;
  }

  function valuesFor(m) {
    const short = { lecture: "LEC", laboratory: "LAB", lab: "LAB", tutorial: "TUT", seminar: "SEM" };
    const description = [];
    if (m.crn) description.push(`CRN: ${m.crn}`);
    description.push(`Term: ${m.term}`);
    if (m.instructor) description.push(`Instructor: ${m.instructor}`);
    description.push("Exported from MyOntarioTech. Check the university schedule for changes.");
    return {
      CourseCode: m.code, CourseName: m.title, Type: m.kind, TypeShort: short[m.kind.toLowerCase()] || m.kind,
      RoomCodeandNumber: roomLabel(m.buildingCode, m.room), RoomNumber: m.room, BuildingCode: m.buildingCode,
      BuildingName: m.buildingName, Campus: m.campus, Instructor: m.instructor, CRN: m.crn, Term: m.term,
      Days: m.days.map(d => DAY_LABELS[d]).join("/"), StartTime: hhmm(m.startTime), EndTime: hhmm(m.endTime),
      StartDate: isoDay(m.startDate), EndDate: isoDay(m.endDate), Location: m.location,
      DefaultTitle: label(m), DefaultDescription: description.join("\n"),
    };
  }

  /** Python str.format-style parsing: literal text, {Field}, {{ and }}. */
  function templateParts(template) {
    if (typeof template !== "string" || template.length > 20000) throw new Error("Templates must be text, with at most 20,000 characters.");
    const canon = {};
    for (const k of PLACEHOLDERS) canon[k.toLowerCase()] = k;
    const parts = [];
    let lit = "", i = 0;
    const unmatched = () => new Error("Unmatched braces in a template. Use {CourseCode}, or {{ and }} for literal braces.");
    while (i < template.length) {
      const c = template[i];
      if (c === "{" && template[i + 1] === "{") { lit += "{"; i += 2; continue; }
      if (c === "}" && template[i + 1] === "}") { lit += "}"; i += 2; continue; }
      if (c === "}") throw unmatched();
      if (c === "{") {
        const close = template.indexOf("}", i + 1);
        if (close < 0) throw unmatched();
        const field = template.slice(i + 1, close);
        if (field.includes("{")) throw unmatched();
        if (!canon[field.toLowerCase()]) throw new Error(`Unknown or unsupported placeholder {${field}}. Choose a field from the placeholder list.`);
        parts.push([lit, canon[field.toLowerCase()]]);
        lit = ""; i = close + 1; continue;
      }
      lit += c; i++;
    }
    if (lit) parts.push([lit, null]);
    return parts;
  }

  function renderTemplate(template, values) {
    let out = "";
    const missing = new Set();
    for (const [lit, field] of templateParts(template)) {
      out += lit;
      if (field) { const v = values[field]; out += v; if (!v) missing.add(field); }
    }
    return { text: out.trim(), missing };
  }

  function renderEvent(m, style = DEFAULT_STYLE) {
    const values = valuesFor(m);
    const t = renderTemplate(style.title, values), d = renderTemplate(style.description, values), l = renderTemplate(style.location, values);
    if (!t.text) throw new Error(`The title is empty for ${m.code || m.crn}. Add a title or a populated placeholder.`);
    return { title: t.text, description: d.text, location: l.text, missing: [...new Set([...t.missing, ...d.missing, ...l.missing])].sort() };
  }

  // ── SHA-256 (sync, for stable UIDs) ──────────────────────────────────────
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256hex(str) {
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length, total = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map(x => x.toString(16).padStart(8, "0")).join("");
  }
  /** Python json.dumps(str) with ensure_ascii, so UIDs equal the Python exporter's. */
  function pyJsonStr(s) {
    let out = '"';
    for (const ch of String(s)) {
      for (let i = 0; i < ch.length; i++) {
        const c = ch.charCodeAt(i), x = ch[i];
        if (x === '"') out += '\\"'; else if (x === "\\") out += "\\\\";
        else if (x === "\n") out += "\\n"; else if (x === "\r") out += "\\r"; else if (x === "\t") out += "\\t";
        else if (x === "\b") out += "\\b"; else if (x === "\f") out += "\\f";
        else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
        else out += x;
      }
    }
    return out + '"';
  }
  function isoUtc(ms) { const t = new Date(ms); return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+00:00`; }
  function icsUtc(ms) { return isoUtc(ms).replace(/[-:]/g, "").replace("+0000", "Z"); }
  const uidFor = key => sha256hex("[" + key.map(pyJsonStr).join(", ") + "]") + "@ontario-tech-course-exporter.local";

  // ── .ics writing ─────────────────────────────────────────────────────────
  function escapeText(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n"); }
  /** Fold content lines at 75 octets without splitting UTF-8 sequences. */
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = "", size = 0, limit = 75;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
      cur += ch; size += n;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  /** → {ics, count, events:[{uid, meetingIndex, day}]}. */
  function makeCalendar(meetings, { skip = new Set(), reminder = null, style = DEFAULT_STYLE, name = "Ontario Tech Courses", now = Date.now() } = {}) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ontario Tech Course Exporter//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${TZ}`];
    const stamp = icsUtc(Math.floor(now / 1000) * 1000);
    const seen = new Set(), events = [];
    meetings.forEach((m, index) => {
      const r = renderEvent(m, style);
      for (const [begin, finish, day] of occurrences(m, skip)) {
        const key = [m.term, m.crn, m.kind, isoUtc(begin), isoUtc(finish)];
        const k = JSON.stringify(key);
        if (seen.has(k)) continue;
        seen.add(k);
        const uid = uidFor(key);
        lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART:${icsUtc(begin)}`, `DTEND:${icsUtc(finish)}`, `SUMMARY:${escapeText(r.title)}`);
        if (r.location) lines.push(`LOCATION:${escapeText(r.location)}`);
        if (r.description) lines.push(`DESCRIPTION:${escapeText(r.description)}`);
        lines.push("TRANSP:OPAQUE");
        if (reminder !== null && reminder !== undefined) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(r.title)}`, reminder > 0 ? `TRIGGER:-PT${reminder}M` : "TRIGGER:PT0S", "END:VALARM");
        lines.push("END:VEVENT");
        events.push({ uid, meetingIndex: index, day });
      }
    });
    if (!events.length) throw new Error("No class occurrences to export. No calendar file was made.");
    lines.push("END:VCALENDAR");
    return { ics: lines.map(fold).join("\r\n") + "\r\n", count: events.length, events };
  }

  // ── .ics reading (for the preview, so it shows exactly what the file says) ─
  function unescapeText(s) { return s.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c)); }
  function parseIcsTime(v) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
    if (!m) return null;
    if (!m[4]) return { allDay: true, ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return { allDay: false, ms: m[7] ? local : zonedToUtc(dayNum(+m[1], +m[2], +m[3]), +m[4] * 60 + +m[5]) };
  }
  function parseIcs(ics) {
    const lines = String(ics).replace(/\r\n[ \t]|\n[ \t]/g, "").split(/\r?\n/);
    const events = [], cal = {};
    let ev = null, depth = 0;
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const head = line.slice(0, i), value = line.slice(i + 1), name = head.split(";")[0].toUpperCase();
      if (name === "BEGIN") { if (value === "VEVENT") ev = { alarms: [] }; else if (ev) depth++; continue; }
      if (name === "END") { if (value === "VEVENT" && ev) { events.push(ev); ev = null; } else if (ev && depth) depth--; continue; }
      if (!ev) { if (name.startsWith("X-WR-")) cal[name] = unescapeText(value); continue; }
      if (depth) { if (name === "TRIGGER") ev.alarms.push(value); continue; }
      if (name === "DTSTART" || name === "DTEND") { const t = parseIcsTime(value); if (t) ev[name === "DTSTART" ? "start" : "end"] = t.ms; }
      else if (["SUMMARY", "LOCATION", "DESCRIPTION", "UID"].includes(name)) ev[name.toLowerCase()] = unescapeText(value);
    }
    return { events: events.filter(e => e.start !== undefined).sort((a, b) => a.start - b.start), calendar: cal };
  }

  // ── editable schedule (save / reopen) ────────────────────────────────────
  function editableSchedule(meetings) {
    const courses = new Map();
    for (const m of meetings) {
      const key = `${m.term}|${m.crn}|${m.crn ? "" : m.code}`;
      if (!courses.has(key)) courses.set(key, { term: m.term, crn: m.crn, code: m.code, title: m.title, meetings: [] });
      courses.get(key).meetings.push({
        kind: m.kind, start_date: isoDay(m.startDate), end_date: isoDay(m.endDate), start_time: hhmm(m.startTime), end_time: hhmm(m.endTime),
        days: m.days.map(d => DAY_LABELS[d]), location: m.location, instructor: m.instructor, interval_weeks: m.intervalWeeks,
        building_code: m.buildingCode, building_name: m.buildingName, room: m.room, campus: m.campus,
      });
    }
    return { format: "ontario-tech-calendar-v1", timezone: TZ, courses: [...courses.values()] };
  }

  return {
    TZ, WEEKDAYS, DAY_LABELS, DAY_MS, text, validCrn, pick, parseDate, parseTime, parseDays, hhmm,
    dayNum, ymd, isoDay, weekday, courseRecords, meetingRecords, instructors, label, normalize,
    exclusions, exclusionText, zoneParts, zoneOffset, zonedToUtc, localOf, occurrences, termWeeks, classPatterns, readingWeek, weekList, weekNames,
    DEFAULT_STYLE, PRESETS, PLACEHOLDERS, roomLabel, valuesFor, templateParts, renderTemplate, renderEvent,
    sha256hex, pyJsonStr, uidFor, isoUtc, icsUtc, escapeText, fold, makeCalendar, parseIcs, editableSchedule,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OC;
