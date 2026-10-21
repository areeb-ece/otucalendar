# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Ontario Tech University students who want their term's classes in Google, Apple or
Outlook Calendar. They arrive once or twice a term (start of term, after a timetable
change), on a computer or a phone, usually from areeb-ece.github.io. They are signed in
to MyOntarioTech in another tab and want the job done in a few minutes without handing
their password to anyone.

## Product Purpose

Turn an Ontario Tech course schedule into a calendar file (`.ics`) and show, week by week,
exactly what that file contains before it is downloaded. Success: the student imports
their schedule, skips reading week and holidays, checks the preview against their
timetable, downloads the file and imports it into their calendar app.

## Positioning

- Everything runs in the browser tab. The Content Security Policy has
  `connect-src 'none'`, so the page cannot send the schedule anywhere, even by mistake.
- The week preview is drawn by parsing the generated `.ics` text back, so what the student
  sees is what their calendar app gets.
- The student brings the schedule to the page (saved page or pasted text, or
  classes entered by hand); the site never asks for university credentials.

## Operating Context

- Source: the Banner 9 "My course schedule" → Schedule Details page on ssp.mycampus.ca.
- Two ways in: saved page (`.html` / `.mhtml`) or copy and paste. JSON saved by the tool
  (or the earlier Python version) loads too. A last resort, mostly for students elsewhere:
  enter each class by hand.
- Output goes into Google Calendar (Settings → Import & export), Apple Calendar or Outlook.
  The file is a snapshot; a changed timetable means deleting the old calendar and importing
  a new file.
- Served at areeb-ece.github.io/otucalendar/ from its own repo; static, no build step.

## Capabilities and Constraints

- Import, event-text templates with placeholders and presets, reminder, calendar name,
  skip dates (typed or by clicking a day), per-meeting include and repeat interval,
  fallback term dates, week preview with event details, raw `.ics` view, `.ics` and
  `.json` downloads, and the schedule as an image (PNG or SVG; whole term, one week or
  every week) with a week table giving the exact dates of alternating and part-term classes.
- Strict CSP: no inline scripts or styles, no `style` attributes (styles go through CSSOM),
  no network connections. No third-party code, no dependencies.
- Nothing about the schedule is stored. Only templates (`otucalendar.style`), the offline
  theme (`otucalendar.theme`) and the shared display settings (`design.settings`) are kept
  in localStorage.
- Uses the shared design system from areeb-ece.github.io/design/ (tokens, sd- components,
  settings, night sky, text font) and keeps an offline fallback in `css/style.css` for when
  the page is opened from disk.
- Not an official Ontario Tech application.

## Brand Commitments

- Name: OTU Calendar; wordmark OTU/CALENDAR; "made by areeb", lowercase.
- Shares the look of areeb-ece.github.io: Libre Franklin for text, mononoki for codes,
  times, figures and the `.ics` text (confirmed 2026-10-20).
- Voice: plain and short; says what happens to the student's data.

## Evidence on Hand

- `samples/sample_schedule.json` and `samples/saved-schedule-page.example.html` are
  fictional (DEMO courses) and must stay labelled as such.
- The importer has not been run against a real signed-in account; the README says so and
  nothing may claim otherwise. No users, testimonials or usage numbers exist.

## Product Principles

1. Privacy is shown, not claimed: the page states plainly what it reads and that nothing
   leaves the tab.
2. Preview before download: the student can always check the exact result first.
3. The common path is short: import, skip the holidays, download. Everything else waits
   behind it.
4. One family: looks and settings match the portfolio and the other two tools.

## Accessibility & Inclusion

WCAG 2.2 AA in every shared theme: text contrast, visible focus, full keyboard use
(including week navigation and dialogs), `prefers-reduced-motion` and the shared
"Animations" switch respected, and usable on a phone.
