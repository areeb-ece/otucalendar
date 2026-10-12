/* OTU/CALENDAR importer: turns what a student can get out of MyOntarioTech into
 * editable course records (ontario-tech-calendar-v1), entirely inside the page.
 *
 *  - a saved "My course schedule" page (.html, or .mhtml single file)
 *  - text copied from that page (select all → copy → paste)
 *  - JSON: from the helper snippet, Banner's own responses, or a saved schedule
 *
 * Uploaded HTML is parsed with DOMParser into an inert document: its scripts never
 * run, nothing it references is fetched, and none of it is inserted into this page.
 * Only course fields are kept; names, student numbers and tokens are never read out. */
const OI = (() => {
  "use strict";
  const C = (typeof module !== "undefined" && module.exports) ? require("./core.js") : OC;

  const MAX_BYTES = 25 * 1024 * 1024;

  // ── patterns ─────────────────────────────────────────────────────────────
  const TIME = String.raw`(?:\d{1,2}:\d{2}\s*[AaPp]\.?\s*[Mm]\.?|(?:[01]?\d|2[0-3]):[0-5]\d(?!\s*[AaPp]\.?[Mm]))`;
  const TIME_RANGE = new RegExp(`(${TIME})\\s*(?:-|–|—|to)\\s*(${TIME})`, "g");
  const DATE = String.raw`(?:\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})`;
  const DATE_RANGE = new RegExp(`(${DATE})\\s*(?:--|-|–|—|to|through)\\s*(${DATE})`, "g");
  const LABELED_RANGE = new RegExp(`Start Date:?\\s*(${DATE})[\\s\\S]{0,40}?End Date:?\\s*(${DATE})`, "i");
  // Ontario Tech course codes always end in U (undergraduate) or G (graduate): ELEE 2110U.
  const CODE = /\b([A-Z]{3,4})[  ]?(\d{4}[UG])\b/g;
  const DAY_WORD = String.raw`(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun)\b`;
  const DAY_RUN = new RegExp(`\\b${DAY_WORD}(?:\\s*(?:,|/|&|and)?\\s*${DAY_WORD})*`, "g");
  const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const KINDS = ["Lecture", "Laboratory", "Tutorial", "Seminar", "Studio", "Practicum", "Workshop", "Thesis", "Project", "Field Experience", "Lab", "Online"];
  const KIND_RE = new RegExp(`\\b(${KINDS.join("|")})\\b`, "i");

  function dayIndex(word) {
    const w = word.toLowerCase();
    return DAY_NAMES.findIndex(n => n.startsWith(w.slice(0, 2)) && (w.length <= 4 ? n.startsWith(w.replace(/s$/, "")) || n.startsWith(w) : n === w));
  }
  function daysFrom(run) {
    const out = new Set();
    for (const m of run.matchAll(new RegExp(DAY_WORD, "g"))) { const i = dayIndex(m[0]); if (i >= 0) out.add(i); }
    return [...out].sort((a, b) => a - b);
  }
  const clean = s => String(s || "").replace(/[   ]/g, " ").replace(/[ \t]+/g, " ").trim();
  const lastMatch = (re, s) => { let last = null; for (const m of s.matchAll(re)) last = m; return last; };
  function normTime(t) { return t.replace(/\s+/g, " ").replace(/([AaPp])\.?\s*([Mm])\.?/, (_, a) => ` ${a.toUpperCase()}M`).replace(/\s+/g, " ").trim(); }
  const DAY_LABELS = C.DAY_LABELS;

  function termFromName(season, year) {
    const s = season.toLowerCase();
    if (s.startsWith("fall")) return `${year}09`;
    if (s.startsWith("winter")) return `${year}01`;
    if (s.startsWith("spring") || s.startsWith("summer")) return `${year}05`;
    return "";
  }
  function termFromDate(isoOrUs) {
    try { const p = C.ymd(C.parseDate(isoOrUs)); return `${p.y}${p.m >= 9 ? "09" : p.m >= 5 ? "05" : "01"}`; } catch (e) { return ""; }
  }
  function findTerm(text) {
    let m = text.match(/\b(?:Term(?: Code)?|termCode|term)\s*[:=]\s*"?(\d{4}(?:01|05|09))\b/i);
    if (m) return { term: m[1], source: "page" };
    m = text.match(/\b(Fall|Winter|Spring\/Summer|Spring|Summer)\s*(?:Term\s*)?(20\d{2})\b/);
    if (m) return { term: termFromName(m[1], m[2]), source: "page" };
    return { term: "", source: "" };
  }

  // ── meeting details around one time range ────────────────────────────────
  function fieldAfter(seg, label) {
    const m = seg.match(new RegExp(`\\b${label}\\s*:\\s*([^\\n|]*?)(?=\\s+(?:Type|Location|Campus|Building|Room|Start Date|End Date|Instructor|Schedule Type|Days)\\s*:|\\s*\\||\\n|$)`, "i"));
    return m ? clean(m[1]) : "";
  }

  function parseMeeting(before, range, after) {
    const mt = { start_time: normTime(range[1]), end_time: normTime(range[2]) };
    // An unlabeled "09/08/2026 -- 12/07/2026" leads into its own meeting (list view);
    // "Start Date: … End Date: …" trails its meeting (class-search view).
    const nextLead = after.search(DATE_RANGE);
    const tail = nextLead >= 0 ? after.slice(0, nextLead) : after;
    const labeled = tail.match(LABELED_RANGE);
    const lead = lastMatch(DATE_RANGE, before);
    if (labeled) { mt.start_date = labeled[1]; mt.end_date = labeled[2]; }
    else if (lead) { mt.start_date = lead[1]; mt.end_date = lead[2]; }
    else { const any = tail.match(new RegExp(DATE_RANGE.source)); if (any) { mt.start_date = any[1]; mt.end_date = any[2]; } }

    const beforeDays = lead ? before.slice(lead.index + lead[0].length) : before.slice(-160);
    let days = null;
    const labeledDays = lastMatch(/\bDays?\s*:\s*([A-Za-z ,/&]+?)(?=\s*(?:\||\n|$|\d|Type|Time|from))/gi, beforeDays);
    if (labeledDays) {
      const v = labeledDays[1].trim();
      if (/^none$/i.test(v)) days = [];
      else if (/^[MTWRFSU]{1,7}$/.test(v)) days = C.parseDays({ days: v });
      else days = daysFrom(v);
    }
    if (days === null) {
      const run = lastMatch(DAY_RUN, beforeDays);
      if (run) { const d = daysFrom(run[0]); if (d.length && d.length < 7) days = d; }
    }
    if (days === null) {
      const letters = beforeDays.match(/(?:^|\s)([MTWRF]{1,5})\s*$/);
      if (letters) days = C.parseDays({ days: letters[1] });
    }
    if (days === null && /\bClass on\b/i.test(beforeDays)) days = [];
    if (days !== null) mt.days = days.map(d => DAY_LABELS[d]);

    const type = fieldAfter(tail, "Type");
    if (type) mt.kind = type;
    const building = fieldAfter(tail, "Building");
    const room = fieldAfter(tail, "Room");
    const campus = fieldAfter(tail, "Campus") || fieldAfter(tail, "Location");
    if (building) {
      // "Science Building (UA)" or a short code such as "UA" / "SIRC".
      const b = building.match(/^(.*?)\s*\(([A-Z0-9]{1,6})\)$/);
      if (b) { mt.building_name = b[1]; mt.building_code = b[2]; }
      else if (/^[A-Z0-9]{1,6}$/.test(building)) mt.building_code = building;
      else mt.building_name = building;
    }
    if (room && !/^(none|tba|tbd)$/i.test(room)) {
      mt.room = room;
      // A prefixed room such as UA1350 or SIRC 2060 also tells us the building code.
      const rc = room.match(/^([A-Z]{1,5})\s?\d/);
      if (rc && !mt.building_code) mt.building_code = rc[1];
    }
    if (campus) mt.campus = campus;
    const instr = fieldAfter(tail, "Instructor");
    if (instr) mt.instructor = instr.replace(/\s*\(Primary\)\s*/i, "").trim();
    return mt;
  }

  // ── course context around one course code ────────────────────────────────
  function courseInfo(text, anchor, nextAnchor) {
    const section = text.slice(anchor.index, nextAnchor);
    const lineStart = text.lastIndexOf("\n", anchor.index) + 1;
    const lineEndRaw = text.indexOf("\n", anchor.index);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    const line = text.slice(lineStart, lineEnd);
    const info = { code: `${anchor[1]} ${anchor[2]}` };

    const crn = section.match(/\bCRN\s*[:#]?\s*(\d{5})\b/i) || text.slice(lineStart, anchor.index).match(/\bCRN\s*[:#]?\s*(\d{5})\b/i)
      || section.slice(0, 260).match(/(?:^|[\s|,])(\d{5})(?=$|[\s|,])/);
    if (crn) info.crn = crn[1];

    // Title: "Electric Circuits I | Electrical Engineering ELEE 2110U Section 001", "ELEE 2110U - Electric Circuits I",
    // or a table row "Electric Circuits I | ELEE 2110U, 001 | ...".
    const cells = line.split("|").map(clean);
    const at = cells.findIndex(c => c.includes(anchor[1]) && c.includes(anchor[2]));
    const titleish = c => c && /[A-Za-z]{3}/.test(c) && !/\d{1,2}:\d{2}|\d\/\d|:\s*$/.test(c) && c.length < 120 && !c.match(new RegExp(CODE.source));
    if (at > 0 && titleish(cells[at - 1])) info.title = cells[at - 1];
    if (!info.title) {
      const rest = clean(line.slice(anchor.index - lineStart + anchor[0].length).split("|")[0])
        .replace(/^[,\s-–—:]*(?:Section\s*)?\d{3}\b/i, "").replace(/^[\s,\-–—:]+/, "");
      if (titleish(rest) && !/^(Section|CRN|Class|Lecture|Laboratory|Tutorial)\b/i.test(rest)) info.title = rest;
    }
    if (!info.title) {
      const prev = text.slice(0, lineStart).replace(/\n+$/, "");
      const prevLine = clean(prev.slice(prev.lastIndexOf("\n") + 1));
      if (titleish(prevLine) && !/[|]/.test(prevLine) && prevLine.split(" ").length <= 12) info.title = prevLine;
    }
    // Prefixes Banner adds before the code ("Electrical Engineering ELEE 2110U") are not part of the title.
    if (info.title) info.title = info.title.replace(/\s+Section\s+\d+$/i, "");

    const st = section.match(/\bSchedule Type\s*:?\s*\|?\s*([A-Za-z ]{3,30}?)(?=\s*(?:\||\n|$|[A-Z][a-z]+\s*:))/);
    const kw = section.slice(0, 400).match(KIND_RE);
    if (st) info.kind = clean(st[1]);
    else if (kw) info.kind = kw[1][0].toUpperCase() + kw[1].slice(1).toLowerCase();

    const begin = section.match(new RegExp(`Class Begin:?\\s*(${DATE})`, "i")), end = section.match(new RegExp(`Class End:?\\s*(${DATE})`, "i"));
    if (begin) info.startDate = begin[1];
    if (end) info.endDate = end[1];

    // Only a labelled status or a table cell counts; course titles may contain these words.
    const STATUS = "(?:\\*{0,2}(?:Web )?(?:Dropped|Drop|Withdrawn|Withdraw|Wait ?Listed|Waitlisted|Cancelled|Deleted|Registered)\\*{0,2})";
    const status = section.slice(0, 600).match(new RegExp(`Status\\s*:?\\s*\\|?\\s*(${STATUS})`, "i")) || line.match(new RegExp(`\\|\\s*(${STATUS})\\s*(?:\\||$)`, "i"));
    if (status && !/registered/i.test(status[1])) info.status = status[1].replace(/\*/g, "");
    const instr = section.match(/\bInstructors?\s*:\s*([A-Z][A-Za-z.'\- ]+(?:,\s*[A-Z][A-Za-z.'\- ]+)*?)(?=\s*(?:\(Primary\)|\||\n|$|[A-Z][a-z]+\s*:))/);
    if (instr) info.instructor = clean(instr[1]);
    return info;
  }

  /** Plain text (copied page, or text extracted from saved HTML) → courses. */
  function parseScheduleText(raw, { meta = null } = {}) {
    const text = String(raw || "").replace(/\r\n?/g, "\n").split("\n").map(clean).join("\n");
    const notes = [];
    const anchors = [...text.matchAll(CODE)];
    const ranges = [...text.matchAll(TIME_RANGE)];
    const infos = anchors.map((a, i) => courseInfo(text, a, i + 1 < anchors.length ? anchors[i + 1].index : text.length));
    // Fill gaps from earlier mentions of the same code (title links, repeated rows).
    infos.forEach((info, i) => {
      for (let j = i - 1; j >= 0; j--) {
        const o = infos[j];
        if (o.code !== info.code) continue;
        if (!info.crn && o.crn && (!info.kind || !o.kind || o.kind === info.kind)) info.crn = o.crn;
        if (!info.title && o.title) info.title = o.title;
        if (!info.kind && o.kind && o.crn === info.crn) info.kind = o.kind;
      }
      if (meta) {
        const byCrn = info.crn && meta.get(info.crn);
        const rows = byCrn ? [byCrn] : [...meta.values()].filter(r => r.code === info.code);
        const row = rows.length === 1 ? rows[0] : rows.find(r => r.kind && info.kind && r.kind.toLowerCase() === info.kind.toLowerCase());
        // The registration grid is authoritative for CRN, title, type and status.
        if (row) for (const k of ["crn", "title", "kind", "status", "instructor"]) if (row[k] && (!info[k] || k === "title" || k === "status")) info[k] = row[k];
      }
    });

    const meetings = [];
    let prevEnd = 0;
    ranges.forEach((r, i) => {
      // nearest course code before this time range
      let ai = -1;
      for (let j = 0; j < anchors.length && anchors[j].index < r.index; j++) ai = j;
      if (ai < 0) return;
      const nextRange = i + 1 < ranges.length ? ranges[i + 1].index : text.length;
      const nextAnchor = ai + 1 < anchors.length ? anchors[ai + 1].index : text.length;
      const from = Math.max(prevEnd, anchors[ai].index + anchors[ai][0].length);
      prevEnd = r.index + r[0].length;
      const before = text.slice(from, r.index);
      const after = text.slice(prevEnd, Math.min(nextRange, nextAnchor > prevEnd ? nextAnchor : nextRange));
      const mt = parseMeeting(before, r, after);
      meetings.push({ info: infos[ai], mt });
    });

    // The weekly grid (Schedule tab) repeats each class without dates; drop those copies.
    const dated = meetings.filter(x => x.mt.start_date);
    const same = (a, b) => a.info.code === b.info.code && a.mt.start_time === b.mt.start_time && a.mt.end_time === b.mt.end_time;
    // …but an undated summary ("Class on: Monday, Wednesday from …") may be the only place the days appear.
    for (const d of dated) if (!d.mt.days) { const u = meetings.find(x => !x.mt.start_date && x.mt.days && x.mt.days.length && same(x, d)); if (u) d.mt.days = u.mt.days; }
    const kept = meetings.filter(x => x.mt.start_date || !dated.some(d => same(x, d)));
    if (kept.length < meetings.length) notes.push(`Skipped ${meetings.length - kept.length} undated repeat${meetings.length - kept.length === 1 ? "" : "s"} of classes already listed with dates.`);

    const courses = new Map();
    for (const { info, mt } of kept) {
      let kind = mt.kind;
      if (!kind || /^(class|classroom|in person|in-person)$/i.test(kind)) kind = info.kind || kind || "";
      const key = info.crn ? `crn:${info.crn}` : `code:${info.code}|${kind}`;
      if (!courses.has(key)) {
        const c = { crn: info.crn || "", code: info.code, title: info.title || info.code, meetings: [] };
        if (info.status) c.status = info.status;
        if (info.startDate) c.startDate = info.startDate;
        if (info.endDate) c.endDate = info.endDate;
        courses.set(key, c);
      }
      const meeting = { ...mt, kind };
      if (!meeting.instructor && info.instructor) meeting.instructor = info.instructor;
      courses.get(key).meetings.push(meeting);
    }
    // Courses listed without any time range (online / TBA, or meeting details collapsed).
    const listed = new Set([...courses.values()].map(c => c.code));
    const unscheduled = [...new Set(infos.map(i => i.code))].filter(c => !listed.has(c));
    if (unscheduled.length) notes.push(`No meeting times found for ${unscheduled.join(", ")} (online, TBA, or their details were collapsed when the page was saved).`);

    const t = findTerm(text);
    return { courses: [...courses.values()], term: t.term, termSource: t.source, notes };
  }

  // ── HTML (browser only: needs a Document) ────────────────────────────────
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "IFRAME", "OBJECT", "CANVAS", "SELECT", "BUTTON", "INPUT", "TEXTAREA"]);
  const BLOCK = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "UL", "CAPTION"]);
  const PILL_ORDER = [6, 0, 1, 2, 3, 4, 5]; // S M T W T F S

  /** Banner shows meeting days as a row of 7 letters, with the meeting days highlighted. */
  function pillboxDays(el) {
    const items = [...el.children].filter(c => c.nodeType === 1);
    const flat = items.length === 7 ? items : [...el.querySelectorAll("li")];
    if (flat.length !== 7) return null;
    const days = [];
    flat.forEach((li, i) => {
      const cls = (li.getAttribute("class") || "").toLowerCase();
      const on = /selected|checked|active|\bon\b/.test(cls) || ["aria-checked", "aria-selected", "aria-pressed"].some(a => li.getAttribute(a) === "true");
      if (!on) return;
      const named = li.getAttribute("data-name") || li.getAttribute("title") || li.getAttribute("aria-label") || "";
      const idx = named ? dayIndex(named.trim().split(/\s+/)[0]) : -1;
      days.push(idx >= 0 ? idx : PILL_ORDER[i]);
    });
    return [...new Set(days)].sort((a, b) => a - b);
  }

  function htmlToText(doc) {
    const out = [];
    const walk = node => {
      if (node.nodeType === 3) { out.push(node.nodeValue); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();
      if (SKIP.has(tag) || node.getAttribute("aria-hidden") === "true" && !/pillbox/i.test(node.getAttribute("class") || "")) return;
      if (/pillbox/i.test(node.getAttribute("class") || "")) {
        const d = pillboxDays(node);
        if (d) { out.push(` Days: ${d.length ? d.map(i => DAY_LABELS[i]).join(",") : "none"} `); return; }
      }
      const block = BLOCK.has(tag);
      if (block) out.push("\n");
      if (tag === "TD" || tag === "TH") out.push(" | ");
      const before = out.length;
      for (const c of node.childNodes) walk(c);
      // Some meeting summaries keep the readable sentence in an accessibility label only.
      const aria = node.getAttribute("aria-label") || "";
      if (aria && new RegExp(TIME_RANGE.source).test(aria) && !new RegExp(TIME_RANGE.source).test(out.slice(before).join(""))) out.push(` ${aria} `);
      if (block) out.push("\n");
    };
    walk(doc.body || doc.documentElement);
    return out.join("").split("\n").map(clean).filter(l => l && l !== "|").map(l => l.replace(/^\|\s*/, "")).join("\n");
  }

  /** Rows of Banner's registration grid: <td data-property="courseReferenceNumber">… */
  function rowsFromDoc(doc) {
    const meta = new Map();
    for (const tr of doc.querySelectorAll("tr")) {
      const row = {};
      for (const cell of tr.cells || []) {
        if (cell.tagName !== "TD" || !cell.hasAttribute("data-property")) continue;
        row[cell.getAttribute("data-property")] = clean(cell.textContent);
      }
      const crn = row.courseReferenceNumber || row.crn;
      if (!/^\d{5}$/.test(crn || "")) continue;
      let code = "";
      const subj = (row.subject || "").match(/[A-Z]{3,4}/), num = (row.courseNumber || "").match(/\d{4}[A-Z]?/);
      if (subj && num) code = `${subj[0]} ${num[0]}`;
      else { const m = Object.values(row).join(" ").match(new RegExp(CODE.source)); if (m) code = `${m[1]} ${m[2]}`; }
      meta.set(crn, {
        crn, code, title: row.courseTitle || row.title || "",
        kind: row.scheduleDescription || row.scheduleTypeDescription || row.scheduleType || "",
        status: row.registrationStatusDescription || row.statusDescription || row.status || "",
        instructor: row.instructor || "",
      });
    }
    const terms = ["#lookupFilter", "#term", "[name=term]", "[name=termCode]", "#txt_term"]
      .flatMap(s => [...doc.querySelectorAll(s)]).map(e => e.value || e.getAttribute("value") || "").filter(v => /^\d{6}$/.test(v));
    return { meta, term: terms[0] || "" };
  }

  function importDocument(doc) {
    const { meta, term } = rowsFromDoc(doc);
    const text = htmlToText(doc);
    const r = parseScheduleText(text, { meta: meta.size ? meta : null });
    if (term) { r.term = term; r.termSource = "page"; }
    if (meta.size) r.notes.unshift(`Read ${meta.size} registration rows from the page's course table.`);
    return r;
  }

  // ── MHTML ("Webpage, Single File") ───────────────────────────────────────
  function decodeQP(s) {
    const body = s.replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(body.substr(i + 1, 2))) { bytes.push(parseInt(body.substr(i + 1, 2), 16)); i += 2; }
      else { const code = body.charCodeAt(i); if (code < 128) bytes.push(code); else for (const b of new TextEncoder().encode(c)) bytes.push(b); }
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
  function decodeBase64(s) {
    const bin = atob(s.replace(/\s+/g, ""));
    return new TextDecoder("utf-8").decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
  }
  function decodeMHTML(src) {
    const b = src.match(/boundary="?([^";\r\n]+)"?/i);
    if (!b) return null;
    for (const part of src.split("--" + b[1])) {
      const split = part.search(/\r?\n\r?\n/);
      if (split < 0) continue;
      const head = part.slice(0, split), body = part.slice(split).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
      if (!/content-type:\s*text\/html/i.test(head)) continue;
      const enc = (head.match(/content-transfer-encoding:\s*([\w-]+)/i) || [])[1] || "";
      if (/quoted-printable/i.test(enc)) return decodeQP(body);
      if (/base64/i.test(enc)) return decodeBase64(body);
      return body;
    }
    return null;
  }

  // ── entry point ──────────────────────────────────────────────────────────
  const looksMHTML = s => /^\s*(?:From:|Snapshot-Content-Location:|Subject:|Date:|MIME-Version:)/i.test(s.slice(0, 400)) && /multipart\/related/i.test(s.slice(0, 2000));
  const looksHTML = s => /<(?:!doctype html|html|body|table|div)\b/i.test(s.slice(0, 5000));

  /** source text → {payload, kind, term, termSource, notes}. parseHtml(html) → Document (DOMParser in the page). */
  function importSource(src, { parseHtml = null, fileName = "" } = {}) {
    src = String(src || "");
    if (src.length > MAX_BYTES) throw new Error("That file is larger than 25 MB; it is not a schedule page.");
    const trimmed = src.trim();
    if (!trimmed) throw new Error("Nothing to import: the text is empty.");
    if (/^[\[{]/.test(trimmed)) {
      let data;
      try { data = JSON.parse(trimmed); } catch (e) { throw new Error("This looks like JSON but could not be read: " + e.message); }
      const term = C.text(data && !Array.isArray(data) && (data.term || data.termCode)) || "";
      return { payload: data, kind: "json", term: /^\d{6}$/.test(term) ? term : "", termSource: term ? "file" : "", notes: [] };
    }
    let r, kind = "text";
    if (looksMHTML(src) || /\.mht(ml)?$/i.test(fileName)) {
      const html = decodeMHTML(src);
      if (!html) throw new Error("Could not find the page inside this .mhtml file.");
      if (!parseHtml) throw new Error("HTML import needs a browser.");
      r = importDocument(parseHtml(html)); kind = "mhtml";
    } else if (looksHTML(src)) {
      if (!parseHtml) throw new Error("HTML import needs a browser.");
      r = importDocument(parseHtml(src)); kind = "html";
    } else {
      r = parseScheduleText(src);
    }
    let { term, termSource } = r;
    if (!term) {
      const first = r.courses.flatMap(c => c.meetings).map(m => m.start_date).find(Boolean);
      if (first) { term = termFromDate(first); termSource = term ? "dates" : ""; }
    }
    for (const c of r.courses) c.term = term;
    return { payload: { format: "ontario-tech-calendar-v1", timezone: C.TZ, term, courses: r.courses }, kind, term, termSource, notes: r.notes };
  }

  return { importSource, parseScheduleText, parseMeeting, htmlToText, rowsFromDoc, importDocument, decodeMHTML, decodeQP, pillboxDays, termFromName, termFromDate, findTerm, MAX_BYTES };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OI;
