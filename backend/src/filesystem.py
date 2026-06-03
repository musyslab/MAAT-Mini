from __future__ import annotations

import ast
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SOURCE_EXTS = {".py", ".java"}
ASSIGNMENT_PREFIX_RE = re.compile(r"^\s*(\d+)\s*-")
SUBMISSION_TIME_RE = re.compile(r"^(?P<user>.+?)_(?P<time>.+)$")


@dataclass(frozen=True)
class AssignmentInfo:
    id: int
    name: str
    language: str
    folder: Path
    correct_solution_dir: Path
    incorrect_solutions_dir: Path
    instruction_files: list[Path]


@dataclass(frozen=True)
class SubmissionInfo:
    id: int
    project_id: int
    ordinal: int
    folder_name: str
    folder: Path
    user_key: str
    first_name: str
    last_name: str
    submitted_at: str
    is_passing: bool
    testcase_json_path: Path | None
    testcase_results_path: Path | None
    code_files: list[Path]


def _stable_int(text: str, modulus: int = 800000) -> int:
    digest = hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()
    return 1000 + (int(digest[:12], 16) % modulus)


def _assignment_id(folder_name: str, ordinal: int) -> int:
    match = ASSIGNMENT_PREFIX_RE.match(folder_name)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return _stable_int(f"assignment:{ordinal}:{folder_name}")


def _language_from_name(name: str, correct_dir: Path) -> str:
    lower = name.lower()
    if "python" in lower:
        return "python"
    if "java" in lower:
        return "java"
    if any(p.suffix.lower() == ".py" for p in correct_dir.glob("**/*") if p.is_file()):
        return "python"
    if any(p.suffix.lower() == ".java" for p in correct_dir.glob("**/*") if p.is_file()):
        return "java"
    return "unknown"


def root_from_env() -> Path:
    tabot_dir = Path(os.environ.get("TABOT_DIR", "/tabot-files"))
    return tabot_dir / "incorrect-programs"


def scan_assignments(root: Path | None = None) -> list[AssignmentInfo]:
    root = root or root_from_env()
    if not root.exists():
        return []

    assignments: list[AssignmentInfo] = []
    for ordinal, folder in enumerate(sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name.lower()), start=1):
        correct_dir = folder / "correct solution"
        incorrect_dir = folder / "incorrect solutions"
        if not correct_dir.exists() and not incorrect_dir.exists():
            continue
        instruction_files = [
            p for p in correct_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".pdf", ".docx", ".doc"}
        ] if correct_dir.exists() else []
        assignment = AssignmentInfo(
            id=_assignment_id(folder.name, ordinal),
            name=folder.name,
            language=_language_from_name(folder.name, correct_dir),
            folder=folder,
            correct_solution_dir=correct_dir,
            incorrect_solutions_dir=incorrect_dir,
            instruction_files=instruction_files,
        )
        assignments.append(assignment)
    return assignments


def get_assignment(project_id: int) -> AssignmentInfo | None:
    for assignment in scan_assignments():
        if assignment.id == project_id:
            return assignment
    return None


def _display_name_from_folder(folder_name: str) -> tuple[str, str, str, str]:
    match = SUBMISSION_TIME_RE.match(folder_name)
    user_key = match.group("user") if match else folder_name
    submitted_at = match.group("time") if match else ""

    cleaned = user_key.replace("-", " ").replace(".", " ").strip()
    if cleaned.isdigit():
        return user_key, f"Student {cleaned}", "", submitted_at

    pieces = [p for p in re.split(r"[\s_]+", cleaned) if p]
    if len(pieces) >= 2:
        return user_key, pieces[0].title(), " ".join(pieces[1:]).title(), submitted_at
    return user_key, cleaned or folder_name, "", submitted_at


def _read_pass_fail(testcase_results_path: Path | None, testcase_json_path: Path | None) -> bool:
    if testcase_json_path and testcase_json_path.exists():
        try:
            data = json.loads(testcase_json_path.read_text(encoding="utf-8"))
            results = data.get("results", [])
            if isinstance(results, list) and results:
                return all(bool(item.get("passed")) for item in results if isinstance(item, dict))
        except Exception:
            pass

    if testcase_results_path and testcase_results_path.exists():
        try:
            parsed = ast.literal_eval(testcase_results_path.read_text(encoding="utf-8").strip())
            failed = parsed.get("Failed", []) if isinstance(parsed, dict) else []
            return len(failed) == 0
        except Exception:
            pass

    return False


