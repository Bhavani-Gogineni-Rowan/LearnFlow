# LearnFlow

> Turn any syllabus or PDF into a streaming, schema-validated, day-by-day study plan, with on-demand quizzes, real (non-hallucinated) resource links, progress tracking, and milestones.

LearnFlow is a full-stack applied-LLM application built on **FastAPI + React + Google Gemini**, designed to run end-to-end on completely free API tiers. It pairs a chunked, schema-grounded plan generator with a two-stage anti-hallucination pipeline that resolves real URLs via Serper.dev, so the AI never invents a link.

---

## Quickstart

### 1. Clone and install

```bash
git clone https://github.com/<your-handle>/LearnFlow.git
cd LearnFlow

# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

Create a `.env` in the repo root (or `backend/`):

```bash
GEMINI_API_KEY=your_gemini_key_here
SERPER_API_KEY=your_serper_key_here          # optional; falls back to Google search URLs
```

Get API keys from:

- **Gemini** → [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free tier)
- **Serper** → [serper.dev](https://serper.dev) (free 2,500 queries/month)

### 3. Run

```bash
# Terminal 1 — backend
cd backend
python3 main.py                    # http://localhost:8000  (docs at /docs)

# Terminal 2 — frontend
cd frontend
npm run dev                        # http://localhost:5173
```

### 4. Try it

Open [http://localhost:5173](http://localhost:5173), pick any *User ID*, set **Days = 3**, **Hours/Day = 1**, paste a syllabus (e.g., `Python basics: variables, functions, loops`), and click **Generate Study Plan**. Watch the Track tab populate progressively.

