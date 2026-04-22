import json
from typing import Optional

import google.generativeai as genai
from fastapi import HTTPException
from pydantic import ValidationError

from app.config import (
    PLAN_CHUNK_DAYS,
    PLAN_MAX_SINGLE_CALL_DAYS,
    QUIZ_QUESTIONS_PER_DAY,
    USE_INSTRUCTOR_GEMINI,
)
from app.schemas import DailyQuizPayload, PlanDay, StudyPlanResponse

try:
    import instructor
except Exception:
    instructor = None


# Trim very long syllabi so they fit inside Gemini's input window.
def _truncate_syllabus(text: str, limit: int = 16000) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n\n[... syllabus truncated ...]"


# Generation config tuned to keep one chunk's full JSON inside Gemini's token cap.
def _gemini_plan_generation_config() -> dict:
    return {
        "response_mime_type": "application/json",
        "max_output_tokens": 8192,
    }


# Build the single-call plan prompt (used when total days fits in one Gemini response).
def build_prompt(syllabus_text: str, retrieved_context: str, days: int, hours: int) -> str:
    output_schema = json.dumps(StudyPlanResponse.model_json_schema(), indent=2)
    return f"""
Create a study-plan SKELETON using the provided syllabus context.
Constraint: {days} days total, {hours} hours per day.

CRITICAL — plan length:
- The JSON "plan" array MUST contain EXACTLY {days} objects — one object per calendar day, numbered day 1 through {days}.
- Do not stop early. If the response is too long, shorten wording per field, but still output all {days} days.

Retrieved syllabus context:
{retrieved_context or syllabus_text}

Output requirements:
- Return ONLY valid JSON. Do NOT wrap output in markdown code fences or add any text before/after the JSON.
- Must conform to this JSON schema:
{output_schema}
- For each day, output: "day" (int), "topics" (1-5 short strings), AND "resources" (see rules below).
- DO NOT output "quiz" — leave the field absent or as an empty array. Quizzes are generated on demand later.
- Keep responses compact so the full {days}-day plan fits in one response.

Resource rules (CRITICAL — anti-hallucination):
- For EVERY day include 2-4 strings in "resources".
- NEVER include any URL. Do NOT write http://, https://, www., or any web address. The application converts these to real links automatically.
- Write short DESCRIPTIVE SEARCH-QUERY strings tied to the day's topics. Examples:
    "Python list comprehensions — tutorial"
    "Binary search tree — Wikipedia"
    "Goroutines and channels — Go by Example"
    "REST API design best practices — guide"
- Each query should be 4-12 words, mention at least one of the day's topics, and end with a hint such as "tutorial", "documentation", "Wikipedia", "guide", "explained", or "video".
- Never use an empty "resources" array. Never repeat the same query within a day.
"""


# Build the prompt for one segment of a long roadmap, used by the chunked path.
def build_chunk_prompt(
    syllabus_text: str,
    retrieved_context: str,
    total_days: int,
    hours: int,
    start_day: int,
    end_day: int,
    prior_context: str,
) -> str:
    output_schema = json.dumps(StudyPlanResponse.model_json_schema(), indent=2)
    chunk_len = end_day - start_day + 1
    ctx = _truncate_syllabus(retrieved_context or syllabus_text, 14000)
    return f"""
You are building ONE SEGMENT of a longer study-roadmap SKELETON (multi-part generation).

Overall roadmap: {total_days} days total, {hours} hours per day.
THIS SEGMENT ONLY: output EXACTLY {chunk_len} days — calendar day numbers {start_day} through {end_day} inclusive.
The JSON "plan" array MUST contain exactly {chunk_len} objects, in order.
Set "day": {start_day} on the first object, then {start_day + 1}, ... up to {end_day} on the last.

Syllabus / context:
{ctx}

Continuation context (build on these previously covered topics — do NOT repeat them):
{prior_context or "(First segment — start from fundamentals appropriate to the syllabus.)"}

Output requirements:
- Return ONLY valid JSON. Do NOT wrap output in markdown code fences or add any text before/after the JSON.
- Must conform to this JSON schema:
{output_schema}
- For each day, output: "day" (int), "topics" (1-5 short strings), AND "resources" (see rules below).
- DO NOT output "quiz" — leave the field absent or as an empty array. Quizzes are generated on demand later.
- Keep responses compact so the full segment fits in one response.

Resource rules (CRITICAL — anti-hallucination):
- For EVERY day include 2-4 strings in "resources".
- NEVER include any URL. Do NOT write http://, https://, www., or any web address. The application converts these to real links automatically.
- Write short DESCRIPTIVE SEARCH-QUERY strings tied to the day's topics. Examples:
    "Python list comprehensions — tutorial"
    "Binary search tree — Wikipedia"
    "Goroutines and channels — Go by Example"
    "REST API design best practices — guide"
- Each query should be 4-12 words, mention at least one of the day's topics, and end with a hint such as "tutorial", "documentation", "Wikipedia", "guide", "explained", or "video".
- Never use an empty "resources" array. Never repeat the same query within a day.
"""


