from __future__ import annotations

import json
import os
import random
import uuid
from datetime import datetime
from http import HTTPStatus
from typing import Iterable, List, Set

import requests
from flask import Blueprint, current_app, jsonify, make_response, request, send_file
from sqlalchemy import delete, func

from src.database import db
from src.filesystem import (
    assignment_materials_payload,
    assignment_to_dict,
    code_payload,
    find_assignment_material_file,
    get_assignment,
    get_submission,
    scan_assignments,
    scan_submissions,
    submission_to_dict,
    testcase_payload,
)
from src.models import (
    MiniProlificSession,
    MiniProlificSurvey,
    MiniProlificTask,
    MiniProlificTaskLineError,
    MiniSubmissionGrade,
    MiniSubmissionManualError,
)

mini_api = Blueprint("mini_api", __name__)
submission_api = Blueprint("submission_api", __name__)
ai_api = Blueprint("ai_api", __name__)

AI_CLICKS_LOG = "/tabot-files/project-files/ai_clicks.log"
SUGGESTION_LIMIT = 3
PROLIFIC_ASSIGNMENT_IDS = [47, 51, 57]
PROLIFIC_TASK_MODES = [
    "rubric",
    "line_no_ai",
    "line_ai",
    "rubric",
    "line_no_ai",
    "line_ai",
    "rubric",
    "line_no_ai",
    "line_ai",
]
PROLIFIC_DESIRED_SOURCES = ["student", "ai", "student", "ai", "student", "ai", "student", "ai", "student"]
MODE_LABELS = {
    "rubric": "Standard rubric",
    "line_no_ai": "Line errors without AI",
    "line_ai": "Line errors with AI suggestions",
}

GRADING_ERROR_DEFS = [
    {
        "id": "IO_FORMAT",
        "label": "Wrong input, output, prompt, or formatting",
        "description": (
            "Use for incorrect prompts, input order, output text, spacing, "
            "capitalization, punctuation, decimal display, or output order."
        ),
        "points": 10,
    },
    {
        "id": "CALCULATION",
        "label": "Wrong calculation, formula, operator, or numeric result",
        "description": (
            "Use for wrong formulas, arithmetic, operators, precedence, rounding, or computed values."
        ),
        "points": 20,
    },
    {
        "id": "DECISION_LOGIC",
        "label": "Wrong condition, comparison, branch, or boundary",
        "description": (
            "Use for wrong if/else logic, comparisons, boolean expressions, ranges, categories, "
            "boundaries, or special cases."
        ),
        "points": 20,
    },
    {
        "id": "LOOP_LOGIC",
        "label": "Wrong loop structure, iteration count, or loop condition",
        "description": (
            "Use for incorrect loops, loop conditions, start/stop values, repeated actions, "
            "early exits, infinite loops, or off-by-one errors."
        ),
        "points": 20,
    },
    {
        "id": "VARIABLE_STATE",
        "label": "Wrong variable, initialization, update, or accumulated state",
        "description": (
            "Use for incorrect variables, missing initialization, wrong updates, overwritten values, "
            "or incorrect counters, totals, flags, minimums, or maximums."
        ),
        "points": 20,
    },
    {
        "id": "COLLECTIONS_INDEXING",
        "label": "Wrong list, array, string, dictionary, or index handling",
        "description": (
            "Use for incorrect collection use, indexing, slicing, lookup, length handling, "
            "iteration over items, or string/array access."
        ),
        "points": 20,
    },
    {
        "id": "FUNCTIONS_MODULARITY",
        "label": "Wrong function definition, call, parameter, return, or decomposition",
        "description": (
            "Use for missing or incorrect functions, parameters, arguments, return values, scope, "
            "or required program decomposition."
        ),
        "points": 20,
    },
    {
        "id": "REQUIREMENT_COMPLETENESS",
        "label": "Missing, incomplete, or misunderstood assignment requirement",
        "description": (
            "Use when required behavior, cases, sections, calculations, messages, or features "
            "are missing, incomplete, or substantially misunderstood."
        ),
        "points": 40,
    },
    {
        "id": "RUNTIME",
        "label": "Syntax error, crash, timeout, or program cannot run",
        "description": (
            "Use when the program cannot complete because of syntax errors, build/import failures, "
            "runtime exceptions, timeouts, or infinite loops."
        ),
        "points": 60,
    },
]

