/* OTU/CALENDAR image export: draws a flat list of drawing operations to a high-resolution
 * canvas (PNG) or to a standalone SVG document. The same format as PrereqFlow's image.js,
 * with two faces: Libre Franklin for text and mononoki for codes, times and dates.
 *
 * spec = { width, height, bg, ops: [...] } in CSS pixels, where each op is one of
 *   { t: "rect",  x, y, w, h, r?, fill?, stroke?, sw?, dash? }   r = corner radius
 *   { t: "path",  d, stroke?, sw?, dash?, fill? }                d is SVG path data
 *   { t: "text",  x, y, text, size, weight?, color, anchor?, ls?, mono? }   y = baseline
 * and may carry `a` (opacity, 0–1). A text op can be a run of parts instead of `text`:
 *   parts: [{ text, weight?, color?, mono?, strike? }]   (strike: a line through it)
 * which an SVG keeps as one line of <tspan>s, so they stay apart in whatever font it's
 * shown with. */
const OImage = (() => {
  "use strict";

  const TEXT = '"Libre Franklin", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const MONO = '"mononoki", ui-monospace, Menlo, Consolas, monospace';
  // Browsers refuse canvases past ~16k px per side; Safari also caps the total area.
  const MAX_SIDE = 16000, MAX_AREA = 120e6;

  const fontStr = (size, weight = 400, mono = false) => `${weight} ${size}px ${mono ? MONO : TEXT}`;

  let measureCtx = null;
  function measure(text, size, weight = 400, mono = false) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = fontStr(size, weight, mono);
    return measureCtx.measureText(String(text)).width;
  }
  /** The width of a run of parts (see the text op). */
  const measureParts = (parts, size, weight = 400, mono = false) => parts.reduce((t, p) => t + measure(p.text, size, p.weight || weight, p.mono ?? mono), 0);
  /** The longest start of `text` that fits in maxW, with an ellipsis when cut. */
  function fit(text, maxW, size, weight = 400, mono = false) {
    let s = String(text);
    if (measure(s, size, weight, mono) <= maxW) return s;
    while (s.length > 1 && measure(s + "…", size, weight, mono) > maxW) s = s.slice(0, -1);
    return s.length > 1 ? s.trimEnd() + "…" : "";
  }
  /** Word-wrap to at most maxLines lines of maxW px; the last line gets an ellipsis. */
  function wrap(text, maxW, size, weight = 400, maxLines = 2, mono = false) {
    if (maxLines <= 1) return [fit(text, maxW, size, weight, mono)];
    const words = String(text).split(/\s+/).filter(Boolean), lines = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const next = cur ? cur + " " + words[i] : words[i];
      if (!cur || measure(next, size, weight, mono) <= maxW) { cur = next; continue; }
      lines.push(cur); cur = words[i];
      if (lines.length === maxLines - 1) { cur = words.slice(i).join(" "); break; }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, maxLines).map((l, i, a) => (i === a.length - 1 ? fit(l, maxW, size, weight, mono) : l));
  }

  /** The largest scale ≤ wanted that keeps the canvas inside browser limits. */
  function fitScale(w, h, wanted) {
    const s = Math.min(wanted, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
    return Math.max(0.25, Math.floor(s * 100) / 100);
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (r && ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const want = [fontStr(12), fontStr(12, 600), fontStr(12, 700), fontStr(12, 400, true), fontStr(12, 700, true)];
    try { await Promise.all(want.map(f => document.fonts.load(f))); } catch (e) { /* system fonts then */ }
  }

  async function toCanvas(spec, scale) {
    await loadFonts();
    const cv = document.createElement("canvas");
    cv.width = Math.round(spec.width * scale);
    cv.height = Math.round(spec.height * scale);
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("This browser couldn't make a canvas that large.");
    ctx.scale(scale, scale);
    ctx.fillStyle = spec.bg;
    ctx.fillRect(0, 0, spec.width, spec.height);
    ctx.lineCap = "round";
    for (const op of spec.ops) {
      ctx.setLineDash(op.dash || []);
      ctx.globalAlpha = op.a == null ? 1 : op.a;
      if (op.t === "rect") {
        if (op.fill) { ctx.fillStyle = op.fill; rrect(ctx, op.x, op.y, op.w, op.h, op.r); ctx.fill(); }
        if (op.stroke) {
          const o = (op.sw || 1) / 2;
          ctx.strokeStyle = op.stroke; ctx.lineWidth = op.sw || 1;
          rrect(ctx, op.x + o, op.y + o, op.w - 2 * o, op.h - 2 * o, op.r ? Math.max(0, op.r - o) : 0); ctx.stroke();
        }
      } else if (op.t === "path") {
        const p = new Path2D(op.d);
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(p); }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.sw || 1; ctx.stroke(p); }
      } else if (op.t === "text") {
        const parts = (op.parts || [op]).map(p => ({ ...p, font: fontStr(op.size, p.weight || op.weight || 400, p.mono ?? op.mono) }));
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        if ("letterSpacing" in ctx) ctx.letterSpacing = (op.ls || 0) + "px";
        for (const p of parts) { ctx.font = p.font; p.w = ctx.measureText(p.text).width; }
        const total = parts.reduce((t, p) => t + p.w, 0);
        let x = op.anchor === "end" ? op.x - total : op.anchor === "middle" ? op.x - total / 2 : op.x;
        for (const p of parts) {
          ctx.font = p.font;
          ctx.fillStyle = p.color || op.color;
          ctx.fillText(p.text, x, op.y);
          if (p.strike) {
            ctx.strokeStyle = p.strike; ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.moveTo(x - 1, op.y - op.size * 0.33); ctx.lineTo(x + p.w + 1, op.y - op.size * 0.33); ctx.stroke();
          }
          x += p.w;
        }
        if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return cv;
  }

  const toBlob = cv => new Promise(res => cv.toBlob(b => res(b), "image/png"));
  /** PNG, stepping the scale down if the browser refuses a canvas that size. */
  async function toPNG(spec, wanted) {
    let scale = fitScale(spec.width, spec.height, wanted);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const cv = await toCanvas(spec, scale);
        const blob = await toBlob(cv);
        cv.width = cv.height = 0;
        if (blob && blob.size > 1000) return { blob, scale, w: Math.round(spec.width * scale), h: Math.round(spec.height * scale) };
      } catch (e) { /* try smaller */ }
      scale = Math.max(0.5, Math.floor(scale * 0.7 * 100) / 100);
    }
    throw new Error("The image is too large for this browser. Try a lower resolution, or fewer weeks.");
  }

  const x = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const n = v => Math.round(v * 100) / 100;
  /** A standalone SVG. The page can't read font files (its security policy allows no
   * connections), so the faces are named, not embedded. */
  function toSVG(spec) {
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(spec.width)}" height="${n(spec.height)}" viewBox="0 0 ${n(spec.width)} ${n(spec.height)}">`];
    out.push(`<style>text{font-family:${TEXT.replace(/"/g, "'")};white-space:pre;}.m{font-family:${MONO.replace(/"/g, "'")};}</style>`);
    out.push(`<rect width="100%" height="100%" fill="${spec.bg}"/>`);
    for (const op of spec.ops) {
      const alpha = op.a != null && op.a < 1 ? ` opacity="${n(op.a)}"` : "";
      const dash = (op.dash && op.dash.length ? ` stroke-dasharray="${op.dash.join(" ")}"` : "") + alpha;
      if (op.t === "rect") {
        const o = op.stroke ? (op.sw || 1) / 2 : 0;
        if (op.fill && op.stroke) out.push(`<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}"${op.r ? ` rx="${n(op.r)}"` : ""} fill="${op.fill}"${alpha}/>`);
        out.push(`<rect x="${n(op.x + o)}" y="${n(op.y + o)}" width="${n(op.w - 2 * o)}" height="${n(op.h - 2 * o)}"${op.r ? ` rx="${n(Math.max(0, op.r - o))}"` : ""} fill="${op.stroke ? "none" : op.fill || "none"}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${op.sw || 1}"` : ""}${dash}/>`);
      } else if (op.t === "path") {
        out.push(`<path d="${op.d}" fill="${op.fill || "none"}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${op.sw || 1}" stroke-linecap="round"` : ""}${dash}/>`);
      } else if (op.t === "text") {
        const anchor = op.anchor && op.anchor !== "start" ? ` text-anchor="${op.anchor}"` : "";
        const ls = op.ls ? ` letter-spacing="${op.ls}"` : "";
        const body = op.parts
          ? op.parts.map(p => `<tspan${p.mono ?? op.mono ? ' class="m"' : ""}${p.weight && p.weight !== (op.weight || 400) ? ` font-weight="${p.weight}"` : ""}${p.color ? ` fill="${p.color}"` : ""}${p.strike ? ' text-decoration="line-through"' : ""}>${x(p.text)}</tspan>`).join("")
          : x(op.text);
        out.push(`<text${op.mono ? ' class="m"' : ""} x="${n(op.x)}" y="${n(op.y)}" font-size="${op.size}"${op.weight && op.weight !== 400 ? ` font-weight="${op.weight}"` : ""} fill="${op.color}"${anchor}${ls}${alpha}>${body}</text>`);
      }
    }
    out.push("</svg>");
    return out.join("\n");
  }

  /** Diagonal hatch lines (like the preview's skipped days) inside a rectangle, as path data. */
  function hatch(x0, y0, w, h, step = 9) {
    const d = [];
    for (let c = step; c < w + h; c += step) {
      // the line x + y = c (in box coordinates), clipped to the box
      const ax = Math.min(c, w), ay = c - ax, by = Math.min(c, h), bx = c - by;
      d.push(`M${n(x0 + ax)},${n(y0 + ay)} L${n(x0 + bx)},${n(y0 + by)}`);
    }
    return d.join(" ");
  }

  /** A grid of dots inside a rectangle, as path data (zero-length strokes with round caps). */
  function dots(x0, y0, w, h, step = 6) {
    const d = [];
    for (let j = 0, y = y0 + step / 2; y < y0 + h; j++, y += step) {
      for (let x = x0 + (j % 2 ? step : step / 2); x < x0 + w; x += step) d.push(`M${n(x)},${n(y)} h0.01`);
    }
    return d.join(" ");
  }

  return { TEXT, MONO, measure, measureParts, fit, wrap, fitScale, toCanvas, toPNG, toSVG, hatch, dots };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OImage;
