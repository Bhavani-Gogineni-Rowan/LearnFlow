from typing import Optional

from pydantic import BaseModel, Field

from app.config import QUIZ_QUESTIONS_PER_DAY


class QuizItem(BaseModel):
    question: str
    options: list[str] = Field(min_length=2)
    answer: str
    explanation: str
    topic_covered: Optional[str] = None


class PlanDay(BaseModel):
    day: int = Field(ge=1)
    topics: list[str] = Field(min_length=1)
    # Holds AI search-query strings before resolution, real URLs after.
    resources: list[str] = Field(default_factory=list, max_length=8)
    quiz: list[QuizItem] = Field(default_factory=list)


# Exactly ten quiz questions for one study day.
class DailyQuizPayload(BaseModel):
    quiz: list[QuizItem] = Field(min_length=QUIZ_QUESTIONS_PER_DAY, max_length=QUIZ_QUESTIONS_PER_DAY)


class StudyPlanResponse(BaseModel):
    plan: list[PlanDay] = Field(min_length=1)


class GeneratePlanResponse(BaseModel):
    plan_id: str
    user_id: str
    plan: list[PlanDay]


class ProgressUpsertRequest(BaseModel):
    plan_id: str
    day: int = Field(ge=1)
    completed_topics: list[str] = Field(default_factory=list)
    is_completed: bool = False


class QuizScoreCreateRequest(BaseModel):
    plan_id: str
    day: int = Field(ge=1)
    score: int = Field(ge=0)
    total_questions: int = Field(ge=1)
    weak_topics: list[str] = Field(default_factory=list)


class PlanStatsResponse(BaseModel):
    plan_id: str
    total_days: int
    completed_days: int
    completion_percent: int
    current_streak: int
    longest_streak: int
    unlocked_badges: list[str]


