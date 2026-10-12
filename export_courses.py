#!/usr/bin/env python3
"""Ontario Tech course schedule to .ics. Start with run.bat or bash run.sh."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys

from calendar_core import (DAY_LABELS, editable_schedule, exclusions, make_calendar,
                           normalize, parse_date, write_private)
from event_style import EventStyle, load_style, render_event


def parser() -> argparse.ArgumentParser:
    app = argparse.ArgumentParser(description="Export registered Ontario Tech courses to Google Calendar (.ics).")
    app.add_argument("--input", type=Path, help="Convert saved schedule JSON without signing in")
    app.add_argument("--output", "-o", type=Path, help="Output .ics path (default: ontario-tech-TERM.ics)")
    app.add_argument("--term", default="", help="Only export this six-digit Banner term code")
    app.add_argument("--browser", choices=("auto", "chromium", "chrome", "firefox"), default="auto",
                     help="auto uses installed Chromium/Chrome, or bundled Chromium")
    app.add_argument("--exclude", default="", help="Dates/ranges to skip: YYYY-MM-DD,YYYY-MM-DD..YYYY-MM-DD")
    app.add_argument("--exclude-file", type=Path, help="Text file with excluded dates/ranges and # comments")
    app.add_argument("--start-date", type=parse_date, help="Fallback only when a meeting has no start date")
    app.add_argument("--end-date", type=parse_date, help="Fallback only when a meeting has no end date")
    app.add_argument("--reminder", type=int, metavar="MINUTES", help="Add a reminder before each class")
    app.add_argument("--save-schedule", type=Path, help="Also save editable JSON containing the parsed meetings")
    app.add_argument("--yes", "-y", action="store_true", help="Accept preview and use supplied exclusions without prompting")
    app.add_argument("--allow-partial", action="store_true", help="With --yes, explicitly accept skipped/missing meetings")
    app.add_argument("--force", action="store_true", help="Replace existing output files")
    app.add_argument("--gui", action="store_true", help="Open the graphical customization and export window")
    app.add_argument("--style-file", type=Path, help="Load title, description, and location templates from JSON")
    app.add_argument("--title-template", help="Event title, e.g. '{CourseCode} · {Type}'")
    app.add_argument("--description-template", help="Event description; empty text omits it")
    app.add_argument("--location-template", help="Event location; empty text omits it")
    return app


def main(argv: list[str] | None = None) -> int:
    if sys.platform == "win32":
        # Redirected Windows consoles may use an encoding without all course-title characters.
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(errors="replace")
    app = parser()
    args = app.parse_args(argv)
    if args.reminder is not None and not 0 <= args.reminder <= 40320:
        app.error("--reminder must be between 0 and 40320 minutes")
    if args.term and (len(args.term) != 6 or not args.term.isdigit()):
        app.error("--term must be a six-digit Banner term code")
    try:
        if args.gui:
            from gui import launch
            return launch(args)
        base_style = load_style(args.style_file) if args.style_file else EventStyle()
        style = EventStyle(
            args.title_template if args.title_template is not None else base_style.title,
            args.description_template if args.description_template is not None else base_style.description,
            args.location_template if args.location_template is not None else base_style.location,
        )
        if args.input:
            data = json.loads(args.input.read_text(encoding="utf-8"))
            term = args.term
        else:
            from browser_capture import capture
            print("Ontario Tech → Google Calendar\nYour sign-in stays in a temporary local browser session.")
            data, term = asyncio.run(capture(term=args.term, browser_name=args.browser))
        result = normalize(data, term=term, start=args.start_date, end=args.end_date)
        if not args.yes and any("missing meeting dates" in w for w in result.warnings):
            print("Banner did not provide meeting dates. Enter the actual first/last class dates for this term.")
            start = args.start_date or parse_date(input("First class date (YYYY-MM-DD): "))
            end = args.end_date or parse_date(input("Last class date (YYYY-MM-DD): "))
            result = normalize(data, term=term, start=start, end=end)
        print(f"\nFound {result.course_count} course sections; {len(result.meetings)} scheduled meeting patterns.")
        for meeting in result.meetings:
            days = "/".join(DAY_LABELS[day] for day in meeting.days)
            interval = f", every {meeting.interval_weeks} weeks" if meeting.interval_weeks != 1 else ""
            rendered = render_event(meeting, style)
            print(f"\n  {rendered.title} [CRN {meeting.crn}]")
            print(f"    {days} {meeting.start_time:%H:%M}–{meeting.end_time:%H:%M}{interval} · Toronto time")
            print(f"    {meeting.start_date} through {meeting.end_date} · {meeting.location or 'Location not supplied'}")
        if result.warnings:
            print("\nItems requiring attention:")
            for warning in result.warnings:
                print("  - " + warning)
        if not result.meetings:
            raise ValueError("No scheduled meetings were found. No .ics file was written. See README.md for troubleshooting.")
        if args.yes and result.warnings and not args.allow_partial:
            raise ValueError("Some meetings were skipped. Review them interactively, or use --allow-partial to accept them.")
        excluded = exclusions(args.exclude)
        if args.exclude_file:
            excluded |= exclusions(args.exclude_file.read_text(encoding="utf-8"))
        if not args.yes:
            print("\nReading week and holidays are NOT inferred from Banner's date ranges.")
            print("Add dates to skip, separated by commas; ranges use YYYY-MM-DD..YYYY-MM-DD.")
            extra = input("Dates to skip (Enter for none beyond --exclude): ").strip()
            excluded |= exclusions(extra)
        calendar, count = make_calendar(result.meetings, excluded, args.reminder, style)
        terms = sorted({m.term for m in result.meetings if m.term})
        label = term or (terms[0] if len(terms) == 1 else "courses")
        output = (args.output or Path(f"ontario-tech-{label}.ics")).expanduser().absolute()
        targets = [output] + ([args.save_schedule.expanduser().absolute()] if args.save_schedule else [])
        if len(set(targets)) != len(targets):
            raise ValueError("Calendar and JSON output paths must be different.")
        if args.input and args.input.expanduser().absolute() in targets:
            raise ValueError("Choose an output path different from the input JSON.")
        for target in targets:
            if target.exists() and not args.force:
                raise FileExistsError(f"{target.name} already exists. Choose --output, or use --force to replace it.")
        print(f"\nReady: {count} class events; {len(excluded)} excluded dates.\nOutput: {output}")
        if not args.yes:
            wording = "Export these events, accepting the items listed above? [y/N]: " if result.warnings else "Export these events? [y/N]: "
            if input(wording).strip().lower() not in {"y", "yes"}:
                print("Cancelled; no files written.")
                return 0
        write_private(output, calendar, overwrite=args.force)
        print(f"\nSaved {count} events to {output}")
        if args.save_schedule:
            schedule = json.dumps(editable_schedule(result.meetings), ensure_ascii=False, indent=2) + "\n"
            write_private(args.save_schedule, schedule.encode(), overwrite=args.force)
            print(f"Saved editable schedule to {args.save_schedule.absolute()}")
        print("Import: Google Calendar on a computer → Settings → Import & export → select this .ics.")
        print("Use a separate course calendar. An imported file is a snapshot; it does not sync schedule changes.")
        return 0
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return 130
    except EOFError:
        print("Run from an interactive desktop terminal; offline conversions can use --yes.", file=sys.stderr)
        return 1
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
