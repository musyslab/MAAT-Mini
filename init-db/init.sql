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
