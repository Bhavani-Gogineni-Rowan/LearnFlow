import {
  BookOpen,
  CircleCheckBig,
  Flame,
  History,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";

function PlannerView({
  days,
  setDays,
  hours,
  setHours,
  textInput,
  setTextInput,
  setPdfFile,
  onGeneratePlan,
  isGenerating,
  planId,
  completionPct,
  planLength,
  averageQuizPct,
  currentStreak,
  stats,
  message,
  error,
  savedPlans = [],
  savedPlansLoading = false,
  onResumePlan,
  onRefreshSavedPlans,
  activePlanId = "",
}) {
  return (
    <>
      <section className="saved-plans-section">
        <div className="saved-plans-header">
          <h2>
            <History size={18} /> Your saved roadmaps
          </h2>
          <button type="button" className="ghost-btn refresh-saved-btn" onClick={onRefreshSavedPlans} disabled={savedPlansLoading}>
            {savedPlansLoading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            Refresh
          </button>
        </div>
        <p className="saved-plans-sub">
          Plans listed here match the <strong>User ID</strong> in the bar at the top. Click <strong>Resume progress</strong> to reopen your roadmap and scores.
        </p>
        {savedPlansLoading && !savedPlans.length ? (
          <p className="saved-plans-empty">Loading your plans…</p>
        ) : null}
        {!savedPlansLoading && !savedPlans.length ? (
          <p className="saved-plans-empty">No saved plans for this User ID yet. Generate one below.</p>
        ) : null}
        {savedPlans.length > 0 && (
          <ul className="saved-plans-list">
            {savedPlans
              .filter((item) => item && typeof item.plan_id === "string")
              .map((item) => (
              <li key={item.plan_id} className={item.plan_id === activePlanId ? "saved-plan-row current" : "saved-plan-row"}>
                <div className="saved-plan-meta">
                  <strong>{item.completion_percent}%</strong> done
                  <span className="saved-plan-days">
                    {item.completed_days_count}/{item.total_plan_days} days
                  </span>
                  <span className="saved-plan-date">
                    {item.created_at ? new Date(item.created_at).toLocaleString() : "Unknown date"}
                  </span>
                </div>
                <p className="saved-plan-preview">{item.syllabus_preview}</p>
                <div className="saved-plan-foot">
                  <code className="saved-plan-id">{item.plan_id.slice(0, 8)}…</code>
                  <button type="button" className="primary-btn resume-btn" onClick={() => onResumePlan(item.plan_id)}>
                    Resume progress
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="hero-card">
        <div className="hero-headline">
          <span className="badge">
            <Sparkles size={16} /> LearnFlow AI Planner
          </span>
          <p>
            Generate a personalized roadmap, track day-level progress, log quiz performance.
          </p>
        </div>

        <form className="form-grid" onSubmit={onGeneratePlan}>
          <label>
            <span>Days</span>
            <input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 7"
              value={days === '' ? '' : days}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  setDays('');
                  return;
                }
                const n = parseInt(v, 10);
                if (Number.isNaN(n)) return;
                if (n < 1) {
                  setDays('');
                  return;
                }
                setDays(n);
              }}
              required
            />
          </label>
          <label>
            <span>Hours / Day</span>
            <input
              type="number"
              min={1}
              step={1}
              placeholder="e.g. 2"
              value={hours === '' ? '' : hours}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  setHours('');
                  return;
                }
                const n = parseInt(v, 10);
                if (Number.isNaN(n)) return;
                if (n < 1) {
                  setHours('');
                  return;
                }
                setHours(n);
              }}
              required
            />
          </label>
          <label className="full">
            <span>Syllabus Text</span>
            <textarea
              rows={5}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste your syllabus topics or chapters here..."
            />
          </label>
          <label className="full">
            <span>Upload PDF (optional)</span>
            <input type="file" accept=".pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} />
          </label>
          <button type="submit" className="primary-btn full" disabled={isGenerating}>
            {isGenerating ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
            {isGenerating ? "Generating..." : "Generate Study Plan"}
          </button>
        </form>
      </section>

      <section className="kpi-row">
        <article className="kpi-card">
          <Target size={18} />
          <div>
            <p>Plan ID</p>
            <h3>{planId || "Not generated"}</h3>
          </div>
        </article>
        <article className="kpi-card">
          <CircleCheckBig size={18} />
          <div>
            <p>Completion</p>
            <h3>{completionPct}%</h3>
          </div>
        </article>
        <article className="kpi-card">
          <BookOpen size={18} />
          <div>
            <p>Total Days</p>
            <h3>{planLength}</h3>
          </div>
        </article>
        <article className="kpi-card">
          <Flame size={18} />
          <div>
            <p>Avg Quiz</p>
            <h3>{averageQuizPct}%</h3>
          </div>
        </article>
        <article className="kpi-card">
          <TrendingUp size={18} />
          <div>
            <p>Current Streak</p>
            <h3>{currentStreak} day(s)</h3>
          </div>
        </article>
      </section>

      {stats && (
        <section className="badge-row">
          <h3>Milestone Badges</h3>
          <div>
            {stats.unlocked_badges?.length ? (
              stats.unlocked_badges.map((badge) => (
                <span key={badge} className="badge-pill">
                  <Trophy size={14} /> {badge}
                </span>
              ))
            ) : (
              <span className="badge-pill muted">No badges yet - keep your streak alive.</span>
            )}
          </div>
        </section>
      )}

      {message && <p className="message ok">{message}</p>}
      {error && <p className="message err">{error}</p>}
    </>
  );
}

export default PlannerView;
