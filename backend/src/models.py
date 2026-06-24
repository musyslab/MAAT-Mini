from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from src.database import db


class MiniSubmissionGrade(db.Model):
    __tablename__ = "MiniSubmissionGrades"

    SubmissionId = Column(Integer, primary_key=True)
    ProjectId = Column(Integer, nullable=False, index=True)
    Grade = Column(Integer)
    ScoringMode = Column(String(20))
    ErrorPointsJson = Column(Text)
    ErrorDefsJson = Column(Text)
    UpdatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MiniSubmissionManualError(db.Model):
    __tablename__ = "MiniSubmissionManualErrors"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SubmissionId = Column(Integer, nullable=False, index=True)
    StartLine = Column(Integer, nullable=False)
    EndLine = Column(Integer, nullable=False)
    ErrorId = Column(String(80), nullable=False)
    Count = Column(Integer, nullable=False, default=1)
    Note = Column(Text)


class MiniProlificSession(db.Model):
    __tablename__ = "MiniProlificSessions"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    Token = Column(String(80), nullable=False, unique=True, index=True)
    ProlificPid = Column(String(120), nullable=False, index=True)
    StudyId = Column(String(120), nullable=False, index=True)
    SessionId = Column(String(120), nullable=False, index=True)
    AssignmentId = Column(Integer, nullable=False, index=True)
    AssignmentName = Column(String(255), nullable=False)
    Status = Column(String(40), nullable=False, default="started")
    MaterialReviewStartedAt = Column(DateTime)
    MaterialReviewEndedAt = Column(DateTime)
    MaterialReviewSeconds = Column(Integer, default=0)
    CreatedAt = Column(DateTime, default=datetime.utcnow, nullable=False)
    UpdatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    CompletedAt = Column(DateTime)


class MiniProlificTask(db.Model):
    __tablename__ = "MiniProlificTasks"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SessionDbId = Column(Integer, ForeignKey("MiniProlificSessions.Id"), nullable=False, index=True)
    TaskIndex = Column(Integer, nullable=False)
    SubmissionId = Column(Integer, nullable=False, index=True)
    ProjectId = Column(Integer, nullable=False, index=True)
    Mode = Column(String(40), nullable=False)
    Source = Column(String(40), nullable=False)
    IsRepeat = Column(Boolean, nullable=False, default=False)
    StartedAt = Column(DateTime)
    EndedAt = Column(DateTime)
    DurationSeconds = Column(Integer, default=0)
    Grade = Column(Integer)
    ScoringMode = Column(String(40))
    RubricJson = Column(Text)
    ErrorPointsJson = Column(Text)
    ErrorDefsJson = Column(Text)
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
    Note = Column(Text)


class MiniProlificSurvey(db.Model):
    __tablename__ = "MiniProlificSurveys"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SessionDbId = Column(Integer, ForeignKey("MiniProlificSessions.Id"), nullable=False, unique=True, index=True)
    Confidence = Column(String(40))
    Difficulty = Column(String(40))
    AiUsefulness = Column(String(40))
    Fairness = Column(String(40))
    Comments = Column(Text)
    SurveyJson = Column(Text)
    SubmittedAt = Column(DateTime, default=datetime.utcnow, nullable=False)
