# CLAUDE.md

## Display rules

No inferable bloat in the UI or in exports (image, SVG, PDF, print, text). Displayed
text is bloat if any of these apply:

1. **Inferable from the view:** it restates what the viewer can already see or count on
   the same screen or export (totals of visible cards, per-column counts, "7 to go" next
   to a list of those 7).
2. **Not about this view:** it describes data that isn't shown (whole-sheet totals on an
   export of the goal path). Any number that stays is computed from exactly what that
   view displays.
3. **Trivia:** it doesn't help the user decide or do anything (link, card or machine
   counts, layout mode, generation dates and timestamps).
4. **Raw internal format:** an internal code where a human label exists ("1-1" →
   "Year 1 Sem 1", "202701" → "Winter 2027").
5. **Duplicate:** the same fact twice on one view. Keep the one in the most useful place.

Test for every candidate: given what's still visible, would the user lose anything they
need if it were gone? If not, leave it out.

Keep: legends and keys, a status label that is the only non-colour cue for that status,
titles, and any fact the user needs that appears nowhere else on the view. Useful text
in the wrong place gets moved, not deleted.
