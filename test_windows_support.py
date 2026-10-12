"""Windows-specific paths and bootstrap logic simulated without requiring Windows."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from browser_capture import installed_chromium
from event_style import default_style_path
from windows_launcher import browser_option, export_arguments, main, needs_browser


class WindowsSupportTests(unittest.TestCase):
    def test_double_click_defaults_to_gui_and_preserves_path_arguments(self):
        self.assertEqual(export_arguments([]), ["--gui"])
        path = r"C:\Users\A Student\Documents\my-schedule.json"
        self.assertEqual(export_arguments(["--input", path]), ["--gui", "--input", path])
        self.assertEqual(export_arguments(["--cli", "--input", path]), ["--input", path])
        self.assertEqual(export_arguments(["--help"]), ["--help"])
        with self.assertRaises(ValueError):
            export_arguments(["--cli", "--gui"])

    def test_browser_is_only_needed_for_live_terminal_capture(self):
        self.assertTrue(needs_browser(export_arguments(["--cli"])))
        self.assertFalse(needs_browser(export_arguments([])))
        self.assertFalse(needs_browser(export_arguments(["--cli", "--input=sample.json"])))
        self.assertEqual(browser_option(["--browser", "firefox"]), "firefox")
        self.assertEqual(browser_option(["--browser=chrome"]), "chrome")

    def test_windows_style_and_chrome_paths_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix="calendar windows test ") as folder:
            base = Path(folder)
            chrome = base / "Google" / "Chrome" / "Application" / "chrome.exe"
            chrome.parent.mkdir(parents=True)
            chrome.touch()
            with patch("event_style.sys.platform", "win32"), patch.dict(os.environ, {"APPDATA": folder, "LOCALAPPDATA": folder}), patch("browser_capture.shutil.which", return_value=None):
                self.assertEqual(default_style_path(), base / "OntarioTechCalendar" / "appearance.json")
                self.assertEqual(installed_chromium(), str(chrome))

    def test_bootstrap_installs_once_and_runs_without_shell_expansion(self):
        with tempfile.TemporaryDirectory(prefix="calendar app with spaces ") as folder:
            root = Path(folder)
            (root / "requirements.txt").write_text("example==1.0\n")
            python = root / ".venv-windows" / "Scripts" / "python.exe"
            class Builder:
                def create(self, target):
                    python.parent.mkdir(parents=True)
                    python.touch()
            with patch("windows_launcher.__file__", str(root / "windows_launcher.py")), \
                 patch("windows_launcher.venv.EnvBuilder", return_value=Builder()), \
                 patch("windows_launcher.subprocess.run", return_value=SimpleNamespace(returncode=0)) as run, \
                 patch("builtins.print"):
                self.assertEqual(main([]), 0)
                self.assertEqual(run.call_count, 2)
                self.assertEqual(run.call_args.args[0], [str(python), str(root / "export_courses.py"), "--gui"])
                self.assertNotIn("shell", run.call_args.kwargs)
                run.reset_mock()
                self.assertEqual(main(["--input", "a schedule.json"]), 0)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args.args[0][-3:], ["--gui", "--input", "a schedule.json"])


if __name__ == "__main__":
    unittest.main()
