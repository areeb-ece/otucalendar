/* OTU/CALENDAR image export: the schedule as a picture (PNG or SVG), like PrereqFlow's.
 * Three views: every class on one week (with the weeks each alternating or part-term class
 * meets), one week of the preview, or every week. A week table under the schedule gives the
 * dates of every week and the exact day each irregular class meets, so the picture alone
 * says when everything happens. Built from the same calendar the preview shows; uses
 * app.js's state (S) and helpers, and js/image.js to draw. */
"use strict";

const IMG_SITE = "areeb-ece.github.io/otucalendar";
// The night and paper sheets, for when the theme files can't be read (see imagePalette).
const IMG_PALETTE = {
  dark: { bg: "#17191E", head: "#14161A", card: "#1C1F25", ink: "#F1EDE5", ink2: "#CAC5BB", ink3: "#A29E96", ink4: "#6E6B65", rule: "#2E323B", rule2: "#23262D", grid: "rgba(241,237,229,0.03)", accent: "#A3B8F0", danger: "#EE9585", hatch: "rgba(241,237,229,0.045)", c: ["#92B1EE", "#9FD4AB", "#F0B68E", "#C4A9F2", "#EACB76", "#7DCBC4", "#EBA3C6", "#F0A391"], mix: 0.16 },
  light: { bg: "#F6F3EC", head: "#FAF8F3", card: "#FFFFFF", ink: "#2F2D36", ink2: "#5D5967", ink3: "#6E6A76", ink4: "#B5B0B9", rule: "#DDD7CB", rule2: "#E8E3D9", grid: "rgba(47,45,54,0.035)", accent: "#4F67C6", danger: "#C2564A", hatch: "rgba(47,45,54,0.05)", c: ["#4E6BC8", "#3F8D5B", "#C5713C", "#7A58C4", "#A9831B", "#2B8A84", "#B6508A", "#C65A45"], mix: 0.11 },
};
// The dialog's choices; the course list resets when a different schedule is loaded.
const IMG = { scope: "term", courses: null, scale: 3, format: "png", theme: "current" };

// ── colours ──────────────────────────────────────────────────────────────
/** A sheet's colours from the shared palette, read through a hidden probe element (every
 * theme is also defined on [data-theme]); "current" reads the page itself. Theme colours
 * can be color-mix() and the like, so each is turned into plain rgb() through a canvas. */
function imagePalette(theme) {
  const root = document.documentElement, cur = theme === "current";
  const probe = h("div", { hidden: true });
  if (!cur) probe.dataset.theme = theme;
  document.body.append(probe);
  const cs = getComputedStyle(cur ? root : probe);
  const light = cur ? cs.colorScheme === "light" || root.dataset.scheme === "light" || root.dataset.theme === "light" : theme === "light";
  const base = IMG_PALETTE[light ? "light" : "dark"];
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const plain = c => {
    probe.style.color = "";
    probe.style.color = c;
    if (!probe.style.color) return "";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
  };
  const pick = (name, fallback) => { const v = cs.getPropertyValue(name).trim(); return (v && plain(v)) || fallback; };
  const mix = cur ? parseFloat(cs.getPropertyValue("--ev-mix")) / 100 : NaN;
  const P = {
    bg: pick("--sheet-2", base.bg), head: pick("--sheet", base.head), card: pick("--card", base.card),
    ink: pick("--ink", base.ink), ink2: pick("--ink-2", base.ink2), ink3: pick("--ink-3", base.ink3), ink4: pick("--ink-4", base.ink4),
    rule: pick("--rule", base.rule), rule2: pick("--rule-2", base.rule2), grid: pick("--grid", base.grid),
    accent: pick("--accent", base.accent), danger: pick("--danger", base.danger), hatch: pick("--hatch", base.hatch),
    c: base.c.map((c, i) => pick(`--c${i}`, c)), mix: mix > 0 ? mix : base.mix,
  };
  probe.remove();
  return P;
}
const rgbOf = c => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  return (String(c).match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
};
/** t of a over b, as the preview tints a class block with color-mix(). */
const mixRgb = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return `rgb(${x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(",")})`; };
/** A session's shade of its course colour, mixed as shadeCss() mixes it in the preview. */
const shadeRgb = (P, ci, si) => {
  const [p, to] = SHADES[si % SHADES.length], c = P.c[ci % 8];
  return to ? mixRgb(c, to === "--ink" ? P.ink : P.card, p / 100) : c;
};