def scan_submissions(project_id: int) -> list[SubmissionInfo]:
    assignment = get_assignment(project_id)
    if not assignment or not assignment.incorrect_solutions_dir.exists():
        return []

    rows: list[SubmissionInfo] = []
    submission_dirs = sorted([p for p in assignment.incorrect_solutions_dir.iterdir() if p.is_dir()], key=lambda p: p.name.lower())
    for ordinal, folder in enumerate(submission_dirs, start=1):
        testcase_json = folder / "testcases.json"
        testcase_results = folder / "TestCaseResults.txt"
        code_files = sorted(
            [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in SOURCE_EXTS],
            key=lambda p: str(p.relative_to(folder)).lower(),
        )
        user_key, first_name, last_name, submitted_at = _display_name_from_folder(folder.name)
        rows.append(
            SubmissionInfo(
                id=(project_id * 1_000_000) + ordinal,
                project_id=project_id,
                ordinal=ordinal,
                folder_name=folder.name,
                folder=folder,
                user_key=user_key,
                first_name=first_name,
                last_name=last_name,
                submitted_at=submitted_at,
                is_passing=_read_pass_fail(testcase_results if testcase_results.exists() else None, testcase_json if testcase_json.exists() else None),
                testcase_json_path=testcase_json if testcase_json.exists() else None,
                testcase_results_path=testcase_results if testcase_results.exists() else None,
                code_files=code_files,
            )
        )
    return rows


def get_submission(submission_id: int) -> SubmissionInfo | None:
    project_id = submission_id // 1_000_000
    for submission in scan_submissions(project_id):
        if submission.id == submission_id:
            return submission
    return None


def assignment_to_dict(assignment: AssignmentInfo) -> dict[str, Any]:
    submissions = scan_submissions(assignment.id)
    return {
        "id": assignment.id,
        "name": assignment.name,
        "language": assignment.language,
        "path": str(assignment.folder),
        "submissionCount": len(submissions),
        "incorrectSolutionsPath": str(assignment.incorrect_solutions_dir),
        "correctSolutionPath": str(assignment.correct_solution_dir),
        "instructionFiles": [p.name for p in assignment.instruction_files],
    }


def submission_to_dict(submission: SubmissionInfo) -> dict[str, Any]:
    full_name = f"{submission.first_name} {submission.last_name}".strip() or submission.user_key
    return {
        "submissionId": submission.id,
        "projectId": submission.project_id,
        "userId": submission.ordinal,
        "userKey": submission.user_key,
        "firstName": submission.first_name,
        "lastName": submission.last_name,
        "fullName": full_name,
        "folderName": submission.folder_name,
        "submittedAt": submission.submitted_at,
        "isPassing": submission.is_passing,
        "codeFileCount": len(submission.code_files),
        "hasTestcasesJson": bool(submission.testcase_json_path),
        "hasTestCaseResults": bool(submission.testcase_results_path),
        "path": str(submission.folder),
    }


def testcase_payload(submission: SubmissionInfo) -> dict[str, Any]:
    if submission.testcase_json_path and submission.testcase_json_path.exists():
        try:
            data = json.loads(submission.testcase_json_path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("results"), list):
                return data
        except Exception as exc:
            return {"results": [], "error": f"Could not parse testcases.json: {exc}"}

    if submission.testcase_results_path and submission.testcase_results_path.exists():
        try:
            parsed = ast.literal_eval(submission.testcase_results_path.read_text(encoding="utf-8").strip())
            passed = parsed.get("Passed", []) if isinstance(parsed, dict) else []
            failed = parsed.get("Failed", []) if isinstance(parsed, dict) else []
            results = []
            for name in passed:
                results.append({
                    "name": str(name),
                    "description": str(name),
                    "passed": True,
                    "shortDiff": "",
                    "longDiff": "",
                    "shortDiffSameAsLong": True,
                })
            for name in failed:
                results.append({
                    "name": str(name),
                    "description": str(name),
                    "passed": False,
                    "shortDiff": "",
                    "longDiff": "No testcases.json longDiff was provided for this failed testcase.",
                    "shortDiffSameAsLong": True,
                })
            return {"results": results}
        except Exception as exc:
            return {"results": [], "error": f"Could not parse TestCaseResults.txt: {exc}"}

    return {"results": []}


def code_payload(submission: SubmissionInfo) -> dict[str, Any]:
    files = []
    for path in submission.code_files:
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(encoding="latin-1", errors="replace")
        except Exception as exc:
            content = f"/* Could not read {path.name}: {exc} */"
        files.append({"name": str(path.relative_to(submission.folder)), "content": content})
    return {"files": files}
