/* OTU/CALENDAR page: import → customize → preview week by week → download .ics.
 * Everything happens in this tab. The page's CSP forbids network connections, and
 * imported markup is only ever parsed into an inert document, never displayed. */
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const THEME_KEY = "otucalendar.theme";
const STYLE_KEY = "otucalendar.style";
const HOUR = 46; // px per hour; keep in sync with --hour
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = OC.DAY_LABELS;

/** Small DOM builder; styles are set through CSSOM so the CSP needs no 'unsafe-inline'. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "vars") for (const [n, x] of Object.entries(v)) el.style.setProperty(n, x);
    else if (k === "style") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;

// ── formatting ───────────────────────────────────────────────────────────
function fmt12(mins) {
  const h24 = Math.floor(mins / 60) % 24, m = mins % 60, h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}
const ampm = mins => (Math.floor(mins / 60) % 24 < 12 ? "am" : "pm");
function timeRange(a, b) { return ampm(a) === ampm(b) ? `${fmt12(a)}–${fmt12(b)} ${ampm(b)}` : `${fmt12(a)} ${ampm(a)}–${fmt12(b)} ${ampm(b)}`; }
function dayShort(n) { const p = OC.ymd(n); return `${MONTHS[p.m - 1]} ${p.d}`; }
function dayLong(n) { const p = OC.ymd(n); return `${DAYS[OC.weekday(n)]}, ${MONTHS[p.m - 1]} ${p.d} ${p.y}`; }
function weekRange(start) {
  const a = OC.ymd(start), b = OC.ymd(start + 6);
  if (a.y !== b.y) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  return a.m === b.m ? `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${a.y}` : `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
}
function termName(t) {
  const m = /^(\d{4})(\d{2})$/.exec(t || "");
  if (!m) return "";
  return { "01": "Winter", "05": "Spring/Summer", "09": "Fall" }[m[2]] ? `${{ "01": "Winter", "05": "Spring/Summer", "09": "Fall" }[m[2]]} ${m[1]}` : "";
}
const kb = n => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// ── state ────────────────────────────────────────────────────────────────
const S = {
  payload: null, info: null, term: "", fallback: { start: null, end: null },
  meetings: [], warnings: [], courseCount: 0, off: new Set(), colors: new Map(), shades: new Map(),
  style: loadStyle(), reminder: null, calName: "Ontario Tech Courses", skip: new Set(),
  ics: "", count: 0, buildErr: "", templateErr: "", parsed: null, uidMeeting: new Map(),
  weeks: [], week: 0, view: "weeks", pasteHtml: null, pasteText: "",
  // reading week: the Monday of the confirmed one, and whether the question was answered
  readingWeek: null, rwAnswered: false, rwPick: null,
};

function loadStyle() {
  try {
    const s = JSON.parse(localStorage.getItem(STYLE_KEY) || "null");
    if (s && ["title", "description", "location"].every(k => typeof s[k] === "string")) return s;
  } catch (e) {}
  return { ...OC.PRESETS.Minimal };
}
function saveStyle() { try { localStorage.setItem(STYLE_KEY, JSON.stringify(S.style)); } catch (e) {} }
const todayDay = () => OC.localOf(Date.now()).day;
const enabled = () => S.meetings.map((m, i) => [m, i]).filter(([, i]) => !S.off.has(i));
// Each course has its colour, and each of its sessions (lecture, lab, tutorial…) a shade of
// it: the first the colour itself, the next ones mixed toward the card or the ink, so they
// read darker and lighter in every theme without losing the hue. The image export mixes
// the same (shadeRgb).
const SHADES = [[100, ""], [62, "--card"], [66, "--ink"], [80, "--card"], [82, "--ink"]];
const sessionKey = m => `${m.code}|${m.kind}|${m.crn}`;
const shadeCss = (ci, si) => {
  const [p, to] = SHADES[si % SHADES.length];
  return to ? `color-mix(in srgb, var(--c${ci % 8}) ${p}%, var(${to}))` : `var(--c${ci % 8})`;
};
const shadeOf = m => S.shades.get(sessionKey(m)) || 0;
const colorOf = m => shadeCss(S.colors.get(m.code) || 0, shadeOf(m));

// ── import ───────────────────────────────────────────────────────────────
// Banner's pages are full of inline styles and stylesheet links. Nothing in a DOMParser document
// is applied, but the page's CSP still reports each one, so they're dropped before parsing.
const parseHtml = html => new DOMParser().parseFromString(String(html)
  .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
  .replace(/<link\b[^>]*>/gi, "")
  .replace(/(<[a-z][^>]*?)\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1"), "text/html");

function importFrom(src, { fileName = "", forceHtml = false, statusEl = null } = {}) {
  const status = (msg, err) => { if (statusEl) { statusEl.textContent = msg; statusEl.classList.toggle("err", !!err); } };
  let r;
  try {
    r = forceHtml ? (() => {
      const d = OI.importDocument(parseHtml(src));
      const first = d.courses.flatMap(c => c.meetings).map(m => m.start_date).find(Boolean);
      const term = d.term || (first ? OI.termFromDate(first) : "");
      for (const c of d.courses) c.term = term;
      return { payload: { format: "ontario-tech-calendar-v1", timezone: OC.TZ, term, courses: d.courses }, kind: "paste", term, termSource: d.term ? "page" : first ? "dates" : "", notes: d.notes };
    })() : OI.importSource(src, { parseHtml, fileName });
  } catch (e) { status(e.message, true); return false; }
  const norm = OC.normalize(r.payload, {});
  if (!norm.courseCount) {
    const saved = /registrationHistory|StudentRegistrationSsb/i.test(src.slice(0, 200000));
    status(saved
      ? "This page has no courses in it. Save it while your courses are on screen (Schedule Details), as \"Webpage, Complete\" or \"Single File\", not \"HTML only\". Or try the Paste tab."
      : "No Ontario Tech courses found. Use the Schedule Details page from My course schedule, or a .json from the helper.", true);
    return false;
  }
  status("");
  loadPayload(r.payload, r);
  return true;
}

function loadPayload(payload, info) {
  S.payload = payload; S.info = info; S.term = info.term || "";
  S.fallback = { start: null, end: null };
  S.skip = new Set(); $("#oSkip").value = ""; $("#oErr").textContent = "";
  S.readingWeek = null; S.rwAnswered = false; S.rwPick = null;
  $("#fbStart").value = ""; $("#fbEnd").value = "";
  normalizeNow();
  S.week = -1;
  rebuild();
  closeAll();
  showReport();
}

function normalizeNow() {
  const r = OC.normalize(S.payload, { start: S.fallback.start, end: S.fallback.end });
  const order = k => { const i = ["lecture", "laboratory", "lab", "tutorial", "seminar"].indexOf(k.toLowerCase()); return i < 0 ? 9 : i; };
  r.meetings.forEach(m => { if (!m.term && S.term) m.term = S.term; });
  S.meetings = r.meetings.sort((a, b) => a.code.localeCompare(b.code) || order(a.kind) - order(b.kind) || a.startTime - b.startTime);
  S.warnings = r.warnings; S.courseCount = r.courseCount; S.off = new Set();
  if (!S.term) S.term = (S.meetings.find(m => m.term) || {}).term || "";
  S.colors = new Map([...new Set(S.meetings.map(m => m.code))].sort().map((c, i) => [c, i]));
  // shades in the meetings' order: lectures first, then labs, tutorials, seminars
  S.shades = new Map();
  const per = new Map();
  for (const m of S.meetings) {
    const k = sessionKey(m);
    if (S.shades.has(k)) continue;
    S.shades.set(k, per.get(m.code) || 0);
    per.set(m.code, S.shades.get(k) + 1);
  }
  $("#fallback").hidden = !S.warnings.some(w => w.includes("missing meeting dates")) && S.fallback.start === null;
}

async function readFile(file, statusEl) {
  if (!file) return;
  if (file.size > OI.MAX_BYTES) { statusEl.textContent = "That file is larger than 25 MB; it isn't a schedule page."; statusEl.classList.add("err"); return; }
  statusEl.classList.remove("err");
  statusEl.textContent = `Reading ${file.name}…`;
  const text = await file.text();
  if (importFrom(text, { fileName: file.name, statusEl })) toast(`Read ${esc(file.name)} in this tab. Nothing was uploaded.`, null, 4200);
}

// ── build the calendar ───────────────────────────────────────────────────
function rebuild() {
  S.templateErr = ""; S.buildErr = "";
  const on = enabled();
  try {
    for (const k of ["title", "description", "location"]) OC.templateParts(S.style[k]);
  } catch (e) { S.templateErr = e.message; }
  if (!S.templateErr && on.length) {
    try {
      const out = OC.makeCalendar(on.map(([m]) => m), { skip: S.skip, reminder: S.reminder, style: S.style, name: S.calName || "Ontario Tech Courses" });
      S.ics = out.ics; S.count = out.count;
      S.uidMeeting = new Map(out.events.map(e => [e.uid, on[e.meetingIndex][1]]));
      S.parsed = OC.parseIcs(out.ics);
    } catch (e) { S.buildErr = e.message; }
  } else if (!on.length) S.buildErr = S.meetings.length ? "Every meeting is switched off." : "No scheduled meetings to export.";
  if (S.templateErr || S.buildErr) { S.ics = ""; S.count = 0; S.parsed = { events: [], calendar: {} }; S.uidMeeting = new Map(); }
  buildWeeks();
  render();
}

function buildWeeks() {
  // Classes (a bi-weekly lab is one meeting per date in Banner) and their week patterns.
  const pairs = enabled();
  S.pat = OC.classPatterns(pairs.map(([m]) => m), S.skip);
  S.classOf = new Map(pairs.map(([, mi], k) => [mi, S.pat.of[k]]));
  const on = pairs.map(([m]) => m);
  const evs = S.parsed.events.map(e => {
    const a = OC.localOf(e.start), b = OC.localOf(e.end);
    return { ...e, day: a.day, s: a.mins, e: b.day > a.day ? 24 * 60 : Math.max(b.mins, a.mins + 15), mi: S.uidMeeting.get(e.uid) };
  });
  let lo = Infinity, hi = -Infinity;
  for (const m of on) { lo = Math.min(lo, m.startDate); hi = Math.max(hi, m.endDate); }
  for (const e of evs) { lo = Math.min(lo, e.day); hi = Math.max(hi, e.day); }
  S.weeks = [];
  if (lo === Infinity) { S.layout = null; return; }
  const first = lo - OC.weekday(lo), last = hi - OC.weekday(hi);
  for (let w = first; w <= last && S.weeks.length < 60; w += 7) S.weeks.push({ start: w, events: [] });
  for (const e of evs) { const w = S.weeks[Math.floor((e.day - first) / 7)]; if (w) w.events.push(e); }
  const weekend = evs.some(e => OC.weekday(e.day) >= 5);
  let h0 = 8, h1 = 18;
  if (evs.length) {
    h0 = Math.min(...evs.map(e => Math.floor(e.s / 60)));
    h1 = Math.max(...evs.map(e => Math.ceil(e.e / 60)));
    if (h1 - h0 < 8) h1 = Math.min(24, h0 + 8);
  }
  S.layout = { days: weekend ? 7 : 5, h0, h1 };
  if (S.week < 0 || S.week >= S.weeks.length) {
    const t = todayDay(), i = S.weeks.findIndex(w => t >= w.start && t < w.start + 7);
    S.week = i >= 0 ? i : 0;
  }
}

// ── render ───────────────────────────────────────────────────────────────
function render() {
  const has = !!S.payload;
  $("#empty").hidden = has;
  $("#btnDownload").disabled = !S.ics;
  $("#btnSaveJson").disabled = !has || !S.meetings.length;
  $("#btnImage").disabled = !S.ics;
  $("#sheetInfo").textContent = has
    ? [S.term ? `${S.term}${termName(S.term) ? " · " + termName(S.term) : ""}` : "Term unknown", plural(S.colors.size, "course"), plural(S.count, "class", "classes")].join(" · ")
    : "No schedule loaded";
  renderLegend(); renderFacts(); renderAppearance(); renderMeetings(); renderNotes();
  renderReadingWeek(); renderWeeks(); renderIcs();
}

function renderLegend() {
  const el = $("#legend");
  el.replaceChildren();
  if (!S.payload) return;
  const titles = new Map();
  for (const m of S.meetings) if (!titles.has(m.code)) titles.set(m.code, m.title);
  // one swatch per session, in its shade of the course colour
  const sessions = new Map([...S.colors.keys()].map(c => [c, new Map()]));
  for (const m of S.meetings) {
    const list = sessions.get(m.code), k = sessionKey(m);
    if (!list.has(k)) list.set(k, { cc: colorOf(m), label: `${m.code} ${m.kind || "Class"}${m.crn ? ` · CRN ${m.crn}` : ""}` });
  }
  for (const [code, list] of sessions) el.append(h("span", { class: "k", title: titles.get(code) || "" },
    h("span", { class: "sws" }, ...[...list.values()].map(x => h("span", { class: "sw", vars: { "--cc": x.cc }, title: x.label }))), h("b", { text: code })));
  // The bi-weekly sets: striped meets in one set of weeks, dotted in the other.
  for (let set = 1; S.pat && set <= S.pat.sets; set++) {
    const cls = S.pat.classes.filter(c => c.set === set);
    const weeks = [...new Set(cls.flatMap(c => c.weeks))];
    const names = [...new Set(cls.map(c => { const m = S.meetings[[...S.classOf].find(([, x]) => x === c)[0]]; return `${m.code} ${OC.valuesFor(m).TypeShort}`; }))];
    el.append(h("span", { class: "k bwk", vars: { "--cc": "var(--ink-3)" }, title: `${names.join(", ")} meet in these weeks` },
      h("span", { class: `sw bw${set}` }), h("b", { text: `${setName(set)} · ${OC.weekNames(weeks)}` })));
  }
}
/** "Bi-weekly" or "Bi-weekly, set 1" (when two sets meet in different weeks). */
const setName = set => S.pat && S.pat.sets > 1 ? `Bi-weekly set ${set}` : "Bi-weekly";
/** When a class meets, for the ones that don't meet every week: "Bi-weekly set 1: W1, W3, …" or "W2–W13". */
function meetsText(c) {
  if (!c || c.weekly) return "";
  return c.set ? `${setName(c.set)}: ${OC.weekNames(c.weeks)}` : OC.weekList(c.weeks);
}

