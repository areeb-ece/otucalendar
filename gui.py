"""Local Tk desktop interface. Browser work runs away from Tk's UI thread."""
from __future__ import annotations

import asyncio
from concurrent.futures import Future
from dataclasses import replace
import json
from pathlib import Path
import queue
import sys
import threading

from calendar_core import (DAY_LABELS, editable_schedule, exclusions, make_calendar,
                           normalize, parse_date, write_private)
from event_style import (EventStyle, PLACEHOLDERS, PRESETS, default_style_path,
                         load_style, render_event, save_style, values_for)
from browser_capture import ensure_browser

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError as exc:
    raise RuntimeError("The GUI needs Tkinter. On Windows, install full Python from python.org with Tcl/Tk support. "
                       "Fedora: sudo dnf install python3-tkinter; "
                       "CachyOS/Arch: sudo pacman -S tk; Ubuntu/Mint: sudo apt install python3-tk") from exc

BG, CARD, INPUT = "#101720", "#192432", "#101b28"
FG, MUTED, ACCENT, LINE, ERROR = "#edf4fa", "#9aafc3", "#6ed9c7", "#304356", "#ffb59f"
ROOT = Path(__file__).resolve().parent


class CalendarApp(tk.Tk):
    def __init__(self, args=None):
        super().__init__()
        self.title("Ontario Tech · Course Calendar")
        self.geometry("1220x820")
        self.minsize(1040, 720)
        self.configure(bg=BG)
        self.args = args
        self.meetings, self.warnings = [], []
        self.raw_data = None
        self.is_sample = False
        self.capturing = False
        self.closing = False
        self.cancel_requested = False
        self.worker_loop = self.worker_task = None
        self.pending_prompt = None
        self.events = queue.Queue()
        self.refresh_job = None
        self.active_field = "title"
        self._theme()
        self._build()
        initial_style = PRESETS["Minimal"]
        style_path = getattr(args, "style_file", None) or default_style_path()
        if style_path.exists():
            try:
                initial_style = load_style(style_path)
            except (ValueError, OSError) as exc:
                self.status.set(f"Could not load saved style: {exc}")
        elif getattr(args, "style_file", None):
            self.status.set("The supplied style file was not found. Using Minimal.")
        initial_style = EventStyle(**{
            name: getattr(args, name + "_template", None) if getattr(args, name + "_template", None) is not None else getattr(initial_style, name)
            for name in ("title", "description", "location")
        })
        self.set_style(initial_style)
        self.preview_example = normalize(json.loads((ROOT / "sample_schedule.json").read_text())).meetings[0]
        if args:
            self.browser.set(args.browser)
            self.term.set(args.term)
            self.skip.insert("1.0", args.exclude)
            if args.exclude_file:
                try:
                    self.skip.insert("end", "\n" + args.exclude_file.read_text())
                except OSError as exc:
                    self.status.set(str(exc))
            if args.reminder is not None:
                self.reminders.set(True)
                self.reminder_minutes.set(str(args.reminder))
            if args.start_date:
                self.first_date.set(args.start_date.isoformat())
            if args.end_date:
                self.last_date.set(args.end_date.isoformat())
            if args.input:
                self.after(0, lambda: self.load_file(args.input))
        self.protocol("WM_DELETE_WINDOW", self.close_app)
        self.poll_job = self.after(80, self.poll)
        self.refresh()

    def _theme(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=FG, font=("DejaVu Sans", 10))
        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=CARD)
        style.configure("TLabel", background=BG, foreground=FG)
        style.configure("Card.TLabel", background=CARD)
        style.configure("Muted.TLabel", foreground=MUTED)
        style.configure("TButton", background=LINE, foreground=FG, borderwidth=0, padding=(12, 8))
        style.map("TButton", background=[("active", "#3b5369"), ("disabled", "#202b37")], foreground=[("disabled", "#76899a")])
        style.configure("Accent.TButton", background=ACCENT, foreground=BG, font=("DejaVu Sans", 10, "bold"))
        style.map("Accent.TButton", background=[("active", "#9aebdc"), ("disabled", "#284740")], foreground=[("disabled", "#a0b6b1")])
        style.configure("TEntry", fieldbackground=INPUT, foreground=FG, insertcolor=FG, bordercolor=LINE, padding=5)
        style.configure("TCombobox", fieldbackground=INPUT, foreground=FG, background=LINE, arrowcolor=FG, padding=5)
        style.map("TCombobox", fieldbackground=[("readonly", INPUT)], foreground=[("readonly", FG)])
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", background=BG, padding=(12, 9), foreground=MUTED)
        style.map("TNotebook.Tab", background=[("selected", CARD)], foreground=[("selected", FG)])
        style.configure("Treeview", background=INPUT, fieldbackground=INPUT, foreground=FG, rowheight=33, borderwidth=0)
        style.configure("Treeview.Heading", background=LINE, foreground=FG, padding=(7, 7), borderwidth=0)
        style.map("Treeview", background=[("selected", "#315568")])
        style.configure("TCheckbutton", background=BG, foreground=FG)
        self.option_add("*TCombobox*Listbox.background", INPUT)
        self.option_add("*TCombobox*Listbox.foreground", FG)

    def text_box(self, parent, height=1, **kwargs):
        return tk.Text(parent, height=height, bg=INPUT, fg=FG, insertbackground=ACCENT,
                       selectbackground="#315568", relief="flat", padx=10, pady=8,
                       highlightthickness=1, highlightbackground=LINE, highlightcolor=ACCENT,
                       font=("DejaVu Sans", 10), wrap="word", undo=True, **kwargs)

    def _build(self):
        outer = ttk.Frame(self, padding=(24, 18))
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(4, weight=1)
        ttk.Label(outer, text="COURSE CALENDAR", foreground=ACCENT, font=("DejaVu Sans", 9, "bold")).grid(row=0, sticky="w")
        ttk.Label(outer, text="Make your schedule yours.", font=("DejaVu Sans", 24, "bold")).grid(row=1, sticky="w", pady=(4, 12))
        toolbar = ttk.Frame(outer)
        toolbar.grid(row=2, sticky="ew")
        self.login_button = ttk.Button(toolbar, text="Sign in & load courses", style="Accent.TButton", command=self.start_capture)
        self.login_button.pack(side="left", padx=(0, 8))
        self.open_button = ttk.Button(toolbar, text="Open saved schedule", command=self.choose_file)
        self.open_button.pack(side="left", padx=(0, 8))
        self.sample_button = ttk.Button(toolbar, text="Try sample", command=self.load_sample)
        self.sample_button.pack(side="left", padx=(0, 8))
        self.save_button = ttk.Button(toolbar, text="Save schedule…", command=self.save_schedule, state="disabled")
        self.save_button.pack(side="left")
        self.status = tk.StringVar(value="Start by signing in, or open a saved schedule. Your password stays in the university browser.")
        ttk.Label(outer, textvariable=self.status, style="Muted.TLabel", wraplength=1120).grid(row=3, sticky="ew", pady=(10, 14))
        body = ttk.Frame(outer)
        body.grid(row=4, sticky="nsew")
        body.columnconfigure(0, weight=0, minsize=410)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)
        self.tabs = ttk.Notebook(body, width=395)
        self.tabs.grid(row=0, column=0, sticky="nsew", padx=(0, 18))
        appearance = ttk.Frame(self.tabs, padding=16)
        settings = ttk.Frame(self.tabs, padding=16)
        logtab = ttk.Frame(self.tabs, padding=10)
        self.tabs.add(appearance, text="Appearance")
        self.tabs.add(settings, text="Export options")
        self.tabs.add(logtab, text="Read log")

        presetrow = ttk.Frame(appearance)
        presetrow.pack(fill="x", pady=(0, 12))
        self.preset = tk.StringVar(value="Minimal")
        combo = ttk.Combobox(presetrow, textvariable=self.preset, values=tuple(PRESETS) + ("Custom",), state="readonly", width=17)
        combo.pack(side="left", fill="x", expand=True)
        combo.bind("<<ComboboxSelected>>", lambda _: self.set_style(PRESETS[self.preset.get()]) if self.preset.get() in PRESETS else None)
        ttk.Button(presetrow, text="Remember style", command=self.remember_style).pack(side="right", padx=(8, 0))
        self.fields = {}
        for name, label, height in (("title", "Event title", 1), ("description", "Description", 3), ("location", "Location", 1)):
            ttk.Label(appearance, text=label, font=("DejaVu Sans", 10, "bold")).pack(anchor="w", pady=(0, 5))
            widget = self.text_box(appearance, height=height, width=34)
            widget.pack(fill="x", pady=(0, 12))
            widget.bind("<<Modified>>", self.changed)
            widget.bind("<FocusIn>", lambda _, n=name: setattr(self, "active_field", n))
            self.fields[name] = widget
        insertrow = ttk.Frame(appearance)
        insertrow.pack(fill="x", pady=(0, 8))
        self.placeholder = tk.StringVar(value="{CourseCode}")
        ttk.Combobox(insertrow, textvariable=self.placeholder, values=tuple("{" + k + "}" for k in PLACEHOLDERS), state="readonly", width=23).pack(side="left", fill="x", expand=True)
        ttk.Button(insertrow, text="Insert", command=self.insert_placeholder).pack(side="right", padx=(8, 0))
        ttk.Label(appearance, text="Click a field, then insert a placeholder. Leave description or location blank to omit it.", style="Muted.TLabel", wraplength=360).pack(anchor="w")
        self.validation = tk.StringVar()
        ttk.Label(appearance, textvariable=self.validation, foreground=ERROR, wraplength=360).pack(fill="x", pady=(12, 0))

        self.term = tk.StringVar()
        self.browser = tk.StringVar(value="auto")
        self.first_date, self.last_date = tk.StringVar(), tk.StringVar()
        self.reminders = tk.BooleanVar(value=False)
        self.reminder_minutes = tk.StringVar(value="15")
        ttk.Label(settings, text="Dates to skip", font=("DejaVu Sans", 10, "bold")).pack(anchor="w")
        self.skip = self.text_box(settings, height=3, width=34)
        self.skip.pack(fill="x", pady=(6, 6))
        ttk.Label(settings, text="YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD\nHolidays and reading week are not added automatically.", style="Muted.TLabel", wraplength=360).pack(anchor="w", pady=(0, 12))
        remind = ttk.Frame(settings)
        remind.pack(fill="x", pady=(0, 16))
        ttk.Checkbutton(remind, text="Reminder", variable=self.reminders).pack(side="left")
        ttk.Entry(remind, textvariable=self.reminder_minutes, width=5).pack(side="left", padx=8)
        ttk.Label(remind, text="minutes before class").pack(side="left")
        for label, var in (("Term code (optional filter)", self.term), ("Fallback first class date", self.first_date), ("Fallback last class date", self.last_date)):
            line = ttk.Frame(settings)
            line.pack(fill="x", pady=4)
            ttk.Label(line, text=label).pack(side="left")
            ttk.Entry(line, textvariable=var, width=13).pack(side="right")
        ttk.Button(settings, text="Apply term / fallback dates", command=self.reparse).pack(fill="x", pady=(8, 10))
        row = ttk.Frame(settings)
        row.pack(fill="x")
        ttk.Label(row, text="Browser").pack(side="left")
        ttk.Combobox(row, textvariable=self.browser, values=("auto", "chromium", "chrome", "firefox"), state="readonly", width=16).pack(side="right")
        ttk.Label(settings, text="Missing room information? Select a course and use Edit room details.", style="Muted.TLabel", wraplength=360).pack(fill="x", pady=(14, 0))
        self.log = self.text_box(logtab, height=15, width=32)
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

        right = ttk.Frame(body)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)
        right.rowconfigure(2, weight=2)
        heading = ttk.Frame(right)
        heading.grid(row=0, sticky="ew", pady=(0, 8))
        self.source = tk.StringVar(value="Your courses")
        ttk.Label(heading, textvariable=self.source, font=("DejaVu Sans", 12, "bold")).pack(side="left")
        self.edit_button = ttk.Button(heading, text="Edit room details…", command=self.edit_room, state="disabled")
        self.edit_button.pack(side="right")
        table = ttk.Frame(right)
        table.grid(row=1, sticky="nsew", pady=(0, 14))
        self.tree = ttk.Treeview(table, columns=("code", "type", "time"), show="headings", height=5, selectmode="browse")
        for key, label, width in (("code", "Course", 170), ("type", "Type", 115), ("time", "Meets", 205)):
            self.tree.heading(key, text=label, anchor="w")
            self.tree.column(key, width=width, minwidth=70)
        scrollbar = ttk.Scrollbar(table, command=self.tree.yview)
        scrollbar.pack(side="right", fill="y")
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.pack(side="left", fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", lambda _: self.refresh())

        preview = ttk.Frame(right, style="Card.TFrame", padding=20)
        preview.grid(row=2, sticky="nsew")
        preview.columnconfigure(0, weight=1)
        preview.rowconfigure(5, weight=1)
        self.preview_caption = tk.StringVar(value="SAMPLE PREVIEW")
        ttk.Label(preview, textvariable=self.preview_caption, style="Card.TLabel", foreground=ACCENT, font=("DejaVu Sans", 9, "bold")).grid(row=0, sticky="w")
        self.preview_title = tk.StringVar()
        self.title_label = ttk.Label(preview, textvariable=self.preview_title, style="Card.TLabel", font=("DejaVu Sans", 19, "bold"), wraplength=570)
        self.title_label.grid(row=1, sticky="ew", pady=(12, 8))
        self.preview_time, self.preview_location = tk.StringVar(), tk.StringVar()
        ttk.Label(preview, textvariable=self.preview_time, style="Card.TLabel", foreground=MUTED).grid(row=2, sticky="w", pady=(0, 10))
        ttk.Label(preview, text="LOCATION", style="Card.TLabel", foreground=MUTED, font=("DejaVu Sans", 8, "bold")).grid(row=3, sticky="w")
        self.location_label = ttk.Label(preview, textvariable=self.preview_location, style="Card.TLabel", wraplength=570)
        self.location_label.grid(row=4, sticky="ew", pady=(4, 12))
        self.preview_description = self.text_box(preview, height=3, width=35)
        self.preview_description.configure(bg=CARD, highlightthickness=0, padx=0, pady=0, state="disabled")
        self.preview_description.grid(row=5, sticky="nsew")
        self.preview_note = tk.StringVar()
        ttk.Label(preview, textvariable=self.preview_note, style="Card.TLabel", foreground=MUTED, wraplength=570).grid(row=6, sticky="ew", pady=(10, 0))
        preview.bind("<Configure>", lambda e: [w.configure(wraplength=max(200, e.width - 42)) for w in (self.title_label, self.location_label)])

        self.prompt_box = ttk.Frame(outer, padding=(0, 10))
        self.prompt_box.grid(row=5, sticky="ew")
        self.prompt_box.grid_remove()
        footer = ttk.Frame(outer)
        footer.grid(row=6, sticky="ew", pady=(14, 0))
        self.total = tk.StringVar(value="Load a schedule to export your classes.")
        ttk.Label(footer, textvariable=self.total, style="Muted.TLabel").pack(side="left")
        self.export_button = ttk.Button(footer, text="Export calendar (.ics)", style="Accent.TButton", command=self.export_calendar, state="disabled")
        self.export_button.pack(side="right")

    def style(self):
        return EventStyle(**{name: widget.get("1.0", "end-1c") for name, widget in self.fields.items()})

    def set_style(self, style):
        for name, widget in self.fields.items():
            widget.delete("1.0", "end")
            widget.insert("1.0", getattr(style, name))
            widget.edit_modified(False)
        self.preset.set(next((name for name, preset in PRESETS.items() if preset == style), "Custom"))
        if hasattr(self, "preview_example"):
            self.refresh()

    def changed(self, event):
        if not event.widget.edit_modified():
            return
        event.widget.edit_modified(False)
        self.preset.set("Custom")
        if self.refresh_job:
            self.after_cancel(self.refresh_job)
        self.refresh_job = self.after(100, self.refresh)

    def insert_placeholder(self):
        widget = self.fields[self.active_field]
        try:
            widget.delete("sel.first", "sel.last")
        except tk.TclError:
            pass
        widget.insert("insert", self.placeholder.get())
        widget.focus_set()

    def selected_index(self):
        selection = self.tree.selection()
        return int(selection[0]) if selection else 0

    def refresh(self):
        self.refresh_job = None
        if not hasattr(self, "preview_example"):
            return
        meeting = self.meetings[self.selected_index()] if self.meetings else self.preview_example
        try:
            style = self.style()
            rendered = render_event(meeting, style)
            for other in self.meetings:
                render_event(other, style)
            self.validation.set("")
            self.export_button.configure(state="normal" if self.meetings and not self.capturing else "disabled")
            self.preview_title.set(rendered.title)
            self.preview_location.set(rendered.location or "Omitted")
            self.preview_description.configure(state="normal")
            self.preview_description.delete("1.0", "end")
            self.preview_description.insert("1.0", rendered.description or "No description")
            self.preview_description.configure(state="disabled")
            self.preview_note.set("Unavailable fields: " + ", ".join(rendered.missing) if rendered.missing else "These are the exact title, location, and description that will be exported.")
        except ValueError as exc:
            self.validation.set(str(exc))
            self.export_button.configure(state="disabled")
        values = values_for(meeting)
        self.preview_time.set(f"{values['Days']}  ·  {values['StartTime']}–{values['EndTime']}  ·  Toronto time")
        self.preview_caption.set("SAMPLE PREVIEW · FICTIONAL COURSES" if not self.meetings or self.is_sample else "EVENT PREVIEW")
        self.total.set(f"All {len(self.meetings)} meeting patterns will be exported." if self.meetings else "Load a schedule to export your classes.")

    def remember_style(self):
        try:
            style = self.style()
            render_event(self.meetings[0] if self.meetings else self.preview_example, style)
            save_style(default_style_path(), style)
            self.status.set("Style remembered. It will be restored the next time you open this window.")
        except (ValueError, OSError) as exc:
            messagebox.showerror("Could not save style", str(exc), parent=self)

    def choose_file(self):
        name = filedialog.askopenfilename(parent=self, title="Open schedule JSON", filetypes=[("Schedule JSON", "*.json")])
        if name:
            self.load_file(Path(name))

    def load_file(self, path):
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            self.is_sample = Path(path).resolve() == (ROOT / "sample_schedule.json").resolve()
            if isinstance(data, dict):
                self.is_sample = self.is_sample or "FICTIONAL SAMPLE" in str(data.get("note", ""))
            self.set_data(data)
        except (ValueError, OSError) as exc:
            messagebox.showerror("Could not load schedule", str(exc), parent=self)

    def load_sample(self):
        self.term.set("")
        self.load_file(ROOT / "sample_schedule.json")

    def set_data(self, data):
        result = normalize(data, term=self.term.get().strip(),
                           start=parse_date(self.first_date.get()) if self.first_date.get().strip() else None,
                           end=parse_date(self.last_date.get()) if self.last_date.get().strip() else None)
        self.raw_data = data
        self.meetings, self.warnings = result.meetings, result.warnings
        self.tree.delete(*self.tree.get_children())
        for i, meeting in enumerate(self.meetings):
            values = values_for(meeting)
            self.tree.insert("", "end", iid=str(i), values=(meeting.code or meeting.title, meeting.kind,
                             f"{values['Days']} {values['StartTime']}–{values['EndTime']}"))
        if self.meetings:
            self.tree.selection_set("0")
        self.source.set(f"{'Sample courses' if self.is_sample else 'Your courses'} · {len(self.meetings)} meetings")
        self.save_button.configure(state="normal" if self.meetings else "disabled")
        self.edit_button.configure(state="normal" if self.meetings else "disabled")
        self.status.set(f"Loaded {len(self.meetings)} meeting patterns. " + (f"{len(self.warnings)} items need attention; see Read log." if self.warnings else "Select a course to preview your style."))
        if not self.meetings:
            self.status.set("No scheduled meetings found. Check the term filter and Read log; add fallback dates in Export options if needed.")
        for warning in self.warnings:
            self.append_log(warning)
        self.refresh()

    def reparse(self):
        if self.raw_data is None:
            return
        try:
            self.set_data(self.raw_data)
        except ValueError as exc:
            messagebox.showerror("Check term or dates", str(exc), parent=self)

    def edit_room(self):
        if not self.meetings:
            return
        index = self.selected_index()
        meeting = self.meetings[index]
        dialog = tk.Toplevel(self)
        dialog.title("Room details · " + (meeting.code or meeting.title))
        dialog.configure(bg=BG)
        dialog.transient(self)
        frame = ttk.Frame(dialog, padding=20)
        frame.pack(fill="both", expand=True)
        variables = {}
        for row, (key, label) in enumerate((("building_code", "Building code"), ("room", "Room number"), ("building_name", "Building name"), ("campus", "Campus"))):
            variables[key] = tk.StringVar(value=getattr(meeting, key))
            ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", padx=(0, 14), pady=6)
            ttk.Entry(frame, textvariable=variables[key], width=30).grid(row=row, column=1)
        def save():
            fields = {key: var.get().strip() for key, var in variables.items()}
            building = fields["building_name"] or fields["building_code"]
            fields["location"] = ", ".join(filter(None, (" ".join(filter(None, (building, fields["room"]))), fields["campus"])))
            self.meetings[index] = replace(meeting, **fields)
            self.raw_data = editable_schedule(self.meetings)
            dialog.destroy()
            self.refresh()
        ttk.Button(frame, text="Save room details", style="Accent.TButton", command=save).grid(row=4, column=0, columnspan=2, sticky="ew", pady=(16, 0))
        dialog.grab_set()

    def save_schedule(self):
        name = filedialog.asksaveasfilename(parent=self, title="Save editable schedule", defaultextension=".json", initialfile="my-schedule.json", filetypes=[("Schedule JSON", "*.json")])
        if not name:
            return
        try:
            data = editable_schedule(self.meetings)
            if self.is_sample:
                data["note"] = "FICTIONAL SAMPLE ONLY. This is not your registered schedule."
            write_private(Path(name), (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode(), overwrite=True)
            self.status.set("Saved editable schedule. You can reopen it without signing in.")
        except OSError as exc:
            messagebox.showerror("Could not save", str(exc), parent=self)

    def export_bytes(self):
        reminder = int(self.reminder_minutes.get()) if self.reminders.get() else None
        if reminder is not None and not 0 <= reminder <= 40320:
            raise ValueError("Reminder must be between 0 and 40320 minutes.")
        return make_calendar(self.meetings, exclusions(self.skip.get("1.0", "end-1c")), reminder, self.style())

    def export_calendar(self):
        try:
            content, count = self.export_bytes()
            missing = sorted({field for meeting in self.meetings for field in render_event(meeting, self.style()).missing})
            notices = list(self.warnings)
            if missing:
                notices.append("Some values are unavailable and will be blank: " + ", ".join(missing))
            if self.is_sample:
                notices.insert(0, "This schedule contains fictional SAMPLE classes.")
            if notices and not messagebox.askyesno("Review before exporting", "\n\n".join(notices) + "\n\nExport the available events?", parent=self):
                return
            terms = sorted({meeting.term for meeting in self.meetings if meeting.term})
            label = terms[0] if len(terms) == 1 else "courses"
            name = filedialog.asksaveasfilename(parent=self, title=f"Save {count} calendar events", defaultextension=".ics", initialfile=f"ontario-tech-{label}.ics", filetypes=[("iCalendar", "*.ics")])
            if not name:
                return
            write_private(Path(name), content, overwrite=True)
            self.status.set(f"Saved {count} events to {Path(name).name}. Import it in Google Calendar → Settings → Import & export.")
            messagebox.showinfo("Calendar exported", f"Saved {count} events.\n\nGoogle Calendar → Settings → Import & export.\nAn imported file is a snapshot, not a live sync.", parent=self)
        except (ValueError, OSError) as exc:
            messagebox.showerror("Could not export", str(exc), parent=self)

    def append_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", str(text).strip() + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def start_capture(self):
        if self.capturing:
            self.cancel_capture()
            return
        term, browser = self.term.get().strip(), self.browser.get()
        if term and (len(term) != 6 or not term.isascii() or not term.isdigit()):
            messagebox.showerror("Check term", "Enter a six-digit term code, or leave it empty and select a term in the browser.", parent=self)
            return
        self.capturing = True
        self.cancel_requested = False
        self.login_button.configure(text="Cancel loading")
        for widget in (self.open_button, self.sample_button, self.export_button, self.edit_button, self.save_button):
            widget.configure(state="disabled")
        self.status.set("Opening your university sign-in page...")
        def worker():
            from browser_capture import capture
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            async def prompt(message):
                future = Future()
                self.events.put(("prompt", message, future))
                return await asyncio.wrap_future(future)
            def log(message):
                self.events.put(("log", message))
            async def run():
                await ensure_browser(browser, log)
                return await capture(term=term, browser_name=browser, prompt=prompt, log=log)
            task = loop.create_task(run())
            self.events.put(("worker", loop, task))
            try:
                self.events.put(("loaded", loop.run_until_complete(task)))
            except asyncio.CancelledError:
                self.events.put(("cancelled",))
            except Exception as exc:
                self.events.put(("error", str(exc)))
            finally:
                loop.run_until_complete(loop.shutdown_asyncgens())
                loop.close()
                self.events.put(("finished",))
        threading.Thread(target=worker, daemon=True).start()

    def cancel_capture(self):
        self.cancel_requested = True
        self.status.set("Closing the temporary browser session...")
        if self.worker_loop and not self.worker_loop.is_closed() and self.worker_task and not self.worker_task.done():
            self.worker_loop.call_soon_threadsafe(self.worker_task.cancel)

    def show_prompt(self, message, future):
        self.pending_prompt = future
        for widget in self.prompt_box.winfo_children():
            widget.destroy()
        self.prompt_box.grid()
        if "Press Enter when" in message:
            label = "Sign in and select your term in the browser. When your schedule is visible, click Read schedule."
            ttk.Label(self.prompt_box, text=label, wraplength=760).pack(side="left")
            ttk.Button(self.prompt_box, text="Read schedule", style="Accent.TButton", command=lambda: self.resolve_prompt("")).pack(side="right")
        elif "Open those courses" in message:
            ttk.Label(self.prompt_box, text="Some meeting data is missing. Open those courses' details in the browser, then retry. See Read log.", wraplength=590).pack(side="left")
            ttk.Button(self.prompt_box, text="Use available data", command=lambda: self.resolve_prompt("continue")).pack(side="right", padx=8)
            ttk.Button(self.prompt_box, text="Retry", command=lambda: self.resolve_prompt("")).pack(side="right")
        else:
            ttk.Label(self.prompt_box, text=message.strip(), wraplength=650).pack(side="left")
            value = tk.StringVar()
            ttk.Entry(self.prompt_box, textvariable=value, width=12).pack(side="left", padx=12)
            ttk.Button(self.prompt_box, text="Continue", command=lambda: self.resolve_prompt(value.get().strip())).pack(side="right")
        self.lift()

    def resolve_prompt(self, value):
        if self.pending_prompt and not self.pending_prompt.done():
            self.pending_prompt.set_result(value)
        self.pending_prompt = None
        self.prompt_box.grid_remove()

    def poll(self):
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "worker":
                    self.worker_loop, self.worker_task = event[1:]
                    if self.cancel_requested:
                        self.cancel_capture()
                elif kind == "log":
                    self.append_log(event[1])
                    self.status.set(str(event[1]).strip()[:200])
                elif kind == "prompt":
                    if not event[2].done():
                        self.show_prompt(event[1], event[2])
                elif kind == "loaded":
                    data, term = event[1]
                    self.term.set(term)
                    self.is_sample = False
                    try:
                        self.set_data(data)
                    except ValueError as exc:
                        messagebox.showerror("Check meeting dates", str(exc), parent=self)
                elif kind == "error":
                    self.append_log(event[1])
                    self.status.set("Could not load the schedule. See Read log for details.")
                    if not self.closing:
                        messagebox.showerror("Could not load schedule", event[1], parent=self)
                elif kind == "cancelled":
                    self.status.set("Loading cancelled. Your existing preview is unchanged.")
                elif kind == "finished":
                    self.capturing = False
                    self.worker_loop = self.worker_task = None
                    self.pending_prompt = None
                    self.prompt_box.grid_remove()
                    self.login_button.configure(text="Sign in & load courses")
                    self.open_button.configure(state="normal")
                    self.sample_button.configure(state="normal")
                    self.edit_button.configure(state="normal" if self.meetings else "disabled")
                    self.save_button.configure(state="normal" if self.meetings else "disabled")
                    self.refresh()
                    if self.closing:
                        self.destroy()
                        return
        except queue.Empty:
            pass
        self.poll_job = self.after(80, self.poll)

    def destroy(self):
        for job in (getattr(self, "poll_job", None), getattr(self, "refresh_job", None)):
            if job:
                try:
                    self.after_cancel(job)
                except tk.TclError:
                    pass
        super().destroy()

    def close_app(self):
        if self.capturing:
            self.closing = True
            self.cancel_capture()
        else:
            self.destroy()


def launch(args=None):
    try:
        app = CalendarApp(args)
    except tk.TclError as exc:
        raise RuntimeError("The GUI could not open a display. On Windows double-click run.bat; on Linux use a desktop terminal: bash run.sh --gui") from exc
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(launch())