ERROR_DEFS = GRADING_ERROR_DEFS

GRADING_DEFAULT_DEFS_MAP = {
    e["id"]: {
        "label": e.get("label", e["id"]),
        "description": e.get("description", ""),
        "points": int(e.get("points", 0) or 0),
    }
    for e in GRADING_ERROR_DEFS
}

ALLOWED_IDS: Set[str] = {e["id"] for e in GRADING_ERROR_DEFS}


def _parse_int(value, default=-1) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default


def _json_or_none(value):
    if value is None:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def truncate_text(s: str, limit: int) -> str:
    s = (s or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(s) <= limit:
        return s
    return s[:limit] + "\n...[truncated]..."


def one_line(s: str) -> str:
    return (s or "").replace("\r", "\\r").replace("\n", "\\n")


def safe_int(value, default: int = -1) -> int:
    try:
        return int(value)
    except Exception:
        return default


def get_llm_url() -> str:
    return os.getenv("LLM_URL", "").strip()


def get_llm_model() -> str:
    return os.getenv("LLM_MODEL", "").strip()


def log_ai_click(submission_id: int, prompt: str, output: str) -> None:
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        username = "unknown"
        role = 0

        os.makedirs(os.path.dirname(AI_CLICKS_LOG), exist_ok=True)

        prompt_safe = one_line(truncate_text(prompt, 6000))
        output_safe = one_line(truncate_text(output, 6000))

        line = (
            f"{ts} | user:{username} | role:{role} | submission:{int(submission_id)}"
            f" | prompt:{prompt_safe} | output:{output_safe}\n"
        )

        with open(AI_CLICKS_LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def public_error_defs() -> List[dict]:
    return [
        {
            "id": str(e.get("id", "")),
            "label": str(e.get("label", e.get("id", ""))),
            "description": str(e.get("description", "")),
            "points": int(e.get("points", 0) or 0),
        }
        for e in GRADING_ERROR_DEFS
    ]

def completion_code() -> str:
    return os.getenv("PROLIFIC_COMPLETION_CODE", "MAATMINI-COMPLETE").strip() or "MAATMINI-COMPLETE"


def completion_url() -> str:
    code = completion_code()
    explicit = os.getenv("PROLIFIC_COMPLETION_URL", "").strip()
    if explicit:
        return explicit
    return f"https://app.prolific.com/submissions/complete?cc={code}"


def now_utc() -> datetime:
    return datetime.utcnow()


def prolific_session_to_dict(session: MiniProlificSession) -> dict:
    tasks = MiniProlificTask.query.filter_by(SessionDbId=session.Id).order_by(MiniProlificTask.TaskIndex).all()
    completed = [t for t in tasks if t.EndedAt is not None]
    first_open = next((t for t in tasks if t.EndedAt is None), tasks[0] if tasks else None)
    return {
        "success": True,
        "id": session.Id,
        "token": session.Token,
        "assignmentId": session.AssignmentId,
        "assignmentName": session.AssignmentName,
        "status": session.Status,
        "taskCount": len(tasks),
        "completedTaskCount": len(completed),
        "firstTaskId": first_open.Id if first_open else None,
        "completionCode": completion_code(),
        "completionUrl": completion_url(),
    }


def require_prolific_session(token: str) -> MiniProlificSession | None:
    token = str(token or "").strip()
    if not token:
        return None
    return MiniProlificSession.query.filter_by(Token=token).first()


def available_prolific_assignment_ids() -> list[int]:
    return [assignment_id for assignment_id in PROLIFIC_ASSIGNMENT_IDS if get_assignment(assignment_id)]


def choose_balanced_assignment_id() -> int | None:
    available = available_prolific_assignment_ids()
    if not available:
        return None

    count_rows = dict(
        db.session.query(MiniProlificSession.AssignmentId, func.count(MiniProlificSession.Id))
        .filter(MiniProlificSession.AssignmentId.in_(available))
        .group_by(MiniProlificSession.AssignmentId)
        .all()
    )
    min_count = min(int(count_rows.get(assignment_id, 0)) for assignment_id in available)
    least_used = [assignment_id for assignment_id in available if int(count_rows.get(assignment_id, 0)) == min_count]
    return random.choice(least_used)


def pick_submission(candidates, desired_source: str, used_ids: set[int], previous_id: int | None):
    pools = [
        [s for s in candidates if s.source == desired_source and s.id not in used_ids and s.id != previous_id],
        [s for s in candidates if s.source != desired_source and s.id not in used_ids and s.id != previous_id],
        [s for s in candidates if s.id not in used_ids and s.id != previous_id],
        [s for s in candidates if s.id != previous_id],
        list(candidates),
    ]
    for pool in pools:
        if pool:
            return random.choice(pool)
    return None


def create_prolific_tasks(session: MiniProlificSession) -> None:
    submissions = [s for s in scan_submissions(session.AssignmentId) if s.code_files]
    if not submissions:
        return

    used_ids: set[int] = set()
    selected = []
    previous_id = None

    for idx, (mode, desired_source) in enumerate(zip(PROLIFIC_TASK_MODES, PROLIFIC_DESIRED_SOURCES), start=1):
        is_repeat = False
        if idx == 7 and selected:
            repeat_source = selected[0]
            submission = repeat_source["submission"]
            is_repeat = True
            if previous_id == submission.id and len(selected) > 1:
                repeat_source = selected[1]
                submission = repeat_source["submission"]
        else:
            submission = pick_submission(submissions, desired_source, used_ids, previous_id)
            if submission:
                used_ids.add(submission.id)

        if not submission:
            continue

        selected.append({"mode": mode, "submission": submission, "isRepeat": is_repeat})
        previous_id = submission.id

    for idx, item in enumerate(selected, start=1):
        submission = item["submission"]
        db.session.add(
            MiniProlificTask(
                SessionDbId=session.Id,
                TaskIndex=idx,
                SubmissionId=submission.id,
                ProjectId=submission.project_id,
                Mode=item["mode"],
                Source=submission.source,
                IsRepeat=bool(item["isRepeat"]),
            )
        )


def task_line_errors(task_id: int) -> list[dict]:
    errors = MiniProlificTaskLineError.query.filter_by(TaskId=task_id).order_by(
        MiniProlificTaskLineError.StartLine,
        MiniProlificTaskLineError.EndLine,
        MiniProlificTaskLineError.ErrorId,
    ).all()
    return [
        {
            "startLine": err.StartLine,
            "endLine": err.EndLine,
            "errorId": err.ErrorId,
            "count": err.Count or 1,
            "note": err.Note or "",
        }
        for err in errors
    ]


def task_to_dict(task: MiniProlificTask, task_count: int) -> dict:
    rubric = _json_or_none(task.RubricJson) or {}
    return {
        "id": task.Id,
        "taskIndex": task.TaskIndex,
        "taskCount": task_count,
        "submissionId": task.SubmissionId,
        "projectId": task.ProjectId,
        "mode": task.Mode,
        "modeLabel": MODE_LABELS.get(task.Mode, task.Mode),
        "programLabel": f"Program {task.TaskIndex}",
        "isRepeat": bool(task.IsRepeat),
        "completed": task.EndedAt is not None,
        "grade": task.Grade,
        "rubricSelections": rubric.get("selections", []),
        "rubricComment": rubric.get("comment", ""),
        "errors": task_line_errors(task.Id),
    }


def require_task_for_session(session: MiniProlificSession, task_id: int) -> MiniProlificTask | None:
    return MiniProlificTask.query.filter_by(Id=task_id, SessionDbId=session.Id).first()


@mini_api.get("/health")
def health():
    return jsonify({"status": "ok"})


@mini_api.post("/prolific/session")
def create_or_resume_prolific_session():
    payload = request.get_json(silent=True) or {}
    prolific_pid = str(payload.get("prolificPid") or payload.get("PROLIFIC_PID") or "").strip()
    study_id = str(payload.get("studyId") or payload.get("STUDY_ID") or "").strip()
    session_id = str(payload.get("sessionId") or payload.get("SESSION_ID") or "").strip()

    if not prolific_pid or not study_id or not session_id:
        return make_response(
            jsonify({"success": False, "error": "PROLIFIC_PID, STUDY_ID, and SESSION_ID are required."}),
            HTTPStatus.BAD_REQUEST,
        )

    existing = MiniProlificSession.query.filter_by(
        ProlificPid=prolific_pid,
        StudyId=study_id,
        SessionId=session_id,
    ).first()
    if existing:
        return jsonify(prolific_session_to_dict(existing))

    assignment_id = choose_balanced_assignment_id()
    if assignment_id is None:
        return make_response(
            jsonify({"success": False, "error": "None of the configured Prolific assignments were found: 47, 51, 57."}),
            HTTPStatus.NOT_FOUND,
        )

    assignment_info = get_assignment(assignment_id)
    if not assignment_info:
        return make_response(jsonify({"success": False, "error": "Assigned project could not be loaded."}), HTTPStatus.NOT_FOUND)

    session = MiniProlificSession(
        Token=uuid.uuid4().hex,
        ProlificPid=prolific_pid,
        StudyId=study_id,
        SessionId=session_id,
        AssignmentId=assignment_id,
        AssignmentName=assignment_info.name,
        Status="started",
    )
    db.session.add(session)
    db.session.flush()
    create_prolific_tasks(session)
    db.session.commit()
    return jsonify(prolific_session_to_dict(session))


@mini_api.get("/prolific/session/<token>")
def get_prolific_session(token: str):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)
    return jsonify(prolific_session_to_dict(session))


@mini_api.post("/prolific/session/<token>/materials-time")
def save_materials_time(token: str):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)

    payload = request.get_json(silent=True) or {}
    event = str(payload.get("event") or "").strip().lower()
    now = now_utc()

    if event == "start":
        if session.MaterialReviewStartedAt is None:
            session.MaterialReviewStartedAt = now
        session.Status = "materials"
    elif event == "end":
        if session.MaterialReviewStartedAt is None:
            session.MaterialReviewStartedAt = now
        session.MaterialReviewEndedAt = now
        session.MaterialReviewSeconds = max(0, int((session.MaterialReviewEndedAt - session.MaterialReviewStartedAt).total_seconds()))
        session.Status = "grading"
    else:
        return make_response(jsonify({"success": False, "error": "event must be 'start' or 'end'."}), HTTPStatus.BAD_REQUEST)

    session.UpdatedAt = now
    db.session.commit()
    return jsonify({"success": True, "session": prolific_session_to_dict(session)})


