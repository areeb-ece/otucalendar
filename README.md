# OTU Calendar

**Live: [areeb-ece.github.io/otucalendar](https://areeb-ece.github.io/otucalendar/)** · made by areeb

Turn your Ontario Tech course schedule into a calendar file (`.ics`) for Google,
Apple or Outlook Calendar. Before you download it, you can scroll through the term
week by week and see exactly what the file contains.

It's a static site with no build step, no framework and no server. Your schedule is
read and the calendar is built inside your browser tab, and nothing is uploaded.

---

## Getting started

```sh
git clone https://github.com/areeb-ece/otucalendar.git
cd otucalendar
python3 -m http.server 8080      # or: npm run serve
# open http://localhost:8080
```

You can also open `index.html` directly from disk. Everything works that way, but
browsers block the font files on `file://`, so the page falls back to your monospace font.

To publish it, turn on GitHub Pages for the repository (Settings → Pages → deploy
from the `main` branch, root folder).

## Getting your schedule in

MyOntarioTech has no export button and no public API, and a third-party site should
never ask for your university password. So the student brings the schedule to the
page instead. There are three ways in:

### [A] Saved schedule page (recommended)

1. Open [My course schedule](https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/registrationHistory/registrationHistory?mepCode=UOIT),
   sign in on the university's page and choose your term.
2. Open **Schedule Details** so the meeting times are on screen.
3. Press <kbd>Ctrl</kbd> <kbd>S</kbd> (<kbd>⌘</kbd> <kbd>S</kbd> on a Mac) and save as
   **Webpage, Complete** or **Webpage, Single File** (Chrome/Edge), or
   **Web Page, complete** (Firefox). Don't pick "HTML only": that saves the page as it
   was before your courses loaded.
4. Drop the `.html` or `.mhtml` file onto OTU Calendar.

### [B] Copy and paste

On the Schedule Details page press <kbd>Ctrl</kbd> <kbd>A</kbd>, <kbd>Ctrl</kbd> <kbd>C</kbd>
and paste into **Import → Paste text**. When the clipboard carries the page's
formatting, the highlighted meeting days are read from it. No file is left behind to
delete.

### [C] Helper bookmark

**Import → Helper** shows a short script you can read line by line. Drag it to your
bookmarks bar and click it on your signed-in schedule page. It reads the course rows
on screen, asks the same site for each section's meeting times (the
`getFacultyMeetingTimes` request the page itself makes), and saves
`ontario-tech-TERM.json`, which you then load here. It only makes same-site requests.
This gives the most exact data, but only run code you have read.

`.json` files saved by OTU Calendar (**Save .json**) or by the earlier Python version
of this project also load directly.

## Privacy and security

- **No server.** Parsing, templating and `.ics` generation all run in the tab.
- **No network.** The page's Content Security Policy includes `connect-src 'none'`,
  so the page cannot send data anywhere, even by mistake. Fonts and scripts are served
  from the site itself, and no third-party code is loaded.
- **No credentials.** You only sign in on the university's own page. OTU Calendar
  never sees your password, cookies or session.
- **Inert parsing.** An uploaded page is parsed with `DOMParser` into a detached
  document. Its scripts don't run, its images and stylesheets aren't fetched, and its
  markup is never inserted into the page. Only course fields are read from it: code,
  title, CRN, schedule type, status, meeting dates, days, times, building and room.
  Your name, student number and any session tokens on the page are ignored.
- **Nothing kept.** The schedule lives only in memory. Only the theme and your
  appearance templates are stored, in `localStorage`.
- A saved schedule page contains your name and student number, so delete it once
  your calendar is made and sign out of MyOntarioTech.

The browser check (`npm run test:browser`) asserts that importing and exporting
makes no request outside the site's own files.

## Using it

### Week preview

The preview is drawn from the generated `.ics` text itself (it is parsed back), so
what you see is what your calendar app will get.

- Scroll sideways, swipe, use <kbd>←</kbd> / <kbd>→</kbd>, or click a week chip. Each
  chip shows a small bar per day.
- <kbd>t</kbd> or **today** jumps to the current week, which also shows a now-line.
- Click a day's heading to **skip** that date (reading week, holidays). Skipped days
  are hatched and listed under **Options → Skip dates**.
- Click a class to see its calendar entry: title, time, location, notes, reminder and
  UID.
- **.ics file** shows the raw file, ready to copy.

### Appearance

Three templates control each event's **Title**, **Description** and **Location**. The
presets:

