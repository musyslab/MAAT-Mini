DROP TABLE IF EXISTS MiniProlificTaskLineErrors;
DROP TABLE IF EXISTS MiniProlificSurveys;
DROP TABLE IF EXISTS MiniProlificTasks;
DROP TABLE IF EXISTS MiniSubmissionManualErrors;
DROP TABLE IF EXISTS MiniProlificSessions;
DROP TABLE IF EXISTS MiniSubmissionPaths;

CREATE TABLE MiniSubmissionPaths (
  Id INT NOT NULL AUTO_INCREMENT,
  PathHash VARCHAR(64) NOT NULL,
  ExternalSubmissionId INT NOT NULL,
  AssignmentId INT NOT NULL,
  AssignmentName VARCHAR(255) NOT NULL DEFAULT '',
  Ordinal INT NOT NULL DEFAULT 0,
  Source VARCHAR(40) NOT NULL DEFAULT 'student',
  SourceLabel VARCHAR(80) NOT NULL DEFAULT 'Program',
  DisplayName VARCHAR(120) NOT NULL DEFAULT 'Program',
  FolderName VARCHAR(500) NOT NULL DEFAULT '',
  FolderPath TEXT NOT NULL,
  TestcasesJsonPath TEXT NOT NULL,
  TestcaseResultsPath TEXT NOT NULL,
  CodeFilesJson TEXT NOT NULL,
  IsPassing TINYINT(1) NOT NULL DEFAULT 0,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  UNIQUE KEY uq_MiniSubmissionPaths_PathHash (PathHash),
  UNIQUE KEY uq_MiniSubmissionPaths_ExternalSubmissionId (ExternalSubmissionId),
  KEY idx_MiniSubmissionPaths_AssignmentId (AssignmentId),
  KEY idx_MiniSubmissionPaths_Source (Source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE MiniSubmissionManualErrors (
  Id INT NOT NULL AUTO_INCREMENT,
  SubmissionPathId INT NOT NULL,
  StartLine INT NOT NULL,
  EndLine INT NOT NULL,
  ErrorId VARCHAR(80) NOT NULL,
  Count INT NOT NULL DEFAULT 1,
  Note TEXT NOT NULL,
  PRIMARY KEY (Id),
  KEY idx_MiniSubmissionManualErrors_SubmissionPathId (SubmissionPathId),
  CONSTRAINT fk_MiniSubmissionManualErrors_SubmissionPathId
    FOREIGN KEY (SubmissionPathId) REFERENCES MiniSubmissionPaths (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE MiniProlificSessions (
  Id INT NOT NULL AUTO_INCREMENT,
  Token VARCHAR(80) NOT NULL,
  ProlificPid VARCHAR(120) NOT NULL,
  StudyId VARCHAR(120) NOT NULL,
  SessionId VARCHAR(120) NOT NULL,
  AssignmentId INT NOT NULL,
  AssignmentName VARCHAR(255) NOT NULL DEFAULT '',
  Status VARCHAR(40) NOT NULL DEFAULT 'started',
  MaterialReviewSeconds INT NOT NULL DEFAULT 0,
  MaterialReviewVisits INT NOT NULL DEFAULT 0,
  MaterialReturnCount INT NOT NULL DEFAULT 0,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  UNIQUE KEY uq_MiniProlificSessions_Token (Token),
  UNIQUE KEY uq_MiniProlificSessions_ProlificStudySession (ProlificPid, StudyId, SessionId),
  KEY idx_MiniProlificSessions_ProlificPid (ProlificPid),
  KEY idx_MiniProlificSessions_StudyId (StudyId),
  KEY idx_MiniProlificSessions_SessionId (SessionId),
  KEY idx_MiniProlificSessions_AssignmentId (AssignmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE MiniProlificTasks (
  Id INT NOT NULL AUTO_INCREMENT,
  SessionDbId INT NOT NULL,
  TaskIndex INT NOT NULL,
  SubmissionPathId INT NOT NULL,
  Mode VARCHAR(40) NOT NULL,
  Source VARCHAR(40) NOT NULL DEFAULT 'student',
  IsRepeat TINYINT(1) NOT NULL DEFAULT 0,
  RepeatGroupKey VARCHAR(80) NOT NULL DEFAULT '',
  RepeatGroupLabel VARCHAR(160) NOT NULL DEFAULT '',
  RepeatGroupSize INT NOT NULL DEFAULT 1,
  RepeatGroupOrdinal INT NOT NULL DEFAULT 1,
  VisitCount INT NOT NULL DEFAULT 0,
  GradingStartedAt DATETIME NULL,
  GradingSeconds INT NOT NULL DEFAULT 0,
  Completed TINYINT(1) NOT NULL DEFAULT 0,
  Grade INT NOT NULL DEFAULT 100,
  ScoringMode VARCHAR(40) NOT NULL DEFAULT '',
  RubricSelectionsJson TEXT NOT NULL,
  RubricCountsJson TEXT NOT NULL,
  RubricComment TEXT NOT NULL,
  ErrorPointsJson TEXT NOT NULL,
  ErrorDefsJson TEXT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  UNIQUE KEY uq_MiniProlificTasks_SessionTask (SessionDbId, TaskIndex),
  KEY idx_MiniProlificTasks_SessionDbId (SessionDbId),
  KEY idx_MiniProlificTasks_SubmissionPathId (SubmissionPathId),
  KEY idx_MiniProlificTasks_RepeatGroupKey (RepeatGroupKey),
  KEY idx_MiniProlificTasks_Mode (Mode),
  CONSTRAINT fk_MiniProlificTasks_SessionDbId
    FOREIGN KEY (SessionDbId) REFERENCES MiniProlificSessions (Id)
    ON DELETE CASCADE,
  CONSTRAINT fk_MiniProlificTasks_SubmissionPathId
    FOREIGN KEY (SubmissionPathId) REFERENCES MiniSubmissionPaths (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE MiniProlificTaskLineErrors (
  Id INT NOT NULL AUTO_INCREMENT,
  TaskId INT NOT NULL,
  StartLine INT NOT NULL,
  EndLine INT NOT NULL,
  ErrorId VARCHAR(80) NOT NULL,
  Count INT NOT NULL DEFAULT 1,
  Note TEXT NOT NULL,
  PRIMARY KEY (Id),
  KEY idx_MiniProlificTaskLineErrors_TaskId (TaskId),
  CONSTRAINT fk_MiniProlificTaskLineErrors_TaskId
    FOREIGN KEY (TaskId) REFERENCES MiniProlificTasks (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE MiniProlificSurveys (
  Id INT NOT NULL AUTO_INCREMENT,
  SessionDbId INT NOT NULL,
  ResponsesJson TEXT NOT NULL,
  SubmittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  UNIQUE KEY uq_MiniProlificSurveys_SessionDbId (SessionDbId),
  CONSTRAINT fk_MiniProlificSurveys_SessionDbId
    FOREIGN KEY (SessionDbId) REFERENCES MiniProlificSessions (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;