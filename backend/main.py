import json
import os
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Optional

import google.generativeai as genai
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from starlette.background import BackgroundTask

from app.config import MAX_PDF_SIZE_BYTES, MODEL_NAME, PLAN_MAX_SINGLE_CALL_DAYS, QUIZ_QUESTIONS_PER_DAY
from app.database import ProgressRecord, QuizScoreRecord, SessionLocal, StudyPlanRecord
from app.schemas import (
    GeneratePlanResponse,
    PlanStatsResponse,
    ProgressUpsertRequest,
    QuizScoreCreateRequest,
    StudyPlanResponse,
)
from services.adaptive import (
    compute_streak_metrics,
    get_unlocked_badges,
    save_plan_to_db,
)
from services.generation import (
    build_daily_quiz_prompt,
    build_prompt,
    generate_and_validate_daily_quiz,
    generate_and_validate_plan,
    generate_plan_in_chunks,
    iter_plan_chunks,
)
from services.pdf import extract_syllabus_text_from_pdf
from services.rag import build_vector_store_and_retrieve_context
from services.resources import resolve_day_resources, resolve_plan_resources_background

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Build a study plan from text/PDF and persist it; URL resolution runs in the background.
@app.post("/generate-plan/")
async def generate_plan(
    background_tasks: BackgroundTasks,
    days: int = Form(...),
    hours: int = Form(...),
    user_id: str = Form("demo-user"),
    text_input: Optional[str] = Form(None),
    plan_name: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    if days <= 0 or hours <= 0:
        raise HTTPException(status_code=400, detail="Days and hours must be greater than 0.")

    syllabus_text = (text_input or "").strip()
    cleaned_plan_name = (plan_name or "").strip()

    if file:
        if file.content_type not in {"application/pdf", "application/octet-stream"}:
            raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        if not cleaned_plan_name:
            raise HTTPException(
                status_code=400,
                detail="Plan Name is required when uploading a syllabus PDF.",
            )
        content = await file.read()
        if len(content) > MAX_PDF_SIZE_BYTES:
            raise HTTPException(status_code=400, detail="PDF exceeds 10MB size limit.")
        syllabus_text = f"{syllabus_text}\n{extract_syllabus_text_from_pdf(content)}".strip()

    if not syllabus_text:
        raise HTTPException(
            status_code=400,
            detail="Provide syllabus text or upload a PDF with readable content.",
        )

    retrieval_query = (
        f"Most important concepts, prerequisites, and progression needed to build a "
        f"{days}-day study plan with {hours} hours per day."
    )
    try:
        retrieved_context = build_vector_store_and_retrieve_context(
            syllabus_text=syllabus_text,
            query=retrieval_query,
        )
    except Exception:
        retrieved_context = syllabus_text

    model = genai.GenerativeModel(MODEL_NAME)
    if days > PLAN_MAX_SINGLE_CALL_DAYS:
        validated_plan = generate_plan_in_chunks(
            model, syllabus_text, retrieved_context, days, hours
        )
    else:
        prompt = build_prompt(syllabus_text, retrieved_context, days, hours)
        validated_plan = generate_and_validate_plan(
            model, prompt, expected_plan_days=days, skip_instructor=False
        )
    try:
        plan_id = save_plan_to_db(
            user_id=user_id.strip() or "demo-user",
            days=days,
            hours=hours,
            syllabus_text=syllabus_text,
            plan=validated_plan,
            plan_name=cleaned_plan_name or None,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to persist plan: {exc}") from exc

    background_tasks.add_task(resolve_plan_resources_background, plan_id)

    return GeneratePlanResponse(
        plan_id=plan_id,
        user_id=user_id.strip() or "demo-user",
        plan=validated_plan.plan,
    ).model_dump()


# Streaming variant: emits NDJSON events per chunk of days so the UI renders progressively.
@app.post("/generate-plan/stream")
async def generate_plan_stream(
    days: int = Form(...),
    hours: int = Form(...),
    user_id: str = Form("demo-user"),
    text_input: Optional[str] = Form(None),
    plan_name: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    if days <= 0 or hours <= 0:
        raise HTTPException(status_code=400, detail="Days and hours must be greater than 0.")

    syllabus_text = (text_input or "").strip()
    cleaned_plan_name = (plan_name or "").strip()
    if file:
        if file.content_type not in {"application/pdf", "application/octet-stream"}:
            raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        if not cleaned_plan_name:
            raise HTTPException(
                status_code=400,
                detail="Plan Name is required when uploading a syllabus PDF.",
            )
        content = await file.read()
        if len(content) > MAX_PDF_SIZE_BYTES:
            raise HTTPException(status_code=400, detail="PDF exceeds 10MB size limit.")
        syllabus_text = f"{syllabus_text}\n{extract_syllabus_text_from_pdf(content)}".strip()

    if not syllabus_text:
        raise HTTPException(
            status_code=400,
            detail="Provide syllabus text or upload a PDF with readable content.",
        )

    retrieval_query = (
        f"Most important concepts, prerequisites, and progression needed to build a "
        f"{days}-day study plan with {hours} hours per day."
    )
    try:
        retrieved_context = build_vector_store_and_retrieve_context(
            syllabus_text=syllabus_text,
            query=retrieval_query,
        )
    except Exception:
        retrieved_context = syllabus_text

    plan_id = str(uuid.uuid4())
    uid = user_id.strip() or "demo-user"
    model = genai.GenerativeModel(MODEL_NAME)

    # Encode one NDJSON event line.
    def event(obj: dict) -> bytes:
        return (json.dumps(obj) + "\n").encode("utf-8")

    # Generator that yields init/chunk/done/error events as the plan is built.
    def gen():
        merged: list = []
        try:
            yield event({"type": "init", "plan_id": plan_id, "user_id": uid, "days": days, "hours": hours})

            if days > PLAN_MAX_SINGLE_CALL_DAYS:
                for _start, chunk_days in iter_plan_chunks(
                    model, syllabus_text, retrieved_context, days, hours
                ):
                    merged.extend(chunk_days)
                    yield event({"type": "chunk", "days": [d.model_dump() for d in chunk_days]})
            else:
                prompt = build_prompt(syllabus_text, retrieved_context, days, hours)
                validated = generate_and_validate_plan(
                    model, prompt, expected_plan_days=days, skip_instructor=False
                )
                merged.extend(validated.plan)
                yield event({"type": "chunk", "days": [d.model_dump() for d in validated.plan]})

            if len(merged) != days:
                yield event(
                    {"type": "error", "detail": f"Expected {days} days, assembled {len(merged)}."}
                )
                return

            try:
                save_plan_to_db(
                    user_id=uid,
                    days=days,
                    hours=hours,
                    syllabus_text=syllabus_text,
                    plan=StudyPlanResponse(plan=merged),
                    plan_id=plan_id,
                    plan_name=cleaned_plan_name or None,
                )
            except Exception as exc:
                yield event({"type": "error", "detail": f"Failed to persist plan: {exc}"})
                return

            yield event({"type": "done", "plan_id": plan_id})
        except HTTPException as http_exc:
            yield event({"type": "error", "detail": http_exc.detail})
        except Exception as exc:
            yield event({"type": "error", "detail": f"Generation failed: {exc}"})

    # Background URL resolution runs after the streaming body finishes.
    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        background=BackgroundTask(resolve_plan_resources_background, plan_id),
    )


# Return a single saved plan by id.
@app.get("/plans/{plan_id}")
def get_plan(plan_id: str):
    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Plan not found.")
        return {
            "plan_id": row.id,
            "user_id": row.user_id,
            "days": row.days,
            "hours": row.hours,
            "plan": row.plan_json.get("plan", []),
            "created_at": row.created_at.isoformat() + "Z",
        }


# Hard-delete a plan plus its progress and quiz rows; only the owner may delete.
@app.delete("/plans/{plan_id}")
def delete_plan(plan_id: str, user_id: str):
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=400, detail="Query parameter user_id is required.")
    uid = str(user_id).strip()

    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Plan not found.")
        if row.user_id != uid:
            raise HTTPException(status_code=403, detail="This plan does not belong to this user.")

        prog_rows = session.execute(
            select(ProgressRecord).where(ProgressRecord.plan_id == plan_id)
        ).scalars().all()
        quiz_rows = session.execute(
            select(QuizScoreRecord).where(QuizScoreRecord.plan_id == plan_id)
        ).scalars().all()
        for p in prog_rows:
            session.delete(p)
        for q in quiz_rows:
            session.delete(q)
        session.delete(row)
        session.commit()

    return {
        "deleted": True,
        "plan_id": plan_id,
        "progress_rows_removed": len(prog_rows),
        "quiz_rows_removed": len(quiz_rows),
    }

# List all saved plans for a user (newest first) with completion + streak + badges.
@app.get("/users/{user_id}/plans")
def list_plans_for_user(user_id: str):
    uid = (user_id or "").strip() or "demo-user"
    with SessionLocal() as session:
        rows = session.execute(
            select(StudyPlanRecord)
            .where(StudyPlanRecord.user_id == uid)
            .order_by(StudyPlanRecord.created_at.desc())
        ).scalars().all()

        plan_ids = [row.id for row in rows]
        progress_by_plan: dict[str, list[ProgressRecord]] = defaultdict(list)
        quiz_by_plan: dict[str, list[QuizScoreRecord]] = defaultdict(list)
        if plan_ids:
            all_prog = session.execute(
                select(ProgressRecord).where(ProgressRecord.plan_id.in_(plan_ids))
            ).scalars().all()
            for p in all_prog:
                progress_by_plan[p.plan_id].append(p)
            all_quiz = session.execute(
                select(QuizScoreRecord)
                .where(QuizScoreRecord.plan_id.in_(plan_ids))
                .order_by(QuizScoreRecord.created_at.desc())
            ).scalars().all()
            for q in all_quiz:
                quiz_by_plan[q.plan_id].append(q)

        summaries: list[dict] = []
        for row in rows:
            plan_list = row.plan_json.get("plan", [])
            n_days = len(plan_list)
            prog = progress_by_plan.get(row.id, [])
            done = len([p for p in prog if p.is_completed])
            pct = int(round((done / n_days) * 100)) if n_days else 0

            current_streak, _ = compute_streak_metrics(prog)

            # Keep only the latest quiz per day so this matches the Track tab's Mastery Ring.
            quizzes = quiz_by_plan.get(row.id, [])
            latest_by_day: dict[int, QuizScoreRecord] = {}
            for q in quizzes:
                if q.day not in latest_by_day:
                    latest_by_day[q.day] = q
            quiz_ratios = [
                (q.score / q.total_questions)
                for q in latest_by_day.values()
                if q.total_questions and q.total_questions > 0
            ]
            avg_quiz_ratio = (sum(quiz_ratios) / len(quiz_ratios)) if quiz_ratios else 0.0
            avg_quiz_pct = int(round(avg_quiz_ratio * 100))

            unlocked_badges = get_unlocked_badges(
                current_streak, pct, avg_quiz_ratio
            )

            raw_syllabus = row.syllabus_text or ""
            preview = raw_syllabus[:140].replace("\n", " ").strip()
            if len(raw_syllabus) > 140:
                preview += "…"
            summaries.append(
                {
                    "plan_id": row.id,
                    "created_at": row.created_at.isoformat() + "Z",
                    "days": row.days,
                    "hours": row.hours,
                    "plan_name": row.plan_name,
                    "syllabus_preview": preview or "(no syllabus text)",
                    "completed_days_count": done,
                    "total_plan_days": n_days,
                    "completion_percent": pct,
                    "current_streak": current_streak,
                    "average_quiz_percent": avg_quiz_pct,
                    "unlocked_badges": unlocked_badges,
                }
            )
        return summaries


# Full plan + saved progress + latest quiz per day for the Track tab to rehydrate.
@app.get("/plans/{plan_id}/resume")
def resume_plan_state(plan_id: str, user_id: str):
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=400, detail="Query parameter user_id is required.")
    uid = str(user_id).strip()

    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Plan not found.")
        if row.user_id != uid:
            raise HTTPException(status_code=403, detail="This plan does not belong to this user.")

        prog_rows = session.execute(
            select(ProgressRecord).where(ProgressRecord.plan_id == plan_id)
        ).scalars().all()
        quiz_rows = session.execute(
            select(QuizScoreRecord)
            .where(QuizScoreRecord.plan_id == plan_id)
            .order_by(QuizScoreRecord.created_at.desc())
        ).scalars().all()

    progress_by_day: dict[str, dict] = {}
    for p in prog_rows:
        progress_by_day[str(p.day)] = {
            "completed_topics": list(p.completed_topics or []),
            "is_completed": bool(p.is_completed),
        }

    quiz_by_day: dict[str, dict] = {}
    for q in quiz_rows:
        key = str(q.day)
        if key in quiz_by_day:
            continue
        quiz_by_day[key] = {
            "score": q.score,
            "total_questions": q.total_questions,
            "weak_topics": list(q.weak_topics or []),
        }

    plan_list = row.plan_json.get("plan", [])

    return {
        "plan_id": row.id,
        "user_id": row.user_id,
        "days": row.days,
        "hours": row.hours,
        "plan": plan_list,
        "plan_name": row.plan_name,
        "progress_by_day": progress_by_day,
        "quiz_by_day": quiz_by_day,
        "syllabus_text": row.syllabus_text or "",
        "created_at": row.created_at.isoformat() + "Z",
    }