// ── what goes in the picture ─────────────────────────────────────────────
const imgCodes = () => [...new Set(enabled().map(([m]) => m.code))].sort((a, b) => (S.colors.get(a) || 0) - (S.colors.get(b) || 0));
const fullWeek = start => { const a = OC.ymd(start), b = OC.ymd(start + (S.layout && S.layout.days === 7 ? 6 : 4)); return a.m === b.m ? `${MONTHS[a.m - 1]} ${a.d}–${b.d}` : `${MONTHS[a.m - 1]} ${a.d}–${MONTHS[b.m - 1]} ${b.d}`; };

function imageScopes() {
  const w = S.weeks[S.week];
  return [
    { id: "term", label: "Whole term", hint: "Every class on one week. Classes that don't meet every week are lettered, and the week table says the exact dates they meet." },
    { id: "week", label: w ? `Week ${S.week + 1}` : "This week", hint: w ? `Week ${S.week + 1} (${weekRange(w.start)}) as the preview shows it, skipped days hatched.` : "" },
    { id: "all", label: `All ${S.weeks.length} weeks`, hint: `Each of the ${S.weeks.length} weeks as the preview shows them, side by side.` },
  ];
}

/** The included classes (a bi-weekly lab is one meeting per date in Banner; they're one
 * class here), each with what the picture needs: its week pattern, its bi-weekly set, and a
 * letter when it doesn't meet every week. */
function imageModel(courses) {
  const on = enabled();
  const cp = OC.classPatterns(on.map(([m]) => m), S.skip);
  let n = 0;
  const pats = cp.classes.map(p => {
    const [m] = on[p.members[0]];
    let title = `${m.code} · ${m.kind}`;
    try { title = OC.renderEvent(m, S.style).title; } catch (e) { /* the template error is shown on the page */ }
    return { m, mis: p.members.map(k => on[k][1]), p, set: p.set, title, keep: courses.has(m.code), color: S.colors.get(m.code) || 0, shade: shadeOf(m) };
  });
  for (const x of pats) if (x.keep && !x.p.weekly) { x.tag = String.fromCharCode(65 + n % 26) + (n >= 26 ? Math.floor(n / 26) + 1 : ""); n++; }
  const byMeeting = new Map();
  for (const x of pats) for (const mi of x.mis) byMeeting.set(mi, x);
  return { weeks: cp.weeks, sets: cp.sets, pats: pats.filter(x => x.keep), byMeeting };
}
/** A class's note on its block: "bi-weekly · set 1", or the weeks of a part-term class. */
const imgNote = (x, M) => !x.tag ? "" : x.set ? (M.sets > 1 ? `bi-weekly · set ${x.set}` : "bi-weekly") : OC.weekList(x.p.weeks);
/** Set 1 striped, set 2 dotted, in the course colour, as the preview draws them. */
function drawSetPattern(ops, x, y, w, h, set, color, a = 0.45) {
  if (set === 1) ops.push({ t: "path", d: OImage.hatch(x, y, w, h, 7), stroke: color, sw: 1.4, a });
  else if (set === 2) ops.push({ t: "path", d: OImage.dots(x, y, w, h, 6), stroke: color, sw: 2.6, a: Math.min(1, a + 0.15) });
}

// ── drawing ──────────────────────────────────────────────────────────────
const PAD = 24;