function renderFacts() {
  const el = $("#facts");
  el.replaceChildren();
  if (!S.payload) return;
  const on = enabled().map(([m]) => m);
  const src = { page: "from the page", file: "from the file", dates: "guessed from class dates" }[S.info && S.info.termSource] || "";
  const row = (k, ...v) => [h("dt", { text: k }), h("dd", {}, ...v)];
  const evs = S.parsed ? S.parsed.events : [];
  el.append(
    ...row("Term", h("b", { text: S.term || "unknown" }), S.term && termName(S.term) ? ` ${termName(S.term)}` : "", src ? h("span", { class: "tiny" }, ` · ${src}`) : ""),
    ...row("Sections", `${S.courseCount} · ${plural(S.meetings.length, "meeting pattern")}${S.off.size ? ` (${S.off.size} off)` : ""}`),
    ...row("Events", h("b", { text: String(S.count) }), S.ics ? ` · ${kb(new TextEncoder().encode(S.ics).length)}` : ""),
  );
  if (evs.length) {
    el.append(...row("Classes", `${dayShort(OC.localOf(evs[0].start).day)} → ${dayShort(OC.localOf(evs[evs.length - 1].start).day)}`));
  }
  el.append(...row("Skipped", S.skip.size ? plural(S.skip.size, "date") : "none"));
  if (!on.length || S.buildErr) el.append(...row("Status", h("span", { class: "err", text: S.buildErr || "Nothing to export." })));
}

