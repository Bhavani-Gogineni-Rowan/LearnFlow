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
  quizLoadingDay,
  hours,
  planId,
}) {
  if (!plan.length) {
    return <p className="message err">Generate a plan first to access tracking.</p>;
  }

  const normalizedTargetDay = Math.max(1, Math.min(Number(targetDay) || 1, plan.length));
  const selectedDay = plan.find((d) => d.day === normalizedTargetDay) || plan[0];
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

  const persistDayProgress = async (nextCompletedTopics) => {
    // Keep completed topics in the same order as the plan's topic list.
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

  const extractFirstHttpUrl = (text) => {
    const s = String(text || "").trim();
    if (!s) return null;
    const match = s.match(/(https?:\/\/[^\s\)\]\}>,"']+)/i);
    if (!match) return null;
    // Avoid trailing punctuation commonly produced in text.
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
          <div className="timeline">
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
            <ul>
              {selectedDay.resources.map((resource) => (
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
