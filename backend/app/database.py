import os
import sys
from datetime import datetime
from glob import glob

from app.config import DATABASE_URL

try:
    from sqlalchemy import Boolean, DateTime, Integer, JSON, String, create_engine, inspect, text
    from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
except ModuleNotFoundError:
    venv_candidates = glob(
        os.path.join(os.path.dirname(os.path.dirname(__file__)), ".venv", "lib", "python*", "site-packages")
    )
    if venv_candidates:
        sys.path.insert(0, venv_candidates[0])
        from sqlalchemy import Boolean, DateTime, Integer, JSON, String, create_engine, inspect, text
        from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
    else:
        raise


class Base(DeclarativeBase):
    pass


class StudyPlanRecord(Base):
    __tablename__ = "study_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    days: Mapped[int] = mapped_column(Integer)
    hours: Mapped[int] = mapped_column(Integer)
    syllabus_text: Mapped[str] = mapped_column(String)
    plan_json: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # User-supplied label; required for PDF uploads, optional otherwise.
    plan_name: Mapped[str | None] = mapped_column(String(200), nullable=True, default=None)


class ProgressRecord(Base):
    __tablename__ = "progress_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plan_id: Mapped[str] = mapped_column(String(36), index=True)
    day: Mapped[int] = mapped_column(Integer, index=True)
    completed_topics: Mapped[list[str]] = mapped_column(JSON)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class QuizScoreRecord(Base):
    __tablename__ = "quiz_scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plan_id: Mapped[str] = mapped_column(String(36), index=True)
    day: Mapped[int] = mapped_column(Integer, index=True)
    score: Mapped[int] = mapped_column(Integer)
    total_questions: Mapped[int] = mapped_column(Integer)
    weak_topics: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
Base.metadata.create_all(engine)


# Lightweight idempotent SQLite migration: add new columns on existing DBs without recreating them.
def _ensure_columns_exist() -> None:
    insp = inspect(engine)
    if "study_plans" not in insp.get_table_names():
        return
    existing = {col["name"] for col in insp.get_columns("study_plans")}
    if "plan_name" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE study_plans ADD COLUMN plan_name VARCHAR(200)"))


_ensure_columns_exist()

__all__ = [
    "Base",
    "StudyPlanRecord",
    "ProgressRecord",
    "QuizScoreRecord",
    "engine",
    "SessionLocal",
]