function renderAppearance() {
  const seg = $("#presetSeg");
  if (!seg.children.length) {
    for (const name of Object.keys(OC.PRESETS)) seg.append(h("button", { type: "button", role: "radio", "data-preset": name, "aria-checked": "false", onclick: () => applyPreset(name) }, name));
    const sel = $("#phSelect");
    for (const p of OC.PLACEHOLDERS) sel.append(h("option", { value: p, text: `{${p}}` }));
  }
  for (const b of seg.children) { const p = OC.PRESETS[b.dataset.preset]; b.setAttribute("aria-checked", String(["title", "description", "location"].every(k => p[k] === S.style[k]))); }
  for (const [id, k] of [["#tTitle", "title"], ["#tDesc", "description"], ["#tLoc", "location"]]) {
    const el = $(id);
    if (el.value !== S.style[k] && document.activeElement !== el) el.value = S.style[k];
    el.setAttribute("aria-invalid", String(!!S.templateErr && (() => { try { OC.templateParts(S.style[k]); return false; } catch (e) { return true; } })()));
  }
  $("#tErr").textContent = S.templateErr;
  const ex = $("#example");
  ex.replaceChildren();
  const on = enabled();
  if (!on.length || S.templateErr) return;
  try {
    const m = on[0][0], r = OC.renderEvent(m, S.style);
    ex.append(h("span", { class: "lbl", text: `example · ${m.code} ${m.kind}` }), h("b", { text: r.title }));
    if (r.description) ex.append(h("span", { text: r.description }));
    if (r.location) ex.append(h("span", { text: `@ ${r.location}` }));
    if (r.missing.length) ex.append(h("span", { class: "miss", text: `empty here: ${r.missing.map(x => `{${x}}`).join(" ")}` }));
  } catch (e) { $("#tErr").textContent = e.message; }
}

function applyPreset(name) {
  S.style = { ...OC.PRESETS[name] };
  for (const [id, k] of [["#tTitle", "title"], ["#tDesc", "description"], ["#tLoc", "location"]]) $(id).value = S.style[k];
  saveStyle(); rebuild();
}

