from __future__ import annotations

import json
from datetime import datetime
from http import HTTPStatus

from flask import Blueprint, jsonify, make_response, request
from sqlalchemy import delete

from src.database import db
from src.filesystem import (
    assignment_to_dict,
    code_payload,
    get_assignment,
    get_submission,
    scan_assignments,
    scan_submissions,
    submission_to_dict,
    testcase_payload,
)
from src.models import MiniSubmissionGrade, MiniSubmissionManualError

mini_api = Blueprint("mini_api", __name__)
submission_api = Blueprint("submission_api", __name__)
ai_api = Blueprint("ai_api", __name__)


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


@mini_api.get("/health")
def health():
    return jsonify({"status": "ok"})


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

    return jsonify({
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
    })


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
        db.session.add(MiniSubmissionManualError(
            SubmissionId=submission_id,
            StartLine=max(1, _parse_int(item.get("startLine"), 1)),
            EndLine=max(1, _parse_int(item.get("endLine"), 1)),
            ErrorId=str(item.get("errorId") or "UNKNOWN")[:80],
            Count=max(1, _parse_int(item.get("count"), 1)),
            Note=str(item.get("note") or ""),
        ))

    db.session.commit()
    return jsonify({"success": True, "msg": "Grading saved"})


@ai_api.post("/grading-suggestions")
def grading_suggestions():
    # MAAT-Mini does not require an LLM service. The route exists so the copied
    # MAAT grading screen can remain unchanged.
    return jsonify({"suggestions": []})