# Lazy URL resolver for one day; converts AI search-queries to real URLs on demand.
@app.get("/plans/{plan_id}/days/{day}/resources")
def get_day_resources(plan_id: str, day: int):
    if day < 1:
        raise HTTPException(status_code=400, detail="day must be >= 1.")

    # Verify plan + day exist before invoking the resolver.
    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Plan not found.")
        plan_days = list((row.plan_json or {}).get("plan", []))
        if not any(d.get("day") == day for d in plan_days):
            raise HTTPException(status_code=404, detail="Day not found in this plan.")

    urls, cached = resolve_day_resources(plan_id, day)
    return {"plan_id": plan_id, "day": day, "resources": urls, "cached": cached}


# Generate (or return cached) 10 MCQs for one plan day.
@app.post("/plans/{plan_id}/days/{day}/generate-quiz")
def generate_day_quiz(plan_id: str, day: int):
    if day < 1:
        raise HTTPException(status_code=400, detail="day must be >= 1.")

    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Plan not found.")

        plan_obj = dict(row.plan_json or {})
        plan_days = list(plan_obj.get("plan", []))
        day_idx = next((i for i, d in enumerate(plan_days) if d.get("day") == day), None)
        if day_idx is None:
            raise HTTPException(status_code=404, detail="Day not found in this plan.")

        day_entry = plan_days[day_idx]

        # Reuse a previously generated quiz if one is already stored.
        cached_quiz = day_entry.get("quiz")
        if isinstance(cached_quiz, list) and len(cached_quiz) >= QUIZ_QUESTIONS_PER_DAY:
            print(f"[quiz-cache] HIT plan={plan_id[:8]} day={day} (skipped Gemini)")
            return {"quiz": cached_quiz[:QUIZ_QUESTIONS_PER_DAY], "cached": True}
        print(f"[quiz-cache] MISS plan={plan_id[:8]} day={day} → calling Gemini")

        topics = day_entry.get("topics") or []
        if not topics:
            raise HTTPException(status_code=400, detail="This day has no topics to build a quiz from.")

        syllabus = row.syllabus_text or ""

    try:
        retrieved = build_vector_store_and_retrieve_context(
            syllabus_text=syllabus,
            query=f"Concepts for study day {day}: " + ", ".join(topics[:25]),
        )
    except Exception:
        retrieved = syllabus

    prompt = build_daily_quiz_prompt(
        topics=topics,
        syllabus_text=retrieved or syllabus,
        day_number=day,
    )
    model = genai.GenerativeModel(MODEL_NAME)
    payload = generate_and_validate_daily_quiz(model, prompt)
    quiz_list = [q.model_dump() if hasattr(q, "model_dump") else q for q in payload.quiz]

    # Cache the generated quiz inside the plan JSON so the next call hits the DB only.
    from sqlalchemy.orm.attributes import flag_modified

    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is not None:
            plan_obj = dict(row.plan_json or {})
            plan_days = list(plan_obj.get("plan", []))
            for i, d in enumerate(plan_days):
                if d.get("day") == day:
                    d["quiz"] = quiz_list
                    plan_days[i] = d
                    break
            plan_obj["plan"] = plan_days
            row.plan_json = plan_obj
            flag_modified(row, "plan_json")
            session.add(row)
            session.commit()
            print(f"[quiz-cache] saved {len(quiz_list)} MCQs for plan={plan_id[:8]} day={day}")

    return {"quiz": quiz_list, "cached": False}