function renderMeetings() {
  const el = $("#meetings");
  el.replaceChildren();
  $("#meetCount").textContent = S.meetings.length ? `${S.meetings.length - S.off.size}/${S.meetings.length}` : "";
  S.meetings.forEach((m, i) => {
    const room = OC.roomLabel(m.buildingCode, m.room) || m.location;
    const interval = h("select", { class: "sd-select sd-small", "aria-label": `Repeat for ${m.code} ${m.kind}`, onchange: e => { m.intervalWeeks = +e.target.value; rebuild(); } },
      ...[1, 2, 3, 4].map(n => h("option", { value: n, selected: m.intervalWeeks === n }, n === 1 ? "every week" : `every ${n} weeks`)));
    el.append(h("div", { class: "mrow" + (S.off.has(i) ? " off" : ""), vars: { "--cc": colorOf(m) } },
      h("input", { type: "checkbox", checked: !S.off.has(i), "aria-label": `Include ${m.code} ${m.kind}`, onchange: e => { e.target.checked ? S.off.delete(i) : S.off.add(i); rebuild(); } }),
      h("div", { class: "mt" }, `${m.code} · ${m.kind || "Class"}`, m.crn ? h("i", { text: `CRN ${m.crn}` }) : null),
      h("div", { class: "md" },
        h("span", { text: `${m.days.map(d => DAYS[d]).join("/")} ${timeRange(m.startTime, m.endTime)}` }),
        h("span", { text: `${dayShort(m.startDate)} – ${dayShort(m.endDate)}${room ? " · " + room : ""}` })),
      h("div", { class: "mx" }, h("span", { text: "repeats" }), interval)));
  });
}

function renderNotes() {
  const items = [];
  for (const n of (S.info && S.info.notes) || []) items.push([n, ""]);
  for (const w of S.warnings) items.push([w, "w"]);
  if (S.info && S.info.termSource === "dates") items.push([`The term code wasn't on the page, so ${S.term} was guessed from the class dates. It only appears in {Term} and the event IDs.`, ""]);
  const missing = new Map();
  if (!S.templateErr) for (const [m] of enabled()) { try { for (const f of OC.renderEvent(m, S.style).missing) missing.set(f, (missing.get(f) || 0) + 1); } catch (e) {} }
  for (const [f, n] of missing) items.push([`{${f}} is empty for ${plural(n, "meeting")}; that part of the text is left out.`, "w"]);
  $("#pNotes").hidden = !items.length;
  $("#noteCount").textContent = items.length || "";
  $("#notes").replaceChildren(...items.map(([t, c]) => h("li", { class: c, text: t })));
}

// ── week preview ─────────────────────────────────────────────────────────
function layoutDay(evs) {
  // Overlapping classes share the column side by side.
  const sorted = [...evs].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [], cols = [], clusterEnd = -1;
  const flush = () => { for (const x of cluster) x.n = cols.length; out.push(...cluster); cluster = []; cols = []; };
  for (const e of sorted) {
    if (e.s >= clusterEnd && cluster.length) flush();
    let c = cols.findIndex(end => end <= e.s);
    if (c < 0) { c = cols.length; cols.push(0); }
    cols[c] = e.e; e.c = c; cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.e);
  }
  if (cluster.length) flush();
  return out;
}

// ── reading week ─────────────────────────────────────────────────────────
// Banner doesn't mark reading week, and often still lists lectures in it. When the schedule
// gives it away (a week mid-term with nothing in it, or the one week both bi-weekly sets skip),
// ask whether to leave it out; otherwise offer to pick it. Confirming skips every class that week.
const classWeek = start => { const a = OC.ymd(start), b = OC.ymd(start + (S.layout && S.layout.days === 7 ? 6 : 4)); return a.m === b.m ? `${MONTHS[a.m - 1]} ${a.d}–${b.d}` : `${MONTHS[a.m - 1]} ${a.d}–${MONTHS[b.m - 1]} ${b.d}`; };
const weekNo = start => S.weeks.findIndex(w => w.start === start) + 1;
function rwGuess() {
  if (!S.pat || !S.pat.weeks.length) return null;
  const i = OC.readingWeek(S.pat);
  return i < 0 ? null : { start: S.pat.weeks[i], why: S.pat.empty.includes(i) ? "empty" : "biweekly" };
}
function setReadingWeek(start) {
  const days = S.layout && S.layout.days === 7 ? 7 : 5;
  if (S.readingWeek !== null) for (let d = 0; d < 7; d++) S.skip.delete(S.readingWeek + d); // a different week replaces it
  S.readingWeek = start; S.rwAnswered = true; S.rwPick = null;
  if (start !== null) for (let d = 0; d < days; d++) S.skip.add(start + d);
  $("#oSkip").value = OC.exclusionText(S.skip);
  $("#oErr").textContent = "";
  rebuild();
}
function renderReadingWeek() {
  const bar = $("#rwBar");
  bar.replaceChildren();
  bar.hidden = true;
  if (!S.payload || S.weeks.length < 6) return;
  const guess = rwGuess();
  const btn = (text, run, primary) => h("button", { type: "button", class: `sd-btn sd-small${primary ? " sd-primary" : " sd-ghost"}`, text, onclick: run });
  if (S.readingWeek !== null) {
    const n = weekNo(S.readingWeek);
    bar.append(h("p", {}, h("b", { text: `Reading week: W${n}, ${classWeek(S.readingWeek)}.` }), " Every class that week is left out of the calendar."),
      h("div", { class: "acts" }, btn("Change week", () => { const was = S.readingWeek; setReadingWeek(null); S.rwAnswered = false; S.rwPick = was; renderReadingWeek(); }),
        btn("Undo", () => { const was = S.readingWeek; setReadingWeek(null); S.rwAnswered = false; toast(`W${weekNo(was)} is back in the calendar`); })));
    bar.className = "rwbar done"; bar.hidden = false;
    return;
  }
  if (S.rwAnswered && S.rwPick === null) return;
  if (guess && S.rwPick === null) {
    const w = S.weeks.find(x => x.start === guess.start), listed = w ? w.events.length : 0;
    bar.append(h("p", {}, h("b", { text: `Is W${weekNo(guess.start)}, ${classWeek(guess.start)}, reading week?` }), " ",
      guess.why === "empty" ? "Nothing on your schedule meets that week." : `Neither set of bi-weekly classes meets that week${listed ? `, though ${plural(listed, "lecture or tutorial is", "lectures and tutorials are")} still listed in it` : ""}.`,
      listed ? " Confirming leaves every class that week out of the calendar." : ""),
      h("div", { class: "acts" }, btn(`Yes, skip W${weekNo(guess.start)}`, () => { setReadingWeek(guess.start); toast(`W${weekNo(guess.start)} is reading week: no classes`, { label: "Undo", run: () => { setReadingWeek(null); S.rwAnswered = false; render(); } }, 4000); }, true),
        btn("It's a different week", () => { S.rwPick = guess.start; renderReadingWeek(); }),
        btn("No reading week", () => { S.rwAnswered = true; renderReadingWeek(); })));
  } else {
    // pick it: every week, with its dates
    const pick = S.rwPick ?? null;
    const grid = h("div", { class: "rwweeks", role: "radiogroup", "aria-label": "Reading week" },
      ...S.weeks.map((w, i) => h("button", { type: "button", role: "radio", class: "rwk", "aria-checked": String(w.start === pick), onclick: () => { S.rwPick = w.start; renderReadingWeek(); } },
        h("b", { text: `W${i + 1}` }), h("span", { text: classWeek(w.start) }))));
    bar.append(h("p", {}, h("b", { text: "Is there a reading week this term?" }), " Your schedule doesn't say. Pick the week to leave every class out of it."),
      grid,
      h("div", { class: "acts" },
        btn(pick !== null ? `Skip W${weekNo(pick)}, ${classWeek(pick)}` : "Pick a week first", () => { if (pick !== null) setReadingWeek(pick); }, true),
        btn("No reading week", () => { S.rwAnswered = true; S.rwPick = null; renderReadingWeek(); })));
    bar.querySelector(".acts .sd-primary").disabled = pick === null;
  }
  bar.className = "rwbar"; bar.hidden = false;
}

