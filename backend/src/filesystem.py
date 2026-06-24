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
INSTRUCTION_EXTS = {".pdf", ".docx", ".doc"}
TEXT_EXTS = {".txt", ".md", ".rst", ".csv", ".json", ".yaml", ".yml"}
ASSIGNMENT_PREFIX_RE = re.compile(r"^\s*(\d+)\s*-")
SUBMISSION_TIME_RE = re.compile(r"^(?P<user>.+?)_(?P<time>.+)$")
SUBMISSION_ID_FACTOR = 1_000_000
AI_SUBMISSION_ID_OFFSET = 500_000


@dataclass(frozen=True)
class AssignmentInfo:
    id: int
    name: str
    language: str
    folder: Path
    correct_solution_dir: Path
    incorrect_solutions_dir: Path
    ai_generated_dir: Path | None
    instruction_files: list[Path]
    solution_files: list[Path]
    text_files: list[Path]


@dataclass(frozen=True)
class SubmissionInfo:
    id: int
    project_id: int
    ordinal: int
    folder_name: str
    folder: Path
    source: str
    source_label: str
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


def _language_from_suffix(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".py":
        return "python"
    if suffix == ".java":
        return "java"
    return "text"


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1", errors="replace")
    except Exception as exc:
        return f"Could not read {path.name}: {exc}"


def _relative_name(path: Path, base: Path) -> str:
    try:
        return path.relative_to(base).as_posix()
    except ValueError:
        return path.name


def tabot_dir_from_env() -> Path:
    tabot_dir = Path(os.environ.get("TABOT_DIR", "/tabot-files"))
    return tabot_dir


def root_from_env() -> Path:
    return tabot_dir_from_env() / "incorrect-programs"


def ai_generated_root_from_env() -> Path:
    return tabot_dir_from_env() / "ai-generated"


def scan_assignments(root: Path | None = None) -> list[AssignmentInfo]:
    root = root or root_from_env()
    if not root.exists():
        return []

    ai_root = ai_generated_root_from_env()

    assignments: list[AssignmentInfo] = []
    for ordinal, folder in enumerate(sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name.lower()), start=1):
        correct_dir = folder / "correct solution"
        incorrect_dir = folder / "incorrect solutions"
        ai_generated_dir = ai_root / folder.name
        if not correct_dir.exists() and not incorrect_dir.exists():
            continue

        correct_files = sorted(
            [p for p in correct_dir.rglob("*") if p.is_file()],
            key=lambda p: _relative_name(p, correct_dir).lower(),
        ) if correct_dir.exists() else []

        instruction_files = [p for p in correct_files if p.suffix.lower() in INSTRUCTION_EXTS]
        solution_files = [p for p in correct_files if p.suffix.lower() in SOURCE_EXTS]
        text_files = [
            p for p in correct_files
            if p.suffix.lower() in TEXT_EXTS and p.suffix.lower() not in SOURCE_EXTS and p.suffix.lower() not in INSTRUCTION_EXTS
        ]

        assignment = AssignmentInfo(
            id=_assignment_id(folder.name, ordinal),
            name=folder.name,
            language=_language_from_name(folder.name, correct_dir),
            folder=folder,
            correct_solution_dir=correct_dir,
            incorrect_solutions_dir=incorrect_dir,
            ai_generated_dir=ai_generated_dir if ai_generated_dir.exists() and ai_generated_dir.is_dir() else None,
            instruction_files=instruction_files,
            solution_files=solution_files,
            text_files=text_files,
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


def _source_files_in_submission(folder: Path) -> list[Path]:
    return sorted(
        [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in SOURCE_EXTS],
        key=lambda p: str(p.relative_to(folder)).lower(),
    )


def scan_submissions(project_id: int) -> list[SubmissionInfo]:
    assignment = get_assignment(project_id)
    if not assignment:
        return []

    rows: list[SubmissionInfo] = []

    if assignment.incorrect_solutions_dir.exists():
        submission_dirs = sorted([p for p in assignment.incorrect_solutions_dir.iterdir() if p.is_dir()], key=lambda p: p.name.lower())
        for ordinal, folder in enumerate(submission_dirs, start=1):
            testcase_json = folder / "testcases.json"
            testcase_results = folder / "TestCaseResults.txt"
            code_files = _source_files_in_submission(folder)
            user_key, first_name, last_name, submitted_at = _display_name_from_folder(folder.name)
            rows.append(
                SubmissionInfo(
                    id=(project_id * SUBMISSION_ID_FACTOR) + ordinal,
                    project_id=project_id,
                    ordinal=ordinal,
                    folder_name=folder.name,
                    folder=folder,
                    source="student",
                    source_label="Student Submission",
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

    if assignment.ai_generated_dir and assignment.ai_generated_dir.exists():
        ai_ordinal = 1
        student_dirs = sorted([p for p in assignment.ai_generated_dir.iterdir() if p.is_dir()], key=lambda p: p.name.lower())
        for student_dir in student_dirs:
            output_dirs = sorted([p for p in student_dir.iterdir() if p.is_dir()], key=lambda p: p.name.lower())
            for folder in output_dirs:
                testcase_json = folder / "testcases.json"
                testcase_results = folder / "TestCaseResults.txt"
                code_files = _source_files_in_submission(folder)
                if not code_files and not testcase_json.exists() and not testcase_results.exists():
                    continue

                user_key, first_name, last_name, _submitted_at = _display_name_from_folder(student_dir.name)
                folder_name = f"{student_dir.name}/{folder.name}"
                ordinal = AI_SUBMISSION_ID_OFFSET + ai_ordinal
                rows.append(
                    SubmissionInfo(
                        id=(project_id * SUBMISSION_ID_FACTOR) + ordinal,
                        project_id=project_id,
                        ordinal=ordinal,
                        folder_name=folder_name,
                        folder=folder,
                        source="ai",
                        source_label="AI Output",
                        user_key=user_key,
                        first_name=first_name,
                        last_name=last_name,
                        submitted_at=folder.name,
                        is_passing=_read_pass_fail(testcase_results if testcase_results.exists() else None, testcase_json if testcase_json.exists() else None),
                        testcase_json_path=testcase_json if testcase_json.exists() else None,
                        testcase_results_path=testcase_results if testcase_results.exists() else None,
                        code_files=code_files,
                    )
                )
                ai_ordinal += 1
    return rows


def get_submission(submission_id: int) -> SubmissionInfo | None:
    project_id = submission_id // SUBMISSION_ID_FACTOR
    for submission in scan_submissions(project_id):
        if submission.id == submission_id:
            return submission
    return None


def _material_file_dict(path: Path, base: Path, kind: str) -> dict[str, Any]:
    return {
        "name": _relative_name(path, base),
        "kind": kind,
        "extension": path.suffix.lower(),
        "sizeBytes": path.stat().st_size if path.exists() else 0,
        "path": str(path),
    }


def assignment_to_dict(assignment: AssignmentInfo) -> dict[str, Any]:
    submissions = scan_submissions(assignment.id)
    return {
        "id": assignment.id,
        "name": assignment.name,
        "language": assignment.language,
        "path": "",
        "submissionCount": len(submissions),
        "studentSubmissionCount": len([s for s in submissions if s.source == "student"]),
        "aiOutputCount": len([s for s in submissions if s.source == "ai"]),
        "incorrectSolutionsPath": "",
        "aiGeneratedPath": "",
        "correctSolutionPath": "",
        "instructionFiles": [f"Instruction PDF {idx + 1}" for idx, _p in enumerate(assignment.instruction_files)],
        "solutionFiles": [f"Reference file {idx + 1}" for idx, _p in enumerate(assignment.solution_files)],
        "textFiles": [f"Text material {idx + 1}" for idx, _p in enumerate(assignment.text_files)],
    }

def assignment_materials_payload(assignment: AssignmentInfo) -> dict[str, Any]:
    pdf_files = [p for p in assignment.instruction_files if p.suffix.lower() == ".pdf"]

    return {
        "assignment": assignment_to_dict(assignment),
        "pdfFiles": [
            _material_file_dict(p, assignment.correct_solution_dir, "instruction")
            for p in pdf_files
        ],
        "solutionFiles": [
            {
                **_material_file_dict(p, assignment.correct_solution_dir, "solution"),
                "language": _language_from_suffix(p),
                "content": _read_text(p),
            }
            for p in assignment.solution_files
        ],
        "textFiles": [
            {
                **_material_file_dict(p, assignment.correct_solution_dir, "text"),
                "content": _read_text(p),
            }
            for p in assignment.text_files
        ],
    }


def find_assignment_material_file(assignment: AssignmentInfo, kind: str, name: str) -> Path | None:
    target = (name or "").replace("\\", "/").strip("/")
    if not target:
        return None

    if kind == "instruction":
        candidates = [p for p in assignment.instruction_files if p.suffix.lower() == ".pdf"]
    elif kind == "solution":
        candidates = assignment.solution_files
    elif kind == "text":
        candidates = assignment.text_files
    else:
        return None

    for path in candidates:
        rel = _relative_name(path, assignment.correct_solution_dir)
        if rel == target:
            return path
    return None


def submission_to_dict(submission: SubmissionInfo) -> dict[str, Any]:
    display = f"Program {submission.ordinal if submission.source == 'student' else submission.ordinal - AI_SUBMISSION_ID_OFFSET}"
    return {
        "submissionId": submission.id,
        "projectId": submission.project_id,
        "userId": submission.ordinal,
        "userKey": display,
        "firstName": "",
        "lastName": "",
        "fullName": display,
        "folderName": "",
        "source": submission.source,
        "sourceLabel": "Program",
        "submittedAt": "",
        "isPassing": submission.is_passing,
        "codeFileCount": len(submission.code_files),
        "hasTestcasesJson": bool(submission.testcase_json_path),
        "hasTestCaseResults": bool(submission.testcase_results_path),
        "path": "",
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
    for idx, path in enumerate(submission.code_files, start=1):
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = path.read_text(encoding="latin-1", errors="replace")
        except Exception as exc:
            content = f"/* Could not read program file: {exc} */"

        suffix = path.suffix.lower()
        if suffix not in SOURCE_EXTS:
            suffix = ""
        files.append({"name": f"Program file {idx}{suffix}", "content": content})
    return {"files": files}
