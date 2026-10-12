"""Windows bootstrap. Called by run.bat; only standard-library imports here."""
from pathlib import Path
import subprocess
import sys
import venv


def export_arguments(arguments):
    """Default to the GUI; --cli explicitly selects terminal operation."""
    args = list(arguments)
    terminal = "--cli" in args
    if terminal and "--gui" in args:
        raise ValueError("Choose either --cli or --gui.")
    args = [arg for arg in args if arg != "--cli"]
    if not terminal and not any(arg in args for arg in ("--gui", "--help", "-h", "--setup")):
        args.insert(0, "--gui")
    return args


def needs_browser(args):
    return not any(arg in {"--gui", "--help", "-h", "--input"} or arg.startswith("--input=") for arg in args)


def browser_option(args):
    for index, arg in enumerate(args):
        if arg.startswith("--browser="):
            return arg.split("=", 1)[1]
        if arg == "--browser" and index + 1 < len(args):
            return args[index + 1]
    return "auto"


def main(arguments=None):
    if sys.version_info < (3, 10):
        print("Python 3.10 or newer is required. Install Python from https://www.python.org/downloads/windows/.")
        return 1
    root = Path(__file__).resolve().parent
    python = root / ".venv-windows" / "Scripts" / "python.exe"
    requirements = root / "requirements.txt"
    marker = python.parent.parent / "requirements-installed.txt"
    try:
        args = export_arguments(sys.argv[1:] if arguments is None else arguments)
        if not python.is_file():
            print("Creating the Windows Python environment...", flush=True)
            venv.EnvBuilder(with_pip=True).create(python.parent.parent)
        required = requirements.read_bytes()
        if not marker.is_file() or marker.read_bytes() != required:
            print("Installing the exporter dependencies (first run)...", flush=True)
            subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(requirements)], cwd=root, check=True)
            marker.write_bytes(required)
        if "--setup" in args:
            subprocess.run([str(python), "-m", "playwright", "install", "--no-shell", "chromium"], cwd=root, check=True)
            print("Setup complete. Double-click run.bat to open the GUI.")
            return 0
        if needs_browser(args):
            # No shell evaluation: even argument values containing spaces stay intact.
            name = browser_option(args)
            if name not in {"auto", "chrome", "chromium", "firefox"}:
                raise ValueError("Browser must be auto, chrome, chromium, or firefox.")
            code = "import asyncio, sys; from browser_capture import ensure_browser; asyncio.run(ensure_browser(sys.argv[1], print))"
            subprocess.run([str(python), "-c", code, name], cwd=root, check=True)
        if "--gui" in args:
            print("Opening Course Calendar. You can minimize this console while the app runs.", flush=True)
        return subprocess.run([str(python), str(root / "export_courses.py"), *args], cwd=root).returncode
    except KeyboardInterrupt:
        print("\nCancelled.")
        return 130
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print("\nCould not start Course Calendar: " + str(exc))
        print("Use a full Python 3.10+ installation with pip and Tcl/Tk. Extract the ZIP to a writable folder first.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
