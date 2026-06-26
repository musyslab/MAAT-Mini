from __future__ import annotations

import hashlib
import json
import os
import random
import uuid
from datetime import datetime
from http import HTTPStatus
from typing import Any, Iterable, List, Set

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
    MiniSubmissionManualError,
    MiniSubmissionPath,
)

mini_api = Blueprint("mini_api", __name__)
submission_api = Blueprint("submission_api", __name__)
ai_api = Blueprint("ai_api", __name__)

AI_CLICKS_LOG = "/tabot-files/project-files/ai_clicks.log"
SUGGESTION_LIMIT = 3
MAX_TRACKED_SECONDS_PER_EVENT = 24 * 60 * 60
PROLIFIC_ASSIGNMENT_IDS = [47, 51, 57]
PROLIFIC_BATCH_SIZE = 7
PROLIFIC_STAGE_ORDER = ["rubric", "line_no_ai", "line_ai"]
PROLIFIC_SOURCE_PATTERN = ["student", "ai", "student", "ai", "student", "ai", "student"]
PROLIFIC_TASK_PLAN = [
    (mode, desired_source)
    for mode in PROLIFIC_STAGE_ORDER
    for desired_source in PROLIFIC_SOURCE_PATTERN
]
PROLIFIC_ALL_THREE_REPEAT_SLOT = 3
PROLIFIC_TWO_CATEGORY_REPEAT_SLOT = 6
PROLIFIC_ALL_THREE_REPEAT_KEY = "same_all_three_categories"
PROLIFIC_TWO_CATEGORY_REPEAT_KEY = "same_two_categories"
PROLIFIC_FALLBACK_REPEAT_KEY = "unplanned_fallback_repeat"
PROLIFIC_ALL_THREE_REPEAT_LABEL = "Same program across all three grading categories"
PROLIFIC_TWO_CATEGORY_REPEAT_LABEL = "Same program repeated within one grading category"
PROLIFIC_FALLBACK_REPEAT_LABEL = "Unplanned fallback repeat caused by insufficient unique programs"
PROLIFIC_TWO_CATEGORY_REPEAT_SLOT_PAIRS = [
    (2, PROLIFIC_TWO_CATEGORY_REPEAT_SLOT),
    (4, PROLIFIC_TWO_CATEGORY_REPEAT_SLOT),
]
MODE_LABELS = {
    "rubric": "Rubric grading",
    "line_no_ai": "Line-level grading",
    "line_ai": "AI-assisted line-level grading",
}