# Optional schema-constrained path via Instructor; returns None to fall back to plain JSON.
def try_generate_with_instructor(model: genai.GenerativeModel, prompt: str) -> Optional[StudyPlanResponse]:
    if not USE_INSTRUCTOR_GEMINI or instructor is None:
        return None

    try:
        if not hasattr(instructor, "from_gemini"):
            return None

        client = instructor.from_gemini(client=model)
        result = client.messages.create(
            messages=[{"role": "user", "content": prompt}],
            response_model=StudyPlanResponse,
            max_retries=2,
        )
        return result
    except Exception:
        return None


# Build the prompt for generating a single day's 10 MCQ quiz.
def build_daily_quiz_prompt(
    topics: list[str],
    syllabus_text: str,
    day_number: int,
    *,
    retrieved_context: str = "",
) -> str:
    topics_json = json.dumps(topics, indent=2)
    schema = json.dumps(DailyQuizPayload.model_json_schema(), indent=2)

    # Prefer retrieved chunks; otherwise fall back to a short slice of the raw syllabus.
    context_block = (
        retrieved_context.strip()
        if retrieved_context.strip()
        else syllabus_text[:8000] + ("\n\n[truncated]" if len(syllabus_text) > 8000 else "")
    )

    return f"""
You write study quizzes for a single day of a learning plan.

Day number: {day_number}
Topics for this day (you MUST cover every one across the quiz):
{topics_json}

Relevant study material:
{context_block}

Requirements:
- Return ONLY valid JSON. Do NOT wrap output in markdown code fences or add any text before/after the JSON.
- Must conform to this JSON schema:
{schema}
- Include EXACTLY {QUIZ_QUESTIONS_PER_DAY} questions in "quiz".
- Every topic listed above must be tested by at least one question.
- Each item must include "topic_covered" set to exactly one string from the topics list for this day.
- "options" must be a JSON array of 3–4 plain strings. "answer" must exactly equal one of those strings.
- Vary difficulty: approximately the first question easy (recall), middle questions applied (comprehension),
  last question harder (analysis or edge-case). Do not make all questions the same difficulty.
"""


# Optional Instructor path for the daily quiz; mirrors try_generate_with_instructor.
def try_generate_daily_quiz_with_instructor(model: genai.GenerativeModel, prompt: str) -> Optional[DailyQuizPayload]:
    if not USE_INSTRUCTOR_GEMINI or instructor is None:
        return None
    try:
        if not hasattr(instructor, "from_gemini"):
            return None
        client = instructor.from_gemini(client=model)
        return client.messages.create(
            messages=[{"role": "user", "content": prompt}],
            response_model=DailyQuizPayload,
            max_retries=2,
        )
    except Exception:
        return None


# Call Gemini for a daily quiz, validate against the schema, retry once on rate-limit.
def generate_and_validate_daily_quiz(model: genai.GenerativeModel, prompt: str) -> DailyQuizPayload:
    instructor_result = try_generate_daily_quiz_with_instructor(model, prompt)
    if instructor_result is not None:
        return instructor_result

    last_error = "Unknown error"
    for attempt in range(2):
        try:
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            raw_text = (response.text or "").strip()
            parsed = json.loads(raw_text)
            return DailyQuizPayload.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = str(exc)
            prompt = f"""{prompt}

Your previous response was invalid JSON or failed validation.
Reply again with ONLY valid JSON for DailyQuizPayload with exactly {QUIZ_QUESTIONS_PER_DAY} quiz items.
"""
        except Exception as exc:
            msg = str(exc)
            # On Gemini's free-tier 429, honour the server's retry-delay hint and try once more.
            if attempt == 0 and ("429" in msg or "quota" in msg.lower()):
                import re as _re, time as _time

                m = _re.search(r"retry.*?(\d+(?:\.\d+)?)\s*s", msg, _re.IGNORECASE)
                delay = min((float(m.group(1)) if m else 15.0) + 1.0, 60.0)
                _time.sleep(delay)
                last_error = msg
                continue
            raise HTTPException(status_code=502, detail=f"AI quiz generation failed: {exc}") from exc

    raise HTTPException(
        status_code=502,
        detail=f"Could not generate a valid daily quiz after retries: {last_error}",
    )


_URL_TOKENS = ("http://", "https://", "www.")


# Cheap heuristic for "this string looks like a URL".
def _looks_like_url(s: str) -> bool:
    if not isinstance(s, str):
        return False
    low = s.strip().lower()
    return any(tok in low for tok in _URL_TOKENS)


