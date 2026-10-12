"""Plain-text calendar templates. No Python evaluation or attribute access."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
from string import Formatter
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from calendar_core import Meeting


@dataclass(frozen=True)
class EventStyle:
    title: str = "{DefaultTitle}"
    description: str = "{DefaultDescription}"
    location: str = "{Location}"


PRESETS = {
    "Minimal": EventStyle("{CourseCode} · {Type}", "{RoomCodeandNumber}", ""),
    "Room in location": EventStyle("{CourseCode} · {TypeShort}", "{CourseName}", "{RoomCodeandNumber}"),
    "Full details": EventStyle(),
}
PLACEHOLDERS = (
    "CourseCode", "CourseName", "Type", "TypeShort", "RoomCodeandNumber", "RoomNumber",
    "BuildingCode", "BuildingName", "Campus", "Instructor", "CRN", "Term", "Days",
    "StartTime", "EndTime", "StartDate", "EndDate", "Location", "DefaultTitle", "DefaultDescription",
)


def room_label(building_code: str, room: str) -> str:
    code, room = building_code.strip(), room.strip()
    if not room:
        return ""
    # Banner may already supply a prefixed room such as UA1234 or UA 1234.
    prefix = room[:len(code)].casefold() if code else ""
    tail = room[len(code):] if code else room
    if not code or (prefix == code.casefold() and (not tail or tail[0].isdigit() or tail[0] in " -")):
        return room
    return f"{code} {room}"


def values_for(meeting: Meeting) -> dict[str, str]:
    from calendar_core import DAY_LABELS
    short_types = {"lecture": "LEC", "laboratory": "LAB", "lab": "LAB", "tutorial": "TUT", "seminar": "SEM"}
    description = [f"CRN: {meeting.crn}", f"Term: {meeting.term}"]
    if meeting.instructor:
        description.append(f"Instructor: {meeting.instructor}")
    description.append("Exported from MyOntarioTech. Check the university schedule for changes.")
    return {
        "CourseCode": meeting.code, "CourseName": meeting.title, "Type": meeting.kind,
        "TypeShort": short_types.get(meeting.kind.casefold(), meeting.kind),
        "RoomCodeandNumber": room_label(meeting.building_code, meeting.room),
        "RoomNumber": meeting.room, "BuildingCode": meeting.building_code,
        "BuildingName": meeting.building_name, "Campus": meeting.campus,
        "Instructor": meeting.instructor, "CRN": meeting.crn, "Term": meeting.term,
        "Days": "/".join(DAY_LABELS[i] for i in meeting.days),
        "StartTime": meeting.start_time.strftime("%H:%M"), "EndTime": meeting.end_time.strftime("%H:%M"),
        "StartDate": meeting.start_date.isoformat(), "EndDate": meeting.end_date.isoformat(),
        "Location": meeting.location, "DefaultTitle": meeting.label,
        "DefaultDescription": "\n".join(description),
    }


def template_parts(template: str):
    if not isinstance(template, str) or len(template) > 20000:
        raise ValueError("Templates must be text, with at most 20,000 characters.")
    try:
        parts = list(Formatter().parse(template))
    except ValueError as exc:
        raise ValueError("Unmatched braces in a template. Use {CourseCode}, or {{ and }} for literal braces.") from exc
    canonical = {key.casefold(): key for key in PLACEHOLDERS}
    result = []
    for literal, field, spec, conversion in parts:
        if field is None:
            result.append((literal, None))
            continue
        if field.casefold() not in canonical or spec or conversion:
            raise ValueError(f"Unknown or unsupported placeholder {{{field}}}. Choose a field from the placeholder list.")
        result.append((literal, canonical[field.casefold()]))
    return result


def render_template(template: str, values: dict[str, str]) -> tuple[str, set[str]]:
    output, missing = [], set()
    for literal, field in template_parts(template):
        output.append(literal)
        if field is not None:
            value = values[field]
            output.append(value)
            if not value:
                missing.add(field)
    return "".join(output).strip(), missing


@dataclass(frozen=True)
class EventText:
    title: str
    description: str
    location: str
    missing: tuple[str, ...] = ()


def render_event(meeting: Meeting, style: EventStyle | None = None) -> EventText:
    style = style or EventStyle()
    values = values_for(meeting)
    title, missing_title = render_template(style.title, values)
    description, missing_description = render_template(style.description, values)
    location, missing_location = render_template(style.location, values)
    if not title:
        raise ValueError(f"The title is empty for {meeting.code or meeting.crn}. Add a title or a populated placeholder.")
    return EventText(title, description, location, tuple(sorted(missing_title | missing_description | missing_location)))


def default_style_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return base / "OntarioTechCalendar" / "appearance.json"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "ontario-tech-calendar" / "appearance.json"


def load_style(path: Path) -> EventStyle:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or any(not isinstance(data.get(k), str) for k in ("title", "description", "location")):
        raise ValueError("A style file needs text fields: title, description, and location.")
    style = EventStyle(**{k: data[k] for k in ("title", "description", "location")})
    for value in asdict(style).values():
        template_parts(value)
    return style


def save_style(path: Path, style: EventStyle) -> None:
    from calendar_core import write_private
    for value in asdict(style).values():
        template_parts(value)
    write_private(path, (json.dumps(asdict(style), ensure_ascii=False, indent=2) + "\n").encode(), overwrite=True)
