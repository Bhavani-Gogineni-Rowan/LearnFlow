import os

from dotenv import load_dotenv

load_dotenv()

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

QUIZ_QUESTIONS_PER_DAY = 10
# Plans longer than this are generated in chunks to fit Gemini's output token cap.
PLAN_MAX_SINGLE_CALL_DAYS = 10
# Days per chunk; sized so even long plans stay under the free-tier RPM limit.
PLAN_CHUNK_DAYS = 30
MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024
MODEL_NAME = "gemini-3-flash-preview"
CHROMA_PERSIST_PATH = os.path.join(_BACKEND_DIR, ".chroma")
MAX_CHUNKS_IN_PROMPT = 12
ENABLE_WEB_ENRICHMENT = os.getenv("ENABLE_WEB_ENRICHMENT", "true").lower() == "true"
# Serper.dev resolves search-query strings into real URLs; without a key we fall back to Google search URLs.
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "").strip()
SERPER_ENDPOINT = "https://google.serper.dev/search"
SERPER_TIMEOUT_SECONDS = float(os.getenv("SERPER_TIMEOUT_SECONDS", "8"))
# Instructor's from_gemini() is deprecated and can hang; off by default.
USE_INSTRUCTOR_GEMINI = os.getenv("USE_INSTRUCTOR_GEMINI", "false").lower() == "true"
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(_BACKEND_DIR, 'learnflow.db')}",
)


