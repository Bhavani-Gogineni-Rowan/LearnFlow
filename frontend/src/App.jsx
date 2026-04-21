import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import confetti from "canvas-confetti";
import { Compass, ListChecks, Sparkles, User } from "lucide-react";
import PlannerView from "./components/PlannerView";
import TrackView from "./components/TrackView";
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

  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [planId, setPlanId] = useState("");
  const [plan, setPlan] = useState([]);
  const [targetDay, setTargetDay] = useState(1);
  const [stats, setStats] = useState(null);

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

  const normalizeSavedPlans = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .filter((item) => item && typeof item === "object" && typeof item.plan_id === "string")
      .map((item) => ({
        ...item,
        plan_id: String(item.plan_id),
        completion_percent: Number(item.completion_percent ?? 0),
        completed_days_count: Number(item.completed_days_count ?? 0),
        total_plan_days: Number(item.total_plan_days ?? 0),
        syllabus_preview: String(item.syllabus_preview ?? ""),
        created_at: item.created_at || null,
      }));

  const applyResumePayload = useCallback((data) => {
    setPlanId(data.plan_id);
    setPlan(data.plan || []);
    const dn = Number(data.days);
    const hn = Number(data.hours);
    setDays(Number.isFinite(dn) && dn >= 1 ? dn : '');
    setHours(Number.isFinite(hn) && hn >= 1 ? hn : '');
    setTextInput(data.syllabus_text || "");

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

  useEffect(() => {
    const t = setTimeout(() => {
      fetchSavedPlansForUser();
    }, 250);
    return () => clearTimeout(t);
  }, [fetchSavedPlansForUser]);

  // When saved plans load for this user, hydrate Plan + KPIs from the same plan we show stats for
  // (prefer current planId if it’s in the list, else newest). Uses a ref for planId so hydrating
  // doesn’t retrigger this effect and double-fetch. Resume button still loads a chosen plan explicitly.
  useEffect(() => {
    if (!savedPlans.length) {
      setStats(null);
      setPlanId("");
      setPlan([]);
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

    setIsGenerating(true);

    try {
      const formData = new FormData();
      formData.append("days", String(dayNum));
      formData.append("hours", String(hourNum));
      formData.append("user_id", userId.trim() || "demo-user");
      formData.append("text_input", textInput);
      if (pdfFile) {
        formData.append("file", pdfFile);
      }

      const { data } = await api.post("/generate-plan/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setPlanId(data.plan_id);
      setPlan(data.plan || []);
      setTargetDay(1);
      setProgressByDay({});
      setQuizByDay({});
      setStats(null);
      setMessage("Plan generated and saved successfully.");
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.7 } });
      await fetchSavedPlansForUser();
    } catch (requestError) {
      setError(
        requestError?.response?.data?.detail ||
          requestError?.message ||
          "Failed to generate plan."
      );
    } finally {
      setIsGenerating(false);
    }
  };

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

  const closeQuizModal = () => {
    setQuizModalDay(null);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizResult(null);
    setQuizError("");
    setQuizLoading(false);
    setQuizSubmitting(false);
  };

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
              Use the <strong>same ID</strong> every visit. Your saved roadmaps load on the <strong>Plan</strong> tab; resume opens <strong>Track</strong> with progress and quiz scores.
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
            className={activeView === "track" ? "view-btn active" : "view-btn"}
            onClick={() => setActiveView("track")}
            disabled={!plan.length}
          >
            <ListChecks size={16} /> Track
          </button>
        </section>

        {activeView === "planner" && (
          <PlannerView
            days={days}
            setDays={setDays}
            hours={hours}
            setHours={setHours}
            textInput={textInput}
            setTextInput={setTextInput}
            setPdfFile={setPdfFile}
            onGeneratePlan={onGeneratePlan}
            isGenerating={isGenerating}
            planId={planId}
            completionPct={completionPct}
            planLength={plan.length}
            averageQuizPct={averageQuizPct}
            currentStreak={stats?.current_streak ?? 0}
            stats={stats}
            message={message}
            error={error}
            savedPlans={savedPlans}
            savedPlansLoading={savedPlansLoading}
            onResumePlan={resumePlan}
            onRefreshSavedPlans={fetchSavedPlansForUser}
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
            quizLoadingDay={quizLoading ? quizModalDay : null}
            hours={hours}
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