# Insert or update a day's progress row (completed topics + done flag).
@app.post("/progress/")
def upsert_progress(payload: ProgressUpsertRequest):
    with SessionLocal() as session:
        stmt = select(ProgressRecord).where(
            ProgressRecord.plan_id == payload.plan_id,
            ProgressRecord.day == payload.day,
        )
        existing = session.execute(stmt).scalar_one_or_none()

        if existing is None:
            existing = ProgressRecord(
                id=str(uuid.uuid4()),
                plan_id=payload.plan_id,
                day=payload.day,
                completed_topics=payload.completed_topics,
                is_completed=payload.is_completed,
            )
            session.add(existing)
        else:
            existing.completed_topics = payload.completed_topics
            existing.is_completed = payload.is_completed
            existing.updated_at = datetime.utcnow()

        session.commit()
        return {
            "progress_id": existing.id,
            "plan_id": existing.plan_id,
            "day": existing.day,
            "completed_topics": existing.completed_topics,
            "is_completed": existing.is_completed,
            "updated_at": existing.updated_at.isoformat(),
        }


# Aggregated stats (completion %, streaks, badges) for a single plan.
@app.get("/plans/{plan_id}/stats")
def get_plan_stats(plan_id: str):
    with SessionLocal() as session:
        plan_row = session.get(StudyPlanRecord, plan_id)
        if plan_row is None:
            raise HTTPException(status_code=404, detail="Plan not found.")

        progress_rows = session.execute(
            select(ProgressRecord).where(ProgressRecord.plan_id == plan_id)
        ).scalars().all()
        quiz_rows = session.execute(
            select(QuizScoreRecord).where(QuizScoreRecord.plan_id == plan_id)
        ).scalars().all()

    total_days = len(plan_row.plan_json.get("plan", []))
    completed_days = len([row for row in progress_rows if row.is_completed])
    completion_percent = int(round((completed_days / total_days) * 100)) if total_days else 0

    current_streak, longest_streak = compute_streak_metrics(progress_rows)

    quiz_ratios = [
        (row.score / row.total_questions)
        for row in quiz_rows
        if row.total_questions and row.total_questions > 0
    ]
    average_quiz_score = (sum(quiz_ratios) / len(quiz_ratios)) if quiz_ratios else 0.0
    badges = get_unlocked_badges(current_streak, completion_percent, average_quiz_score)

    return PlanStatsResponse(
        plan_id=plan_id,
        total_days=total_days,
        completed_days=completed_days,
        completion_percent=completion_percent,
        current_streak=current_streak,
        longest_streak=longest_streak,
        unlocked_badges=badges,
    ).model_dump()


# Persist a single quiz attempt (score + weak topics) for one plan day.
@app.post("/quiz-score/")
def add_quiz_score(payload: QuizScoreCreateRequest):
    if payload.score > payload.total_questions:
        raise HTTPException(status_code=400, detail="Score cannot exceed total_questions.")

    row = QuizScoreRecord(
        id=str(uuid.uuid4()),
        plan_id=payload.plan_id,
        day=payload.day,
        score=payload.score,
        total_questions=payload.total_questions,
        weak_topics=payload.weak_topics,
    )
    with SessionLocal() as session:
        session.add(row)
        session.commit()
    return {
        "quiz_score_id": row.id,
        "plan_id": row.plan_id,
        "day": row.day,
        "score": row.score,
        "total_questions": row.total_questions,
        "weak_topics": row.weak_topics,
        "created_at": row.created_at.isoformat() + "Z",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)