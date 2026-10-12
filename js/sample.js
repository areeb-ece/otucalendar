/* Fictional sample schedule (same data as samples/sample_schedule.json; tests keep them in sync). */
const OSAMPLE = {
 "format": "ontario-tech-calendar-v1",
 "note": "FICTIONAL SAMPLE ONLY. This is not anyone's registered schedule.",
 "timezone": "America/Toronto",
 "courses": [
  {
   "term": "202609",
   "crn": "99901",
   "code": "DEMO 1000U",
   "title": "Example Circuits Course",
   "meetings": [
    {
     "kind": "Lecture",
     "start_date": "2026-09-08",
     "end_date": "2026-12-07",
     "start_time": "15:00",
     "end_time": "16:20",
     "days": [
      "Mon",
      "Wed"
     ],
     "location": "Example building, room 101",
     "building_code": "EX",
     "building_name": "Example building",
     "room": "101",
     "instructor": "Example Instructor"
    }
   ]
  },
  {
   "term": "202609",
   "crn": "99902",
   "code": "DEMO 1000U",
   "title": "Example Circuits Course",
   "meetings": [
    {
     "kind": "Laboratory",
     "start_date": "2026-09-17",
     "end_date": "2026-12-03",
     "start_time": "11:10",
     "end_time": "14:00",
     "days": [
      "Thu"
     ],
     "interval_weeks": 2,
     "location": "Example lab, room 202",
     "building_code": "EX",
     "building_name": "Example lab",
     "room": "202"
    }
   ]
  },
  {
   "term": "202609",
   "crn": "99903",
   "code": "DEMO 1100U",
   "title": "Example Calculus Course",
   "meetings": [
    {
     "kind": "Lecture",
     "start_date": "2026-09-08",
     "end_date": "2026-12-07",
     "start_time": "09:40",
     "end_time": "11:00",
     "days": [
      "Tue",
      "Thu"
     ],
     "building_code": "EX",
     "building_name": "Example hall",
     "room": "120",
     "instructor": "Example Lecturer"
    },
    {
     "kind": "Tutorial",
     "start_date": "2026-09-14",
     "end_date": "2026-12-04",
     "start_time": "13:10",
     "end_time": "14:00",
     "days": [
      "Fri"
     ],
     "building_code": "EX",
     "building_name": "Example hall",
     "room": "220"
    }
   ]
  },
  {
   "term": "202609",
   "crn": "99904",
   "code": "DEMO 1200U",
   "title": "Example Programming Course",
   "meetings": [
    {
     "kind": "Lecture",
     "start_date": "2026-09-08",
     "end_date": "2026-12-07",
     "start_time": "12:40",
     "end_time": "14:00",
     "days": [
      "Mon",
      "Wed"
     ],
     "building_code": "EX",
     "building_name": "Example centre",
     "room": "1350"
    },
    {
     "kind": "Laboratory",
     "start_date": "2026-09-15",
     "end_date": "2026-12-01",
     "start_time": "15:40",
     "end_time": "18:30",
     "days": [
      "Tue"
     ],
     "building_code": "EX",
     "building_name": "Example centre",
     "room": "2060"
    }
   ]
  },
  {
   "term": "202609",
   "crn": "99905",
   "code": "DEMO 1300U",
   "title": "Example Writing Course",
   "meetings": [
    {
     "kind": "Lecture",
     "start_date": "2026-09-08",
     "end_date": "2026-12-07",
     "start_time": "11:10",
     "end_time": "12:30",
     "days": [
      "Fri"
     ],
     "building_code": "EX",
     "building_name": "Example annex",
     "room": "B5"
    }
   ]
  }
 ]
};
if (typeof module !== "undefined" && module.exports) module.exports = OSAMPLE;
