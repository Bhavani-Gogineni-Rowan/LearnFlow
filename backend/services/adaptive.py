import uuid

from app.database import ProgressRecord, SessionLocal, StudyPlanRecord
from app.schemas import StudyPlanResponse


# Persist a generated plan and return its id.
def save_plan_to_db(
    user_id: str,
    days: int,
    hours: int,
    syllabus_text: str,
    plan: StudyPlanResponse,
    *,
    plan_id: str | None = None,
    plan_name: str | None = None,
) -> str:
    pid = plan_id or str(uuid.uuid4())
    row = StudyPlanRecord(
        id=pid,
        user_id=user_id,
        days=days,
        hours=hours,
        syllabus_text=syllabus_text,
        plan_json=plan.model_dump(),
        plan_name=(plan_name or "").strip() or None,
    )
    with SessionLocal() as session:
        session.add(row)
        session.commit()
    return pid


# Compute (current_streak, longest_streak) of consecutive completed days.
def compute_streak_metrics(progress_rows: list[ProgressRecord]) -> tuple[int, int]:
    completed_days = sorted({row.day for row in progress_rows if row.is_completed})
    if not completed_days:
        return 0, 0

    longest = 1
    run = 1
    for idx in range(1, len(completed_days)):
        if completed_days[idx] == completed_days[idx - 1] + 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    # Current streak: consecutive completions ending at the most recently completed day.
    current = 1
    for idx in range(len(completed_days) - 1, 0, -1):
        if completed_days[idx] == completed_days[idx - 1] + 1:
            current += 1
        else:
            break

    return current, longest


# Return the list of milestone badges unlocked by the supplied streak / completion / quiz average.
def get_unlocked_badges(current_streak: int, completion_percent: int, average_quiz_score: float) -> list[str]:
    badges: list[str] = []
    if current_streak >= 3:
        badges.append("Consistency Spark (3-day streak)")
    if current_streak >= 7:
        badges.append("Discipline Wave (7-day streak)")
    if completion_percent >= 100:
        badges.append("Roadmap Finisher (100% complete)")
    if average_quiz_score >= 0.8:
        badges.append("Quiz Ace (80%+ average)")
    return badges
