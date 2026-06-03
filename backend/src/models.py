from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String, Text
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