function renderWeeks() {
  const track = $("#track"), chips = $("#weekChips");
  track.replaceChildren(); chips.replaceChildren();
  $("#weekNav").hidden = !S.weeks.length;
  if (!S.weeks.length || !S.layout) {
    if (S.payload) track.append(h("div", { class: "week" }, h("p", { class: "sd-callout sd-warn", text: S.templateErr || S.buildErr || "Nothing to preview." })));
    $("#wLabel").replaceChildren();
    return;
  }
  const { days, h0, h1 } = S.layout;
  const today = todayDay(), now = OC.localOf(Date.now());
  const bodyH = (h1 - h0) * HOUR;
  S.weeks.forEach((w, wi) => {
    const grid = h("div", { class: "wgrid", vars: { "--days": days }, style: { gridTemplateRows: `auto ${bodyH}px` } });
    grid.append(h("div", { class: "corner" }));
    for (let d = 0; d < days; d++) {
      const day = w.start + d, skipped = S.skip.has(day);
      grid.append(h("button", { type: "button", class: `dh${day === today ? " today" : ""}${skipped ? " skipped" : ""}`, title: skipped ? "Click to include this date again" : "Click to skip this date (holiday, reading week)", "aria-label": `Skip ${dayLong(day)}`, "aria-pressed": String(skipped), onclick: () => toggleSkip(day) },
        h("b", { text: DAYS[d] }), h("span", { text: skipped ? `${dayShort(day)} · skipped` : dayShort(day) })));
    }
    const gutter = h("div", { class: "gutter" });
    for (let hr = h0 + 1; hr < h1; hr++) gutter.append(h("span", { style: { top: `${(hr - h0) * HOUR}px` }, text: `${hr % 12 || 12}${hr < 12 ? "a" : "p"}` }));
    grid.append(gutter);
    for (let d = 0; d < days; d++) {
      const day = w.start + d;
      const col = h("div", { class: `col${day === today ? " today" : ""}${S.skip.has(day) ? " skipped" : ""}` });
      if (day === today && now.mins >= h0 * 60 && now.mins <= h1 * 60) col.append(h("div", { class: "nowline", style: { top: `${(now.mins - h0 * 60) / 60 * HOUR}px` } }));
      layoutDay(w.events.filter(e => e.day === day)).forEach((e, k) => {
        const m = S.meetings[e.mi] || {};
        const top = (e.s - h0 * 60) / 60 * HOUR, height = Math.max(20, (e.e - e.s) / 60 * HOUR - 2);
        const sub = e.location || (e.description || "").split("\n")[0];
        const cl = S.classOf.get(e.mi), meets = meetsText(cl);
        col.append(h("button", {
          type: "button", class: `ev${cl && cl.set ? " bw" + cl.set : ""}`, title: `${e.summary}\n${timeRange(e.s, e.e)}${sub ? "\n" + sub : ""}${meets ? "\n" + meets : ""}`,
          vars: { "--cc": m.code ? colorOf(m) : "var(--accent)" },
          style: { top: `${top}px`, height: `${height}px`, left: `calc(${(e.c / e.n) * 100}% + 3px)`, width: `calc(${100 / e.n}% - 6px)`, animationDelay: `${Math.min(k * 30 + d * 25, 300)}ms` },
          onclick: ev => openPop(e, ev.currentTarget),
        }, h("b", { text: e.summary || "(no title)" }), height > 34 ? h("span", { text: timeRange(e.s, e.e) }) : null, height > 50 && sub ? h("span", { text: sub }) : null,
        e.alarms.length ? h("i", { class: "al", text: "◷", role: "img", "aria-label": "has a reminder" }) : null));
      });
      grid.append(col);
    }
    if (!w.events.length) grid.append(h("div", { class: "wempty", text: w.start === S.readingWeek ? "Reading week: no classes." : S.skip.size ? "No classes this week (all skipped)." : "No classes this week." }));
    track.append(h("section", { class: "week", "aria-label": `Week of ${weekRange(w.start)}` }, grid));
    const counts = Array.from({ length: days }, (_, d) => w.events.filter(e => e.day === w.start + d).length);
    const max = Math.max(1, ...S.weeks.map(x => x.events.length ? Math.max(...Array.from({ length: days }, (_, d) => x.events.filter(e => e.day === x.start + d).length)) : 0));
    chips.append(h("button", { type: "button", role: "tab", class: "wchip" + (today >= w.start && today < w.start + 7 ? " now" : "") + (w.start === S.readingWeek ? " rw" : ""), "aria-selected": "false", title: `${weekRange(w.start)} · ${w.start === S.readingWeek ? "reading week" : plural(w.events.length, "class", "classes")}`, onclick: () => goWeek(wi, true) },
      h("span", { text: `W${wi + 1}` }), h("span", { class: "bars" }, ...counts.map(c => h("i", { style: { height: `${2 + (c / max) * 12}px` } })))));
  });
  // Replacing the weeks resets the track to week 1; put it back before anything paints.
  scrollLock = true;
  goWeek(S.week, false);
  setTimeout(() => { scrollLock = false; }, 150);
}

