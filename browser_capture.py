"""Read registered Banner courses in a temporary browser session; no saved login."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import parse_qs, urlencode, urlsplit

from calendar_core import course_records, meeting_records, pick, text, valid_crn

SCHEDULE_URL = "https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/registrationHistory/registrationHistory?mepCode=UOIT"
HOST = "ssp.mycampus.ca"
BASE = "https://ssp.mycampus.ca/StudentRegistrationSsb/ssb"


async def ask(prompt: str) -> str:
    # Keep the Playwright event loop alive while the user signs in / selects a term.
    return (await asyncio.to_thread(input, prompt)).strip()


def request_parameters(url: str, body: str = "") -> dict[str, str]:
    params = parse_qs(urlsplit(url).query)
    if body:
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                params.update({k: [text(v)] for k, v in parsed.items() if isinstance(v, (str, int))})
        except ValueError:
            params.update(parse_qs(body))
    return {key: values[-1] for key, values in params.items() if values}


class CaptureStore:
    """Only registration-history responses establish course membership.

    Catalog/detail responses may enrich an already registered course, but can
    never introduce one. Term keys prevent a previous term leaking into export.
    """
    def __init__(self):
        self.courses: OrderedDict[tuple[int, str, str], dict] = OrderedDict()
        self.details: dict[tuple[int, str, str], object] = {}
        self.last_term: dict[int, str] = {}
        self.failures: set[str] = set()

    def ingest(self, url: str, payload: object, page_id: int, body: str = "") -> None:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != HOST:
            return
        path = parsed.path.lower()
        params = request_parameters(url, body)
        term = params.get("term", params.get("termCode", ""))
        if not re.fullmatch(r"\d{6}", term):
            term = ""
        if "/registrationhistory/" in path:
            for row in course_records(payload):
                course = deepcopy(row)
                course_term = text(pick(course, "term", "termCode", default=term))
                if not re.fullmatch(r"\d{6}", course_term):
                    course_term = ""
                crn = text(pick(course, "courseReferenceNumber", "crn"))
                course["term"] = course_term
                self.courses[(page_id, course_term, crn)] = course
                if course_term:
                    self.last_term[page_id] = course_term
        elif path.endswith("/getfacultymeetingtimes"):
            crn = text(params.get("courseReferenceNumber", params.get("crn", "")))
            if term and valid_crn(crn):
                self.details[(page_id, term, crn)] = deepcopy(payload)

    def selected(self, page_id: int, term: str, dom_rows: list[dict]) -> list[dict]:
        rows = OrderedDict()
        for (pid, course_term, crn), course in self.courses.items():
            if pid == page_id and course_term == term and valid_crn(crn):
                rows[crn] = deepcopy(course)
        for dom_row in dom_rows:
            crn = text(pick(dom_row, "courseReferenceNumber", "crn"))
            if not valid_crn(crn):
                continue
            unknown = self.courses.get((page_id, "", crn), {})
            course = rows.setdefault(crn, deepcopy(unknown))
            for key, value in dom_row.items():
                if value is not None and text(value):
                    course.setdefault(key, value)
            course["term"] = term
        for crn, course in rows.items():
            if not list(meeting_records(course)):
                detail = self.details.get((page_id, term, crn))
                if detail is not None:
                    course["meetingsFaculty"] = list(meeting_records(detail))
        return list(rows.values())


DOM_SCHEDULE = r"""() => {
  const rows = [];
  for (const tr of document.querySelectorAll('tr')) {
    const row = {};
    // Only this row's data cells: Banner's TH headings also have data-property.
    for (const cell of Array.from(tr.cells)) {
      if (cell.tagName !== 'TD' || !cell.hasAttribute('data-property')) continue;
      row[cell.getAttribute('data-property')] = cell.innerText.trim();
    }
    if (/^[0-9]{5}$/.test(row.courseReferenceNumber || '') &&
        (row.courseTitle || row.subject || row.courseNumber)) rows.push(row);
  }
  const terms = ['#lookupFilter', '#term', '[name="term"]', '[name="termCode"]']
    .flatMap(s => Array.from(document.querySelectorAll(s)))
    .map(e => e.value || '').filter(v => /^\d{6}$/.test(v));
  return {rows, term: terms[0] || ''};
}"""

FETCH_DETAILS = r"""async (url) => {
  if (new URL(url).origin !== location.origin) return {ok:false, status:0};
  // Banner's own jQuery AJAX hooks add its session synchronizer token.
  if (window.jQuery && window.jQuery.ajax) {
    return await new Promise(resolve => {
      window.jQuery.ajax({url, type:'GET', dataType:'json', timeout:20000})
        .done(data => resolve({ok:true, data}))
        .fail(xhr => resolve({ok:false, status:xhr.status}));
    });
  }
  const headers = {'Accept':'application/json', 'X-Requested-With':'XMLHttpRequest'};
  const token = document.querySelector('meta[name="synchronizer-token"]')?.content;
  if (token) headers['X-Synchronizer-Token'] = token;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(url, {credentials:'same-origin', headers, signal:abort.signal});
    if (!response.ok || !response.headers.get('content-type')?.includes('json'))
      return {ok:false, status:response.status};
    return {ok:true, data:await response.json()};
  } catch (_) { return {ok:false, status:0}; }
  finally { clearTimeout(timer); }
}"""


def installed_chromium() -> str | None:
    for binary in ("chromium", "chromium-browser", "google-chrome-stable", "google-chrome"):
        path = shutil.which(binary)
        if path:
            return path
    if sys.platform == "win32":
        for binary in ("chrome.exe", "chromium.exe"):
            path = shutil.which(binary)
            if path:
                return path
        for key in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"):
            folder = os.environ.get(key)
            if folder:
                path = Path(folder) / "Google" / "Chrome" / "Application" / "chrome.exe"
                if path.is_file():
                    return str(path)
    return None


async def ensure_browser(name: str, log) -> None:
    """Download a bundled browser only when the user starts a live capture."""
    from playwright.async_api import async_playwright
    if name == "chrome" or (name == "auto" and installed_chromium()):
        return
    browser = "firefox" if name == "firefox" else "chromium"
    async with async_playwright() as playwright:
        if Path(getattr(playwright, browser).executable_path).exists():
            return
    log("Installing the browser for first use. This may take a few minutes...")
    command = [sys.executable, "-m", "playwright", "install"]
    if browser == "chromium":
        command.append("--no-shell")
    command.append(browser)
    process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        while line := await process.stdout.readline():
            log(line.decode(errors="replace").strip())
        if await process.wait():
            raise RuntimeError("The browser download failed. See Read log and retry. Browser set to auto can also use an installed Chrome/Chromium browser.")
    finally:
        if process.returncode is None:
            process.terminate()
            await process.wait()


async def capture(*, term: str = "", browser_name: str = "auto", prompt=None, log=None) -> tuple[dict, str]:
    ask_user = prompt or ask
    report = log or print
    try:
        from playwright.async_api import async_playwright, Error as BrowserError
    except ImportError as exc:
        raise RuntimeError("Browser support is missing. Start with run.bat on Windows, or bash run.sh on Linux.") from exc

    store = CaptureStore()
    pending = set()
    async with async_playwright() as playwright:
        engine = playwright.firefox if browser_name == "firefox" else playwright.chromium
        executable = installed_chromium() if browser_name == "auto" else None
        options = {"headless": False}
        if executable:
            options["executable_path"] = executable
        if browser_name == "chrome":
            options["channel"] = "chrome"
        try:
            browser = await engine.launch(**options)
        except BrowserError as exc:
            raise RuntimeError(
                "The browser could not start. On Windows run run.bat --setup; on Linux run bash run.sh --setup. "
                "You can also use installed Chrome/Chromium with Browser set to auto. "
                "See README.md for platform setup instructions."
            ) from exc
        context = await browser.new_context(timezone_id="America/Toronto", locale="en-CA")
        # A fresh, temporary context; no password, cookies, HAR, or browser profile is saved by this tool.
        async def receive(response):
            parsed = urlsplit(response.url)
            path = parsed.path.lower()
            if parsed.hostname != HOST or not (
                "/registrationhistory/" in path or path.endswith("/getfacultymeetingtimes")
            ):
                return
            if response.request.resource_type not in {"xhr", "fetch"}:
                return
            if response.status != 200:
                store.failures.add(f"{parsed.path}: HTTP {response.status}")
                return
            try:
                payload = await response.json()
                page_id = id(response.frame.page)
                store.ingest(response.url, payload, page_id, response.request.post_data or "")
            except (BrowserError, ValueError, TypeError):
                # Expired-session HTML isn't meeting data. Never print response bodies or login URLs.
                pass

        def queue(response):
            task = asyncio.create_task(receive(response))
            pending.add(task)
            task.add_done_callback(pending.discard)

        context.on("response", queue)
        page = await context.new_page()
        try:
            try:
                await page.goto(SCHEDULE_URL, wait_until="domcontentloaded", timeout=60000)
            except BrowserError:
                report("The page is loading slowly. You can continue in the open browser or refresh it.")
            report("\n1. Sign in on the university page using your normal network credentials.")
            report("2. Complete any verification, then select your term in My course schedule.")
            report("3. Wait for your registered courses to appear. Keep this browser open.")
            while True:
                command = await ask_user("\nPress Enter when your schedule is visible (or q to cancel): ")
                if command.lower() == "q":
                    raise RuntimeError("Cancelled; no calendar was written.")
                if not browser.is_connected():
                    raise RuntimeError("The browser was closed. Run the exporter again and keep it open.")
                pages = [p for p in context.pages if not p.is_closed() and
                         urlsplit(p.url).hostname == HOST and "/registrationHistory/" in p.url]
                if not pages:
                    report("Open My course schedule / View Registration Information after signing in, then retry.")
                    continue
                page = pages[-1]
                if len(pages) > 1:
                    report("Reading the most recently opened schedule tab.")
                await page.bring_to_front()
                if pending:
                    await asyncio.gather(*list(pending), return_exceptions=True)
                dom = await page.evaluate(DOM_SCHEDULE)
                selected_term = dom["term"] or store.last_term.get(id(page), "")
                if term and selected_term and term != selected_term:
                    report(f"The browser has term {selected_term}, but --term requests {term}. Select that term and retry.")
                    continue
                chosen = term or selected_term
                while not re.fullmatch(r"\d{6}", chosen):
                    chosen = await ask_user("Enter the six-digit Banner term code shown for your schedule: ")
                courses = store.selected(id(page), chosen, dom["rows"])
                if not courses:
                    report("No registered course rows were captured. Refresh the schedule, select the term, then retry.")
                    continue
                report(f"\nReading meeting details for {len(courses)} course sections in term {chosen}...")
                for course in courses:
                    if list(meeting_records(course)):
                        continue
                    crn = text(pick(course, "courseReferenceNumber", "crn"))
                    params = urlencode({"term": chosen, "courseReferenceNumber": crn})
                    url = f"{BASE}/searchResults/getFacultyMeetingTimes?{params}"
                    try:
                        data = await page.evaluate(FETCH_DETAILS, url)
                        if data.get("ok"):
                            course["meetingsFaculty"] = list(meeting_records(data["data"]))
                        else:
                            store.failures.add(f"Meeting details CRN {crn}: HTTP {data.get('status', 0)}")
                    except BrowserError:
                        store.failures.add(f"Meeting details CRN {crn}: browser request failed")
                missing = [text(pick(c, "courseReferenceNumber", "crn")) for c in courses if not list(meeting_records(c))]
                if missing:
                    report("Meeting data is missing for CRNs: " + ", ".join(missing))
                    for failure in sorted(store.failures):
                        report("  " + failure)
                    action = await ask_user("Open those courses' meeting details, then Enter to retry; type continue to review available data: ")
                    if action.lower() != "continue":
                        continue
                return {"courses": courses}, chosen
        except BrowserError as exc:
            raise RuntimeError("The browser session ended or the page changed while reading it. Run the exporter again and keep the schedule tab open.") from exc
        finally:
            context.remove_listener("response", queue)
            for task in list(pending):
                task.cancel()
            if pending:
                await asyncio.gather(*list(pending), return_exceptions=True)
            try:
                await context.close()
            except BrowserError:
                pass
            try:
                await browser.close()
            except BrowserError:
                pass
