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
browsers block the font files on `file://`, and the shared design files can't load there, so
the page falls back to your system fonts and its own offline copy of the design (below).

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

Banner's Schedule Details spell the subject out ("Calculus I | Mathematics 1010U Section
001") and leave the course code to the registration table above them. Each section is
matched to its code, type and status by its CRN, whether you paste the page or save it.
`samples/schedule-details-paste.example.txt` is a fictional paste in that layout.

### [C] By hand (last resort)

For a schedule that isn't on Ontario Tech's pages (mostly students elsewhere), or a class
missing from one: **Enter your classes by hand** on the welcome screen, or **Import → By
hand**. Add each class with its code, type, days, times, first and last dates and how often
it repeats, then **Make calendar**. Classes with the same code are one course (one colour,
a shade per type). **Save .json** keeps the list to load again later.
Put the term's reading week at the top, if it has one: nothing meets that week, and a
class every 2 weeks or more skips over it in its count (one that meets in W1, with reading
week in W2, next meets in W4, not W3). It's kept in the saved `.json` as `reading_week`.

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
- **Nothing kept.** The schedule lives only in memory. Only your appearance templates
  and the display settings (theme, background; shared with the other sites on
  areeb-ece.github.io) are stored, in `localStorage`.
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

**Bi-weekly classes.** Banner lists a bi-weekly lab or tutorial as one meeting per date;
the page puts them back together into one class (same section, day and time, even when
the room changes). Bi-weekly classes are sorted into two sets by the weeks they meet:
classes in the same set meet in the same weeks. Set 1 (the one that starts first) is
striped and set 2 dotted, in the preview, the legend and every image. The week label says
which set meets that week.

**Reading week.** Banner doesn't mark reading week, and often still lists lectures in it.
The page infers it when it can, either as the one week mid-term in which nothing meets, or
as the one week that neither set of bi-weekly classes meets. It then asks: **Yes, skip W6**
leaves every class that week out of the calendar, and **It's a different week** or **No
reading week** answer otherwise. When it can't tell, it offers every week with its dates to
pick from. A gap between two parts of term (spring and summer) isn't taken for a break.
Skipping reading week doesn't make the weekly classes count as irregular.

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

### Save it as an image

**Save image** draws the schedule as a picture, PNG or SVG, in the style of
[PrereqFlow](https://areeb-ece.github.io/prereqflow/)'s chart export. You choose:

- **Show:** the whole term (every class on one week), the week on screen in the preview,
  or every week side by side.
- **Courses:** any of them.
- **Include:** the title block and course list, the week table, and rooms on the classes.
  The credit line is always there.
- **Format and resolution:** PNG at 2×, 3×, 4× or 6× (stepped down if a browser can't make
  a canvas that large; the dialog shows the size), or SVG, which scales without loss.
- **Sheet:** the current theme, dark, or light for printing.

Classes that don't meet every week (bi-weekly labs, or classes that start or end part-way
through the term) get a letter on their block. A bi-weekly class is one block, striped or
dotted for its set ("bi-weekly · set 1"), and a key above the week table lists each set's
weeks and the reading week. Other irregular classes show the weeks they meet ("W2–W13"). The **week table** under the schedule lists every week with its dates, and
for each lettered class the day of the month it meets that week, so the image alone says
exactly when everything happens. Skipped dates are struck through there and listed in their
own row. A class counts as weekly when it meets in every week in which one of its days
falls inside the term, so a Tuesday class isn't flagged because the term ends on a Monday.

The page can't read files over the network (`connect-src 'none'`), so an SVG names its
fonts (mononoki, Libre Franklin) instead of embedding them; where they aren't installed, the
viewer uses similar system fonts.

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
css/fallback.css                offline copy of the shared design (night/paper, scales, sd- components)
css/style.css                   this page's layout and own parts (week grid, chips, popover), tokens only
js/core.js                      Banner normalization, Toronto time, templates, .ics write + read, term weeks
js/importer.js                  saved page (.html / .mhtml), pasted text and JSON → courses
js/app.js                       UI: import, appearance, options, week preview, downloads
js/export.js                    the image export: its dialog and the picture's layout (week sheets, week table)
js/image.js                     draws an image as PNG (canvas) or SVG, as PrereqFlow's does
js/theme.js                     offline fallback: applies the saved light/dark sheet
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

## Themes and settings

The gear icon at the top right opens the settings shared by
[areeb-ece.github.io](https://areeb-ece.github.io/), PrereqFlow and OTU Calendar: a
theme (Night, Paper, Void, Console, Amber and more, or follow the system), an accent
colour, corner style, motion, and the night sky behind the week preview (number of
stars, size, brightness, blur, colour, drift speed and direction, glow). Choices are
saved in your browser and apply on all three sites.

The colours, themes, type, spacing and motion scales, the shared `sd-` components
(buttons, fields, tabs, dialogs, toast…), the settings panel, the sky and the text face
(Libre Franklin) come from the portfolio repo's `public/design/` (`tokens.css`, `ui.css`,
`fonts.css`, `theme.js`, `ui.js`), served at `/design/`. The page loads them after
`css/fallback.css` and before its own `css/style.css`, which uses only their tokens, so
changing them there restyles every site. They come from the same address, so the Content
Security Policy needs no change. Opened offline or from disk, they can't load: the page
falls back to `css/fallback.css` (a copy of the night/paper themes, the scales and the
`sd-` rules it uses), the system sans and a light/dark button. When the shared files
change, copy the same sections into `css/fallback.css` again.

The browser check stubs those files out and tests the fallback. To test with the real
ones (the portfolio's `public/fonts/` is served too, for Libre Franklin):
`DESIGN_DIR=../areeb-ece.github.io/public/design npm run test:browser`.

## Limits

- The importer reads the Banner 9 schedule page by its text patterns: course codes such
  as `ELEE 2110U`, date ranges, `03:10 PM - 04:30 PM`, `Type:` / `Building:` /
  `Room:` labels and the highlighted day letters. It was built against fictional pages
  that copy that layout. It has not been run against a real signed-in Ontario Tech
  account here, and the university can change its page at any time. If a saved page
  doesn't read correctly, try pasting it (or enter the classes by hand), and check the preview against your
  schedule before importing.
- Reading week, holidays, cancellations and exams are not on the schedule page and are
  not guessed.
- Safari's save formats don't keep the loaded schedule. Use Chrome, Edge or Firefox to
  save the page, or the paste option.

This is an independent utility, not an official Ontario Tech application.