// Smooth scrolling only when neither the system nor the shared Animations switch asks for stillness.
const smoothOk = () => !matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "off";
function goWeek(i, smooth) {
  if (!S.weeks.length) return;
  S.week = Math.max(0, Math.min(S.weeks.length - 1, i));
  const track = $("#track");
  track.scrollTo({ left: S.week * track.clientWidth, behavior: smooth && smoothOk() ? "smooth" : "auto" });
  syncWeek();
}
function syncWeek() {
  const w = S.weeks[S.week];
  if (!w) return;
  // which bi-weekly sets meet this week
  const pi = S.pat && S.pat.weeks.length ? Math.round((w.start - S.pat.weeks[0]) / 7) : -1;
  const sets = S.pat && S.pat.sets > 1 ? [...new Set(S.pat.classes.filter(c => c.set && c.weeks.includes(pi)).map(c => c.set))].sort() : [];
  $("#wLabel").replaceChildren(h("b", { text: `Week ${S.week + 1} of ${S.weeks.length}` }), h("span", { text: `${weekRange(w.start)} · ${plural(w.events.length, "class", "classes")}${sets.length ? ` · bi-weekly set ${sets.join(" & ")}` : ""}` }));
  $("#wPrev").disabled = S.week === 0;
  $("#wNext").disabled = S.week === S.weeks.length - 1;
  const chips = $("#weekChips").children;
  [...chips].forEach((c, i) => c.setAttribute("aria-selected", String(i === S.week)));
  // Only the week on screen is in the Tab order; the others are out of view.
  $$("#track .week").forEach((el, i) => { el.inert = i !== S.week; });
  const c = chips[S.week];
  if (c) { const box = $("#weekChips"); const x = c.offsetLeft - box.clientWidth / 2 + c.clientWidth / 2; box.scrollTo({ left: x, behavior: smoothOk() ? "smooth" : "auto" }); }
  closePop();
}
let scrollTimer = 0, scrollLock = false;
$("#track").addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  if (scrollLock) return;
  scrollTimer = setTimeout(() => {
    const t = $("#track"), i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    if (i !== S.week && S.weeks[i]) { S.week = i; syncWeek(); }
  }, 70);
}, { passive: true });
window.addEventListener("resize", () => { if (S.weeks.length) goWeek(S.week, false); });

function toggleSkip(day) {
  S.skip.has(day) ? S.skip.delete(day) : S.skip.add(day);
  $("#oSkip").value = OC.exclusionText(S.skip);
  $("#oErr").textContent = "";
  rebuild();
  toast(S.skip.has(day) ? `Skipping ${dayLong(day)}` : `Including ${dayLong(day)} again`, { label: "Undo", run: () => toggleSkip(day) }, 3200);
}

// ── event popover ────────────────────────────────────────────────────────
let popFor = null;
function openPop(e, anchor) {
  const pop = $("#pop");
  if (popFor === anchor && !pop.hidden) { closePop(); return; }
  closePop();
  popFor = anchor; anchor.classList.add("sel");
  const m = S.meetings[e.mi] || {};
  const row = (k, v) => v ? [h("dt", { text: k }), h("dd", { text: v })] : [];
  const trig = e.alarms[0] || "";
  const mins = /PT(\d+)M/.exec(trig);
  pop.replaceChildren(
    h("header", {}, h("h4", { text: e.summary || "(no title)" }), h("button", { class: "sd-x", type: "button", "aria-label": "Close", onclick: closePop }, "×")),
    h("dl", {},
      ...row("When", `${dayLong(e.day)}\n${timeRange(e.s, e.e)} · Toronto time`),
      ...row("Location", e.location),
      ...row("Notes", e.description),
      ...row("Reminder", trig ? (mins ? `${mins[1]} min before` : "at start") : ""),
      ...row("Meets", meetsText(S.classOf.get(e.mi))),
      ...row("From", m.code ? `${m.code} · ${m.kind}${m.crn ? ` · CRN ${m.crn}` : ""}` : ""),
      ...row("UID", (e.uid || "").slice(0, 16) + "…")));
  pop.style.setProperty("--cc", m.code ? colorOf(m) : "var(--accent)");
  pop.hidden = false;
  const st = $("#stage").getBoundingClientRect(), a = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = a.right - st.left + 10;
  if (left + pw > st.width - 8) left = a.left - st.left - pw - 10;
  if (left < 8) left = Math.max(8, Math.min(st.width - pw - 8, a.left - st.left));
  let top = a.top - st.top;
  if (left === Math.max(8, Math.min(st.width - pw - 8, a.left - st.left)) && left < a.right - st.left) top = a.bottom - st.top + 8;
  top = Math.max(8, Math.min(st.height - ph - 8, top));
  pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  // It grows out of the side its class is on.
  const ax = a.left - st.left;
  pop.style.setProperty("--pop-origin", left >= a.right - st.left ? "left top" : left + pw <= ax ? "right top" : "center top");
  // Keyboard users land in the entry; closing it returns them to its class.
  pop.querySelector(".sd-x").focus({ preventScroll: true });
}
function closePop() {
  const back = popFor && $("#pop").contains(document.activeElement) ? popFor : null;
  $("#pop").hidden = true; if (popFor) popFor.classList.remove("sel"); popFor = null;
  if (back) back.focus({ preventScroll: true });
}
document.addEventListener("pointerdown", e => { if (!$("#pop").hidden && !e.target.closest("#pop") && !e.target.closest(".ev")) closePop(); });
$("#viewWeeks").addEventListener("scroll", closePop, { passive: true });

