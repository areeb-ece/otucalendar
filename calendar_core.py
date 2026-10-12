"""Normalize Banner meeting data and create a Google Calendar compatible file."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import tempfile
import os
import sys
from typing import Any, Iterator
from zoneinfo import ZoneInfo

TORONTO = ZoneInfo("America/Toronto")
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MISSING = {"", "tba", "tbd", "none", "null", "n/a", "arr", "arranged"}


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def valid_crn(value: Any) -> bool:
    """Ontario Tech course reference numbers contain exactly five ASCII digits."""
    return re.fullmatch(r"[0-9]{5}", text(value)) is not None


def pick(obj: dict, *keys: str, default: Any = "") -> Any:
    for key in keys:
        if key in obj and obj[key] is not None and text(obj[key]) != "":
            return obj[key]
    return default


def truth(value: Any) -> bool:
    return value is True or text(value).lower() in {"true", "1", "y", "yes"}


def parse_date(value: Any) -> date:
    value = text(value)
    if re.match(r"^\d{4}-\d{2}-\d{2}(?:$|T| )", value):
        return date.fromisoformat(value[:10])
    for fmt in ("%m/%d/%Y", "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Missing or unrecognized date: {value!r}")


def parse_time(value: Any) -> time:
    value = text(value).upper().replace(".", "")
    if value.lower() in MISSING:
        raise ValueError("no scheduled time (TBA / asynchronous)")
    if re.fullmatch(r"\d{1,4}", value):
        value = value.zfill(4)
        return time(int(value[:2]), int(value[2:]))
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            pass
    raise ValueError(f"Unrecognized time: {value!r}")


def parse_days(obj: dict) -> tuple[int, ...]:
    if any(key in obj for key in WEEKDAYS):
        return tuple(i for i, key in enumerate(WEEKDAYS) if truth(obj.get(key)))
    raw = pick(obj, "days", "daysOfWeek", default=[])
    if isinstance(raw, str):
        raw = re.split(r"[, /]+", raw.strip())
        if len(raw) == 1 and re.fullmatch(r"[MTWRFSU]+", raw[0]):
            raw = list(raw[0])
    if not isinstance(raw, list):
        raise ValueError("Unrecognized weekdays")
    names = {label[:2].lower(): i for i, label in enumerate(WEEKDAYS)}
    names.update(dict(zip("mtwrfsu", range(7))))
    days = set()
    for item in raw:
        if isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 6:
            days.add(item)
        else:
            key = text(item).lower()
            key = key if len(key) == 1 else key[:2]
            if key not in names:
                raise ValueError(f"Unrecognized weekday: {item!r}")
            days.add(names[key])
    return tuple(sorted(days))


@dataclass(frozen=True)
class Meeting:
    term: str
    crn: str
    code: str
    title: str
    kind: str
    start_date: date
    end_date: date
    start_time: time
    end_time: time
    days: tuple[int, ...]
    location: str = ""
    instructor: str = ""
    interval_weeks: int = 1
    building_code: str = ""
    building_name: str = ""
    room: str = ""
    campus: str = ""

    @property
    def label(self) -> str:
        return " · ".join(filter(None, (self.code, self.title, self.kind)))


@dataclass
class ParseResult:
    meetings: list[Meeting] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    course_count: int = 0


def course_records(payload: Any) -> Iterator[dict]:
    """Find course objects in Banner list/data wrappers or our editable format."""
    if isinstance(payload, list):
        for item in payload:
            yield from course_records(item)
    elif isinstance(payload, dict):
        crn = pick(payload, "courseReferenceNumber", "crn")
        is_course = any(key in payload for key in (
            "courseTitle", "courseNumber", "subject", "subjectCourse", "meetingsFaculty", "meetings", "title"))
        if valid_crn(crn) and is_course:
            yield payload
            return
        for key, item in payload.items():
            if key not in {"faculty", "meetingTime", "meetingTimes"} and isinstance(item, (dict, list)):
                yield from course_records(item)


def meeting_records(payload: Any, inherited: dict | None = None) -> Iterator[dict]:
    """Accept lists, fmt/meetingsFaculty wrappers, and multiple meetingTime entries."""
    inherited = inherited or {}
    if isinstance(payload, list):
        for item in payload:
            yield from meeting_records(item, inherited)
    elif isinstance(payload, dict):
        meta = {**inherited}
        for key in ("faculty", "scheduleTypeDescription", "scheduleType", "startDate", "endDate"):
            if key in payload:
                meta[key] = payload[key]
        if any(key in payload for key in ("beginTime", "start_time", "endTime", "end_time")):
            yield {**meta, **payload}
            return
        for key in ("meetingTime", "meetingTimes", "meetingsFaculty", "meetings", "fmt", "data"):
            if key in payload:
                yield from meeting_records(payload[key], meta)


def instructors(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return ""
    names = []
    for person in raw:
        if not isinstance(person, dict):
            continue
        name = text(pick(person, "displayName", "name"))
        if not name:
            name = " ".join(filter(None, (text(person.get("firstName")), text(person.get("lastName")))))
        if name and name not in names:
            names.append(name)
    return ", ".join(names)


def normalize(payload: Any, *, term: str = "", start: date | None = None,
              end: date | None = None) -> ParseResult:
    result = ParseResult()
    seen = set()
    for course in course_records(payload):
        course_term = text(pick(course, "term", "termCode", default=term))
        if term and course_term and course_term != term:
            continue
        result.course_count += 1
        crn = text(pick(course, "courseReferenceNumber", "crn"))
        code = text(pick(course, "code", "subjectCourse"))
        if not code:
            code = " ".join(filter(None, (text(course.get("subject")), text(course.get("courseNumber")))))
        title = text(pick(course, "courseTitle", "title", default=f"CRN {crn}"))
        label = f"{code or title} (CRN {crn})"
        # Registration-history pages can contain dropped or waitlisted sections.
        status = text(pick(course, "registrationStatusDescription", "statusDescription", "status")).lower()
        status_code = text(pick(course, "registrationStatus", "registrationStatusCode")).upper()
        if any(word in status for word in ("drop", "withdraw", "waitlist", "cancel")) or status_code in {"DD", "DW", "DC", "WL", "WD"}:
            result.warnings.append(f"{label}: excluded registration status {status or status_code}.")
            continue
        raw_meetings = list(meeting_records(course))
        if not raw_meetings:
            result.warnings.append(f"{label}: no meeting data found; open this course's meeting details and retry.")
        for index, raw in enumerate(raw_meetings, 1):
            try:
                begin = parse_time(pick(raw, "start_time", "beginTime"))
                finish = parse_time(pick(raw, "end_time", "endTime"))
                if finish == begin:
                    raise ValueError("start and end times are identical")
                days = parse_days(raw)
                if not days:
                    raise ValueError("no scheduled weekdays (TBA / asynchronous)")
                raw_start = pick(raw, "start_date", "startDate", default=pick(course, "startDate", "start_date"))
                raw_end = pick(raw, "end_date", "endDate", default=pick(course, "endDate", "end_date"))
                first = parse_date(raw_start) if raw_start else start
                last = parse_date(raw_end) if raw_end else end
                if first is None or last is None:
                    raise ValueError("missing meeting dates; supply --start-date and --end-date")
                if last < first or (last - first).days > 400:
                    raise ValueError("invalid meeting date range (maximum 400 days)")
                interval = int(pick(raw, "interval_weeks", default=1))
                if not 1 <= interval <= 52:
                    raise ValueError("interval_weeks must be between 1 and 52")
                building_code = text(pick(raw, "building_code", "buildingCode", "building"))
                building_name = text(pick(raw, "building_name", "buildingDescription"))
                room = text(pick(raw, "room", "roomNumber"))
                campus = text(pick(raw, "campusDescription", "campus"))
                location = text(raw.get("location"))
                if not location:
                    building = building_name or building_code
                    location = ", ".join(filter(None, (" ".join(filter(None, (building, room))), campus)))
                meeting = Meeting(
                    term=course_term, crn=crn, code=code, title=title,
                    kind=text(pick(raw, "kind", "scheduleTypeDescription", "scheduleType",
                                   default=pick(course, "scheduleTypeDescription", "scheduleType"))),
                    start_date=first, end_date=last, start_time=begin, end_time=finish,
                    days=days, location=location,
                    instructor=instructors(pick(raw, "instructor", "faculty", default=course.get("faculty"))),
                    interval_weeks=interval,
                    building_code=building_code, building_name=building_name, room=room, campus=campus,
                )
                if meeting not in seen:
                    seen.add(meeting)
                    result.meetings.append(meeting)
            except (ValueError, TypeError, OverflowError) as exc:
                result.warnings.append(f"{label}, meeting {index}: {exc}.")
    return result


def exclusions(spec: str) -> set[date]:
    """Comma/newline-separated ISO dates or inclusive YYYY-MM-DD..YYYY-MM-DD."""
    answer = set()
    clean = "\n".join(line.split("#", 1)[0] for line in spec.splitlines())
    for token in re.split(r"[,\s]+", clean.strip()):
        if not token:
            continue
        bounds = token.split("..")
        if len(bounds) > 2:
            raise ValueError(f"Invalid excluded range: {token}")
        first, last = parse_date(bounds[0]), parse_date(bounds[-1])
        if last < first or (last - first).days > 400:
            raise ValueError(f"Invalid excluded range: {token}")
        answer.update(first + timedelta(days=i) for i in range((last - first).days + 1))
    return answer


def occurrences(meeting: Meeting, skip: set[date]) -> Iterator[tuple[datetime, datetime]]:
    day = meeting.start_date
    anchor = day - timedelta(days=day.weekday())
    while day <= meeting.end_date:
        week = (day - anchor).days // 7
        if day.weekday() in meeting.days and week % meeting.interval_weeks == 0 and day not in skip:
            begin = datetime.combine(day, meeting.start_time, TORONTO)
            end_day = day + timedelta(days=meeting.end_time < meeting.start_time)
            finish = datetime.combine(end_day, meeting.end_time, TORONTO)
            # Each occurrence is converted separately, retaining local class times over DST.
            yield begin.astimezone(timezone.utc), finish.astimezone(timezone.utc)
        day += timedelta(days=1)


def make_calendar(meetings: list[Meeting], skip: set[date] | None = None,
                  reminder: int | None = None, style=None) -> tuple[bytes, int]:
    from icalendar import Alarm, Calendar, Event
    from event_style import render_event
    cal = Calendar()
    cal.add("prodid", "-//Ontario Tech Course Exporter//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("x-wr-calname", "Ontario Tech Courses")
    cal.add("x-wr-timezone", "America/Toronto")
    stamp = datetime.now(timezone.utc)
    seen = set()
    count = 0
    for meeting in meetings:
        rendered = render_event(meeting, style)
        for begin, finish in occurrences(meeting, skip or set()):
            key = (meeting.term, meeting.crn, meeting.kind, begin.isoformat(), finish.isoformat())
            if key in seen:
                continue
            seen.add(key)
            event = Event()
            event.add("uid", sha256(json.dumps(key).encode()).hexdigest() + "@ontario-tech-course-exporter.local")
            event.add("dtstamp", stamp)
            event.add("dtstart", begin)
            event.add("dtend", finish)
            event.add("summary", rendered.title)
            if rendered.location:
                event.add("location", rendered.location)
            if rendered.description:
                event.add("description", rendered.description)
            event.add("transp", "OPAQUE")
            if reminder is not None:
                alarm = Alarm()
                alarm.add("action", "DISPLAY")
                alarm.add("description", rendered.title)
                alarm.add("trigger", timedelta(minutes=-reminder))
                event.add_component(alarm)
            cal.add_component(event)
            count += 1
    if not count:
        raise ValueError("No class occurrences to export. No calendar file was written.")
    return cal.to_ical(), count


def editable_schedule(meetings: list[Meeting]) -> dict:
    courses: dict[tuple[str, str], dict] = {}
    for meeting in meetings:
        row = asdict(meeting)
        key = (meeting.term, meeting.crn)
        course = courses.setdefault(key, {k: row[k] for k in ("term", "crn", "code", "title")})
        for name in ("term", "crn", "code", "title"):
            row.pop(name)
        for name in ("start_date", "end_date", "start_time", "end_time"):
            row[name] = row[name].isoformat()
        row["days"] = [DAY_LABELS[day] for day in meeting.days]
        course.setdefault("meetings", []).append(row)
    return {"format": "ontario-tech-calendar-v1", "timezone": "America/Toronto", "courses": list(courses.values())}


def write_private(path: Path, content: bytes, *, overwrite: bool = False) -> None:
    """Write private local files without truncating an existing output on failure."""
    path = path.expanduser().absolute()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(prefix=".calendar-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(content)
        if overwrite:
            os.replace(temp, path)
        elif sys.platform == "win32":
            # Windows rename refuses an existing destination; no hard-link support is needed.
            os.rename(temp, path)
        else:
            os.link(temp, path)  # Atomic no-clobber, including existing symlinks.
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
