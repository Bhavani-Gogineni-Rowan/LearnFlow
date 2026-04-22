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