@mini_api.get("/prolific/session/<token>/tasks/<int:task_id>")
def get_prolific_task(token: str, task_id: int):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)

    task = require_task_for_session(session, task_id)
    if not task:
        return make_response(jsonify({"success": False, "error": "Grading task not found."}), HTTPStatus.NOT_FOUND)

    tasks = MiniProlificTask.query.filter_by(SessionDbId=session.Id).order_by(MiniProlificTask.TaskIndex).all()
    next_task = next((candidate for candidate in tasks if candidate.TaskIndex > task.TaskIndex), None)

    return jsonify(
        {
            "success": True,
            "token": session.Token,
            "assignmentId": session.AssignmentId,
            "assignmentName": session.AssignmentName,
            "task": task_to_dict(task, len(tasks)),
            "nextTaskId": next_task.Id if next_task else None,
            "errorDefs": public_error_defs(),
        }
    )


@mini_api.post("/prolific/session/<token>/tasks/<int:task_id>/start")
def start_prolific_task(token: str, task_id: int):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)
    task = require_task_for_session(session, task_id)
    if not task:
        return make_response(jsonify({"success": False, "error": "Grading task not found."}), HTTPStatus.NOT_FOUND)

    now = now_utc()
    if task.StartedAt is None:
        task.StartedAt = now
    session.Status = "grading"
    task.UpdatedAt = now
    session.UpdatedAt = now
    db.session.commit()
    return jsonify({"success": True})


