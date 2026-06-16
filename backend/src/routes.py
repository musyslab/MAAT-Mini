from __future__ import annotations

import json
import os
import re
from datetime import datetime
from http import HTTPStatus
from typing import List, Set

from flask import Blueprint, current_app, jsonify, make_response, request
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

LLM_URL = os.getenv("LLM_URL", "").strip()
LLM_MODEL = os.getenv("LLM_MODEL", "").strip()
AI_CLICKS_LOG = os.getenv("MINI_AI_CLICKS_LOG", "/tabot-files/project-files/mini_ai_clicks.log")

GRADING_ERROR_DEFS = [
    {
        "id": "MISSPELL",
        "label": "Wrong output text: spelling or wording",
        "description": "Use when the output is mostly correct but a word, phrase, spelling, or wording choice is wrong.",
        "points": 10,
    },
    {
        "id": "CONTENT",
        "label": "Wrong output content: missing/extra/incorrect",
        "description": "Use when required output is missing, extra output is printed, or the produced value/text is substantively wrong.",
        "points": 20,
    },
    {
        "id": "INPUT",
        "label": "Wrong input handling or prompt",
        "description": "Use when the program reads the wrong number of inputs, reads them in the wrong place, parses the wrong source, or prints an incorrect prompt.",
        "points": 15,
    },
    {
        "id": "ORDER",
        "label": "Wrong order of input, processing, or output",
        "description": "Use when the right pieces are present but are read, processed, or printed in the wrong sequence.",
        "points": 15,
    },
    {
        "id": "INIT_STATE",
        "label": "Wrong initial value or missing initialization",
        "description": "Use when a variable, accumulator, flag, list, or object starts with the wrong initial value or is not initialized before use.",
        "points": 20,
    },
    {
        "id": "STATE_MISUSE",
        "label": "Wrong variable updated or value overwritten",
        "description": "Use when the code updates the wrong variable, overwrites a needed value, fails to update state, or reuses stale state.",
        "points": 15,
    },
    {
        "id": "TYPE_CONVERSION",
        "label": "Wrong data type, parsing, or conversion",
        "description": "Use when strings, numbers, booleans, characters, or casts/conversions are handled incorrectly.",
        "points": 15,
    },
    {
        "id": "COMPUTE",
        "label": "Wrong calculation: formula, math, or rounding",
        "description": "Use when the formula, arithmetic, operator, precedence, rounding method, or derived numeric value is wrong.",
        "points": 20,
    },
    {
        "id": "CONDITION",
        "label": "Wrong condition, comparison, or boundary",
        "description": "Use when a comparison, boolean expression, boundary case, inclusive/exclusive check, or compound condition is wrong.",
        "points": 15,
    },
    {
        "id": "BRANCHING",
        "label": "Wrong if/else path or case selected",
        "description": "Use when the if/elif/else, switch/case, or default-case structure sends execution down the wrong path.",
        "points": 15,
    },
    {
        "id": "LOOP",
        "label": "Wrong loop range, count, or update",
        "description": "Use when a loop starts/stops at the wrong time, skips/repeats items, has an off-by-one error, or updates the loop variable incorrectly.",
        "points": 20,
    },
    {
        "id": "INDEXING",
        "label": "Wrong list/string index or collection access",
        "description": "Use when list/string/array indexes, keys, append/access operations, ranges, or collection setup are wrong.",
        "points": 20,
    },
    {
        "id": "FUNCTIONS",
        "label": "Wrong function parameters, return, or call",
        "description": "Use when a function has the wrong parameters, return value, call order, scope, side effect, or missing return.",
        "points": 15,
    },
    {
        "id": "EDGE_CASE",
        "label": "Missing edge case or special-case handling",
        "description": "Use when the general approach works but fails for empty input, zero, one item, negatives, ties, limits, or other edge cases.",
        "points": 15,
    },
    {
        "id": "COMPILE",
        "label": "Syntax error, crash, or infinite loop",
        "description": "Use when syntax, import, build, uncaught exception, infinite crash loop, or runtime error prevents normal completion.",
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
ID_PATTERN = re.compile(r"\b(" + "|".join(re.escape(e["id"]) for e in GRADING_ERROR_DEFS) + r")\b")


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


def log_ai_click(submission_id: int, prompt: str, output: str) -> None:
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        os.makedirs(os.path.dirname(AI_CLICKS_LOG), exist_ok=True)

        prompt_safe = one_line(truncate_text(prompt, 2500))
        output_safe = one_line(truncate_text(output, 1000))

        line = (
            f"{ts} | app:MAAT-Mini | submission:{int(submission_id)}"
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


@ai_api.get("/grading-error-defs")
def grading_error_defs():
    return jsonify({"success": True, "errorDefs": public_error_defs()})


def build_allowed_list_text() -> str:
    # Keep the model context small for 4B models.
    # The model only needs IDs and self-contained titles; full descriptions are still
    # returned by /grading-error-defs for the human-facing grading UI.
    return "; ".join(
        f'{e["id"]}={e["label"]}'
        for e in GRADING_ERROR_DEFS
    )


def build_prompt(selected_code: str, diff_long: str) -> str:
    selected_code = truncate_text(selected_code, 900)
    diff_long = truncate_text(diff_long, 1500)

    return f"""Task: choose the clearest grading categories for the selected code.
Return only JSON, example: [\"CONTENT\",\"MISSPELL\",\"ORDER\"]
Use 3 IDs from this list and do not invent IDs: {build_allowed_list_text()}

CODE:
{selected_code}

DIFF (- student, + expected):
{diff_long}
"""


def extract_candidate_ids(text: str) -> List[str]:
    if not text:
        return []

    text = text.strip()
    candidates: List[str] = []

    try:
        obj = json.loads(text)
        if isinstance(obj, list):
            candidates.extend(str(x).strip() for x in obj)
    except Exception:
        pass

    if not candidates:
        match = re.search(r"\[[\s\S]*?\]", text)
        if match:
            block = match.group(0)
            try:
                obj = json.loads(block)
                if isinstance(obj, list):
                    candidates.extend(str(x).strip() for x in obj)
            except Exception:
                candidates.extend(p.strip().strip("\"'") for p in block[1:-1].split(","))

    if not candidates:
        candidates.extend(ID_PATTERN.findall(text.upper()))

    return candidates


def sanitize_suggestions(raw_ids: List[str]) -> List[str]:
    clean: List[str] = []
    seen = set()
    for rid in raw_ids:
        rid = (rid or "").strip().upper()
        if rid in ALLOWED_IDS and rid not in seen:
            clean.append(rid)
            seen.add(rid)
        if len(clean) >= 3:
            break
    return clean


def parse_diff_pairs(diff_long: str) -> List[tuple[str, str]]:
    minus_lines: List[str] = []
    plus_lines: List[str] = []

    for raw in (diff_long or "").splitlines():
        if raw.startswith("---") or raw.startswith("+++") or raw.startswith("@@"):
            continue
        if raw.startswith("-"):
            minus_lines.append(raw[1:].strip())
        elif raw.startswith("+"):
            plus_lines.append(raw[1:].strip())

    return list(zip(minus_lines, plus_lines))


def compact_alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def compact_space(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def looks_like_small_word_change(a: str, b: str) -> bool:
    aw = re.findall(r"[A-Za-z]+", a or "")
    bw = re.findall(r"[A-Za-z]+", b or "")
    if not aw or not bw or abs(len(aw) - len(bw)) > 2:
        return False

    changed = 0
    for left, right in zip(aw, bw):
        if left.lower() != right.lower():
            changed += 1
            if abs(len(left) - len(right)) > 4:
                return False
    changed += abs(len(aw) - len(bw))
    return 0 < changed <= 3


def heuristic_suggestions(selected_code: str, diff_long: str) -> List[str]:
    text = f"{selected_code}\n{diff_long}".lower()
    pairs = parse_diff_pairs(diff_long)
    guesses: List[str] = []

    def add(error_id: str) -> None:
        if error_id in ALLOWED_IDS and error_id not in guesses:
            guesses.append(error_id)

    if re.search(r"traceback|syntaxerror|nameerror|indexerror|exception|compile|runtime error|crash", text):
        add("COMPILE")
    if re.search(r"eoferror|no input|stdin|scanner|readline|nextint|nextline|input\(|prompt", text):
        add("INPUT")
    if re.search(r"valueerror|typeerror|numberformatexception|invalid literal|parseint|parsefloat|int\(|float\(|str\(", text):
        add("TYPE_CONVERSION")

    minus_norm: List[str] = []
    plus_norm: List[str] = []
    for raw in (diff_long or "").splitlines():
        if raw.startswith("---") or raw.startswith("+++") or raw.startswith("@@"):
            continue
        if raw.startswith("-"):
            minus_norm.append(compact_space(raw[1:]))
        elif raw.startswith("+"):
            plus_norm.append(compact_space(raw[1:]))

    if (
        len(minus_norm) > 1
        and len(minus_norm) == len(plus_norm)
        and minus_norm != plus_norm
        and sorted(minus_norm) == sorted(plus_norm)
    ):
        add("ORDER")

    for student, expected in pairs:
        if not student and expected:
            add("CONTENT")
        elif student and not expected:
            add("CONTENT")
        elif compact_alnum(student) == compact_alnum(expected) and student != expected:
            add("FORMAT")
        elif compact_space(student) != compact_space(expected) and looks_like_small_word_change(student, expected):
            add("MISSPELL")

    if re.search(r"precent|precentage|mispell|speeling|recieve|occured|typo|spelling", text):
        add("MISSPELL")
    if re.search(r"spacing|newline|line break|format|capital|case|punctuation|precision|decimal|rounding", text):
        add("FORMAT")
    if re.search(r"\d+(?:\.\d+)?", diff_long) and pairs:
        add("COMPUTE")
    if re.search(r"edge|boundary|empty|zero|negative|tie|minimum|maximum|first|last|one item|single item", text):
        add("EDGE_CASE")
    if re.search(r"\b(init|initial|initialize|default|start value|starting value)\b", text):
        add("INIT_STATE")
    if re.search(r"\b(for|while)\b", selected_code):
        add("LOOP")
    if re.search(r"\b(if|elif|else|switch|case)\b", selected_code):
        add("CONDITION")
    if re.search(r"\b(elif|else|switch|case|default)\b", selected_code):
        add("BRANCHING")
    if re.search(r"\bdef\b|\breturn\b|\bfunction\b|\bvoid\b|\bpublic\s+static\b", selected_code):
        add("FUNCTIONS")
    if re.search(r"\[[^\]]*\]|\.append\(|\.get\(|\.add\(|\.length\b|len\(", selected_code):
        add("INDEXING")
    if re.search(r"=\s*[^=]", selected_code) and any(token in selected_code for token in ["total", "sum", "count", "flag", "result", "answer"]):
        add("STATE_MISUSE")

    if not guesses:
        add("CONTENT")

    return guesses[:3]


def merge_suggestions(primary: List[str], fallback: List[str]) -> List[str]:
    merged: List[str] = []
    for error_id in [*primary, *fallback]:
        error_id = (error_id or "").strip().upper()
        if error_id in ALLOWED_IDS and error_id not in merged:
            merged.append(error_id)
        if len(merged) >= 3:
            break
    return merged


def call_llm(prompt: str, temperature: float, max_tokens: int = 60) -> str:
    if not LLM_URL or not LLM_MODEL:
        raise RuntimeError("LLM_URL and LLM_MODEL are not configured")

    import requests

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "Return only the requested JSON array. No explanations."},
            {"role": "user", "content": prompt},
        ],
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
    }

    r = requests.post(
        LLM_URL,
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()

    try:
        return (data.get("choices", [{}])[0].get("message", {}).get("content", "")) or ""
    except Exception:
        return ""


def build_diff_long_for_testcase(submission_id: int, testcase_name: str) -> str:
    submission = get_submission(int(submission_id))
    if not submission:
        return ""

    try:
        payload = testcase_payload(submission) or {}
    except Exception:
        return ""

    results = payload.get("results", []) or []
    want = (testcase_name or "").strip()
    if not want:
        return ""

    for result in results:
        try:
            name = str(result.get("name", "") or "")
            if name != want:
                continue
            if bool(result.get("passed", False)):
                return ""
            return str(result.get("longDiff", "") or "")
        except Exception:
            continue

    return ""


@ai_api.post("/grading-suggestions")
def grading_suggestions():
    data = request.get_json(silent=True) or {}
    submission_id = _parse_int(data.get("submissionId"), -1)
    selected_code = str(data.get("selectedCode", "") or "").strip()
    testcase_name = str(data.get("testcaseName", "") or "").strip()
    testcase_long_diff = str(data.get("testcaseLongDiff", "") or "").strip()

    if submission_id < 0 or not selected_code:
        return jsonify({"suggestions": []})

    diff_long = testcase_long_diff
    if not diff_long and testcase_name:
        diff_long = build_diff_long_for_testcase(submission_id, testcase_name)

    prompt = build_prompt(selected_code, diff_long)
    llm_ids: List[str] = []
    llm_output = ""

    try:
        llm_output = call_llm(prompt, temperature=0.1, max_tokens=60)
        llm_ids = sanitize_suggestions(extract_candidate_ids(llm_output))
    except Exception as exc:
        try:
            current_app.logger.warning(f"[mini_ai_suggestions] LLM call failed: {exc}")
        except Exception:
            pass
        llm_output = f"ERROR: {exc}"

    fallback_ids = heuristic_suggestions(selected_code, diff_long)
    ids = merge_suggestions(llm_ids, fallback_ids)

    log_ai_click(submission_id, prompt, llm_output or json.dumps({"fallback": fallback_ids}))

    return make_response(json.dumps({"suggestions": ids}), 200, {"Content-Type": "application/json"})
