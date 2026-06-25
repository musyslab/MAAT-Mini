from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from src.database import db


class MiniSubmissionPath(db.Model):
    __tablename__ = "MiniSubmissionPaths"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    PathHash = Column(String(64), nullable=False, unique=True, index=True)
    ExternalSubmissionId = Column(Integer, nullable=False, unique=True, index=True)
    AssignmentId = Column(Integer, nullable=False, index=True)
    AssignmentName = Column(String(255), nullable=False, default="")
    Ordinal = Column(Integer, nullable=False, default=0)
    Source = Column(String(40), nullable=False, default="student", index=True)
    SourceLabel = Column(String(80), nullable=False, default="Program")
    DisplayName = Column(String(120), nullable=False, default="Program")
    FolderName = Column(String(500), nullable=False, default="")
    FolderPath = Column(Text, nullable=False, default="")
    TestcasesJsonPath = Column(Text, nullable=False, default="")
    TestcaseResultsPath = Column(Text, nullable=False, default="")
    CodeFilesJson = Column(Text, nullable=False, default="[]")
    IsPassing = Column(Boolean, nullable=False, default=False)
    CreatedAt = Column(DateTime, default=datetime.utcnow, nullable=False)
    UpdatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class MiniSubmissionManualError(db.Model):
    __tablename__ = "MiniSubmissionManualErrors"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SubmissionPathId = Column(Integer, ForeignKey("MiniSubmissionPaths.Id"), nullable=False, index=True)
    StartLine = Column(Integer, nullable=False)
    EndLine = Column(Integer, nullable=False)
    ErrorId = Column(String(80), nullable=False)
    Count = Column(Integer, nullable=False, default=1)
    Note = Column(Text, nullable=False, default="")


class MiniProlificSession(db.Model):
    __tablename__ = "MiniProlificSessions"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    Token = Column(String(80), nullable=False, unique=True, index=True)
    ProlificPid = Column(String(120), nullable=False, index=True)
    StudyId = Column(String(120), nullable=False, index=True)
    SessionId = Column(String(120), nullable=False, index=True)
    AssignmentId = Column(Integer, nullable=False, index=True)
    AssignmentName = Column(String(255), nullable=False, default="")
    Status = Column(String(40), nullable=False, default="started")
    MaterialReviewSeconds = Column(Integer, nullable=False, default=0)
    MaterialReviewVisits = Column(Integer, nullable=False, default=0)
    MaterialReturnCount = Column(Integer, nullable=False, default=0)
    CreatedAt = Column(DateTime, default=datetime.utcnow, nullable=False)
    UpdatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class MiniProlificTask(db.Model):
    __tablename__ = "MiniProlificTasks"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SessionDbId = Column(Integer, ForeignKey("MiniProlificSessions.Id"), nullable=False, index=True)
    TaskIndex = Column(Integer, nullable=False)
    SubmissionPathId = Column(Integer, ForeignKey("MiniSubmissionPaths.Id"), nullable=False, index=True)
    Mode = Column(String(40), nullable=False)
    Source = Column(String(40), nullable=False, default="student")
    IsRepeat = Column(Boolean, nullable=False, default=False)
    RepeatGroupKey = Column(String(80), nullable=False, default="", index=True)
    RepeatGroupLabel = Column(String(160), nullable=False, default="")
    RepeatGroupSize = Column(Integer, nullable=False, default=1)
    RepeatGroupOrdinal = Column(Integer, nullable=False, default=1)
    VisitCount = Column(Integer, nullable=False, default=0)
    Completed = Column(Boolean, nullable=False, default=False)
    Grade = Column(Integer, nullable=False, default=100)
    ScoringMode = Column(String(40), nullable=False, default="")
    RubricSelectionsJson = Column(Text, nullable=False, default="[]")
    RubricCountsJson = Column(Text, nullable=False, default="{}")
    RubricComment = Column(Text, nullable=False, default="")
    ErrorPointsJson = Column(Text, nullable=False, default="{}")
    ErrorDefsJson = Column(Text, nullable=False, default="{}")
    CreatedAt = Column(DateTime, default=datetime.utcnow, nullable=False)
    UpdatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class MiniProlificTaskLineError(db.Model):
    __tablename__ = "MiniProlificTaskLineErrors"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    TaskId = Column(Integer, ForeignKey("MiniProlificTasks.Id"), nullable=False, index=True)
    StartLine = Column(Integer, nullable=False)
    EndLine = Column(Integer, nullable=False)
    ErrorId = Column(String(80), nullable=False)
    Count = Column(Integer, nullable=False, default=1)
    Note = Column(Text, nullable=False, default="")


class MiniProlificSurvey(db.Model):
    __tablename__ = "MiniProlificSurveys"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SessionDbId = Column(Integer, ForeignKey("MiniProlificSessions.Id"), nullable=False, unique=True, index=True)
    ResponsesJson = Column(Text, nullable=False, default="{}")
    SubmittedAt = Column(DateTime, default=datetime.utcnow, nullable=False)