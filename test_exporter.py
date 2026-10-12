"""Run: python -m unittest -v test_exporter.py"""
from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from icalendar import Calendar
from browser_capture import BASE, CaptureStore, capture, request_parameters
from calendar_core import (TORONTO, editable_schedule, exclusions, make_calendar,
                           meeting_records, normalize, write_private)


def banner_course():
    return {
        "term": "202609", "courseReferenceNumber": "45860", "subject": "ELEE",
        "courseNumber": "TEST", "courseTitle": "Circuits, Signals; and Systems",
        "registrationStatusDescription": "Registered",
        "meetingsFaculty": [{
            "faculty": [{"displayName": "Example Teacher"}],
            "meetingTime": {
                "startDate": "10/26/2026", "endDate": "11/09/2026",
                "beginTime": "0900", "endTime": "1020", "monday": True,
                "tuesday": "false", "wednesday": False, "thursday": False,
                "friday": False, "saturday": False, "sunday": False,
                "buildingDescription": "Example Building", "room": "A;101",
                "campusDescription": "North", "scheduleTypeDescription": "Lecture",
            },
        }],
    }


class CalendarTests(unittest.TestCase):
    def test_dst_keeps_nine_am_locally_and_changes_utc(self):
        result = normalize({"data": [banner_course()]})
        blob, count = make_calendar(result.meetings)
        events = Calendar.from_ical(blob).walk("VEVENT")
        self.assertEqual(count, 3)
        self.assertEqual([e.decoded("dtstart").hour for e in events], [13, 14, 14])
        self.assertEqual([e.decoded("dtstart").astimezone(TORONTO).hour for e in events], [9, 9, 9])
        self.assertTrue(all((e.decoded("dtend") - e.decoded("dtstart")).total_seconds() == 4800 for e in events))
        self.assertEqual(str(events[0]["LOCATION"]), "Example Building A;101, North")
        self.assertIn("Example Teacher", str(events[0]["DESCRIPTION"]))

    def test_multiple_meeting_time_entries_and_wrappers(self):
        course = banner_course()
        first = course["meetingsFaculty"][0]["meetingTime"]
        second = {**first, "monday": False, "thursday": True, "beginTime": "1400", "endTime": "1700"}
        course["meetingsFaculty"][0]["meetingTime"] = [first, second]
        result = normalize([course])
        self.assertEqual(len(result.meetings), 2)
        self.assertEqual(make_calendar(result.meetings)[1], 5)
        self.assertEqual(len(list(meeting_records({"fmt": [{"meetingTime": [first, second]}]}))), 2)

    def test_disjoint_lab_ranges_are_not_filled_in(self):
        course = banner_course()
        raw = course["meetingsFaculty"][0]["meetingTime"]
        course["meetingsFaculty"] = [
            {"meetingTime": {**raw, "startDate": "10/26/2026", "endDate": "10/26/2026"}},
            {"meetingTime": {**raw, "startDate": "11/09/2026", "endDate": "11/09/2026"}},
        ]
        self.assertEqual(make_calendar(normalize([course]).meetings)[1], 2)

    def test_exclusions_and_inclusive_end_date(self):
        skipped = exclusions("2026-10-26,2026-11-01..2026-11-08 # comment")
        blob, count = make_calendar(normalize([banner_course()]).meetings, skipped)
        self.assertEqual(count, 1)
        event = Calendar.from_ical(blob).walk("VEVENT")[0]
        self.assertEqual(event.decoded("dtstart").astimezone(TORONTO).date(), date(2026, 11, 9))
        with self.assertRaises(ValueError):
            exclusions("2026-11-10..2026-11-01")

    def test_empty_export_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "No class occurrences"):
            make_calendar([])
        with self.assertRaises(ValueError):
            make_calendar(normalize([banner_course()]).meetings, exclusions("2026-10-01..2026-12-01"))

    def test_tba_missing_dates_and_dropped_courses_reported(self):
        course = banner_course()
        course["meetingsFaculty"][0]["meetingTime"]["beginTime"] = None
        self.assertIn("no scheduled time", normalize([course]).warnings[0])
        course = banner_course()
        course["meetingsFaculty"][0]["meetingTime"].pop("startDate")
        self.assertFalse(normalize([course]).meetings)
        self.assertEqual(len(normalize([course], start=date(2026, 10, 26)).meetings), 1)
        for status in ("Dropped", "Waitlisted", "Withdrawn"):
            course = banner_course()
            course["registrationStatusDescription"] = status
            result = normalize([course])
            self.assertFalse(result.meetings)
            self.assertIn("excluded", result.warnings[0])

    def test_midnight_overnight_and_invalid_time(self):
        course = banner_course()
        raw = course["meetingsFaculty"][0]["meetingTime"]
        raw.update(beginTime="2330", endTime="0030")
        events = Calendar.from_ical(make_calendar(normalize([course]).meetings)[0]).walk("VEVENT")
        self.assertEqual((events[0].decoded("dtend") - events[0].decoded("dtstart")).total_seconds(), 3600)
        raw.update(beginTime=0, endTime="0100")
        self.assertEqual(normalize([course]).meetings[0].start_time.hour, 0)
        raw["beginTime"] = "2561"
        self.assertFalse(normalize([course]).meetings)

    def test_term_filter_duplicates_and_stable_uids(self):
        a = banner_course()
        b = deepcopy(a)
        b["term"] = "202701"
        meetings = normalize([a, a, b], term="202609").meetings
        self.assertEqual(len(meetings), 1)
        one = Calendar.from_ical(make_calendar(meetings)[0]).walk("VEVENT")
        two = Calendar.from_ical(make_calendar(meetings + meetings)[0]).walk("VEVENT")
        self.assertEqual([str(e["UID"]) for e in one], [str(e["UID"]) for e in two])

    def test_editable_roundtrip_biweekly_and_ical_escaping(self):
        course = banner_course()
        course["courseTitle"] = "é" * 90 + ";,\\\nEND:VEVENT"
        result = normalize([course])
        editable = editable_schedule(result.meetings)
        editable["courses"][0]["meetings"][0]["interval_weeks"] = 2
        parsed = normalize(json.loads(json.dumps(editable)))
        blob, count = make_calendar(parsed.meetings, reminder=15)
        events = Calendar.from_ical(blob).walk("VEVENT")
        self.assertEqual(count, 2)
        self.assertEqual(len(events), 2)
        self.assertIn(course["courseTitle"], str(events[0]["SUMMARY"]))
        self.assertEqual(len(events[0].walk("VALARM")), 1)
        self.assertTrue(all(len(line) <= 75 for line in blob.split(b"\r\n")))

    def test_private_atomic_output_does_not_clobber(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.ics"
            write_private(path, b"first")
            if sys.platform != "win32":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                write_private(path, b"second")
            self.assertEqual(path.read_bytes(), b"first")
            write_private(path, b"third", overwrite=True)
            self.assertEqual(path.read_bytes(), b"third")


class CaptureTests(unittest.TestCase):
    def test_header_row_is_not_a_ninth_course(self):
        store = CaptureStore()
        header = {"courseReferenceNumber": "CRN", "courseTitle": "Title", "subject": "Subject"}
        courses = [{"courseReferenceNumber": str(45860 + i), "courseTitle": f"Example {i}"} for i in range(8)]
        selected = store.selected(1, "202409", [header, *courses])
        self.assertEqual(len(selected), 8)
        self.assertEqual([c["courseReferenceNumber"] for c in selected], [c["courseReferenceNumber"] for c in courses])

    def test_invalid_course_numbers_never_enter_capture(self):
        store = CaptureStore()
        for invalid in ("CRN", "", None, "1234", "123456", "45860 extra", "１２３４５"):
            row = {"term": "202409", "courseReferenceNumber": invalid, "courseTitle": "Header or invalid row"}
            store.ingest(BASE + "/registrationHistory/getRegistrationHistory?term=202409", [row], 1)
            self.assertFalse(store.selected(1, "202409", [row]))
            self.assertFalse(normalize([row]).meetings)
            self.assertEqual(normalize([row]).course_count, 0)
        store.ingest(BASE + "/searchResults/getFacultyMeetingTimes?term=202409&courseReferenceNumber=CRN", [], 1)
        self.assertFalse(store.details)

    def test_catalog_never_establishes_registration_or_crosses_terms(self):
        store = CaptureStore()
        course = banner_course()
        store.ingest(BASE + "/searchResults/searchResults?term=202609", {"data": [course]}, 1)
        self.assertFalse(store.selected(1, "202609", []))
        store.ingest(BASE + "/registrationHistory/getRegistrationHistory?term=202609", {"data": [course]}, 1)
        self.assertEqual(len(store.selected(1, "202609", [])), 1)
        self.assertFalse(store.selected(1, "202701", []))
        self.assertFalse(store.selected(2, "202609", []))

    def test_detail_enrichment_and_dom_fallback(self):
        store = CaptureStore()
        course = banner_course()
        details = course.pop("meetingsFaculty")
        store.ingest(BASE + "/registrationHistory/getRegistrationHistory", [course], 1)
        store.ingest(BASE + "/searchResults/getFacultyMeetingTimes?term=202609&courseReferenceNumber=45860", details, 1)
        rows = store.selected(1, "202609", [])
        self.assertEqual(len(normalize(rows).meetings), 1)
        store.ingest(BASE + "/searchResults/getFacultyMeetingTimes?term=202701&courseReferenceNumber=45860", [], 1)
        self.assertEqual(len(normalize(store.selected(1, "202609", [])).meetings), 1)
        dom = [{"courseReferenceNumber": "98765", "courseTitle": "Another Example"}]
        self.assertEqual(len(store.selected(1, "202609", dom)), 2)

    def test_foreign_hosts_and_unknown_term_are_not_trusted(self):
        store = CaptureStore()
        url = "https://example.org/StudentRegistrationSsb/ssb/registrationHistory/getRegistrationHistory"
        store.ingest(url, [banner_course()], 1)
        self.assertFalse(store.selected(1, "202609", []))
        course = banner_course()
        course.pop("term")
        store.ingest(BASE + "/registrationHistory/getRegistrationHistory", [course], 1)
        self.assertFalse(store.selected(1, "202609", []))
        self.assertEqual(len(store.selected(1, "202609", [course])), 1)

    def test_get_and_post_term_parameters(self):
        self.assertEqual(request_parameters("https://example.org/?term=202609")["term"], "202609")
        self.assertEqual(request_parameters("https://example.org/", "term=202701")["term"], "202701")
        self.assertEqual(request_parameters("https://example.org/", '{"term":"202609"}')["term"], "202609")


class CommandLineTests(unittest.TestCase):
    def test_offline_export_and_partial_export_guard(self):
        root = Path(__file__).parent
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "classes.ics"
            result = subprocess.run([sys.executable, str(root / "export_courses.py"), "--input",
                str(root / "sample_schedule.json"), "--output", str(output), "--yes"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(len(Calendar.from_ical(output.read_bytes()).walk("VEVENT")), 20)
            repeated = subprocess.run([sys.executable, str(root / "export_courses.py"), "--input",
                str(root / "sample_schedule.json"), "--output", str(output), "--yes"], capture_output=True, text=True)
            self.assertNotEqual(repeated.returncode, 0)
            bad = banner_course()
            bad["courseReferenceNumber"] = "00000"
            bad["meetingsFaculty"] = []
            source = Path(directory) / "partial.json"
            source.write_text(json.dumps([banner_course(), bad]))
            partial = subprocess.run([sys.executable, str(root / "export_courses.py"), "--input",
                str(source), "--output", str(Path(directory) / "partial.ics"), "--yes"], capture_output=True, text=True)
            self.assertNotEqual(partial.returncode, 0)
            self.assertIn("--allow-partial", partial.stderr)
            self.assertFalse((Path(directory) / "partial.ics").exists())


class BrowserFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_interactive_flow_reads_dom_and_details_and_closes_session(self):
        """Exercise the full capture workflow with a fake browser, without a real account."""
        course = banner_course()
        details = course["meetingsFaculty"]

        class FakePage:
            url = BASE + "/registrationHistory/registrationHistory?mepCode=UOIT"
            def is_closed(self):
                return False
            async def goto(self, *args, **kwargs):
                pass
            async def bring_to_front(self):
                pass
            async def evaluate(self, script, arg=None):
                if arg is None:
                    return {"term": "202609", "rows": [
                        {"courseReferenceNumber": "CRN", "courseTitle": "Title"},
                        {"courseReferenceNumber": "45860", "courseTitle": "Example"},
                    ]}
                if "/getFacultyMeetingTimes?" not in arg:
                    raise AssertionError("Unexpected endpoint: " + arg)
                if request_parameters(arg).get("courseReferenceNumber") != "45860":
                    raise AssertionError("Requested meeting details for a table heading: " + arg)
                return {"ok": True, "data": details}

        class FakeContext:
            def __init__(self):
                self.pages = [FakePage()]
                self.closed = False
            async def new_page(self):
                return self.pages[0]
            def on(self, *args):
                pass
            def remove_listener(self, *args):
                pass
            async def close(self):
                self.closed = True

        context = FakeContext()

        class FakeBrowser:
            closed = False
            async def new_context(self, **kwargs):
                return context
            def is_connected(self):
                return True
            async def close(self):
                self.closed = True

        browser = FakeBrowser()

        class FakePlaywright:
            chromium = type("Engine", (), {"launch": AsyncMock(return_value=browser)})()
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass

        with patch("playwright.async_api.async_playwright", return_value=FakePlaywright()), \
             patch("browser_capture.ask", new=AsyncMock(return_value="")), \
             patch("browser_capture.installed_chromium", return_value=None), \
             patch("builtins.print"):
            payload, term = await capture()
        self.assertEqual(term, "202609")
        self.assertEqual(len(normalize(payload).meetings), 1)
        self.assertTrue(context.closed)
        self.assertTrue(browser.closed)


if __name__ == "__main__":
    unittest.main()