@mini_api.post("/prolific/session/<token>/tasks/<int:task_id>/save")
def save_prolific_task(token: str, task_id: int):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)
    task = require_task_for_session(session, task_id)
    if not task:
        return make_response(jsonify({"success": False, "error": "Grading task not found."}), HTTPStatus.NOT_FOUND)

    payload = request.get_json(silent=True) or {}
    now = now_utc()
    grade = _parse_int(payload.get("grade"), 0)
    scoring_mode = str(payload.get("scoringMode") or task.Mode)
    rubric_selections = payload.get("rubricSelections") if isinstance(payload.get("rubricSelections"), list) else []
    rubric_comment = str(payload.get("rubricComment") or "")
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []
    error_points = payload.get("errorPoints") if isinstance(payload.get("errorPoints"), dict) else {}
    error_defs = payload.get("errorDefs") if isinstance(payload.get("errorDefs"), dict) else {}

    if task.StartedAt is None:
        task.StartedAt = now
    task.EndedAt = now
    task.DurationSeconds = max(0, int((task.EndedAt - task.StartedAt).total_seconds()))
    task.Grade = max(0, min(100, grade))
    task.ScoringMode = scoring_mode[:40]
    task.RubricJson = json.dumps({"selections": [str(x) for x in rubric_selections], "comment": rubric_comment})
    task.ErrorPointsJson = json.dumps(error_points)
    task.ErrorDefsJson = json.dumps(error_defs)
    task.UpdatedAt = now

    db.session.execute(delete(MiniProlificTaskLineError).where(MiniProlificTaskLineError.TaskId == task.Id))
    for item in errors:
        if not isinstance(item, dict):
            continue
        db.session.add(
            MiniProlificTaskLineError(
                TaskId=task.Id,
                StartLine=max(1, _parse_int(item.get("startLine"), 1)),
                EndLine=max(1, _parse_int(item.get("endLine"), 1)),
                ErrorId=str(item.get("errorId") or "UNKNOWN")[:80],
                Count=max(1, _parse_int(item.get("count"), 1)),
                Note=str(item.get("note") or ""),
            )
        )

    remaining = MiniProlificTask.query.filter(
        MiniProlificTask.SessionDbId == session.Id,
        MiniProlificTask.Id != task.Id,
        MiniProlificTask.EndedAt.is_(None),
    ).count()
    session.Status = "survey" if remaining == 0 else "grading"
    session.UpdatedAt = now
    db.session.commit()
    return jsonify({"success": True, "session": prolific_session_to_dict(session)})