| Preset | Title | Description | Location |
| --- | --- | --- | --- |
| Minimal (default) | `{CourseCode} · {Type}` | `{RoomCodeandNumber}` | empty |
| Room in location | `{CourseCode} · {TypeShort}` | `{CourseName}` | `{RoomCodeandNumber}` |
| Full details | `{DefaultTitle}` | `{DefaultDescription}` | `{Location}` |

| Placeholder | Meaning |
| --- | --- |
| `{CourseCode}` / `{CourseName}` | e.g. `ELEE 2110U` / course title |
| `{Type}` / `{TypeShort}` | Lecture, Laboratory, Tutorial… / LEC, LAB, TUT, SEM |
| `{RoomCodeandNumber}` / `{RoomNumber}` | e.g. `UA 1350` / room only |
| `{BuildingCode}` / `{BuildingName}` / `{Campus}` | as supplied |
| `{Instructor}` / `{CRN}` / `{Term}` | when supplied |
| `{Days}` / `{StartTime}` / `{EndTime}` | e.g. `Mon/Wed`, `15:10`, `16:30` |
| `{StartDate}` / `{EndDate}` | first and last dates of the meeting pattern |
| `{Location}` | the full original location |
| `{DefaultTitle}` / `{DefaultDescription}` | the original detailed text |

Placeholder names are case-insensitive. Use `{{` and `}}` for literal braces. An
empty description or location leaves that field out. Templates are remembered in this
browser.

### Options and meetings

- **Reminder** adds an alarm to every class.
- **Skip dates** takes ISO dates or inclusive ranges: `2026-10-12, 2026-10-13..2026-10-16`.
  Reading week and holidays aren't on the schedule page, so check the academic calendar.
- **Meetings** lists every meeting pattern. Switch one off to leave it out, or set it
  to repeat every 2–4 weeks for alternating labs. For an alternating lab, the
  pattern's start date must fall in a week when the lab actually meets.
- If the page had no meeting dates, enter the first and last class dates of the term.

### Add it to your calendar

- **Google:** on a computer, open Settings → Import & export → Import, choose the file
  and a calendar. A new calendar (such as "Fall 2026") is easiest to remove later.
- **Apple:** open the `.ics`. Calendar asks which calendar to add it to.
- **Outlook:** Calendar → Add calendar → Upload from file.

The file is a snapshot. If your timetable changes, remove the old course calendar and
import a fresh file, because re-importing doesn't update events. Each class is its own
event. Times are written in UTC and converted one occurrence at a time, so daylight
saving never shifts a class. Event UIDs are the same as the earlier Python exporter's,
so identical classes keep identical IDs.

## Project layout

```
index.html                      page, dialogs, Content Security Policy
css/style.css                   the PrereqFlow sheet: fallback dark/light tokens, components, week grid
js/core.js                      Banner normalization, Toronto time, templates, .ics write + read
js/importer.js                  saved page (.html / .mhtml), pasted text and JSON → courses
js/helper.js                    the optional helper bookmark (shown in full on the page)
js/app.js                       UI: import, appearance, options, week preview, downloads
js/theme.js                     applies the saved theme before first paint
js/sample.js                    fictional sample (same as samples/sample_schedule.json)
samples/                        fictional sample schedule and a fictional saved page
tests/*.test.js                 unit tests (node --test)
tests/browser-check.js          end-to-end check in Chromium (Playwright)
assets/fonts/                   mononoki (SIL Open Font License)
```

```sh
npm test                                      # unit tests, no dependencies
npm i --no-save playwright && npm run test:browser
```

## Colours

The colours come from the master palette shared with
[areeb-ece.github.io](https://areeb-ece.github.io/) and PrereqFlow: `/design/tokens.css`,
kept in the portfolio repo at `public/design/tokens.css`. The page loads it after
`css/style.css`, so changing it there restyles all three sites. The values in
`css/style.css` are a fallback for when the page is opened offline or from disk. The
stylesheet comes from the same address, so the Content Security Policy needs no change.

## Limits

- The importer reads the Banner 9 schedule page by its text patterns: course codes such
  as `ELEE 2110U`, date ranges, `03:10 PM - 04:30 PM`, `Type:` / `Building:` /
  `Room:` labels and the highlighted day letters. It was built against fictional pages
  that copy that layout. It has not been run against a real signed-in Ontario Tech
  account here, and the university can change its page at any time. If a saved page
  doesn't read correctly, try the helper, and check the preview against your
  schedule before importing.
- Reading week, holidays, cancellations and exams are not on the schedule page and are
  not guessed.
- Safari's save formats don't keep the loaded schedule. Use Chrome, Edge or Firefox to
  save the page, or the paste option.

This is an independent utility, not an official Ontario Tech application.