// ── raw .ics view ────────────────────────────────────────────────────────
function renderIcs() {
  const pre = $("#icsText");
  if (S.view !== "ics") return;
  if (!S.ics) { pre.textContent = S.templateErr || S.buildErr || "No calendar yet."; $("#icsInfo").textContent = ""; return; }
  pre.innerHTML = S.ics.split("\r\n").map(line => {
    if (/^(BEGIN|END):/.test(line)) return `<span class="b">${esc(line)}</span>`;
    if (line.startsWith(" ")) return esc(line);
    const i = line.search(/[:;]/);
    return i > 0 ? `<span class="p">${esc(line.slice(0, i))}</span>${esc(line.slice(i))}` : esc(line);
  }).join("\n");
  $("#icsInfo").textContent = `${fileName("ics")} · ${plural(S.count, "event")} · ${kb(new TextEncoder().encode(S.ics).length)} · times in UTC (Z), shown in Toronto time by your calendar`;
}
function setView(v) {
  S.view = v;
  $$("#viewSeg button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.view === v)));
  $("#viewWeeks").hidden = v !== "weeks"; $("#weekChips").hidden = v !== "weeks"; $("#weekNav").hidden = v !== "weeks" || !S.weeks.length;
  $("#viewIcs").hidden = v !== "ics";
  closePop();
  if (v === "ics") renderIcs(); else goWeek(S.week, false);
}

// ── downloads ────────────────────────────────────────────────────────────
const fileName = ext => `ontario-tech-${S.term || "courses"}.${ext}`;
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
$("#btnDownload").addEventListener("click", () => {
  if (!S.ics) return;
  download(fileName("ics"), S.ics, "text/calendar;charset=utf-8");
  toast(`Saved ${fileName("ics")} · ${plural(S.count, "event")}. Import it in Google Calendar → Settings → Import &amp; export.`, null, 6000);
});
$("#btnSaveJson").addEventListener("click", () => {
  const data = OC.editableSchedule(enabled().map(([m]) => m));
  download(fileName("json"), JSON.stringify(data, null, 2) + "\n", "application/json");
  toast(`Saved ${fileName("json")}. Load it here later to skip signing in. It contains your course list.`, null, 5000);
});
$("#btnCopyIcs").addEventListener("click", () => copy(S.ics, "Copied the .ics text"));
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg, null, 2200); }
  catch (e) { toast("Couldn't copy; select the text and copy it yourself.", null, 3000); }
}

// ── report ───────────────────────────────────────────────────────────────
function showReport() {
  const body = $("#reportBody");
  const kind = { html: "saved page", mhtml: "saved page (single file)", text: "pasted text", paste: "pasted page", json: "JSON file", sample: "fictional sample" }[S.info.kind] || "import";
  const items = [...(S.info.notes || []).map(n => [n, ""]), ...S.warnings.map(w => [w, "w"])];
  body.replaceChildren(...[
    h("p", { class: "rsum" }, "Found ", h("b", { text: plural(S.courseCount, "course section") }), " with ", h("b", { text: plural(S.meetings.length, "meeting pattern") }), " → ", h("b", { text: plural(S.count, "class", "classes") }), "."),
    h("p", { class: "help", text: `From the ${kind}. Term ${S.term || "unknown"}${termName(S.term) ? ` (${termName(S.term)})` : ""}. Check the preview against your schedule before importing it anywhere.` }),
    items.length ? h("div", { class: "rsec" }, h("h3", { text: "Notes" }), h("ul", {}, ...items.map(([t, c]) => h("li", { class: c, text: t })))) : null,
    S.meetings.length ? null : h("p", { class: "sd-callout sd-warn", text: "No timed meetings were found. Online/asynchronous courses have no class times. If your courses do meet, try the helper or the saved page." }),
  ].filter(Boolean));
  open("#reportDlg");
}

// ── dialogs, toasts ──────────────────────────────────────────────────────
function open(sel) {
  const d = $(sel);
  d.hidden = false;
  const f = d.querySelector("[data-autofocus]") || d.querySelector(".btn.primary") || d.querySelector("button");
  if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
}
function close(sel) { $(sel).hidden = true; }
function closeAll() { $$(".overlay").forEach(o => (o.hidden = true)); }
function openImport(tab = "file") {
  closeAll();
  setTab(tab);
  $("#fileStatus").textContent = ""; $("#pasteStatus").textContent = "";
  open("#importDlg");
}
function setTab(tab) {
  $$("#importDlg .tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
  $$("#importDlg [data-pane]").forEach(p => (p.hidden = p.dataset.pane !== tab));
  $("#btnPasteImport").hidden = tab !== "paste";
  $("#btnCopyHelper").hidden = tab !== "helper";
  if (tab === "paste") setTimeout(() => $("#pasteText").focus(), 30);
}
let toastTimer = 0;
function toast(html, action, ms = 2600) {
  const t = $("#toast");
  t.innerHTML = `<span>${html}</span>`;
  if (action) t.append(h("button", { type: "button", onclick: () => { hideToast(); action.run(); } }, action.label));
  t.hidden = false;
  t.setAttribute("data-open", "");
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
// data-open fades it out (the shared .sd-toast); hidden follows once the fade is done.
function hideToast() {
  const t = $("#toast");
  t.removeAttribute("data-open"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 200);
}

function startOver() {
  S.payload = null; S.info = null; S.meetings = []; S.warnings = []; S.off = new Set(); S.skip = new Set();
  S.readingWeek = null; S.rwAnswered = false; S.rwPick = null;
  S.ics = ""; S.count = 0; S.parsed = { events: [], calendar: {} }; S.weeks = []; S.layout = null; S.term = ""; S.colors = new Map(); S.shades = new Map();
  $("#pasteText").value = ""; S.pasteHtml = null; $("#oSkip").value = "";
  render(); closePop();
  open("#welcomeDlg");
}
function loadSample() {
  loadPayload(JSON.parse(JSON.stringify(OSAMPLE)), { kind: "sample", term: "202609", termSource: "file", notes: ["FICTIONAL SAMPLE: made-up DEMO courses, not anyone's schedule."] });
}

// ── wiring ───────────────────────────────────────────────────────────────
document.addEventListener("click", e => {
  const t = e.target.closest("[data-close], [data-action], [data-import-tab], [data-open]");
  if (!t) return;
  if (t.hasAttribute("data-close")) { t.closest(".overlay").hidden = true; return; }
  if (t.dataset.open) { open("#" + t.dataset.open); return; }
  if (t.dataset.importTab) { openImport(t.dataset.importTab); return; }
  const a = t.dataset.action;
  if (a === "home") { closeAll(); open("#welcomeDlg"); }
  else if (a === "choose") $("#fileInput").click();
  else if (a === "sample") loadSample();
});
$$(".overlay").forEach(o => o.addEventListener("pointerdown", e => { if (e.target === o && o.id !== "welcomeDlg") o.hidden = true; }));
$("#btnImport").addEventListener("click", () => openImport("file"));
$("#btnHome").addEventListener("click", startOver);
$("#btnReimport").addEventListener("click", () => openImport("file"));
$$("#importDlg .tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
$("#fileInput").addEventListener("change", e => {
  const status = !$("#importDlg").hidden ? $("#fileStatus") : $("#fileStatus");
  if ($("#importDlg").hidden) openImport("file");
  readFile(e.target.files[0], status);
  e.target.value = "";
});

// paste: keep the copied page's HTML when the clipboard has it, so highlighted meeting days survive
$("#pasteText").addEventListener("paste", e => {
  const html = e.clipboardData && e.clipboardData.getData("text/html");
  S.pasteHtml = html && html.length < OI.MAX_BYTES ? html : null;
  setTimeout(() => { S.pasteText = $("#pasteText").value; }, 0);
});
$("#btnPasteImport").addEventListener("click", () => {
  const text = $("#pasteText").value, st = $("#pasteStatus");
  if (!text.trim()) { st.textContent = "Paste the page first."; st.classList.add("err"); return; }
  if (S.pasteHtml && text === S.pasteText) {
    const before = st.textContent;
    if (importFrom(S.pasteHtml, { forceHtml: true, statusEl: st }) && S.meetings.length) return;
    st.textContent = before;
  }
  importFrom(text, { statusEl: st });
});

// helper
$("#helperCode").textContent = OH.SOURCE;
$("#bookmarklet").href = OH.bookmarklet();
$("#bookmarklet").addEventListener("click", e => { e.preventDefault(); toast("Drag this link to your bookmarks bar, then click it on your schedule page.", null, 3600); });
$("#btnCopyHelper").addEventListener("click", () => copy(OH.SOURCE, "Copied the helper code"));

// drag & drop anywhere
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("#dropVeil").hidden = false; });
window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#dropVeil").hidden = true; });
window.addEventListener("drop", e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $("#dropVeil").hidden = true;
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if ($("#importDlg").hidden) openImport("file");
  setTab("file");
  readFile(f, $("#fileStatus"));
});
for (const id of ["#wDrop", "#dlgDrop"]) {
  const d = $(id);
  d.addEventListener("dragenter", () => d.setAttribute("data-over", ""));
  d.addEventListener("dragleave", () => d.removeAttribute("data-over"));
  d.addEventListener("drop", () => d.removeAttribute("data-over"));
}

