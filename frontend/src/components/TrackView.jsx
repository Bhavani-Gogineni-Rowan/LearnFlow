import { useEffect, useRef, useState } from "react";
import {
  AlarmClock,
  BrainCircuit,
  CircleCheckBig,
  ClipboardList,
  FileText,
  Link,
  LoaderCircle,
  TrendingUp,
  Trophy,
} from "lucide-react";

const QUIZ_TOTAL = 10;

function TrackView({
  plan,
  completionPct,
  averageQuizPct,
  completedDays,
  targetDay,
  setTargetDay,
  progressByDay,
  setProgressByDay,
  quizByDay,
  setQuizByDay,
  saveDayProgress,
  saveQuizScore,
  onOpenQuiz,
  onLoadDayResources,
  quizLoadingDay,
  hours,
  planId,
}) {
  const [resourceLoadingDay, setResourceLoadingDay] = useState(null);
  // Remembers (planId, day) pairs already requested so a failure can't trigger a retry storm.
  const attemptedRef = useRef(new Set());
  const timelineRef = useRef(null);
  const lastPlanIdRef = useRef(null);

  const hasPlan = plan.length > 0;
  const normalizedTargetDay = hasPlan
    ? Math.max(1, Math.min(Number(targetDay) || 1, plan.length))
    : 1;
  const selectedDay = hasPlan
    ? plan.find((d) => d.day === normalizedTargetDay) || plan[0]
    : null;
  const selectedDayNumber = selectedDay?.day ?? null;
  const resourcesForDay = Array.isArray(selectedDay?.resources) ? selectedDay.resources : [];

  // True only when every resource for the day is already an http(s) URL.
  const allResourcesAreUrls =
    resourcesForDay.length > 0 &&
    resourcesForDay.every(
      (r) => typeof r === "string" && /^https?:\/\//i.test(r.trim())
    );

  // Lazily fetch resolved URLs for the selected day if it's still holding raw queries.
  useEffect(() => {
    if (!planId || !selectedDayNumber || !onLoadDayResources) return;
    if (allResourcesAreUrls) return;
    const key = `${planId}::${selectedDayNumber}`;
    if (attemptedRef.current.has(key)) return;
    attemptedRef.current.add(key);
    setResourceLoadingDay(selectedDayNumber);
    Promise.resolve(onLoadDayResources(selectedDayNumber)).finally(() => {
      setResourceLoadingDay((cur) => (cur === selectedDayNumber ? null : cur));
    });
  }, [planId, selectedDayNumber, onLoadDayResources, allResourcesAreUrls]);

  // Reset the per-day "already attempted" memory whenever a new plan is selected.
  useEffect(() => {
    attemptedRef.current = new Set();
  }, [planId]);

  // Scroll the timeline back to Day 1 whenever a new plan is loaded.
  useEffect(() => {
    if (planId && planId !== lastPlanIdRef.current) {
      lastPlanIdRef.current = planId;
      if (timelineRef.current) timelineRef.current.scrollTop = 0;
    }
  }, [planId]);

  if (!hasPlan) {
    return <p className="message err">Generating a plan…</p>;
  }

  const dayProgress =
    progressByDay[selectedDay.day] || { isCompleted: false, completedTopics: [] };
  const dayQuiz =
    quizByDay[selectedDay.day] || { score: 0, weakTopics: "", totalQuestions: QUIZ_TOTAL };
  const topicsForDay = Array.isArray(selectedDay.topics) ? selectedDay.topics : [];
  const completedTopicsForDay = Array.isArray(dayProgress.completedTopics)
    ? dayProgress.completedTopics
    : [];
  const completedTopicSet = new Set(completedTopicsForDay);
  const isAllTopicsComplete =
    topicsForDay.length > 0 && topicsForDay.every((t) => completedTopicSet.has(t));

  // Save the new completed-topics list (in plan order) and toggle the day-done flag accordingly.
  const persistDayProgress = async (nextCompletedTopics) => {
    const nextSet = new Set(nextCompletedTopics);
    const normalizedCompleted = topicsForDay.filter((t) => nextSet.has(t));
    const nextIsCompleted = topicsForDay.length > 0 && normalizedCompleted.length === topicsForDay.length;

    setProgressByDay((prev) => ({
      ...prev,
      [selectedDay.day]: {
        ...(prev[selectedDay.day] || dayProgress),
        completedTopics: normalizedCompleted,
        isCompleted: nextIsCompleted,
      },
    }));

    await saveDayProgress(selectedDay, {
      completedTopics: normalizedCompleted,
      isCompleted: nextIsCompleted,
    });
  };

  // Pull the first http(s) URL from a string (or null) and trim trailing punctuation.
  const extractFirstHttpUrl = (text) => {
    const s = String(text || "").trim();
    if (!s) return null;
    const match = s.match(/(https?:\/\/[^\s\)\]\}>,"']+)/i);
    if (!match) return null;
    return match[1].replace(/[.,;:]+$/g, "");
  };

  return (
    <>
      <section className="ring-and-timeline">
        <article className="ring-card">
          <h3>
            <BrainCircuit size={18} /> Mastery Ring
          </h3>
          <div className="ring-wrap">
            <div
              className="ring"
              style={{
                background: `conic-gradient(#fde68a ${completionPct}%, rgba(191, 219, 254, 0.65) ${completionPct}% 100%)`,
              }}
            >
              <div className="ring-inner">
                <strong>{completionPct}%</strong>
                <span>Plan Completion</span>
              </div>
            </div>
            <div className="ring-metrics">
              <p>Quiz readiness: {averageQuizPct}%</p>
              <p>Completed days: {completedDays}/{plan.length}</p>
            </div>
          </div>
        </article>

        <article className="timeline-card">
          <h3>
            <TrendingUp size={18} /> Study Timeline
          </h3>
          <div className="timeline" ref={timelineRef}>
            {plan.map((day, idx) => {
              const dayState = progressByDay[day.day];
              const done = Boolean(dayState?.isCompleted);
              const active = day.day === normalizedTargetDay;
              return (
                <div key={day.day} className="timeline-item">
                  <div className={done ? "dot done" : active ? "dot active" : "dot"} />
                  {idx !== plan.length - 1 && <div className="connector" />}
                  <div className="timeline-content">
                    <div className="timeline-top-row">
                      <p>Day {day.day}</p>
                      <button
                        type="button"
                        className={active ? "timeline-day-btn active" : "timeline-day-btn"}
                        onClick={() => setTargetDay(day.day)}
                      >
                        {active ? "Selected" : "Show"}
                      </button>
                    </div>
                    <span>{day.topics[0]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="day-card">
          <header>
            <h3>Day {selectedDay.day}</h3>
            <span>
              <AlarmClock size={14} />{' '}
              {typeof hours === 'number' && hours >= 1 ? `${hours}h` : '—'}
            </span>
          </header>

          <div className="day-actions">
            <button
              className="quiz-btn"
              onClick={() => onOpenQuiz(selectedDay.day)}
              disabled={!planId || quizLoadingDay === selectedDay.day}
            >
              {quizLoadingDay === selectedDay.day ? (
                <>
                  <LoaderCircle className="spin" size={14} /> Loading…
                </>
              ) : (
                <>
                  <ClipboardList size={14} /> Take Quiz ({QUIZ_TOTAL} Qs)
                </>
              )}
            </button>
          </div>

          <div className="section">
            <h4>
              <FileText size={14} /> Topics
            </h4>
            <ul>
              {selectedDay.topics.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          </div>

          <div className="section">
            <h4>
              <Link size={14} /> Resources
            </h4>
            {resourceLoadingDay === selectedDay.day && resourcesForDay.length === 0 ? (
              <p className="quiz-help">
                <LoaderCircle className="spin" size={14} /> Finding good links for this day…
              </p>
            ) : resourcesForDay.length === 0 ? (
              <p className="quiz-help">No resources yet for this day.</p>
            ) : (
              <ul>
                {resourcesForDay.map((resource) => (
                  <li key={resource}>
                    {(() => {
                      const href = extractFirstHttpUrl(resource);
                      if (!href) return <span>{resource}</span>;
                      return (
                        <a href={href} target="_blank" rel="noreferrer">
                          {resource}
                        </a>
                      );
                    })()}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="section">
            <h4>
              <CircleCheckBig size={14} /> Progress
            </h4>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isAllTopicsComplete}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const next = checked ? topicsForDay : [];
                  void persistDayProgress(next);
                }}
              />
              Mark day complete
            </label>

            {topicsForDay.length > 0 && (
              <div className="topic-checkbox-list" role="group" aria-label="Completed topics">
                {topicsForDay.map((topic) => (
                  <label key={topic} className="topic-checkbox-item checkbox">
                    <input
                      type="checkbox"
                      checked={completedTopicSet.has(topic)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const next = checked
                          ? [...completedTopicsForDay, topic]
                          : completedTopicsForDay.filter((t) => t !== topic);
                        void persistDayProgress(next);
                      }}
                    />
                    {topic}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="section">
            <h4>
              <Trophy size={14} /> Latest quiz score
            </h4>
            <p className="quiz-help">
              Click <strong>Take Quiz</strong> and submit. The score will update here automatically.
            </p>
            <p className="quiz-row" style={{ marginTop: 4 }}>
              <strong>{dayQuiz.score}</strong> / {QUIZ_TOTAL}
            </p>
            {dayQuiz.weakTopics ? (
              <p className="quiz-help" style={{ marginTop: 8 }}>
                Weak topics: <strong>{dayQuiz.weakTopics}</strong>
              </p>
            ) : (
              <p className="quiz-help" style={{ marginTop: 8 }}>
                Weak topics: <strong>—</strong>
              </p>
            )}
          </div>
        </article>
      </section>
    </>
  );
}

export default TrackView;