@mini_api.post("/prolific/session/<token>/survey")
def save_prolific_survey(token: str):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)

    payload = request.get_json(silent=True) or {}
    survey = MiniProlificSurvey.query.filter_by(SessionDbId=session.Id).first()
    if not survey:
        survey = MiniProlificSurvey(SessionDbId=session.Id)
        db.session.add(survey)

    survey.Confidence = str(payload.get("confidence") or "")[:40]
    survey.Difficulty = str(payload.get("difficulty") or "")[:40]
    survey.AiUsefulness = str(payload.get("aiUsefulness") or "")[:40]
    survey.Fairness = str(payload.get("fairness") or "")[:40]
    survey.Comments = str(payload.get("comments") or "")
    survey.SurveyJson = json.dumps(payload)
    survey.SubmittedAt = now_utc()

    session.Status = "completed"
    session.CompletedAt = survey.SubmittedAt
    session.UpdatedAt = survey.SubmittedAt
    db.session.commit()
    return jsonify({"success": True, "session": prolific_session_to_dict(session)})

@mini_api.get("/assignments")
def assignments():
    rows = [assignment_to_dict(a) for a in scan_assignments()]
    return jsonify({"assignments": rows})


@mini_api.get("/assignments/<int:project_id>")
def assignment(project_id: int):
    item = get_assignment(project_id)
    if not item:
        return make_response(jsonify({"error": "Assignment not found"}), HTTPStatus.NOT_FOUND)
    return jsonify(assignment_to_dict(item))


