"""Template tests; GUI integration tests run when DISPLAY is available."""
from dataclasses import replace
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

from icalendar import Calendar
from calendar_core import editable_schedule, make_calendar, normalize
from event_style import EventStyle, PRESETS, load_style, render_event, room_label, save_style
from test_exporter import banner_course


def course_with_room():
    course = banner_course()
    course["meetingsFaculty"][0]["meetingTime"].update(building="UA", room="1234")
    return course


class TemplateTests(unittest.TestCase):
    def setUp(self):
        self.meeting = normalize([course_with_room()]).meetings[0]

    def test_requested_minimal_style_exports_only_requested_display_fields(self):
        blob, count = make_calendar([self.meeting], reminder=15, style=PRESETS["Minimal"])
        event = Calendar.from_ical(blob).walk("VEVENT")[0]
        self.assertEqual(count, 3)
        self.assertEqual(str(event["SUMMARY"]), "ELEE TEST · Lecture")
        self.assertEqual(str(event["DESCRIPTION"]), "UA 1234")
        self.assertNotIn("LOCATION", event)
        self.assertEqual(str(event.walk("VALARM")[0]["DESCRIPTION"]), "ELEE TEST · Lecture")
        self.assertNotIn("CRN:", blob.decode())
        self.assertNotIn("Example Building", blob.decode())
        self.assertNotIn("Exported from", blob.decode())

    def test_room_metadata_survives_editable_roundtrip(self):
        reloaded = normalize(editable_schedule([self.meeting])).meetings[0]
        self.assertEqual(reloaded, self.meeting)
        self.assertEqual(render_event(reloaded, PRESETS["Minimal"]).description, "UA 1234")
        self.assertEqual(room_label("UA", "UA1234"), "UA1234")
        self.assertEqual(room_label("UA", "UA 1234"), "UA 1234")
        self.assertEqual(room_label("UA", ""), "")

    def test_blank_fields_are_omitted_and_style_does_not_change_event_identity(self):
        a = Calendar.from_ical(make_calendar([self.meeting])[0]).walk("VEVENT")
        b = Calendar.from_ical(make_calendar([self.meeting], style=EventStyle("{CourseCode}", "", ""))[0]).walk("VEVENT")
        self.assertEqual([str(e["UID"]) for e in a], [str(e["UID"]) for e in b])
        self.assertNotIn("DESCRIPTION", b[0])
        self.assertNotIn("LOCATION", b[0])

    def test_literal_braces_case_insensitive_fields_and_unsafe_placeholders(self):
        style = EventStyle("{{CourseCode}} {type}", "{roomcodeandnumber}\n{Instructor}", "")
        rendered = render_event(self.meeting, style)
        self.assertEqual(rendered.title, "{CourseCode} Lecture")
        self.assertEqual(rendered.description, "UA 1234\nExample Teacher")
        for value in ("{CourseCode.__class__}", "{CourseCode[0]}", "{CourseCode!r}", "{CourseCode:100000}", "{}", "{Unknown}", "{CourseCode"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                render_event(self.meeting, EventStyle(value, "", ""))
        with self.assertRaisesRegex(ValueError, "title is empty"):
            render_event(self.meeting, EventStyle("", "", ""))

    def test_old_saved_location_is_not_guessed_as_room_code(self):
        old = replace(self.meeting, room="", building_code="")
        rendered = render_event(old, PRESETS["Minimal"])
        self.assertEqual(rendered.description, "")
        self.assertIn("RoomCodeandNumber", rendered.missing)

    def test_style_persistence_and_invalid_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "style.json"
            save_style(path, PRESETS["Minimal"])
            self.assertEqual(load_style(path), PRESETS["Minimal"])
            if sys.platform != "win32":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            path.write_text('{"title":{},"description":"","location":""}')
            with self.assertRaises(ValueError):
                load_style(path)

    def test_cli_template_flags(self):
        root = Path(__file__).parent
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "classes.ics"
            result = subprocess.run([sys.executable, str(root / "export_courses.py"), "--input",
                str(root / "sample_schedule.json"), "--output", str(output), "--yes", "--title-template",
                "{CourseCode} {TypeShort}", "--description-template", "{RoomCodeandNumber}", "--location-template", ""],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            event = Calendar.from_ical(output.read_bytes()).walk("VEVENT")[0]
            self.assertEqual(str(event["SUMMARY"]), "DEMO 1000U LEC")
            self.assertEqual(str(event["DESCRIPTION"]), "EX 101")
            self.assertNotIn("LOCATION", event)


@unittest.skipUnless(sys.platform == "win32" or os.environ.get("DISPLAY"), "GUI tests need a desktop display or Xvfb")
class GuiTests(unittest.TestCase):
    def setUp(self):
        from gui import CalendarApp
        self.folder = tempfile.TemporaryDirectory()
        self.style_patch = patch("gui.default_style_path", return_value=Path(self.folder.name) / "appearance.json")
        self.style_patch.start()
        self.app = CalendarApp()
        self.app.update()

    def tearDown(self):
        if self.app.capturing:
            self.app.cancel_capture()
            self.pump_until(lambda: not self.app.capturing)
        self.app.destroy()
        self.style_patch.stop()
        self.folder.cleanup()

    def pump_until(self, condition):
        deadline = time.monotonic() + 5
        while not condition() and time.monotonic() < deadline:
            self.app.update()
            time.sleep(0.01)
        self.assertTrue(condition())

    def test_live_preview_validation_and_actual_save_action(self):
        self.app.load_sample()
        self.app.update()
        self.assertEqual(self.app.preview_title.get(), "DEMO 1000U · Lecture")
        self.assertEqual(self.app.preview_description.get("1.0", "end-1c"), "EX 101")
        self.app.set_style(EventStyle("{NoSuchField}", "", ""))
        self.assertEqual(str(self.app.export_button["state"]), "disabled")
        self.app.set_style(EventStyle("{CourseCode} {TypeShort}", "Room {RoomCodeandNumber}", ""))
        self.app.refresh()
        target = Path(self.folder.name) / "custom.ics"
        with patch("gui.filedialog.asksaveasfilename", return_value=str(target)), \
             patch("gui.messagebox.askyesno", return_value=True), patch("gui.messagebox.showinfo"):
            self.app.export_calendar()
        event = Calendar.from_ical(target.read_bytes()).walk("VEVENT")[0]
        self.assertEqual(str(event["SUMMARY"]), self.app.preview_title.get())
        self.assertEqual(str(event["DESCRIPTION"]), self.app.preview_description.get("1.0", "end-1c"))
        self.assertNotIn("LOCATION", event)
        self.app.remember_style()
        self.assertEqual(load_style(Path(self.folder.name) / "appearance.json"), self.app.style())

    def test_gui_browser_prompts_and_cancellation_use_no_terminal_input(self):
        async def fake_capture(**kwargs):
            await kwargs["prompt"]("Press Enter when your schedule is visible (or q to cancel): ")
            return {"courses": [course_with_room()]}, "202609"
        with patch("gui.ensure_browser", new=AsyncMock()), patch("browser_capture.capture", new=fake_capture):
            self.app.start_capture()
            self.pump_until(lambda: self.app.pending_prompt is not None)
            self.app.resolve_prompt("")
            self.pump_until(lambda: not self.app.capturing)
            self.assertEqual(len(self.app.meetings), 1)
            self.app.start_capture()
            self.pump_until(lambda: self.app.pending_prompt is not None)
            self.app.cancel_capture()
            self.pump_until(lambda: not self.app.capturing)
            self.assertEqual(len(self.app.meetings), 1)


if __name__ == "__main__":
    unittest.main()
