/* The optional helper snippet. It is shown in full on the page so it can be read
 * before use. It runs on the signed-in schedule page at ssp.mycampus.ca, reads the
 * registered-course rows on screen, asks that same site for each section's meeting
 * times (the same request the page itself makes), and saves a .json file to the
 * computer. It sends nothing anywhere else. */
const OH = (() => {
  "use strict";
  const SOURCE = String.raw`(async () => {
  // OTU/CALENDAR helper: reads your schedule from this page and saves a .json file.
  // Same-site requests only; nothing is sent anywhere else.
  if (location.hostname !== "ssp.mycampus.ca") {
    alert("Open My course schedule on ssp.mycampus.ca (signed in), then run this again.");
    return;
  }
  const rows = [];
  for (const tr of document.querySelectorAll("tr")) {
    const row = {};
    for (const cell of tr.cells) {
      if (cell.tagName === "TD" && cell.hasAttribute("data-property")) {
        row[cell.getAttribute("data-property")] = cell.innerText.trim();
      }
    }
    if (/^\d{5}$/.test(row.courseReferenceNumber || "")) rows.push(row);
  }
  if (!rows.length) {
    alert("No registered courses on this page yet. Choose your term, wait for the course list, then run this again.");
    return;
  }
  let term = ["#lookupFilter", "#term", "[name=term]", "[name=termCode]"]
    .flatMap(s => [...document.querySelectorAll(s)])
    .map(e => e.value || "").find(v => /^\d{6}$/.test(v)) || "";
  if (!term) term = (prompt("Six-digit term code (e.g. 202609 = Fall 2026):") || "").trim();
  if (!/^\d{6}$/.test(term)) return;
  const headers = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  const token = document.querySelector('meta[name="synchronizer-token"]');
  if (token) headers["X-Synchronizer-Token"] = token.content;
  const base = location.pathname.split("/ssb/")[0] + "/ssb";
  let missing = 0;
  for (const row of rows) {
    const q = new URLSearchParams({ term, courseReferenceNumber: row.courseReferenceNumber });
    try {
      const r = await fetch(base + "/searchResults/getFacultyMeetingTimes?" + q, { credentials: "same-origin", headers });
      if (!r.ok) throw new Error(r.status);
      row.meetingsFaculty = (await r.json()).fmt || [];
    } catch (e) { missing++; }
    row.term = term;
  }
  const file = new Blob([JSON.stringify({ format: "banner-capture-v1", term, courses: rows }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = "ontario-tech-" + term + ".json";
  a.click();
  if (missing) alert("Saved, but meeting times could not be read for " + missing + " section(s).");
})();`;

  /** A javascript: bookmark with the same code (comments and indentation removed). */
  function bookmarklet() {
    const min = SOURCE.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//")).join(" ");
    return "javascript:" + encodeURIComponent(min);
  }
  return { SOURCE, bookmarklet };
})();
if (typeof module !== "undefined" && module.exports) module.exports = OH;