@mini_api.get("/assignments/<int:project_id>/materials")
def assignment_materials(project_id: int):
    item = get_assignment(project_id)
    if not item:
        return make_response(jsonify({"error": "Assignment not found"}), HTTPStatus.NOT_FOUND)
    return jsonify(assignment_materials_payload(item))


@mini_api.get("/assignments/<int:project_id>/materials/file")
def assignment_material_file(project_id: int):
    item = get_assignment(project_id)
    if not item:
        return make_response(jsonify({"error": "Assignment not found"}), HTTPStatus.NOT_FOUND)

    kind = str(request.args.get("kind") or "").strip()
    name = str(request.args.get("name") or "").strip()
    path = find_assignment_material_file(item, kind, name)
    if not path or not path.exists() or not path.is_file():
        return make_response(jsonify({"error": "Assignment material not found"}), HTTPStatus.NOT_FOUND)

    suffix = path.suffix.lower()
    mimetype = "application/pdf" if suffix == ".pdf" else "text/plain"
    response = send_file(
        path,
        mimetype=mimetype,
        as_attachment=False,
        download_name=path.name,
        conditional=True,
    )
    response.headers["Content-Disposition"] = response.headers.get(
        "Content-Disposition",
        "inline",
    ).replace("attachment", "inline")
    return response


@mini_api.get("/assignments/<int:project_id>/submissions")
def assignment_submissions(project_id: int):
    if not get_assignment(project_id):
        return make_response(jsonify({"error": "Assignment not found"}), HTTPStatus.NOT_FOUND)
    return jsonify({"submissions": [submission_to_dict(s) for s in scan_submissions(project_id)]})


@submission_api.post("/recentsubproject")
def recent_submissions_for_project():
    payload = request.get_json(silent=True) or {}
    project_id = _parse_int(payload.get("project_id"), -1)
    rows = scan_submissions(project_id)

    # Shape expected by AdminGrading from full MAAT:
    # Object.entries(data).map(([userId, value]) => value[0]=last, value[1]=first, value[7]=submissionId)
    out = {}
    for submission in rows:
        out[str(submission.ordinal)] = [
            submission.last_name,
            submission.first_name,
            submission.user_key,
            submission.submitted_at,
            submission.folder_name,
            submission.project_id,
            submission.is_passing,
            submission.id,
        ]
    return jsonify(out)


@submission_api.get("/testcaseerrors")
def testcase_errors():
    submission_id = _parse_int(request.args.get("id"), -1)
    submission = get_submission(submission_id)
    if not submission:
        return make_response(jsonify({"results": [], "error": "Submission not found"}), HTTPStatus.NOT_FOUND)
    return jsonify(testcase_payload(submission))


@submission_api.get("/codefinder")
def code_finder():
    submission_id = _parse_int(request.args.get("id"), -1)
    submission = get_submission(submission_id)
    if not submission:
        return make_response(jsonify({"files": [], "error": "Submission not found"}), HTTPStatus.NOT_FOUND)
    return jsonify(code_payload(submission))


@submission_api.post("/log_ui")
def log_ui_click():
    # Full MAAT records these analytics clicks. MAAT-Mini keeps the route so the
    # identical grading screen can call it without a missing-endpoint error.
    return make_response(jsonify({"status": "logged"}), HTTPStatus.CREATED)


@submission_api.get("/get-grading/<int:submission_id>")
def get_grading(submission_id: int):
    errors = MiniSubmissionManualError.query.filter_by(SubmissionId=submission_id).order_by(
        MiniSubmissionManualError.StartLine,
        MiniSubmissionManualError.EndLine,
        MiniSubmissionManualError.ErrorId,
    ).all()
    grade_cfg = MiniSubmissionGrade.query.filter_by(SubmissionId=submission_id).first()

    return jsonify(
        {
            "success": True,
            "errors": [
                {
                    "startLine": err.StartLine,
                    "endLine": err.EndLine,
                    "errorId": err.ErrorId,
                    "count": err.Count or 1,
                    "note": err.Note or "",
                }
                for err in errors
            ],
            "grade": grade_cfg.Grade if grade_cfg else None,
            "scoringMode": grade_cfg.ScoringMode if grade_cfg else None,
            "errorPoints": _json_or_none(grade_cfg.ErrorPointsJson) if grade_cfg else None,
            "errorDefs": _json_or_none(grade_cfg.ErrorDefsJson) if grade_cfg else None,
        }
    )