// appearance
let lastField = $("#tTitle"), styleTimer = 0;
for (const [id, k] of [["#tTitle", "title"], ["#tDesc", "description"], ["#tLoc", "location"]]) {
  const el = $(id);
  el.addEventListener("focus", () => (lastField = el));
  el.addEventListener("input", () => {
    S.style = { ...S.style, [k]: el.value };
    saveStyle();
    clearTimeout(styleTimer); styleTimer = setTimeout(rebuild, 140);
  });
}
$("#phInsert").addEventListener("click", () => {
  const el = lastField, ins = `{${$("#phSelect").value}}`;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, a) + ins + el.value.slice(b);
  el.focus(); el.setSelectionRange(a + ins.length, a + ins.length);
  el.dispatchEvent(new Event("input"));
});

// options
$("#oName").addEventListener("input", e => { S.calName = e.target.value.trim(); clearTimeout(styleTimer); styleTimer = setTimeout(rebuild, 200); });
$("#oReminder").addEventListener("change", e => { S.reminder = e.target.value === "" ? null : +e.target.value; rebuild(); });
let skipTimer = 0;
$("#oSkip").addEventListener("input", e => {
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => {
    try { S.skip = OC.exclusions(e.target.value); $("#oErr").textContent = ""; e.target.removeAttribute("aria-invalid"); rebuild(); }
    catch (err) { $("#oErr").textContent = err.message.replace(/^Missing or unrecognized date: /, "Not a date: "); e.target.setAttribute("aria-invalid", "true"); }
  }, 350);
});
function onFallback() {
  const v = id => { const x = $(id).value; return x ? OC.parseDate(x) : null; };
  const a = v("#fbStart"), b = v("#fbEnd");
  S.fallback = { start: a !== null && b !== null ? a : null, end: a !== null && b !== null ? b : null };
  if (S.payload) { normalizeNow(); $("#fallback").hidden = false; rebuild(); }
}
$("#fbStart").addEventListener("change", onFallback);
$("#fbEnd").addEventListener("change", onFallback);

// view + week navigation
$$("#viewSeg button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
$("#wPrev").addEventListener("click", () => goWeek(S.week - 1, true));
$("#wNext").addEventListener("click", () => goWeek(S.week + 1, true));
$("#wToday").addEventListener("click", () => {
  const t = todayDay(), i = S.weeks.findIndex(w => t >= w.start && t < w.start + 7);
  if (i >= 0) goWeek(i, true); else toast("This week is outside the term.", null, 2200);
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!$("#pop").hidden) { closePop(); return; }
    const o = $$(".overlay").reverse().find(x => !x.hidden && x.id !== "welcomeDlg");
    if (o) o.hidden = true;
    return;
  }
  if (e.target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
  if ($$(".overlay").some(o => !o.hidden) || S.view !== "weeks" || !S.weeks.length) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); goWeek(S.week - 1, false); }
  else if (e.key === "ArrowRight") { e.preventDefault(); goWeek(S.week + 1, false); }
  else if (e.key === "t") $("#wToday").click();
});

// theme: the shared settings button (/design/ui.js) when it loaded, else a light/dark switch
function setTheme(t, save = true) {
  document.documentElement.dataset.theme = t;
  $("#btnTheme").textContent = t === "light" ? "Dark" : "Light";
  if (save) try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}
if (!(window.SiteDesign && SiteDesign.open)) {
  $("#btnTheme").hidden = false;
  $("#btnTheme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
  setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark", false);
}

// While a dialog is open the page behind it is inert, so Tab stays inside the dialog.
new MutationObserver(() => { $("#app").inert = $$(".overlay").some(o => !o.hidden); })
  .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

// start
S.parsed = { events: [], calendar: {} };
render();
open("#welcomeDlg");