/** One week sheet: hour gutter, day headers and the class blocks. Returns its height. */
function drawWeekSheet(ops, P, x0, y0, g) {
  const { days, dayW, hour, h0, h1, gut } = g;
  const headH = g.start === null ? 30 : 40, bodyH = (h1 - h0) * hour, w = gut + days * dayW, H = headH + bodyH;
  ops.push({ t: "rect", x: x0, y: y0, w, h: H, r: 10, fill: P.head });
  // skipped days: the preview's hatch, under everything else
  for (let d = 0; d < days; d++) {
    if (g.start === null || !S.skip.has(g.start + d)) continue;
    const cx = x0 + gut + d * dayW;
    ops.push({ t: "path", d: OImage.hatch(cx, y0 + headH, dayW, bodyH, 9), stroke: P.hatch, sw: 3 });
    ops.push({ t: "text", x: cx + dayW / 2, y: y0 + headH + 16, text: "Skipped", size: 10.5, weight: 600, color: P.ink2, anchor: "middle" });
  }
  for (let hr = h0; hr <= h1; hr++) {
    const y = y0 + headH + (hr - h0) * hour;
    if (hr > h0 && hr < h1) {
      ops.push({ t: "path", d: `M${x0 + gut},${y} H${x0 + w}`, stroke: P.rule2, sw: 1 });
      ops.push({ t: "text", x: x0 + gut - 7, y: y + 3.5, text: `${hr % 12 || 12}${hr < 12 ? "a" : "p"}`, size: 10, color: P.ink3, anchor: "end", mono: true });
    }
    if (hr < h1) ops.push({ t: "path", d: `M${x0 + gut},${y + hour / 2} H${x0 + w}`, stroke: P.grid, sw: 1 });
  }
  ops.push({ t: "path", d: `M${x0},${y0 + headH} H${x0 + w}`, stroke: P.rule, sw: 1 });
  for (let d = 0; d < days; d++) {
    const cx = x0 + gut + d * dayW;
    ops.push({ t: "path", d: `M${cx},${y0} V${y0 + H}`, stroke: P.rule2, sw: 1 });
    ops.push({ t: "text", x: cx + 8, y: y0 + 18, text: DAYS[d], size: 12, weight: 600, color: P.ink });
    if (g.start !== null) {
      const day = g.start + d, skipped = S.skip.has(day);
      ops.push({ t: "text", x: cx + 8, y: y0 + 32, text: OImage.fit(skipped ? `${dayShort(day)} · skipped` : dayShort(day), dayW - 14, 10, 400, true), size: 10, color: skipped ? P.ink2 : P.ink3, mono: true });
    }
  }
  for (let d = 0; d < days; d++) {
    const col = g.blocks.filter(b => b.d === d);
    layoutDay(col).forEach(b => {
      const cw = dayW / b.n;
      const bx = x0 + gut + d * dayW + b.c * cw + 3, bw = cw - 6;
      const by = y0 + headH + (b.s - h0 * 60) / 60 * hour + 1, bh = Math.max(16, (b.e - b.s) / 60 * hour - 2);
      drawBlock(ops, P, bx, by, bw, bh, b, g);
    });
  }
  const allSkipped = g.start !== null && [...Array(days).keys()].every(d => S.skip.has(g.start + d));
  if (!g.blocks.length && !allSkipped) ops.push({ t: "text", x: x0 + gut + 10, y: y0 + headH + 38, text: g.empty || "No classes this week.", size: 11, color: P.ink3 });
  ops.push({ t: "rect", x: x0, y: y0, w, h: H, r: 10, stroke: P.rule2, sw: 1 });
  return H;
}

// A class block as the preview draws it: tinted by its session's shade of the course colour,
// with a 3px edge in that shade.
function drawBlock(ops, P, x, y, w, h, b, g) {
  const c = shadeRgb(P, b.color, b.shade);
  ops.push({ t: "rect", x, y, w, h, r: 5, fill: mixRgb(c, P.card, P.mix) });
  if (b.set) drawSetPattern(ops, x + 3, y + 1, w - 4, h - 2, b.set, c);
  ops.push({ t: "rect", x, y, w, h, r: 5, stroke: c, sw: 1, a: 0.5 });
  ops.push({ t: "rect", x, y, w: 3, h, r: 1.5, fill: c });
  const small = g.small, pad = 7, inner = w - pad - 5;
  let tagW = 0;
  if (b.tag) { // the letter that finds this class in the week table
    tagW = OImage.measure(b.tag, small ? 9 : 10, 700, true) + 9;
    ops.push({ t: "rect", x: x + w - tagW - 3, y: y + 3, w: tagW, h: small ? 12 : 14, r: 3.5, fill: c, a: 0.3 });
    ops.push({ t: "text", x: x + w - 3 - tagW / 2, y: y + (small ? 12.5 : 13.5), text: b.tag, size: small ? 9 : 10, weight: 700, color: P.ink, anchor: "middle", mono: true });
  }
  // Lines in order of importance; whichever fit are drawn, in reading order.
  const ts = small ? 10 : 11.5, ss = small ? 9 : 10.5, lh = ts + 3, sh = ss + 3.5;
  const title = OImage.wrap(b.title, inner - (tagW ? tagW + 2 : 0), ts, 600, 2);
  const cand = [
    { k: 0, pr: 0, h: lh, text: title[0], size: ts, weight: 600, color: P.ink, cut: tagW },
    { k: 1, pr: 3, h: lh, text: title[1], size: ts, weight: 600, color: P.ink },
    { k: 2, pr: 1, h: sh, text: b.time, size: ss, color: P.ink2, mono: true },
    { k: 3, pr: 2, h: sh, text: b.note, size: ss, color: P.ink2 },
    { k: 4, pr: 4, h: sh, text: b.room, size: ss, color: P.ink2 },
  ].filter(l => l.text);
  let room = h - 5;
  const shown = [];
  for (const l of [...cand].sort((p, q) => p.pr - q.pr)) if (l.h <= room) { shown.push(l); room -= l.h; }
  const first = shown.find(l => l.k === 0);
  if (first && title[1] && !shown.some(l => l.k === 1)) first.text = OImage.fit(title.join(" "), inner - (tagW ? tagW + 2 : 0), ts, 600);
  let ty = y + 3;
  for (const l of shown.sort((p, q) => p.k - q.k)) {
    ty += l.h;
    const text = l.k > 1 ? OImage.fit(l.text, inner, l.size, l.weight || 400, l.mono) : l.text;
    ops.push({ t: "text", x: x + pad, y: ty - 3, text, size: l.size, weight: l.weight, color: l.color, mono: l.mono });
  }
}