@submission_api.post("/save-grading")
def save_grading():
    payload = request.get_json(silent=True) or {}
    submission_id = _parse_int(payload.get("submissionId"), -1)
    project_id = _parse_int(payload.get("projectId"), submission_id // 1_000_000)
    grade = _parse_int(payload.get("grade"), 0)
    scoring_mode = str(payload.get("scoringMode") or "perInstance")
    error_points = payload.get("errorPoints") if isinstance(payload.get("errorPoints"), dict) else {}
    error_defs = payload.get("errorDefs") if isinstance(payload.get("errorDefs"), dict) else {}
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []

    if not get_submission(submission_id):
        return make_response(jsonify({"success": False, "error": "Submission not found"}), HTTPStatus.NOT_FOUND)

    grade_cfg = MiniSubmissionGrade.query.filter_by(SubmissionId=submission_id).first()
    if not grade_cfg:
        grade_cfg = MiniSubmissionGrade(SubmissionId=submission_id, ProjectId=project_id)
        db.session.add(grade_cfg)

    grade_cfg.ProjectId = project_id
    grade_cfg.Grade = max(0, min(100, grade))
    grade_cfg.ScoringMode = scoring_mode
    grade_cfg.ErrorPointsJson = json.dumps(error_points)
    grade_cfg.ErrorDefsJson = json.dumps(error_defs)
    grade_cfg.UpdatedAt = datetime.utcnow()

    db.session.execute(delete(MiniSubmissionManualError).where(MiniSubmissionManualError.SubmissionId == submission_id))
    for item in errors:
        if not isinstance(item, dict):
            continue
        db.session.add(
            MiniSubmissionManualError(
                SubmissionId=submission_id,
                StartLine=max(1, _parse_int(item.get("startLine"), 1)),
                EndLine=max(1, _parse_int(item.get("endLine"), 1)),
                ErrorId=str(item.get("errorId") or "UNKNOWN")[:80],
                Count=max(1, _parse_int(item.get("count"), 1)),
                Note=str(item.get("note") or ""),
            )
        )

    db.session.commit()
    return jsonify({"success": True, "msg": "Grading saved"})


@ai_api.route("/grading-error-defs", methods=["GET"])
def grading_error_defs():
    return jsonify({"success": True, "errorDefs": public_error_defs()})


def build_allowed_list_text() -> str:
    return "; ".join(f'{e["id"]}={e["label"]}' for e in GRADING_ERROR_DEFS)


def build_prompt(selected_code: str, diff_long: str) -> str:
    selected_code = truncate_text(selected_code, 6000)
    diff_long = truncate_text(diff_long, 6000)

    return f"""Task: choose the clearest grading categories for the selected code.
Return only a JSON array of 3 category IDs, example: ["IO_FORMAT", "CALCULATION", "DECISION_LOGIC"]
Use only IDs from this list and do not invent IDs: {build_allowed_list_text()}

CODE:
{selected_code}

DIFF (- student, + expected):
{diff_long}
"""


def sanitize_suggestions(raw_ids: Iterable[str]) -> List[str]:
    clean: List[str] = []
    seen = set()

    for raw_id in raw_ids:
        category_id = str(raw_id or "").strip().upper()
        if category_id in ALLOWED_IDS and category_id not in seen:
            clean.append(category_id)
            seen.add(category_id)
        if len(clean) >= SUGGESTION_LIMIT:
            break

    return clean


def extract_json_array_text(text: str) -> str:
    text = (text or "").strip()

    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    start = text.find("[")
    end = text.rfind("]")

    if start >= 0 and end >= start:
        return text[start : end + 1]

    return text


def parse_llm_suggestions(text: str) -> List[str]:
    if not text:
        return []

    json_text = extract_json_array_text(text)

    try:
        obj = json.loads(json_text)
    except Exception:
        return []

    if not isinstance(obj, list):
        return []

    return sanitize_suggestions(obj)


def call_llm(prompt: str, temperature: float = 0.1, max_tokens: int = 150) -> str:
    llm_url = get_llm_url()
    llm_model = get_llm_model()

    if not llm_url or not llm_model:
        return (
            "DEBUG_CONFIG_ERROR: "
            f"LLM_URL={'SET' if llm_url else 'EMPTY'}, "
            f"LLM_MODEL={'SET' if llm_model else 'EMPTY'}"
        )

    payload = {
        "model": llm_model,
        "messages": [
            {
                "role": "system",
                "content": "Return only the requested JSON array. No explanations.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }

    try:
        response = requests.post(llm_url, json=payload, timeout=20)
    except Exception as e:
        return f"DEBUG_REQUEST_ERROR: {e}"

    raw_response_text = response.text or ""

    try:
        response.raise_for_status()
    except Exception as e:
        return (
            "DEBUG_HTTP_ERROR: "
            f"{e}; status={response.status_code}; "
            f"response={truncate_text(raw_response_text, 4000)}"
        )

    try:
        data = response.json()
    except Exception as e:
        return (
            "DEBUG_JSON_PARSE_ERROR: "
            f"{e}; status={response.status_code}; "
            f"response={truncate_text(raw_response_text, 4000)}"
        )

    choices = data.get("choices", [])
    if not choices:
        return (
            "DEBUG_NO_CHOICES: "
            f"status={response.status_code}; "
            f"response={truncate_text(json.dumps(data, ensure_ascii=False), 4000)}"
        )

    choice = choices[0] or {}
    message = choice.get("message", {}) or {}
    content = message.get("content")

    if content:
        return str(content).strip()

    return (
        "DEBUG_NO_CONTENT: "
        f"finish_reason={choice.get('finish_reason')}; "
        f"reasoning={truncate_text(str(message.get('reasoning') or ''), 1000)}; "
        f"response={truncate_text(json.dumps(data, ensure_ascii=False), 4000)}"
    )


def build_diff_long_for_testcase(submission_id: int, testcase_name: str) -> str:
    submission = get_submission(int(submission_id))
    if not submission:
        return ""

    try:
        payload = testcase_payload(submission) or {}
    except Exception:
        return ""

    testcase_name = (testcase_name or "").strip()
    if not testcase_name:
        return ""

    for result in payload.get("results", []) or []:
        try:
            name = str(result.get("name", "") or "")
            if name == testcase_name and not bool(result.get("passed", False)):
                return str(result.get("longDiff", "") or "")
        except Exception:
            continue

    return ""


@ai_api.route("/grading-suggestions", methods=["POST"])
def grading_suggestions():
    data = request.get_json(silent=True) or {}

    submission_id = safe_int(data.get("submissionId", -1), -1)
    selected_code = str(data.get("selectedCode", "") or "").strip()
    testcase_name = str(data.get("testcaseName", "") or "").strip()
    testcase_long_diff = str(data.get("testcaseLongDiff", "") or "").strip()

    if submission_id < 0 or not selected_code:
        return jsonify({"suggestions": []})

    diff_long = testcase_long_diff
    if not diff_long and testcase_name:
        diff_long = build_diff_long_for_testcase(
            submission_id,
            testcase_name,
        )

    prompt = build_prompt(selected_code, diff_long)
    llm_output = ""
    suggestions: List[str] = []

    try:
        llm_output = call_llm(prompt)
        suggestions = parse_llm_suggestions(llm_output)
    except Exception as e:
        current_app.logger.warning(f"[ai_suggestions] LLM call failed: {e}")
        llm_output = f"ERROR: {e}"

    log_ai_click(submission_id, prompt, llm_output)

    return jsonify({"suggestions": suggestions})