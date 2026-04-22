import os

from dotenv import load_dotenv

load_dotenv()

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(_BACKEND_DIR, 'learnflow.db')}",
)