/** The week table: each week's dates, then a row per lettered class with the day of the
 * month it meets that week, and a row of skipped dates. Returns its height. */
function drawWeekTable(ops, P, x0, y0, W, M, hiWeek) {
  const rows = M.pats.filter(x => x.tag);
  const skipDays = M.weeks.map(w => [...Array(7).keys()].map(d => w + d).filter(d => S.skip.has(d) && OC.weekday(d) < (S.layout ? S.layout.days : 5)));
  const anySkip = skipDays.some(s => s.length);
  const label = x => `${x.m.code} ${OC.valuesFor(x.m).TypeShort} · ${x.m.days.map(d => DAYS[d]).join("/")} ${timeRange(x.m.startTime, x.m.endTime)}`;
  const labelW = Math.round(Math.min(W * 0.34, Math.max(170, ...rows.map(x => OImage.measure(label(x), 10.5) + 46))));
  const perRow = Math.max(1, Math.min(M.weeks.length, Math.floor((W - labelW) / 48)));
  const chunks = [];
  for (let i = 0; i < M.weeks.length; i += perRow) chunks.push([i, Math.min(M.weeks.length, i + perRow)]);
  const cellW = Math.min(96, (W - labelW) / Math.min(perRow, M.weeks.length));
  const headH = 50, rowH = 21;
  let y = y0;
  ops.push({ t: "text", x: x0, y: y + 12, text: "WEEKS", size: 10.5, weight: 700, color: P.ink3, ls: 1.4 });
  ops.push({ t: "text", x: x0 + OImage.measure("WEEKS", 10.5, 700) + 24, y: y + 12, text: rows.length
    ? "Day numbers are the dates each lettered class meets that week. Classes without a letter meet every week."
    : `Every class meets every week, W1–W${M.weeks.length}.`, size: 11, color: P.ink2 });
  y += 22;
  const rwi = S.readingWeek === null ? -1 : M.weeks.indexOf(S.readingWeek);
  if (M.sets || rwi >= 0) { // the key: a swatch per bi-weekly set and the weeks it meets, and reading week
    let kx = x0;
    for (let set = 1; set <= M.sets; set++) {
      const weeks = [...new Set(rows.filter(x => x.set === set).flatMap(x => x.p.weeks))];
      const text = `${M.sets > 1 ? `Bi-weekly set ${set}` : "Bi-weekly"}: ${OC.weekNames(weeks)}`;
      ops.push({ t: "rect", x: kx, y: y + 1, w: 22, h: 14, r: 3, fill: P.card });
      drawSetPattern(ops, kx + 1, y + 2, 20, 12, set, P.ink3, 0.8);
      ops.push({ t: "rect", x: kx, y: y + 1, w: 22, h: 14, r: 3, stroke: P.rule, sw: 1 });
      ops.push({ t: "text", x: kx + 30, y: y + 12, text, size: 11, color: P.ink2 });
      kx += 30 + OImage.measure(text, 11) + 26;
    }
    if (rwi >= 0) {
      const text = `Reading week: W${rwi + 1}, ${fullWeek(S.readingWeek)} (no classes)`;
      ops.push({ t: "rect", x: kx, y: y + 1, w: 22, h: 14, r: 3, fill: P.accent, a: 0.18 });
      ops.push({ t: "rect", x: kx, y: y + 1, w: 22, h: 14, r: 3, stroke: P.accent, sw: 1, dash: [3, 2] });
      ops.push({ t: "text", x: kx + 30, y: y + 12, text, size: 11, color: P.ink2 });
    }
    y += 22;
  }
  for (const [a, b] of chunks) {
    const n = b - a, tableH = headH + (rows.length + (anySkip ? 1 : 0)) * rowH;
    ops.push({ t: "rect", x: x0, y, w: labelW + n * cellW, h: tableH, r: 8, fill: P.head });
    for (let i = a; i < b; i++) {
      const cx = x0 + labelW + (i - a) * cellW;
      if (i === hiWeek) ops.push({ t: "rect", x: cx, y, w: cellW, h: tableH, fill: P.accent, a: 0.12 });
      if (M.weeks[i] === S.readingWeek) ops.push({ t: "rect", x: cx + 1, y: y + 1, w: cellW - 2, h: tableH - 2, r: 4, stroke: P.accent, sw: 1, dash: [3, 2] });
      ops.push({ t: "path", d: `M${cx},${y} V${y + tableH}`, stroke: P.rule2, sw: 1 });
      ops.push({ t: "text", x: cx + 7, y: y + 16, text: `W${i + 1}`, size: 11.5, weight: 700, color: i === hiWeek ? P.accent : P.ink, mono: true });
      // "Sep 28" over "–Oct 2", or "Sep 7" over "–11": the week's first and last class day
      const [from, to] = fullWeek(M.weeks[i]).split("–");
      ops.push({ t: "text", x: cx + 7, y: y + 31, text: from, size: 10, color: P.ink3, mono: true });
      ops.push({ t: "text", x: cx + 7, y: y + 43, text: "–" + to, size: 10, color: P.ink3, mono: true });
    }
    ops.push({ t: "path", d: `M${x0},${y + headH} H${x0 + labelW + n * cellW}`, stroke: P.rule, sw: 1 });
    ops.push({ t: "text", x: x0 + 10, y: y + 16, text: "Week", size: 10.5, weight: 600, color: P.ink2 });
    ops.push({ t: "text", x: x0 + 10, y: y + 31, text: "Monday to " + (S.layout && S.layout.days === 7 ? "Sunday" : "Friday"), size: 10.5, color: P.ink3 });
    let ry = y + headH;
    for (const x of rows) {
      const c = shadeRgb(P, x.color, x.shade);
      ops.push({ t: "rect", x: x0 + 8, y: ry + 4, w: 20, h: 14, r: 3.5, fill: c, a: 0.3 });
      if (x.set) drawSetPattern(ops, x0 + 9, ry + 5, 18, 12, x.set, c, 0.6);
      ops.push({ t: "text", x: x0 + 18, y: ry + 15, text: x.tag, size: 10, weight: 700, color: P.ink, anchor: "middle", mono: true });
      ops.push({ t: "text", x: x0 + 34, y: ry + 15, text: OImage.fit(label(x), labelW - 42, 10.5), size: 10.5, color: P.ink2 });
      for (let i = a; i < b; i++) {
        const cx = x0 + labelW + (i - a) * cellW;
        const met = x.p.days[i].map(d => ({ d, skip: false })).concat(x.p.skipped[i].map(d => ({ d, skip: true }))).sort((p, q) => p.d - q.d);
        // the day of the month of each meeting that week; a skipped one struck through
        const parts = [];
        for (const { d, skip } of met) {
          const next = [...parts, ...(parts.length ? [{ text: " " }] : []), skip ? { text: String(OC.ymd(d).d), color: P.danger, strike: P.danger } : { text: String(OC.ymd(d).d), weight: 700 }];
          if (OImage.measureParts(next, 10.5, 400, true) > cellW - 10) break;
          parts.splice(0, parts.length, ...next);
        }
        if (parts.length) ops.push({ t: "text", x: cx + 7, y: ry + 15, parts, size: 10.5, color: P.ink, mono: true });
      }
      ops.push({ t: "path", d: `M${x0},${ry + rowH} H${x0 + labelW + n * cellW}`, stroke: P.rule2, sw: 1 });
      ry += rowH;
    }
    if (anySkip) {
      ops.push({ t: "text", x: x0 + 10, y: ry + 15, text: "Skipped (no classes)", size: 10.5, weight: 600, color: P.danger });
      for (let i = a; i < b; i++) {
        const s = skipDays[i];
        if (!s.length) continue;
        const cx = x0 + labelW + (i - a) * cellW;
        if (M.weeks[i] === S.readingWeek) { ops.push({ t: "text", x: cx + 7, y: ry + 15, text: OImage.fit("reading", cellW - 10, 10.5, 600), size: 10.5, weight: 600, color: P.accent }); continue; }
        const first = OC.ymd(s[0]).d, last = OC.ymd(s[s.length - 1]).d;
        const t = s.length === 1 ? String(first) : s.every((d, k) => !k || d === s[k - 1] + 1) ? `${first}–${last}` : s.map(d => OC.ymd(d).d).join(" ");
        ops.push({ t: "text", x: cx + 7, y: ry + 15, text: OImage.fit(t, cellW - 10, 10.5, 400, true), size: 10.5, color: P.danger, mono: true });
      }
      ry += rowH;
    }
    ops.push({ t: "rect", x: x0, y, w: labelW + n * cellW, h: tableH, r: 8, stroke: P.rule2, sw: 1 });
    y += tableH + 12;
  }
  return y - y0;
}