# Strip any URL strings the model may have smuggled into resources; returns count removed.
def _strip_url_resources(plan: StudyPlanResponse) -> int:
    removed = 0
    for day in plan.plan:
        clean = [r for r in (day.resources or []) if not _looks_like_url(r)]
        if len(clean) != len(day.resources or []):
            removed += len(day.resources) - len(clean)
        day.resources = clean
    return removed


# Call Gemini for a plan, validate it conforms to the schema, retry on JSON/quota errors.
def generate_and_validate_plan(
    model: genai.GenerativeModel,
    prompt: str,
    *,
    expected_plan_days: int | None = None,
    skip_instructor: bool = False,
) -> StudyPlanResponse:
    if not skip_instructor:
        instructor_result = try_generate_with_instructor(model, prompt)
        if instructor_result is not None:
            if expected_plan_days is None or len(instructor_result.plan) == expected_plan_days:
                return instructor_result

    last_error = "Unknown error"
    gen_cfg = _gemini_plan_generation_config()
    max_attempts = 4 if expected_plan_days is not None else 2
    for attempt in range(max_attempts):
        try:
            response = model.generate_content(
                prompt,
                generation_config=gen_cfg,
            )
            raw_text = (response.text or "").strip()
            parsed = json.loads(raw_text)
            result = StudyPlanResponse.model_validate(parsed)
            if expected_plan_days is not None and len(result.plan) != expected_plan_days:
                last_error = (
                    f'Expected exactly {expected_plan_days} entries in "plan", got {len(result.plan)}'
                )
                prompt = f"""{prompt}

CRITICAL: Your previous JSON had {len(result.plan)} items in "plan" but this request requires EXACTLY {expected_plan_days} day objects.
Output exactly {expected_plan_days} days. Do not omit days.
"""
                continue
            removed = _strip_url_resources(result)
            if removed:
                print(f"[plan-validate] stripped {removed} URL strings the AI smuggled into 'resources'")
            return result
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = str(exc)
            prompt = f"""{prompt}

Your previous response was invalid JSON or had schema issues.
Reply again using only valid JSON and ensure all required fields are present.
Error: {last_error}
"""
        except Exception as exc:
            msg = str(exc)
            # On Gemini's free-tier 429, sleep the suggested delay and retry once more.
            if "429" in msg or "quota" in msg.lower():
                import re as _re, time as _time

                m = _re.search(r"retry.*?(\d+(?:\.\d+)?)\s*s", msg, _re.IGNORECASE)
                delay = float(m.group(1)) if m else 15.0
                delay = min(delay + 1.0, 30.0)
                _time.sleep(delay)
                last_error = msg
                continue
            raise HTTPException(status_code=502, detail=f"AI generation failed: {exc}") from exc

    raise HTTPException(
        status_code=502,
        detail=f"Could not generate a valid study plan after retries: {last_error}",
    )


# Yield (start_day, list[PlanDay]) per chunk so callers can stream progress to the client.
def iter_plan_chunks(
    model: genai.GenerativeModel,
    syllabus_text: str,
    retrieved_context: str,
    total_days: int,
    hours: int,
):
    prior = ""
    for start in range(1, total_days + 1, PLAN_CHUNK_DAYS):
        end = min(start + PLAN_CHUNK_DAYS - 1, total_days)
        prompt = build_chunk_prompt(
            syllabus_text,
            retrieved_context,
            total_days,
            hours,
            start,
            end,
            prior,
        )
        chunk = generate_and_validate_plan(
            model,
            prompt,
            expected_plan_days=end - start + 1,
            skip_instructor=True,
        )
        renumbered: list[PlanDay] = []
        for i, day in enumerate(chunk.plan):
            dump = day.model_dump()
            dump["day"] = start + i
            renumbered.append(PlanDay(**dump))

        # Carry forward recent topics so the next chunk avoids repetition.
        tail = chunk.plan[-3:] if len(chunk.plan) >= 3 else chunk.plan
        bits: list[str] = []
        for d in tail:
            bits.extend(d.topics[:7])
        prior = "Previously covered topics (do NOT repeat these — continue beyond them): " + "; ".join(bits[:20])

        yield start, renumbered


# Non-streaming wrapper that collects every chunk into one StudyPlanResponse.
def generate_plan_in_chunks(
    model: genai.GenerativeModel,
    syllabus_text: str,
    retrieved_context: str,
    total_days: int,
    hours: int,
) -> StudyPlanResponse:
    merged: list[PlanDay] = []
    for _start, chunk_days in iter_plan_chunks(
        model, syllabus_text, retrieved_context, total_days, hours
    ):
        merged.extend(chunk_days)

    if len(merged) != total_days:
        raise HTTPException(
            status_code=502,
            detail=f"Plan merge error: expected {total_days} days, assembled {len(merged)}",
        )
    return StudyPlanResponse(plan=merged)