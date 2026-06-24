CREATE TABLE IF NOT EXISTS MiniSubmissionGrades (
  SubmissionId INT NOT NULL,
  ProjectId INT NOT NULL,
  Grade INT DEFAULT NULL,
  ScoringMode VARCHAR(20) DEFAULT NULL,
  ErrorPointsJson TEXT,
  ErrorDefsJson TEXT,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (SubmissionId),
  KEY idx_MiniSubmissionGrades_ProjectId (ProjectId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS MiniSubmissionManualErrors (
  Id INT NOT NULL AUTO_INCREMENT,
  SubmissionId INT NOT NULL,
  StartLine INT NOT NULL,
  EndLine INT NOT NULL,
  ErrorId VARCHAR(80) NOT NULL,
  Count INT NOT NULL DEFAULT 1,
  Note TEXT,
  PRIMARY KEY (Id),
  KEY idx_MiniSubmissionManualErrors_SubmissionId (SubmissionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS MiniProlificSessions (
  Id INT NOT NULL AUTO_INCREMENT,
  Token VARCHAR(80) NOT NULL,
  ProlificPid VARCHAR(120) NOT NULL,
  StudyId VARCHAR(120) NOT NULL,
  SessionId VARCHAR(120) NOT NULL,
  AssignmentId INT NOT NULL,
  AssignmentName VARCHAR(255) NOT NULL,
  Status VARCHAR(40) NOT NULL DEFAULT 'started',
  MaterialReviewStartedAt DATETIME DEFAULT NULL,
  MaterialReviewEndedAt DATETIME DEFAULT NULL,
  MaterialReviewSeconds INT DEFAULT 0,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CompletedAt DATETIME DEFAULT NULL,
  PRIMARY KEY (Id),
  UNIQUE KEY uq_MiniProlificSessions_Token (Token),
  UNIQUE KEY uq_MiniProlificSessions_ProlificStudySession (ProlificPid, StudyId, SessionId),
  KEY idx_MiniProlificSessions_ProlificPid (ProlificPid),
  KEY idx_MiniProlificSessions_StudyId (StudyId),
  KEY idx_MiniProlificSessions_SessionId (SessionId),
  KEY idx_MiniProlificSessions_AssignmentId (AssignmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS MiniProlificTasks (
  Id INT NOT NULL AUTO_INCREMENT,
  SessionDbId INT NOT NULL,
  TaskIndex INT NOT NULL,
  SubmissionId INT NOT NULL,
  ProjectId INT NOT NULL,
  Mode VARCHAR(40) NOT NULL,
  Source VARCHAR(40) NOT NULL,
  IsRepeat TINYINT(1) NOT NULL DEFAULT 0,
  StartedAt DATETIME DEFAULT NULL,
  EndedAt DATETIME DEFAULT NULL,
  DurationSeconds INT DEFAULT 0,
  Grade INT DEFAULT NULL,
  ScoringMode VARCHAR(40) DEFAULT NULL,
  RubricJson TEXT,
  ErrorPointsJson TEXT,
  ErrorDefsJson TEXT,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_MiniProlificTasks_SessionDbId (SessionDbId),
  KEY idx_MiniProlificTasks_SubmissionId (SubmissionId),
  KEY idx_MiniProlificTasks_ProjectId (ProjectId),
  CONSTRAINT fk_MiniProlificTasks_SessionDbId
    FOREIGN KEY (SessionDbId) REFERENCES MiniProlificSessions (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS MiniProlificTaskLineErrors (
  Id INT NOT NULL AUTO_INCREMENT,
  TaskId INT NOT NULL,
  StartLine INT NOT NULL,
  EndLine INT NOT NULL,
  ErrorId VARCHAR(80) NOT NULL,
  Count INT NOT NULL DEFAULT 1,
  Note TEXT,
  PRIMARY KEY (Id),
  KEY idx_MiniProlificTaskLineErrors_TaskId (TaskId),
  CONSTRAINT fk_MiniProlificTaskLineErrors_TaskId
    FOREIGN KEY (TaskId) REFERENCES MiniProlificTasks (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS MiniProlificSurveys (
  Id INT NOT NULL AUTO_INCREMENT,
  SessionDbId INT NOT NULL,
  Confidence VARCHAR(40) DEFAULT NULL,
  Difficulty VARCHAR(40) DEFAULT NULL,
  AiUsefulness VARCHAR(40) DEFAULT NULL,
  Fairness VARCHAR(40) DEFAULT NULL,
  Comments TEXT,
  SurveyJson TEXT,
  SubmittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  UNIQUE KEY uq_MiniProlificSurveys_SessionDbId (SessionDbId),
  CONSTRAINT fk_MiniProlificSurveys_SessionDbId
    FOREIGN KEY (SessionDbId) REFERENCES MiniProlificSessions (Id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;