/** layout + options → drawing operations (see js/image.js). */
function buildImageSpec(o) {
  const P = imagePalette(o.theme);
  const M = imageModel(o.courses);
  if (!M.pats.length) throw new Error("Pick at least one course.");
  const termDays = M.pats.some(x => x.m.days.some(d => d >= 5)) ? 7 : 5;
  const block = (x, s, e, extra) => ({ s, e, color: x.color, shade: x.shade, tag: x.tag, set: x.set, title: x.title, time: timeRange(s % 1440, e % 1440 || 1440), room: o.rooms ? x.p.rooms.join(" / ") : "", note: imgNote(x, M), ...extra });
  // the sheets to draw, each with its blocks
  let sheets;
  if (o.scope === "term") {
    sheets = [{ start: null, blocks: M.pats.flatMap(x => x.m.days.filter(d => d < termDays).map(d => block(x, x.m.startTime, x.m.endTime < x.m.startTime ? 1440 : x.m.endTime, { d }))) }];
  } else {
    const list = o.scope === "week" ? [S.week] : S.weeks.map((_, i) => i);
    sheets = list.map(i => ({
      index: i, start: S.weeks[i].start,
      blocks: S.weeks[i].events.map(e => ({ e, x: M.byMeeting.get(e.mi) })).filter(({ x }) => x && x.keep)
        .map(({ e, x }) => block(x, e.s, e.e, { d: OC.weekday(e.day), title: e.summary || x.title, room: o.rooms ? e.location || (e.description || "").split("\n")[0] : "" })),
    }));
  }
  const days = o.scope === "term" ? termDays : S.layout.days;
  const all = sheets.flatMap(s => s.blocks);
  let h0 = 8, h1 = 18;
  if (all.length) {
    h0 = Math.floor(Math.min(...all.map(b => b.s)) / 60);
    h1 = Math.ceil(Math.max(...all.map(b => b.e)) / 60);
    if (h1 - h0 < 6) h1 = Math.min(24, h0 + 6);
    if (h1 - h0 < 6) h0 = Math.max(0, h1 - 6);
  }
  const many = sheets.length > 1;
  const g = many
    ? { days, dayW: days === 7 ? 88 : 108, hour: 38, gut: 34, h0, h1, small: true }
    : { days, dayW: days === 7 ? 142 : 176, hour: 54, gut: 46, h0, h1, small: false };
  const sheetW = g.gut + days * g.dayW, gap = 22;
  const perRow = many ? (days === 7 ? 2 : 3) : 1;
  const W = Math.max(760, 2 * PAD + perRow * sheetW + (perRow - 1) * gap);
  const ops = [], codes = imgCodes().filter(c => o.courses.has(c));

  // title block and the course list
  let y = 0;
  const titleOps = [];
  if (o.title) {
    const titles = new Map(M.pats.map(x => [x.m.code, x.m.title]));
    // the course list wraps under the title: a swatch per session (its shade), code, name
    const items = codes.map(code => {
      const shades = [...new Set(M.pats.filter(x => x.m.code === code).map(x => x.shade))].sort((a, b) => a - b);
      return { code, name: titles.get(code) || "", color: S.colors.get(code) || 0, shades, sw: shades.length > 1 ? shades.length * 11 - 2 : 16 };
    });
    const lines = [[]];
    let lx = PAD;
    for (const it of items) {
      const w = it.sw + 10 + OImage.measure(it.code, 11.5, 700, true) + 8 + Math.min(220, OImage.measure(it.name, 11.5)) + 22;
      if (lx + w > W - PAD && lines[lines.length - 1].length) { lines.push([]); lx = PAD; }
      lines[lines.length - 1].push({ ...it, x: lx }); lx += w;
    }
    const titleH = 88 + lines.length * 20 + 8;
    titleOps.push({ t: "rect", x: 0, y: 0, w: W, h: titleH, fill: P.head });
    titleOps.push({ t: "path", d: `M0,${titleH - 1} H${W}`, stroke: P.ink, sw: 2 });
    titleOps.push({ t: "text", x: PAD, y: 34, size: 19, weight: 700, color: P.ink, ls: 3, mono: true, parts: [{ text: "OTU" }, { text: "/", weight: 400, color: P.accent }, { text: "CALENDAR" }] });
    const term = termName(S.term) || S.term || "Term unknown";
    const w = S.weeks[S.week];
    const what = o.scope === "term" ? "every class on one week" : o.scope === "week" ? `week ${S.week + 1} · ${weekRange(w.start)}` : "every week";
    titleOps.push({ t: "text", x: PAD, y: 57, text: `${term} · ${what}`, size: 13, weight: 600, color: P.ink2 });
    const meta = `${plural(codes.length, "course")} · Toronto time`;
    titleOps.push({ t: "text", x: PAD, y: 76, text: OImage.fit(meta, W - 2 * PAD - 230, 11.5), size: 11.5, color: P.ink3 });
    lines.forEach((line, li) => {
      const ly = 88 + li * 20 + 14;
      for (const it of line) {
        const sw = it.shades.length > 1 ? 9 : 16;
        it.shades.forEach((si, j) => {
          const c = shadeRgb(P, it.color, si), sx = it.x + j * 11;
          titleOps.push({ t: "rect", x: sx, y: ly - 9, w: sw, h: 11, r: 2, fill: mixRgb(c, P.card, P.mix) });
          titleOps.push({ t: "rect", x: sx, y: ly - 9, w: 3, h: 11, r: 1, fill: c });
          titleOps.push({ t: "rect", x: sx, y: ly - 9, w: sw, h: 11, r: 2, stroke: c, sw: 1, a: 0.55 });
        });
        titleOps.push({ t: "text", x: it.x + it.sw + 8, y: ly, size: 11.5, color: P.ink2, parts: [{ text: it.code, weight: 700, color: P.ink, mono: true }, { text: "  " + OImage.fit(it.name, 220, 11.5) }] });
      }
    });
    // credit badge, top right, as PrereqFlow's
    const by = "made by areeb";
    // a little slack, for an SVG shown in a wider stand-in for mononoki
    const bw = Math.max(OImage.measure(by, 15, 700), OImage.measure(IMG_SITE, 12, 400, true) * 1.12) + 30;
    const bx = W - PAD - bw;
    titleOps.push({ t: "rect", x: bx, y: 16, w: bw, h: 52, r: 12, fill: P.accent, a: 0.12 });
    titleOps.push({ t: "rect", x: bx, y: 16, w: bw, h: 52, r: 12, stroke: P.accent, sw: 1.2, a: 0.7 });
    titleOps.push({ t: "text", x: bx + 15, y: 38, text: by, size: 15, weight: 700, color: P.ink });
    titleOps.push({ t: "text", x: bx + 15, y: 57, text: IMG_SITE, size: 12, color: P.accent, mono: true });
    y = titleH;
  }
  y += PAD;

  // the week sheets
  sheets.forEach((s, i) => {
    const col = i % perRow, x = PAD + col * (sheetW + gap);
    let top = y;
    if (many) { // each week's name over its sheet
      ops.push({ t: "text", x, y: top + 12, size: 12, color: P.ink3, parts: [{ text: `W${s.index + 1}`, weight: 700, color: P.ink, mono: true }, { text: `  ${fullWeek(s.start)}` }] });
      top += 20;
    }
    const sh = drawWeekSheet(ops, P, x, top, { ...g, start: s.start, blocks: s.blocks, empty: S.skip.size ? "No classes this week (skipped)." : "No classes this week." });
    if (col === perRow - 1 || i === sheets.length - 1) y = top + sh + (many ? 22 : PAD);
  });

  // the week table
  if (o.weeks) y += drawWeekTable(ops, P, PAD, y, W - 2 * PAD, M, o.scope === "week" ? S.week : -1) + PAD - 12;

  // footer: the credit, always
  const footH = 40, fy = y, ly = fy + 25;
  ops.push({ t: "rect", x: 0, y: fy, w: W, h: footH, fill: P.head });
  ops.push({ t: "path", d: `M0,${fy + 0.5} H${W}`, stroke: P.rule2, sw: 1 });
  const credit = [{ text: "made by areeb · ", weight: 700, color: P.ink2 }, { text: IMG_SITE, color: P.accent, mono: true }];
  const credW = OImage.measureParts(credit, 12);
  ops.push({ t: "text", x: W - PAD, y: ly, size: 12, color: P.ink2, anchor: "end", parts: credit });
  ops.push({ t: "text", x: PAD, y: ly, text: OImage.fit("Not an official Ontario Tech schedule; check yours for changes.", W - 3 * PAD - credW, 11), size: 11, color: P.ink3 });
  return { width: W, height: fy + footH, bg: P.bg, ops: [...ops, ...titleOps] };
}

