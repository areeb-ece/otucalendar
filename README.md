# Ontario Tech → Google Calendar

A local Windows/Linux program with a desktop GUI and command-line mode. It opens MyOntarioTech, lets you sign in, reads your registered course meetings, and writes a customizable `.ics` file for Google Calendar. No Google account connection or API key is needed.

## Start on Windows

Use **Windows 11** with **Python 3.10 or newer**. Windows 11 is supported by the current Playwright browser library.

1. Install the full version of [Python for Windows](https://www.python.org/downloads/windows/), including pip and Tcl/Tk (the GUI component). If Python is already installed, you can check it with `py -3 --version` in PowerShell.
2. Extract the ZIP to a writable local folder, such as Documents. Open the extracted `ontario-tech-calendar` folder.
3. Double-click **run.bat**. It installs the Python dependencies on the first run and opens the GUI. You can minimize the console window; keep it open while using the app.

No Bash or WSL is needed. The launcher creates a separate `.venv-windows` environment next to the source files. First-time setup needs internet access. Browser installation happens when you start a university login; an installed Chrome browser can also be used automatically.

To use PowerShell instead, open it in the extracted folder:

```powershell
# Open the GUI (also the double-click default).
.\run.bat

# Open a saved schedule in the GUI; quote paths containing spaces.
.\run.bat --input "C:\Users\YourName\Documents\my schedule.json"

# Use terminal mode, or test it with the fictional sample.
.\run.bat --cli
.\run.bat --cli --input sample_schedule.json --output demo.ics --yes

# Show export options, or pre-download the bundled Chromium browser.
.\run.bat --help
.\run.bat --setup
```

All export options below also work on Windows: replace `bash run.sh` with `.\run.bat --cli` for terminal mode, or `.\run.bat` for GUI mode. If the window reports a missing Python, pip, or Tcl/Tk installation, install or repair the full Python package and retry. Run from the extracted folder, not from inside the ZIP viewer.

## Start on Linux

Extract the updated ZIP, replace the old program files, and run this inside the `ontario-tech-calendar` folder:

```bash
bash run.sh --gui
```

## Customize in the GUI

Click **Sign in & load courses**, sign in on the university page and select your term, then click **Read schedule** in the app. The GUI handles all further prompts. You can also use **Open saved schedule** to load JSON from a previous export, or **Try sample** to explore with clearly marked fictional courses.

Under **Appearance**, edit the three fields and select a course to see a live preview. The default **Minimal** preset matches this example:

| Calendar field | Template | Example result |
| --- | --- | --- |
| Title | `{CourseCode} · {Type}` | `ELEE 2110U · Lecture` |
| Description | `{RoomCodeandNumber}` | `UA 1234` |
| Location | Leave empty | No location field |

The exported display fields contain exactly the template output. CRNs, building names, and the exporter note are not appended to a customized description. Internal calendar identifiers remain present for event identity, but they do not add visible CRN information.

- **Insert** adds the selected placeholder at your cursor in the last focused field.
- **Remember style** saves the three templates locally and restores them on the next GUI launch.
- **Room in location** is another preset; **Full details** restores the original detailed format.
- **Edit room details** lets you correct the building code, room number, building name, and campus for the selected meeting.
- **Export options** provides date exclusions, reminders, a term filter, fallback dates, and browser selection.
- **Export calendar (.ics)** opens a save dialog. All loaded meeting patterns are exported; selecting a table row only chooses the preview.
- **Save schedule** keeps editable meeting data, including the separate room fields, for future use without signing in.

The GUI opens without downloading a browser. It downloads one, if necessary, only when you start a university login. Your existing installed Chromium/Chrome or previously downloaded browser can be reused.

On Linux, if Tkinter is missing, install the GUI package for your distro and rerun the command:

| Distribution | GUI package |
| --- | --- |
| Fedora | `sudo dnf install python3-tkinter` |
| CachyOS / Arch | `sudo pacman -S --needed tk` |
| Ubuntu / Mint / Debian | `sudo apt install python3-tk` |

## Template placeholders

| Placeholder | Meaning |
| --- | --- |
| `{CourseCode}` | Subject and course number as supplied by Banner |
| `{CourseName}` | Course title |
| `{Type}` | Lecture, Laboratory, Tutorial, or the source meeting type |
| `{TypeShort}` | LEC, LAB, TUT, SEM for recognized types; otherwise the source type |
| `{RoomCodeandNumber}` | Short building code plus room number, e.g. `UA 1234` |
| `{RoomNumber}` | Room value only |
| `{BuildingCode}` / `{BuildingName}` | Short building code / full building name |
| `{Campus}` / `{Instructor}` | Campus / instructor, when supplied |
| `{CRN}` / `{Term}` | Course reference number / term code |
| `{Days}` | Meeting weekdays, e.g. `Mon/Wed` |
| `{StartTime}` / `{EndTime}` | Local meeting times in 24-hour format |
| `{StartDate}` / `{EndDate}` | First and last dates of the meeting pattern's date range |
| `{Location}` | Complete original location, including the building/campus if supplied |
| `{DefaultTitle}` / `{DefaultDescription}` | Original detailed title / description |

Placeholder names are case-insensitive. Ordinary text and multiple description lines are supported. Use `{{` and `}}` to write literal braces. Unknown placeholders are reported before export. A blank description or location omits that calendar field. Titles must contain text.

**Older saved JSON may only contain a combined location.** The program does not guess a short building code or room number from a full building name. Reload the schedule from the university, or select a meeting and use **Edit room details**. Missing placeholder values are shown in the preview and confirmed before export.

For command-line customization:

```bash
bash run.sh --title-template '{CourseCode} · {Type}' \
  --description-template '{RoomCodeandNumber}' --location-template ''

# Open an existing schedule directly in the GUI.
bash run.sh --gui --input my-schedule.json

# Reuse the GUI's remembered appearance in a command-line export.
bash run.sh --input my-schedule.json \
  --style-file ~/.config/ontario-tech-calendar/appearance.json
```

On Windows, the remembered style is stored at `%APPDATA%\OntarioTechCalendar\appearance.json`. On Linux it uses `~/.config/ontario-tech-calendar/appearance.json`, respecting `XDG_CONFIG_HOME` if set. Use `--style-file` to load either file explicitly. Command-line mode retains the original full-detail defaults unless templates or a style file are supplied. Style files contain only the three templates, with no credentials or course data. Exclusions and reminder settings are configured separately.

## Run in the terminal on Linux

1. Extract the ZIP.
2. Open a terminal in the extracted `ontario-tech-calendar` folder.
3. Run:

   ```bash
   bash run.sh
   ```

4. In the browser that opens, enter your normal Ontario Tech network credentials. Complete any verification. Select your term in **My course schedule / View Registration Information**.
5. Once your registered courses appear, return to the terminal and press Enter.
6. Review the courses, times, locations, and date ranges. Enter any holidays / reading-week dates to skip, then type `y` to export.

Your file will be named `ontario-tech-TERM.ics` in this folder. The launcher installs Python dependencies in `.venv` on its first run. It uses an installed Chromium/Chrome when available; otherwise it downloads a separate Chromium browser into your user cache. First-time setup needs internet access and may take several minutes.

**Enter credentials only on the university page in the browser.** The program does not ask you to put a password in chat, a script, a command-line argument, or a configuration file. Its temporary session handles the normal university sign-in and any verification prompts. It does not save a login profile, cookies, or passwords, and does not send your schedule to an external export service. Closing the session removes its temporary profile. Exported files contain course data.

## Import into Google Calendar

On a computer, open [Google Calendar](https://calendar.google.com/).

1. Optionally create a separate calendar, such as **Ontario Tech — Fall 2026**, using **Other calendars → + → Create new calendar**.
2. Open **Settings → Import & export → Import**.
3. Choose your `.ics` file, select the destination calendar, and click **Import**.

The file is a snapshot. If your timetable changes, regenerate it. To replace a whole term reliably, remove the old course calendar and import into a fresh one, after checking it contains no unrelated events. Re-importing does not reliably update existing events, and changing a course's time can create duplicates. Each class occurrence is a separate event.

## What it includes

- Customizable titles, descriptions, and locations, using course code/title, meeting type, room, CRN, and instructor when supplied.
- Separate lecture, laboratory, and tutorial sections.
- Multiple meeting rows per section, including separate date windows.
- The meeting's actual start/end dates. Semester dates are never guessed.
- Toronto time, with each occurrence independently converted to UTC so daylight saving time does not shift your classes.
- Optional exclusions and reminders; stable event identifiers for identical exports.
- A preview and explicit reports of missing data, TBA/asynchronous meetings, and recognized dropped/waitlisted registrations.

Reading week, holidays, cancellations, rescheduled classes, and final exams are **not automatically inferred**. Use the university calendar and your course outlines to choose exclusions. A Banner row with weekdays and a date range is treated as weekly. If an alternating lab is shown as separate date windows, those windows are respected. If Banner instead lists a broad range without its alternating-week pattern, save the editable JSON and set `interval_weeks: 2`; set `start_date` in the first actual meeting week. The preview makes these assumptions visible.

## Useful commands

```bash
# Save editable course data alongside the calendar; no login information is included.
bash run.sh --save-schedule my-schedule.json

# Add a 15-minute reminder to every class.
bash run.sh --reminder 15

# Use an exclusion file: one ISO date or inclusive range per line, with # comments.
bash run.sh --exclude-file excluded-dates.txt

# Rebuild an edited saved schedule, without opening a browser.
bash run.sh --input my-schedule.json --output updated-courses.ics

# Test using FICTIONAL sample courses. This does not access your account.
bash run.sh --input sample_schedule.json --output demo.ics --yes

# Use the Playwright Firefox browser (downloaded separately; not your normal profile).
bash run.sh --browser firefox

# Show every option.
bash run.sh --help
```

For inline exclusions, use `--exclude "YYYY-MM-DD,YYYY-MM-DD..YYYY-MM-DD"` with actual dates. Ranges include both endpoints. An `excluded-dates.example.txt` template is included.

`--start-date` and `--end-date` supply fallbacks only for meetings missing their own dates. `--term` filters by Banner's six-digit term code; select the same term in the browser. `--force` deliberately replaces existing output files. `--yes` bypasses export prompts; if data is missing, it refuses a partial export unless you also pass `--allow-partial`.

Saved JSON contains the parsed meeting patterns. Reapply exclusions and reminders when rebuilding it. A meeting's `interval_weeks` counts calendar weeks starting Monday; for an alternating lab, its `start_date` must be in the first week when it actually meets.

## Linux setup and troubleshooting

Requires Python **3.10+**, a graphical Linux desktop, and an internet connection for sign-in. Normal runs need no administrator privileges. These initial OS package installs may be necessary:

| Distribution | Initial packages |
| --- | --- |
| Fedora | `sudo dnf install python3 python3-pip chromium` |
| CachyOS / Arch | `sudo pacman -S --needed python python-pip chromium` |
| Ubuntu / Linux Mint / Debian | `sudo apt install python3 python3-venv` |

If bundled Chromium reports missing shared libraries on Ubuntu/Mint/Debian, use:

```bash
.venv/bin/python -m playwright install-deps chromium
```

That dependency installer may request your administrator password. On Fedora or Arch/CachyOS, installing the distribution's Chromium package also installs its system dependencies; `bash run.sh` detects it. Playwright formally supports a narrower set of Linux distributions, so Fedora/Arch browser compatibility has not been verified here. If a bundled-browser download fails, installing your distribution's Chromium is another supported launcher path.

If you see a sign-in username-format error, use the same username format you normally use on MyOntarioTech. The university's sign-in page is authoritative; this program does not force a domain prefix.

If no courses are found, confirm you opened **My course schedule / View Registration Information**, not course search or Plan Ahead. Refresh, select your term again, and wait for the registered course list before pressing Enter. Only registration-history data establishes which courses to export. Viewing a course in the catalog cannot add it to the export.

This version fixes the table-heading bug that could report **Meeting data is missing for CRNs: CRN** and request an invalid course, causing HTTP 500. It reads data cells only and accepts five-digit course numbers from both the table and captured responses. If an older running copy shows that exact error and only lists `CRN` as missing, type `continue` to review the real courses, or stop it and run this updated copy.

If a course has no captured meeting data, the program attempts a read-only meeting-details request in your authenticated page. If that fails, open the course's meeting details in the browser and retry when prompted. TBA/asynchronous classes have no timed events and are reported. The program refuses to write an empty calendar.

Use one term and one schedule tab per run. Export another term with a fresh run. Avoid changing the term while the program reads meeting details. This program reads the registration page; it does not register, drop, or edit courses.

## Validation and limits

The official schedule link and its redirect to the university's sign-in page were checked on September 8, 2026. All 31 automated tests passed on Linux on September 9, including two GUI integration tests on a virtual display. They cover the original exporter, template validation and exact output, room-field preservation, saved styles, live preview, GUI file export, and GUI browser prompts/cancellation with a simulated capture. The reported ninth-course/header bug remains covered. The GUI was rendered for visual inspection. The Linux first-run launcher successfully installed its dependencies in a fresh environment and exported 32 fictional sample events. Windows tests simulate dependency setup, GUI/CLI selection, paths containing spaces, Chrome discovery, and the Windows style-file location.

**The Windows launcher and GUI have not been executed on a native Windows machine here.** Windows path and bootstrap tests run with mocks on Linux. A signed-in export from this GUI against a real Ontario Tech account has also not been tested here. The protected Banner page or API can change. The actual GUI, sample export, and formatting were tested on Linux; the automated browser login handoff used simulated course data.

Run the tests after the launcher has installed dependencies:

```bash
.venv/bin/python -m unittest discover -v
```

On Windows, use:

```powershell
.\.venv-windows\Scripts\python.exe -m unittest discover -v
```

GUI tests run on Windows or when a Linux desktop `DISPLAY` is available; they are skipped in a headless Linux terminal. The other 29 tests need no display or account.

## Source files

`run.bat` and `windows_launcher.py` set up and start the app on Windows; `run.sh` does so on Linux. `gui.py` implements the desktop window; `event_style.py` implements text templates; `export_courses.py` is the command-line workflow; `browser_capture.py` handles the temporary browser and registered-course capture; `calendar_core.py` handles Banner parsing, time zones, and `.ics` generation. All source is included and can be edited locally.

Official references:

- [MyOntarioTech undergraduate portal](https://my.ontariotechu.ca/current-students/undergraduate/index.php)
- [My course schedule](https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/registrationHistory/registrationHistory?mepCode=UOIT)
- [Registrar resources and schedule instructions](https://registrar.ontariotechu.ca/services/resources.php)
- [Google Calendar import instructions](https://support.google.com/calendar/answer/37118)
- [Playwright browser installation](https://playwright.dev/python/docs/browsers)
- [Playwright system requirements](https://playwright.dev/python/docs/intro#system-requirements)
- [icalendar library](https://icalendar.readthedocs.io/en/latest/how-to/usage.html)
- [Python Tkinter documentation](https://docs.python.org/3/library/tkinter.html)
- [Python on Windows](https://docs.python.org/3/using/windows.html)

This is an independent utility, not an official Ontario Tech application.
