import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import confetti from "canvas-confetti";
import { Compass, History, ListChecks, Sparkles, User } from "lucide-react";
import PlannerView from "./components/PlannerView";
import TrackView from "./components/TrackView";
import YourPlansView from "./components/YourPlansView";
import { QuizModal, normalizeAnswer, TOTAL as QUIZ_TOTAL } from "./components/QuizModal";
import "./App.css";

const api = axios.create({
  baseURL: "http://localhost:8000",
});

function App() {
  const [activeView, setActiveView] = useState("planner");
  const [days, setDays] = useState('');
  const [hours, setHours] = useState('');
  const [userId, setUserId] = useState("demo-user");
  const [textInput, setTextInput] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [planName, setPlanName] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [planId, setPlanId] = useState("");
  const [plan, setPlan] = useState([]);
  const [planHours, setPlanHours] = useState(null);
  const [targetDay, setTargetDay] = useState(1);
  const [stats, setStats] = useState(null);
  // Bumped to force-remount PlannerView so native inputs (like the file picker) reset.
  const [formResetKey, setFormResetKey] = useState(0);

  const [progressByDay, setProgressByDay] = useState({});
  const [quizByDay, setQuizByDay] = useState({});

  const [quizModalDay, setQuizModalDay] = useState(null);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizResult, setQuizResult] = useState(null);

  const [savedPlans, setSavedPlans] = useState([]);
  const [savedPlansLoading, setSavedPlansLoading] = useState(false);
  const planIdRef = useRef(planId);
  planIdRef.current = planId;

  // Coerce the raw /users/:id/plans payload into the shape the UI expects.
  const normalizeSavedPlans = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .filter((item) => item && typeof item === "object" && typeof item.plan_id === "string")
      .map((item) => ({
        ...item,
        plan_id: String(item.plan_id),
        completion_percent: Number(item.completion_percent ?? 0),
        completed_days_count: Number(item.completed_days_count ?? 0),
        total_plan_days: Number(item.total_plan_days ?? 0),
        average_quiz_percent: Number(item.average_quiz_percent ?? 0),
        current_streak: Number(item.current_streak ?? 0),
        unlocked_badges: Array.isArray(item.unlocked_badges) ? item.unlocked_badges : [],
        plan_name: item.plan_name ? String(item.plan_name) : "",
        syllabus_preview: String(item.syllabus_preview ?? ""),
        created_at: item.created_at || null,
      }));

  // Clear every Plan-tab form input and force the form component to remount.
  const resetPlanForm = useCallback(() => {
    setDays('');
    setHours('');
    setTextInput("");
    setPdfFile(null);
    setPlanName("");
    setFormResetKey((k) => k + 1);
  }, []);

  // Hydrate Track-tab state from a /resume payload; never touches the Plan form.
  const applyResumePayload = useCallback((data) => {
    setPlanId(data.plan_id);
    setPlan(data.plan || []);
    const hn = Number(data.hours);
    setPlanHours(Number.isFinite(hn) && hn >= 1 ? hn : null);

    const pb = {};
    Object.entries(data.progress_by_day || {}).forEach(([k, v]) => {
      pb[Number(k)] = {
        isCompleted: Boolean(v.is_completed),
        completedTopics: Array.isArray(v.completed_topics) ? v.completed_topics : [],
      };
    });
    setProgressByDay(pb);

    const qb = {};
    Object.entries(data.quiz_by_day || {}).forEach(([k, v]) => {
      const weak = v.weak_topics;
      qb[Number(k)] = {
        score: Number(v.score ?? 0),
        totalQuestions: Number(v.total_questions ?? QUIZ_TOTAL),
        weakTopics: Array.isArray(weak) ? weak.join(", ") : "",
      };
    });
    setQuizByDay(qb);
  }, []);

  // Refresh the saved-plans list for the current user id.
  const fetchSavedPlansForUser = useCallback(async () => {
    const uid = userId.trim() || "demo-user";
    setSavedPlansLoading(true);
    try {
      const { data } = await api.get(`/users/${encodeURIComponent(uid)}/plans`);
      setSavedPlans(normalizeSavedPlans(data));
    } catch {
      setSavedPlans([]);
    } finally {
      setSavedPlansLoading(false);
    }
  }, [userId]);

  // Debounced reload of saved plans whenever the user id changes.
  useEffect(() => {
    const t = setTimeout(() => {
      fetchSavedPlansForUser();
    }, 250);
    return () => clearTimeout(t);
  }, [fetchSavedPlansForUser]);

  // Auto-hydrate Track-tab from the current (or newest) saved plan whenever the saved list changes.
  useEffect(() => {
    if (!savedPlans.length) {
      setStats(null);
      setPlanId("");
      setPlan([]);
      setPlanHours(null);
      setProgressByDay({});
      setQuizByDay({});
      return undefined;
    }
    const ids = new Set(savedPlans.map((p) => p.plan_id));
    const current = planIdRef.current;
    const targetId = current && ids.has(current) ? current : savedPlans[0].plan_id;
    const uid = userId.trim() || "demo-user";
    const ac = new AbortController();
    Promise.allSettled([
      api.get(`/plans/${targetId}/resume`, { params: { user_id: uid }, signal: ac.signal }),
      api.get(`/plans/${targetId}/stats`, { signal: ac.signal }),
    ]).then(([resumeOutcome, statsOutcome]) => {
      if (resumeOutcome.status !== "fulfilled") {
        return;
      }
      applyResumePayload(resumeOutcome.value.data);
      if (statsOutcome.status === "fulfilled") {
        setStats(statsOutcome.value.data);
      } else {
        setStats(null);
      }
    });
    return () => ac.abort();
  }, [savedPlans, userId, applyResumePayload]);

  // Delete a plan server-side, then clear it from local state if it was active.
  const deletePlan = useCallback(
    async (pid) => {
      if (!pid) return;
      const uid = userId.trim() || "demo-user";
      setError("");
      setMessage("");
      try {
        await api.delete(`/plans/${pid}`, { params: { user_id: uid } });
        if (planIdRef.current === pid) {
          setPlanId("");
          setPlan([]);
          setProgressByDay({});
          setQuizByDay({});
          setStats(null);
          setTargetDay(1);
        }
        setSavedPlans((prev) => prev.filter((p) => p.plan_id !== pid));
        setMessage("Plan deleted.");
        await fetchSavedPlansForUser();
      } catch (requestError) {
        setError(
          requestError?.response?.data?.detail ||
            requestError?.message ||
            "Could not delete this plan."
        );
      }
    },
    [userId, fetchSavedPlansForUser]
  );

  // Reopen a saved plan: load its full state + stats and switch to the Track tab.
  const resumePlan = async (pid) => {
    setError("");
    setMessage("");
    const uid = userId.trim() || "demo-user";
    try {
      const [resumeOutcome, statsOutcome] = await Promise.allSettled([
        api.get(`/plans/${pid}/resume`, { params: { user_id: uid } }),
        api.get(`/plans/${pid}/stats`),
      ]);
      if (resumeOutcome.status !== "fulfilled") {
        throw resumeOutcome.reason;
      }
      const data = resumeOutcome.value.data;
      applyResumePayload(data);

      if (statsOutcome.status === "fulfilled") {
        setStats(statsOutcome.value.data);
      } else {
        setStats(null);
      }
      setTargetDay(1);
      setMessage("Welcome back! Your progress and quiz scores are restored.");
      setActiveView("track");
    } catch (requestError) {
      setError(
        requestError?.response?.data?.detail ||
          requestError?.message ||
          "Could not load this plan."
      );
    }
  };

  const completedDays = useMemo(
    () => Object.values(progressByDay).filter((item) => item?.isCompleted).length,
    [progressByDay]
  );

  const completionPct = plan.length ? Math.round((completedDays / plan.length) * 100) : 0;
  const averageQuizPct = useMemo(() => {
    const all = Object.entries(quizByDay).map(([dayKey, val]) => {
      const total = val.totalQuestions ?? QUIZ_TOTAL;
      if (!total) return 0;
      return Math.min(100, Math.round((Number(val.score || 0) / total) * 100));
    });
    if (!all.length) return 0;
    return Math.round(all.reduce((sum, n) => sum + n, 0) / all.length);
  }, [quizByDay]);

  // Submit the Plan form: stream the generated plan from the backend and persist it.
  const onGeneratePlan = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    const dayNum = typeof days === 'number' ? days : Number(days);
    const hourNum = typeof hours === 'number' ? hours : Number(hours);
    if (!Number.isFinite(dayNum) || dayNum < 1 || !Number.isFinite(hourNum) || hourNum < 1) {
      setError("Enter Days and Hours / Day (each must be at least 1).");
      return;
    }

    const trimmedPlanName = planName.trim();
    if (pdfFile && !trimmedPlanName) {
      setError("Plan Name is required when uploading a syllabus PDF.");
      return;
    }

    setIsGenerating(true);
    setPlan([]);
    setPlanId("");
    setProgressByDay({});
    setQuizByDay({});
    setStats(null);
    setTargetDay(1);
    setPlanHours(hourNum);
    setActiveView("track");

    try {
      const formData = new FormData();
      formData.append("days", String(dayNum));
      formData.append("hours", String(hourNum));
      formData.append("user_id", userId.trim() || "demo-user");
      formData.append("text_input", textInput);
      if (trimmedPlanName) {
        formData.append("plan_name", trimmedPlanName);
      }
      if (pdfFile) {
        formData.append("file", pdfFile);
      }

      const response = await fetch(`${api.defaults.baseURL}/generate-plan/stream`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      let donePlanId = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "init") {
            setPlanId(evt.plan_id);
            setMessage(`Generating ${evt.days}-day plan…`);
          } else if (evt.type === "chunk") {
            const incoming = Array.isArray(evt.days) ? evt.days : [];
            setPlan((prev) => {
              const seen = new Set(prev.map((d) => d.day));
              const merged = [...prev];
              for (const d of incoming) {
                if (!seen.has(d.day)) merged.push(d);
              }
              merged.sort((a, b) => a.day - b.day);
              return merged;
            });
          } else if (evt.type === "done") {
            donePlanId = evt.plan_id;
          } else if (evt.type === "error") {
            streamError = evt.detail || "Plan generation failed.";
          }
        }
      }

      if (streamError) {
        setError(streamError);
      } else {
        if (donePlanId) setPlanId(donePlanId);
        setMessage("Plan generated and saved successfully.");
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } });
      }
      await fetchSavedPlansForUser();
    } catch (requestError) {
      setError(requestError?.message || "Failed to generate plan.");
    } finally {
      setIsGenerating(false);
      // Always blank the form so the next plan starts from a clean slate.
      resetPlanForm();
    }
  };

  // Upsert per-day progress (completed topics + done flag) and refresh stats.
  const saveDayProgress = async (day, overrides) => {
    try {
      const dayState = progressByDay[day.day] || { isCompleted: false, completedTopics: [] };
      const completedTopics = overrides?.completedTopics ?? dayState.completedTopics;
      const isCompleted = overrides?.isCompleted ?? dayState.isCompleted;
      await api.post("/progress/", {
        plan_id: planId,
        day: day.day,
        completed_topics: completedTopics,
        is_completed: isCompleted,
      });
      const { data } = await api.get(`/plans/${planId}/stats`);
      setStats(data);
      setMessage(`Progress updated for Day ${day.day}.`);
      await fetchSavedPlansForUser();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Failed to save progress.");
    }
  };

  // Persist the latest quiz score for one day and refresh stats.
  const saveQuizScore = async (day) => {
    try {
      const quizState = quizByDay[day.day] || { score: 0, weakTopics: "", totalQuestions: QUIZ_TOTAL };
      await api.post("/quiz-score/", {
        plan_id: planId,
        day: day.day,
        score: Number(quizState.score || 0),
        total_questions: quizState.totalQuestions ?? QUIZ_TOTAL,
        weak_topics: quizState.weakTopics
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      });
      const { data } = await api.get(`/plans/${planId}/stats`);
      setStats(data);
      setMessage(`Quiz score saved for Day ${day.day}.`);
      await fetchSavedPlansForUser();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Failed to save quiz score.");
    }
  };

  // Fetch resolved URLs for a day on demand and merge them into local plan state.
  const loadDayResources = useCallback(async (dayNum) => {
    const pid = planIdRef.current;
    if (!pid) return;
    try {
      const { data } = await api.get(`/plans/${pid}/days/${dayNum}/resources`);
      const urls = Array.isArray(data?.resources) ? data.resources : [];
      setPlan((prev) =>
        prev.map((d) => (d.day === dayNum ? { ...d, resources: urls } : d))
      );
    } catch (err) {
      // Stale plan id (already deleted on the server) → drop local state so the saved-plans effect reseeds.
      if (err?.response?.status === 404) {
        setPlanId("");
        setPlan([]);
        setProgressByDay({});
        setQuizByDay({});
        setStats(null);
      }
    }
  }, []);

  // Open the quiz modal for one day (generates the quiz on the backend if not cached).
  const openDayQuiz = async (dayNum) => {
    if (!planId) return;
    setQuizModalDay(dayNum);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizResult(null);
    setQuizError("");
    setQuizLoading(true);
    try {
      const { data } = await api.post(`/plans/${planId}/days/${dayNum}/generate-quiz`);
      setQuizQuestions(data.quiz || []);
    } catch (requestError) {
      setQuizError(
        requestError?.response?.data?.detail ||
          requestError?.message ||
          "Failed to generate quiz."
      );
    } finally {
      setQuizLoading(false);
    }
  };

  // Reset all quiz-modal state and close it.
  const closeQuizModal = () => {
    setQuizModalDay(null);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizResult(null);
    setQuizError("");
    setQuizLoading(false);
    setQuizSubmitting(false);
  };

  // Score a submitted quiz, persist the score, and update local quiz state.
  const handleQuizSubmit = async (questions, answers) => {
    if (!planId || quizModalDay == null) return;
    setQuizSubmitting(true);
    let score = 0;
    const weak = [];
    questions.forEach((q, i) => {
      if (normalizeAnswer(answers[i], q.answer)) score += 1;
      else if (q.topic_covered) weak.push(q.topic_covered);
    });
    const uniqueWeak = [...new Set(weak)];
    try {
      await api.post("/quiz-score/", {
        plan_id: planId,
        day: quizModalDay,
        score,
        total_questions: QUIZ_TOTAL,
        weak_topics: uniqueWeak,
      });
      const { data } = await api.get(`/plans/${planId}/stats`);
      setStats(data);
      setQuizByDay((prev) => ({
        ...prev,
        [quizModalDay]: {
          score,
          weakTopics: uniqueWeak.join(", "),
          totalQuestions: QUIZ_TOTAL,
        },
      }));
      setQuizResult({ score, weakTopics: uniqueWeak });
      setMessage(`Day ${quizModalDay} quiz: ${score}/${QUIZ_TOTAL}`);
      await fetchSavedPlansForUser();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Failed to save quiz score.");
    } finally {
      setQuizSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <main className="container">
        <header className="site-header">
          <div className="site-header-brand">
            <span className="site-logo" aria-hidden>
              <Sparkles size={32} strokeWidth={1.75} />
            </span>
            <div className="site-header-text">
              <h1 className="site-title">LearnFlow</h1>
              <p className="site-tagline">
                Skillup with personalized study plans and quizzes.
              </p>
            </div>
          </div>
        </header>

        <section className="user-id-bar" aria-label="Your account">
          <div className="user-id-bar-inner">
            <label className="user-id-label">
              <span className="user-id-title">
                <User size={16} aria-hidden />
                User ID
              </span>
              <input
                type="text"
                autoComplete="username"
                spellCheck={false}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. jasti-student-001"
              />
            </label>
            <p className="user-id-hint">
              Use the <strong>same ID</strong> every visit. Open the <strong>Your Plans</strong> tab to see your saved roadmaps with live stats; <strong>Resume progress</strong> opens <strong>Track</strong> with progress and quiz scores.
            </p>
          </div>
        </section>

        <section className="view-switcher">
          <button
            className={activeView === "planner" ? "view-btn active" : "view-btn"}
            onClick={() => setActiveView("planner")}
          >
            <Compass size={16} /> Plan
          </button>
          <button
            className={activeView === "your-plans" ? "view-btn active" : "view-btn"}
            onClick={() => setActiveView("your-plans")}
          >
            <History size={16} /> Your Plans
          </button>
          <button
            className={activeView === "track" ? "view-btn active" : "view-btn"}
            onClick={() => setActiveView("track")}
            disabled={!plan.length}
          >
            <ListChecks size={16} /> Track
          </button>
        </section>

        {activeView === "planner" && (
          <PlannerView
            key={formResetKey}
            days={days}
            setDays={setDays}
            hours={hours}
            setHours={setHours}
            textInput={textInput}
            setTextInput={setTextInput}
            pdfFile={pdfFile}
            setPdfFile={setPdfFile}
            planName={planName}
            setPlanName={setPlanName}
            onGeneratePlan={onGeneratePlan}
            isGenerating={isGenerating}
            message={message}
            error={error}
          />
        )}

        {activeView === "your-plans" && (
          <YourPlansView
            savedPlans={savedPlans}
            savedPlansLoading={savedPlansLoading}
            onResumePlan={resumePlan}
            onRefreshSavedPlans={fetchSavedPlansForUser}
            onDeletePlan={deletePlan}
            activePlanId={planId}
          />
        )}

        {activeView === "track" && (
          <TrackView
            plan={plan}
            completionPct={completionPct}
            averageQuizPct={averageQuizPct}
            completedDays={completedDays}
            targetDay={targetDay}
            setTargetDay={setTargetDay}
            progressByDay={progressByDay}
            setProgressByDay={setProgressByDay}
            quizByDay={quizByDay}
            setQuizByDay={setQuizByDay}
            saveDayProgress={saveDayProgress}
            saveQuizScore={saveQuizScore}
            onOpenQuiz={openDayQuiz}
            onLoadDayResources={loadDayResources}
            quizLoadingDay={quizLoading ? quizModalDay : null}
            hours={planHours}
            planId={planId}
          />
        )}

        <QuizModal
          open={quizModalDay != null}
          dayNumber={quizModalDay}
          questions={quizQuestions}
          loading={quizLoading}
          error={quizError}
          answers={quizAnswers}
          setAnswers={setQuizAnswers}
          onClose={closeQuizModal}
          onSubmit={handleQuizSubmit}
          submitting={quizSubmitting}
          result={quizResult}
        />
      </main>
    </div>
  );
}

export default App;