GRADING_ERROR_DEFS = [
    {
        "id": "IO_FORMAT",
        "label": "Wrong input, output, spelling, or formatting",
        "description": (
            "Use for incorrect spelling, input order, output text, spacing, "
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


def grade_from_manual_errors(errors: Iterable[MiniSubmissionManualError]) -> int:
    deduction = 0
    for err in errors:
        meta = GRADING_DEFAULT_DEFS_MAP.get(str(err.ErrorId or ""))
        points = int((meta or {}).get("points", 0) or 0)
        count = max(1, int(err.Count or 1))
        deduction += points * count
    return max(0, min(100, 100 - deduction))


def completion_code() -> str:
    return os.getenv("PROLIFIC_COMPLETION_CODE", "").strip()


def completion_url() -> str:
    code = completion_code()
    explicit = os.getenv("PROLIFIC_COMPLETION_URL", "").strip()
    if explicit:
        return explicit
    return f"https://app.prolific.com/submissions/complete?cc={code}"


def now_utc() -> datetime:
    return datetime.utcnow()


def clean_text(value: Any, limit: int | None = None) -> str:
    text = str(value or "")
    if limit is not None:
        return text[:limit]
    return text


def clean_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [clean_json(v) for v in value if v is not None]
    return value


def json_dumps_clean(value: Any, default: Any) -> str:
    cleaned = clean_json(value)
    if cleaned is None:
        cleaned = default
    return json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))


def json_or_default(value: str, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except Exception:
        return default
    return parsed if parsed is not None else default


def positive_elapsed_seconds(payload: dict) -> int:
    seconds = _parse_int(payload.get("elapsedSeconds"), 0)
    return max(0, min(seconds, MAX_TRACKED_SECONDS_PER_EVENT))


def seconds_between(start: datetime | None, end: datetime) -> int:
    if not start:
        return 0
    try:
        seconds = int((end - start).total_seconds())
    except Exception:
        return 0
    return max(0, min(seconds, MAX_TRACKED_SECONDS_PER_EVENT))


def current_task_grading_seconds(task: MiniProlificTask, now: datetime | None = None) -> int:
    now = now or now_utc()
    return int(task.GradingSeconds or 0) + seconds_between(task.GradingStartedAt, now)


def record_task_grading_stop(task: MiniProlificTask, now: datetime, payload: dict | None = None) -> int:
    payload = payload or {}

    if not task.GradingStartedAt:
        if bool(task.Completed) or "elapsedSeconds" not in payload:
            return 0
        elapsed = positive_elapsed_seconds(payload)
        task.GradingSeconds = int(task.GradingSeconds or 0) + elapsed
        return elapsed

    client_seconds = positive_elapsed_seconds(payload) if "elapsedSeconds" in payload else 0
    server_seconds = seconds_between(task.GradingStartedAt, now)
    elapsed = max(client_seconds, server_seconds)

    task.GradingSeconds = int(task.GradingSeconds or 0) + elapsed
    task.GradingStartedAt = None
    return elapsed


def mode_time_summary_for_tasks(tasks: list[MiniProlificTask], now: datetime | None = None) -> dict[str, dict]:
    now = now or now_utc()
    summary: dict[str, dict] = {}

    for task in tasks:
        mode = task.Mode or "unknown"
        row = summary.setdefault(
            mode,
            {
                "mode": mode,
                "modeLabel": MODE_LABELS.get(mode, mode),
                "taskCount": 0,
                "completedTaskCount": 0,
                "visitCount": 0,
                "gradingSeconds": 0,
            },
        )
        row["taskCount"] += 1
        row["completedTaskCount"] += 1 if bool(task.Completed) else 0
        row["visitCount"] += int(task.VisitCount or 0)
        row["gradingSeconds"] += current_task_grading_seconds(task, now)

    return summary


def submission_path_hash(submission) -> str:
    raw = f"{submission.project_id}|{submission.source}|{submission.folder.as_posix()}"
    return hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()


def display_name_for_submission(submission) -> str:
    display_index = submission.ordinal
    if submission.source == "ai":
        display_index = max(1, submission.ordinal - 500_000)
    return f"Program {display_index}"


def sync_submission_paths_for_assignment(project_id: int, commit: bool = False) -> list[dict]:
    assignment = get_assignment(project_id)
    if not assignment:
        return []

    synced: list[dict] = []
    for submission in scan_submissions(project_id):
        path_hash = submission_path_hash(submission)
        row = MiniSubmissionPath.query.filter_by(PathHash=path_hash).first()
        if not row:
            row = MiniSubmissionPath(PathHash=path_hash)
            db.session.add(row)

        row.ExternalSubmissionId = int(submission.id)
        row.AssignmentId = int(submission.project_id)
        row.AssignmentName = clean_text(assignment.name, 255)
        row.Ordinal = int(submission.ordinal)
        row.Source = clean_text(submission.source, 40) or "student"
        row.SourceLabel = clean_text(submission.source_label, 80) or "Program"
        row.DisplayName = display_name_for_submission(submission)
        row.FolderName = clean_text(submission.folder_name, 500)
        row.FolderPath = submission.folder.as_posix()
        row.TestcasesJsonPath = submission.testcase_json_path.as_posix() if submission.testcase_json_path else ""
        row.TestcaseResultsPath = submission.testcase_results_path.as_posix() if submission.testcase_results_path else ""
        row.CodeFilesJson = json_dumps_clean([p.as_posix() for p in submission.code_files], [])
        row.IsPassing = bool(submission.is_passing)
        row.UpdatedAt = now_utc()
        synced.append({"submission": submission, "path": row})

    db.session.flush()
    if commit:
        db.session.commit()
    return synced


def runtime_submission_for_path_id(submission_path_id: int):
    row = MiniSubmissionPath.query.get(int(submission_path_id))
    if not row:
        return None

    submission = get_submission(int(row.ExternalSubmissionId))
    if submission:
        return submission

    for candidate in scan_submissions(int(row.AssignmentId)):
        if submission_path_hash(candidate) == row.PathHash:
            return candidate
    return None


def submission_path_to_dict(row: MiniSubmissionPath, submission) -> dict:
    display = row.DisplayName or display_name_for_submission(submission)
    return {
        "submissionId": row.Id,
        "submissionPathId": row.Id,
        "projectId": row.AssignmentId,
        "userId": row.Ordinal,
        "userKey": display,
        "firstName": "",
        "lastName": "",
        "fullName": display,
        "folderName": row.FolderName,
        "source": row.Source,
        "sourceLabel": "Program",
        "submittedAt": "",
        "isPassing": bool(row.IsPassing),
        "codeFileCount": len(submission.code_files),
        "hasTestcasesJson": bool(row.TestcasesJsonPath),
        "hasTestCaseResults": bool(row.TestcaseResultsPath),
        "path": row.FolderPath,
    }


def prolific_session_to_dict(session: MiniProlificSession) -> dict:
    tasks = MiniProlificTask.query.filter_by(SessionDbId=session.Id).order_by(MiniProlificTask.TaskIndex).all()
    completed = [t for t in tasks if bool(t.Completed)]
    first_open = next((t for t in tasks if not bool(t.Completed)), tasks[0] if tasks else None)
    now = now_utc()
    grading_time_by_mode = mode_time_summary_for_tasks(tasks, now)
    out = {
        "success": True,
        "id": session.Id,
        "token": session.Token,
        "assignmentId": session.AssignmentId,
        "assignmentName": session.AssignmentName,
        "status": session.Status,
        "taskCount": len(tasks),
        "completedTaskCount": len(completed),
        "materialReviewSeconds": int(session.MaterialReviewSeconds or 0),
        "materialReviewVisits": int(session.MaterialReviewVisits or 0),
        "materialReturnCount": int(session.MaterialReturnCount or 0),
        "gradingSeconds": sum(row["gradingSeconds"] for row in grading_time_by_mode.values()),
        "gradingTimeByMode": grading_time_by_mode,
        "completionCode": completion_code(),
        "completionUrl": completion_url(),
    }
    if first_open:
        out["firstTaskId"] = first_open.Id
    return out


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


def desired_source_for_stage_slot(stage_slot: int) -> str:
    if 1 <= stage_slot <= len(PROLIFIC_SOURCE_PATTERN):
        return PROLIFIC_SOURCE_PATTERN[stage_slot - 1]
    return PROLIFIC_SOURCE_PATTERN[0] if PROLIFIC_SOURCE_PATTERN else "student"


def task_index_for_stage_slot(mode: str, stage_slot: int) -> int:
    try:
        stage_offset = PROLIFIC_STAGE_ORDER.index(mode) * PROLIFIC_BATCH_SIZE
    except ValueError:
        stage_offset = 0
    return stage_offset + stage_slot


def repeat_group_modes_label(modes: Iterable[str]) -> str:
    return ", ".join(MODE_LABELS.get(mode, mode) for mode in modes)


def pick_submission(candidates: list[dict], desired_source: str, used_path_ids: set[int], previous_path_id: int | None):
    pools = [
        [c for c in candidates if c["submission"].source == desired_source and c["path"].Id not in used_path_ids and c["path"].Id != previous_path_id],
        [c for c in candidates if c["submission"].source != desired_source and c["path"].Id not in used_path_ids and c["path"].Id != previous_path_id],
        [c for c in candidates if c["path"].Id not in used_path_ids and c["path"].Id != previous_path_id],
        [c for c in candidates if c["path"].Id != previous_path_id],
        list(candidates),
    ]
    for pool in pools:
        if pool:
            return random.choice(pool)
    return None


def pick_control_submission(candidates: list[dict], desired_source: str, excluded_path_ids: set[int]):
    pools = [
        [c for c in candidates if c["submission"].source == desired_source and c["path"].Id not in excluded_path_ids],
        [c for c in candidates if c["path"].Id not in excluded_path_ids],
        [c for c in candidates if c["submission"].source == desired_source],
        list(candidates),
    ]
    for pool in pools:
        if pool:
            return random.choice(pool)
    return None


def add_controlled_repeat_positions(
    controlled_positions: dict[tuple[str, int], dict],
    item: dict | None,
    positions: Iterable[tuple[str, int]],
    group_key: str,
    group_label: str,
) -> None:
    if not item:
        return

    valid_positions = [
        (mode, stage_slot)
        for mode, stage_slot in positions
        if mode in PROLIFIC_STAGE_ORDER and 1 <= stage_slot <= PROLIFIC_BATCH_SIZE
    ]
    ordered_positions = sorted(
        valid_positions,
        key=lambda position: task_index_for_stage_slot(position[0], position[1]),
    )
    if not ordered_positions:
        return

    group_size = len(ordered_positions)
    ordered_modes = [mode for mode, _stage_slot in ordered_positions]
    unique_modes = list(dict.fromkeys(ordered_modes))
    modes_label = repeat_group_modes_label(unique_modes)

    for ordinal, (mode, stage_slot) in enumerate(ordered_positions, start=1):
        controlled_positions[(mode, stage_slot)] = {
            "submission": item["submission"],
            "path": item["path"],
            "repeatGroupKey": group_key,
            "repeatGroupLabel": f"{group_label}: {modes_label}",
            "repeatGroupSize": group_size,
            "repeatGroupOrdinal": ordinal,
        }


def add_controlled_repeat(
    controlled_positions: dict[tuple[str, int], dict],
    item: dict | None,
    modes: Iterable[str],
    stage_slot: int,
    group_key: str,
    group_label: str,
) -> None:
    add_controlled_repeat_positions(
        controlled_positions,
        item,
        [(mode, stage_slot) for mode in modes],
        group_key,
        group_label,
    )


def create_prolific_tasks(session: MiniProlificSession) -> None:
    candidates = [item for item in sync_submission_paths_for_assignment(session.AssignmentId) if item["submission"].code_files]
    if not candidates:
        return

    controlled_positions: dict[tuple[str, int], dict] = {}
    controlled_path_ids: set[int] = set()

    all_three_item = pick_control_submission(
        candidates,
        desired_source_for_stage_slot(PROLIFIC_ALL_THREE_REPEAT_SLOT),
        controlled_path_ids,
    )
    if all_three_item:
        controlled_path_ids.add(all_three_item["path"].Id)
        add_controlled_repeat(
            controlled_positions,
            all_three_item,
            PROLIFIC_STAGE_ORDER,
            PROLIFIC_ALL_THREE_REPEAT_SLOT,
            PROLIFIC_ALL_THREE_REPEAT_KEY,
            PROLIFIC_ALL_THREE_REPEAT_LABEL,
        )

    two_category_mode = random.choice(PROLIFIC_STAGE_ORDER)
    two_category_slots = random.choice(PROLIFIC_TWO_CATEGORY_REPEAT_SLOT_PAIRS)
    two_category_item = pick_control_submission(
        candidates,
        desired_source_for_stage_slot(PROLIFIC_TWO_CATEGORY_REPEAT_SLOT),
        controlled_path_ids,
    )
    if two_category_item:
        controlled_path_ids.add(two_category_item["path"].Id)
        add_controlled_repeat_positions(
            controlled_positions,
            two_category_item,
            [(two_category_mode, stage_slot) for stage_slot in two_category_slots],
            PROLIFIC_TWO_CATEGORY_REPEAT_KEY,
            PROLIFIC_TWO_CATEGORY_REPEAT_LABEL,
        )

    used_path_ids: set[int] = set()
    selected = []
    previous_path_id = None

    for mode in PROLIFIC_STAGE_ORDER:
        for stage_slot, desired_source in enumerate(PROLIFIC_SOURCE_PATTERN, start=1):
            controlled = controlled_positions.get((mode, stage_slot))

            if controlled:
                submission = controlled["submission"]
                path_row = controlled["path"]
                is_repeat = path_row.Id in used_path_ids
                selected.append(
                    {
                        "mode": mode,
                        "submission": submission,
                        "path": path_row,
                        "isRepeat": is_repeat,
                        "repeatGroupKey": controlled["repeatGroupKey"],
                        "repeatGroupLabel": controlled["repeatGroupLabel"],
                        "repeatGroupSize": controlled["repeatGroupSize"],
                        "repeatGroupOrdinal": controlled["repeatGroupOrdinal"],
                    }
                )
                used_path_ids.add(path_row.Id)
                previous_path_id = path_row.Id
                continue

            item = pick_submission(candidates, desired_source, used_path_ids, previous_path_id)
            if not item:
                continue

            submission = item["submission"]
            path_row = item["path"]
            is_repeat = path_row.Id in used_path_ids
            selected.append(
                {
                    "mode": mode,
                    "submission": submission,
                    "path": path_row,
                    "isRepeat": is_repeat,
                    "repeatGroupKey": PROLIFIC_FALLBACK_REPEAT_KEY if is_repeat else "",
                    "repeatGroupLabel": PROLIFIC_FALLBACK_REPEAT_LABEL if is_repeat else "",
                    "repeatGroupSize": 1,
                    "repeatGroupOrdinal": 1,
                }
            )
            used_path_ids.add(path_row.Id)
            previous_path_id = path_row.Id

    for idx, item in enumerate(selected, start=1):
        db.session.add(
            MiniProlificTask(
                SessionDbId=session.Id,
                TaskIndex=idx,
                SubmissionPathId=item["path"].Id,
                Mode=item["mode"],
                Source=item["submission"].source,
                IsRepeat=bool(item["isRepeat"]),
                RepeatGroupKey=item.get("repeatGroupKey", ""),
                RepeatGroupLabel=item.get("repeatGroupLabel", ""),
                RepeatGroupSize=max(1, _parse_int(item.get("repeatGroupSize"), 1)),
                RepeatGroupOrdinal=max(1, _parse_int(item.get("repeatGroupOrdinal"), 1)),
                Completed=False,
                Grade=100,
                ScoringMode="",
                RubricSelectionsJson="[]",
                RubricCountsJson="{}",
                RubricComment="",
                ErrorPointsJson="{}",
                ErrorDefsJson="{}",
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
    submission_path = MiniSubmissionPath.query.get(task.SubmissionPathId)
    stage_index = PROLIFIC_STAGE_ORDER.index(task.Mode) + 1 if task.Mode in PROLIFIC_STAGE_ORDER else 1
    stage_task_index = ((task.TaskIndex - 1) % PROLIFIC_BATCH_SIZE) + 1
    stage_label = MODE_LABELS.get(task.Mode, task.Mode)
    project_id = submission_path.AssignmentId if submission_path else 0

    return {
        "id": task.Id,
        "taskIndex": task.TaskIndex,
        "taskCount": task_count,
        "submissionId": task.SubmissionPathId,
        "submissionPathId": task.SubmissionPathId,
        "projectId": project_id,
        "mode": task.Mode,
        "modeLabel": stage_label,
        "programLabel": f"Program {task.TaskIndex}",
        "stageIndex": stage_index,
        "stageCount": len(PROLIFIC_STAGE_ORDER),
        "stageTaskIndex": stage_task_index,
        "stageTaskCount": PROLIFIC_BATCH_SIZE,
        "stageLabel": stage_label,
        "isRepeat": bool(task.IsRepeat),
        "repeatGroupKey": task.RepeatGroupKey or "",
        "repeatGroupLabel": task.RepeatGroupLabel or "",
        "repeatGroupSize": int(task.RepeatGroupSize or 1),
        "repeatGroupOrdinal": int(task.RepeatGroupOrdinal or 1),
        "visitCount": int(task.VisitCount or 0),
        "gradingSeconds": current_task_grading_seconds(task),
        "completed": bool(task.Completed),
        "grade": int(task.Grade or 100),
        "rubricSelections": json_or_default(task.RubricSelectionsJson, []),
        "rubricCounts": json_or_default(task.RubricCountsJson, {}),
        "rubricComment": task.RubricComment or "",
        "errors": task_line_errors(task.Id),
    }


def require_task_for_session(session: MiniProlificSession, task_id: int) -> MiniProlificTask | None:
    return MiniProlificTask.query.filter_by(Id=task_id, SessionDbId=session.Id).first()


@mini_api.get("/health")
def health():
    return jsonify({"status": "ok"})


@mini_api.get("/prolific/grading-time")
def prolific_grading_time_report():
    query = MiniProlificSession.query

    prolific_pid = str(request.args.get("prolificPid") or request.args.get("PROLIFIC_PID") or "").strip()
    study_id = str(request.args.get("studyId") or request.args.get("STUDY_ID") or "").strip()
    session_id = str(request.args.get("sessionId") or request.args.get("SESSION_ID") or "").strip()
    assignment_id = _parse_int(request.args.get("assignmentId"), 0)
    mode_filter = str(request.args.get("mode") or request.args.get("rubric") or "").strip()

    if prolific_pid:
        query = query.filter(MiniProlificSession.ProlificPid == prolific_pid)
    if study_id:
        query = query.filter(MiniProlificSession.StudyId == study_id)
    if session_id:
        query = query.filter(MiniProlificSession.SessionId == session_id)
    if assignment_id > 0:
        query = query.filter(MiniProlificSession.AssignmentId == assignment_id)

    sessions = query.order_by(MiniProlificSession.CreatedAt.desc()).limit(500).all()
    now = now_utc()
    rows: list[dict] = []

    for session in sessions:
        tasks = MiniProlificTask.query.filter_by(SessionDbId=session.Id).order_by(MiniProlificTask.TaskIndex).all()
        summary = mode_time_summary_for_tasks(tasks, now)
        for mode, mode_row in summary.items():
            if mode_filter and mode != mode_filter:
                continue
            rows.append(
                {
                    "prolificPid": session.ProlificPid,
                    "studyId": session.StudyId,
                    "sessionId": session.SessionId,
                    "assignmentId": session.AssignmentId,
                    "assignmentName": session.AssignmentName,
                    "status": session.Status,
                    "mode": mode,
                    "modeLabel": mode_row["modeLabel"],
                    "taskCount": mode_row["taskCount"],
                    "completedTaskCount": mode_row["completedTaskCount"],
                    "visitCount": mode_row["visitCount"],
                    "gradingSeconds": mode_row["gradingSeconds"],
                    "materialReviewSeconds": int(session.MaterialReviewSeconds or 0),
                    "materialReviewVisits": int(session.MaterialReviewVisits or 0),
                    "materialReturnCount": int(session.MaterialReturnCount or 0),
                    "createdAt": session.CreatedAt.isoformat() if session.CreatedAt else "",
                    "updatedAt": session.UpdatedAt.isoformat() if session.UpdatedAt else "",
                }
            )

    return jsonify({"success": True, "rows": rows})


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
        MaterialReviewSeconds=0,
        MaterialReviewVisits=0,
        MaterialReturnCount=0,
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
        session.MaterialReviewVisits = int(session.MaterialReviewVisits or 0) + 1
        from_task_id = _parse_int(payload.get("fromTaskId"), 0)
        if from_task_id > 0:
            session.MaterialReturnCount = int(session.MaterialReturnCount or 0) + 1
        session.Status = "materials"
    elif event == "end":
        session.MaterialReviewSeconds = int(session.MaterialReviewSeconds or 0) + positive_elapsed_seconds(payload)
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
    out = {
        "success": True,
        "token": session.Token,
        "assignmentId": session.AssignmentId,
        "assignmentName": session.AssignmentName,
        "task": task_to_dict(task, len(tasks)),
        "errorDefs": public_error_defs(),
    }
    if next_task:
        out["nextTaskId"] = next_task.Id
    return jsonify(out)


@mini_api.post("/prolific/session/<token>/tasks/<int:task_id>/start")
def start_prolific_task(token: str, task_id: int):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)
    task = require_task_for_session(session, task_id)
    if not task:
        return make_response(jsonify({"success": False, "error": "Grading task not found."}), HTTPStatus.NOT_FOUND)

    now = now_utc()
    task.VisitCount = int(task.VisitCount or 0) + 1
    if not task.GradingStartedAt:
        task.GradingStartedAt = now
    task.UpdatedAt = now
    session.Status = "grading"
    session.UpdatedAt = now
    task_count = MiniProlificTask.query.filter_by(SessionDbId=session.Id).count()
    db.session.commit()
    return jsonify({"success": True, "task": task_to_dict(task, task_count)})


@mini_api.post("/prolific/session/<token>/tasks/<int:task_id>/pause")
def pause_prolific_task(token: str, task_id: int):
    session = require_prolific_session(token)
    if not session:
        return make_response(jsonify({"success": False, "error": "Prolific session not found."}), HTTPStatus.NOT_FOUND)
    task = require_task_for_session(session, task_id)
    if not task:
        return make_response(jsonify({"success": False, "error": "Grading task not found."}), HTTPStatus.NOT_FOUND)

    payload = request.get_json(silent=True) or {}
    now = now_utc()
    elapsed = record_task_grading_stop(task, now, payload)
    task.UpdatedAt = now
    session.Status = "materials"
    session.UpdatedAt = now
    task_count = MiniProlificTask.query.filter_by(SessionDbId=session.Id).count()
    db.session.commit()
    return jsonify({"success": True, "elapsedSeconds": elapsed, "task": task_to_dict(task, task_count)})


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
    rubric_counts = payload.get("rubricCounts") if isinstance(payload.get("rubricCounts"), dict) else {}
    rubric_comment = str(payload.get("rubricComment") or "")
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []
    error_points = payload.get("errorPoints") if isinstance(payload.get("errorPoints"), dict) else {}
    error_defs = payload.get("errorDefs") if isinstance(payload.get("errorDefs"), dict) else {}

    record_task_grading_stop(task, now, payload)

    task.Completed = True
    task.Grade = max(0, min(100, grade))
    task.ScoringMode = scoring_mode[:40]
    task.RubricSelectionsJson = json_dumps_clean([str(x) for x in rubric_selections], [])
    task.RubricCountsJson = json_dumps_clean(rubric_counts, {})
    task.RubricComment = rubric_comment
    task.ErrorPointsJson = json_dumps_clean(error_points, {})
    task.ErrorDefsJson = json_dumps_clean(error_defs, {})
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
        MiniProlificTask.Completed.is_(False),
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
    raw_responses = payload.get("responses") if isinstance(payload.get("responses"), dict) else {}

    responses = dict(raw_responses)
    for key in ("confusingParts", "helpfulParts", "aiConcerns", "comments"):
        if key not in responses:
            responses[key] = str(payload.get(key) or "")

    alias_keys = {
        "confidence": "overallConfidence",
        "difficulty": "overallDifficulty",
        "fairness": "overallFairness",
    }
    for payload_key, response_key in alias_keys.items():
        if response_key not in responses and payload.get(payload_key) not in (None, ""):
            responses[response_key] = str(payload.get(payload_key) or "")

    for key in (
        "aiUsefulness",
        "preferredMode",
        "mostReliableMode",
        "leastReliableMode",
        "attentionCheck",
    ):
        if key not in responses and payload.get(key) not in (None, ""):
            responses[key] = str(payload.get(key) or "")

    survey = MiniProlificSurvey.query.filter_by(SessionDbId=session.Id).first()
    if not survey:
        survey = MiniProlificSurvey(SessionDbId=session.Id)
        db.session.add(survey)

    survey.ResponsesJson = json_dumps_clean(responses, {})
    survey.SubmittedAt = now_utc()

    session.Status = "completed"
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
    rows = sync_submission_paths_for_assignment(project_id, commit=True)
    return jsonify({"submissions": [submission_path_to_dict(item["path"], item["submission"]) for item in rows]})


@submission_api.post("/recentsubproject")
def recent_submissions_for_project():
    payload = request.get_json(silent=True) or {}
    project_id = _parse_int(payload.get("project_id"), -1)
    rows = sync_submission_paths_for_assignment(project_id, commit=True)

    # Shape expected by AdminGrading from full MAAT:
    # Object.entries(data).map(([userId, value]) => value[0]=last, value[1]=first, value[7]=submissionId)
    out = {}
    for item in rows:
        submission = item["submission"]
        path_row = item["path"]
        out[str(submission.ordinal)] = [
            "",
            "",
            path_row.DisplayName,
            "",
            path_row.FolderName,
            path_row.AssignmentId,
            bool(path_row.IsPassing),
            path_row.Id,
        ]
    return jsonify(out)


@submission_api.get("/testcaseerrors")
def testcase_errors():
    submission_id = _parse_int(request.args.get("id"), -1)
    submission = runtime_submission_for_path_id(submission_id)
    if not submission:
        return make_response(jsonify({"results": [], "error": "Submission not found"}), HTTPStatus.NOT_FOUND)
    return jsonify(testcase_payload(submission))


@submission_api.get("/codefinder")
def code_finder():
    submission_id = _parse_int(request.args.get("id"), -1)
    submission = runtime_submission_for_path_id(submission_id)
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
    errors = MiniSubmissionManualError.query.filter_by(SubmissionPathId=submission_id).order_by(
        MiniSubmissionManualError.StartLine,
        MiniSubmissionManualError.EndLine,
        MiniSubmissionManualError.ErrorId,
    ).all()

    out = {
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
        "grade": grade_from_manual_errors(errors),
        "scoringMode": "lineErrors" if errors else "",
        "errorPoints": {},
        "errorDefs": GRADING_DEFAULT_DEFS_MAP,
    }
    return jsonify(out)


@submission_api.post("/save-grading")
def save_grading():
    payload = request.get_json(silent=True) or {}
    submission_path_id = _parse_int(payload.get("submissionId"), -1)
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []

    submission_path = MiniSubmissionPath.query.get(submission_path_id)
    if not submission_path:
        return make_response(jsonify({"success": False, "error": "Submission path not found"}), HTTPStatus.NOT_FOUND)

    db.session.execute(delete(MiniSubmissionManualError).where(MiniSubmissionManualError.SubmissionPathId == submission_path_id))
    for item in errors:
        if not isinstance(item, dict):
            continue
        start_line = max(1, _parse_int(item.get("startLine"), 1))
        end_line = max(start_line, _parse_int(item.get("endLine"), start_line))
        db.session.add(
            MiniSubmissionManualError(
                SubmissionPathId=submission_path_id,
                StartLine=start_line,
                EndLine=end_line,
                ErrorId=str(item.get("errorId") or "UNKNOWN")[:80],
                Count=max(1, _parse_int(item.get("count"), 1)),
                Note=str(item.get("note") or ""),
            )
        )

    saved_errors = MiniSubmissionManualError.query.filter_by(SubmissionPathId=submission_path_id).all()
    grade = grade_from_manual_errors(saved_errors)

    db.session.commit()
    return jsonify({"success": True, "msg": "Grading saved", "grade": grade, "scoringMode": "lineErrors"})


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
    submission = runtime_submission_for_path_id(int(submission_id))
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