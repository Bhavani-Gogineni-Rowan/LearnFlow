# Two-stage resource pipeline: AI emits search-query strings, this module resolves them into real URLs via Serper.dev.

from __future__ import annotations

import re
from threading import Lock
from typing import Optional
from urllib.parse import quote_plus

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore

from sqlalchemy.orm.attributes import flag_modified

from app.config import (
    SERPER_API_KEY,
    SERPER_ENDPOINT,
    SERPER_TIMEOUT_SECONDS,
)
from app.database import SessionLocal, StudyPlanRecord
from app.schemas import PlanDay, StudyPlanResponse


_URL_TOKENS = ("http://", "https://", "www.")


# True if the string already looks like a URL (so we shouldn't try to resolve it).
def _is_url_string(s: str) -> bool:
    if not isinstance(s, str):
        return False
    low = s.strip().lower()
    return any(tok in low for tok in _URL_TOKENS)


# Always-valid Google search URL used as the last-resort fallback.
def google_fallback_url(query: str) -> str:
    q = (query or "").strip() or "study guide tutorial"
    return f"https://www.google.com/search?q={quote_plus(q)}"


# Pull the first http(s) URL out of an arbitrary text blob (or None).
def extract_first_http_url(text: str) -> Optional[str]:
    if not text:
        return None
    s = text.strip()
    if s.startswith(("http://", "https://")):
        return s
    match = re.search(r"(https?://[^\s\)>\",']+)", s)
    if not match:
        return None
    return match.group(1).rstrip(".,;")


_QUERY_URL_CACHE: dict[str, str] = {}
_QUERY_URL_LOCK = Lock()


# POST a query to Serper.dev and return the first organic result link, or None.
def _serper_first_url(query: str) -> Optional[str]:
    if requests is None or not SERPER_API_KEY:
        return None
    response = requests.post(
        SERPER_ENDPOINT,
        headers={
            "X-API-KEY": SERPER_API_KEY,
            "Content-Type": "application/json",
        },
        json={"q": query, "num": 5},
        timeout=SERPER_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json() or {}
    for item in data.get("organic", []) or []:
        link = (item.get("link") or "").strip()
        if link.startswith(("http://", "https://")):
            return link
    return None


# Resolve one search query to a real URL, using cache → Serper → Google fallback.
def resolve_query_to_url(query: str) -> str:
    q = (query or "").strip()
    if not q:
        return ""
    if _is_url_string(q):
        return q

    with _QUERY_URL_LOCK:
        cached = _QUERY_URL_CACHE.get(q)
    if cached is not None:
        return cached

    url: Optional[str] = None
    if SERPER_API_KEY:
        try:
            url = _serper_first_url(q)
        except Exception as exc:
            print(f"[serper] query={q!r} failed: {exc}; falling back to Google URL")
            url = None

    if not url:
        url = google_fallback_url(q)

    with _QUERY_URL_LOCK:
        _QUERY_URL_CACHE[q] = url
    return url


# Synthesise descriptive search queries from raw topic names (used as a last resort).
def _queries_from_topics(topics: list[str], limit: int = 4) -> list[str]:
    cleaned = [str(t).strip() for t in (topics or []) if str(t).strip()]
    if not cleaned:
        return ["study guide tutorial"]
    out: list[str] = []
    suffixes = ["tutorial", "explained", "documentation", "Wikipedia"]
    for i, t in enumerate(cleaned[:limit]):
        out.append(f"{t} — {suffixes[i % len(suffixes)]}")
    return out


# Lazy resolver for one day; returns (urls, cached) and persists newly resolved URLs.
def resolve_day_resources(plan_id: str, day: int) -> tuple[list[str], bool]:
    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            return ([], False)

        plan_json = dict(row.plan_json or {})
        plan_days = list(plan_json.get("plan", []))
        idx = next((i for i, d in enumerate(plan_days) if d.get("day") == day), -1)
        if idx < 0:
            return ([], False)

        day_obj = plan_days[idx]
        existing = list(day_obj.get("resources") or [])
        topics = list(day_obj.get("topics") or [])

    # Already resolved → nothing to do.
    if existing and all(_is_url_string(s) for s in existing):
        return (existing, True)

    queries = [s for s in existing if isinstance(s, str) and s.strip()]
    if not queries:
        queries = _queries_from_topics(topics)
    queries = queries[:4]

    urls = [resolve_query_to_url(q) for q in queries]
    urls = [u for u in urls if u]

    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is not None:
            plan_json = dict(row.plan_json or {})
            plan_days = list(plan_json.get("plan", []))
            for i, d in enumerate(plan_days):
                if d.get("day") == day:
                    plan_days[i] = {**d, "resources": urls}
                    break
            plan_json["plan"] = plan_days
            row.plan_json = plan_json
            flag_modified(row, "plan_json")
            session.commit()

    return (urls, False)


# Background task: resolve every day's queries to URLs and persist after each day.
def resolve_plan_resources_background(plan_id: str) -> None:
    with SessionLocal() as session:
        row = session.get(StudyPlanRecord, plan_id)
        if row is None:
            return
        plan_json = dict(row.plan_json or {})
        plan_days = list(plan_json.get("plan", []))

    if not plan_days:
        return

    print(f"[bg-resolve] starting plan={plan_id[:8]} days={len(plan_days)}")

    for i, day_obj in enumerate(plan_days):
        existing = list(day_obj.get("resources") or [])
        topics = list(day_obj.get("topics") or [])

        if existing and all(_is_url_string(s) for s in existing):
            continue

        queries = [s for s in existing if isinstance(s, str) and s.strip()]
        if not queries:
            queries = _queries_from_topics(topics)
        queries = queries[:4]

        urls = [resolve_query_to_url(q) for q in queries]
        urls = [u for u in urls if u]
        plan_days[i] = {**day_obj, "resources": urls}

        # Persist incrementally so partial progress is visible if the task is interrupted.
        with SessionLocal() as session:
            row = session.get(StudyPlanRecord, plan_id)
            if row is None:
                return
            plan_json = dict(row.plan_json or {})
            plan_json["plan"] = plan_days
            row.plan_json = plan_json
            flag_modified(row, "plan_json")
            session.commit()

    print(f"[bg-resolve] finished plan={plan_id[:8]}")


# Legacy entry point: resolve queries derived from topics into URLs.
def fetch_resources_for_topics(topics: list[str], max_results: int = 4) -> list[str]:
    queries = _queries_from_topics(topics, limit=max_results)
    out: list[str] = []
    for q in queries:
        url = resolve_query_to_url(q)
        if url:
            out.append(url)
    return out


# Synchronous full-plan resolution used by the legacy non-streaming path.
def enrich_plan_resources(plan: StudyPlanResponse) -> StudyPlanResponse:
    enriched_days: list[PlanDay] = []
    for day_plan in plan.plan:
        existing = list(day_plan.resources or [])
        queries = [s for s in existing if not _is_url_string(s) and s.strip()]
        if not queries:
            queries = _queries_from_topics(day_plan.topics)
        urls = [resolve_query_to_url(q) for q in queries[:4]]
        urls = [u for u in urls if u]
        enriched_days.append(
            PlanDay(
                day=day_plan.day,
                topics=day_plan.topics,
                resources=urls,
                quiz=day_plan.quiz,
            )
        )
    return StudyPlanResponse(plan=enriched_days)