// ── the dialog ───────────────────────────────────────────────────────────
function imageOptions() {
  return { scope: IMG.scope, courses: IMG.courses, scale: IMG.scale, format: IMG.format, theme: IMG.theme,
    title: $("#imgTitle").checked, weeks: $("#imgWeeks").checked, rooms: $("#imgRooms").checked };
}
function segOf(sel, options, value, onPick) {
  const el = $(sel);
  el.replaceChildren(...options.map(([v, label]) => h("button", { type: "button", role: "radio", "data-v": v, "aria-checked": String(String(v) === String(value)), onclick: () => onPick(v) }, label)));
}
function openImageDlg() {
  if (!S.ics) return;
  const codes = imgCodes();
  if (!IMG.courses || ![...IMG.courses].every(c => codes.includes(c)) || !IMG.courses.size) IMG.courses = new Set(codes);
  if (IMG.scope !== "term" && !S.weeks.length) IMG.scope = "term";
  $("#imgStatus").textContent = "";
  $("#imgStatus").classList.remove("err");
  drawImageDlg();
  open("#imageDlg");
}
function drawImageDlg() {
  segOf("#imgScope", imageScopes().map(s => [s.id, s.label]), IMG.scope, v => { IMG.scope = v; drawImageDlg(); });
  $("#imgScopeHint").textContent = imageScopes().find(s => s.id === IMG.scope).hint;
  segOf("#imgFormat", [["png", "PNG"], ["svg", "SVG"]], IMG.format, v => { IMG.format = v; drawImageDlg(); });
  segOf("#imgScale", [[2, "2×"], [3, "3×"], [4, "4×"], [6, "6×"]], IMG.scale, v => { IMG.scale = v; drawImageDlg(); });
  $$("#imgScale button").forEach(b => (b.disabled = IMG.format === "svg"));
  segOf("#imgTheme", [["current", "Current theme"], ["dark", "Dark"], ["light", "Light / print"]], IMG.theme, v => { IMG.theme = v; drawImageDlg(); });
  const box = $("#imgCourses");
  const titles = new Map(S.meetings.map(m => [m.code, m.title]));
  box.replaceChildren(...imgCodes().map(code => h("label", { class: "sd-check", vars: { "--cc": `var(--c${(S.colors.get(code) || 0) % 8})` }, title: titles.get(code) || "" },
    h("input", { type: "checkbox", checked: IMG.courses.has(code), onchange: e => { e.target.checked ? IMG.courses.add(code) : IMG.courses.delete(code); updateImageDims(); } }),
    h("span", { class: "sw", "aria-hidden": "true" }), h("b", { text: code }))));
  updateImageDims();
}
function updateImageDims() {
  const o = imageOptions(), go = $("#imgGo");
  try {
    const spec = buildImageSpec(o);
    const fit = OImage.fitScale(spec.width, spec.height, o.scale);
    const px = sc => `${Math.round(spec.width * sc).toLocaleString()} × ${Math.round(spec.height * sc).toLocaleString()} px`;
    $("#imgDims").textContent = o.format === "svg"
      ? `Vector · ${Math.round(spec.width)} × ${Math.round(spec.height)} units (scales without loss)`
      : `${px(fit)}${fit < o.scale ? ` · reduced from ${o.scale}× to stay within the browser's canvas limits` : ""}`;
    go.disabled = false;
  } catch (e) {
    $("#imgDims").textContent = e.message;
    go.disabled = true;
  }
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function runImageExport() {
  const o = imageOptions(), btn = $("#imgGo"), st = $("#imgStatus");
  btn.disabled = true;
  st.classList.remove("err");
  st.textContent = "Drawing…";
  try {
    const spec = buildImageSpec(o);
    const base = fileName("x").replace(/\.x$/, "") + (o.scope === "term" ? "-schedule" : o.scope === "week" ? `-week-${S.week + 1}` : "-all-weeks");
    if (o.format === "svg") {
      saveBlob(new Blob([OImage.toSVG(spec)], { type: "image/svg+xml;charset=utf-8" }), base + ".svg");
      toast(`Saved ${esc(base)}.svg. Its text uses mononoki and Libre Franklin where they're installed, otherwise similar system fonts (this page can't read font files to embed them).`, null, 6500);
    } else {
      const r = await OImage.toPNG(spec, o.scale);
      saveBlob(r.blob, base + ".png");
      toast(`Saved ${esc(base)}.png · ${r.w.toLocaleString()} × ${r.h.toLocaleString()} px`, null, 4500);
    }
    close("#imageDlg");
    st.textContent = "";
  } catch (e) {
    st.textContent = (e && e.message) || String(e);
    st.classList.add("err");
  } finally {
    btn.disabled = false;
  }
}

$("#btnImage").addEventListener("click", openImageDlg);
$("#imgGo").addEventListener("click", runImageExport);
for (const id of ["#imgTitle", "#imgWeeks", "#imgRooms"]) $(id).addEventListener("change", updateImageDims);
