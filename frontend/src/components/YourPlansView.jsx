import {
  BookOpen,
  CircleCheckBig,
  Flame,
  History,
  LoaderCircle,
  Play,
  RefreshCw,
  Trash2,
  TrendingUp,
  Trophy,
} from "lucide-react";

function YourPlansView({
  savedPlans = [],
  savedPlansLoading = false,
  onResumePlan,
  onRefreshSavedPlans,
  onDeletePlan,
  activePlanId = "",
}) {
  // Pick the best display title: user-supplied plan name > syllabus preview > placeholder.
  const titleForItem = (item) =>
    (item.plan_name && item.plan_name.trim()) ||
    (item.syllabus_preview && item.syllabus_preview.trim()) ||
    "Untitled roadmap";

  // Confirm with the user, then delegate to the parent to delete this plan.
  const handleDelete = (item) => {
    if (!onDeletePlan) return;
    const label = titleForItem(item).slice(0, 60);
    const ok = window.confirm(
      `Delete "${label}"?\n\nThis permanently removes the plan, its progress, and all quiz scores. This cannot be undone.`
    );
    if (!ok) return;
    onDeletePlan(item.plan_id);
  };
  return (
    <section className="your-plans-section">
      <div className="your-plans-header">
        <h2>
          <History size={18} /> Your saved roadmaps
        </h2>
        <button
          type="button"
          className="ghost-btn refresh-saved-btn"
          onClick={onRefreshSavedPlans}
          disabled={savedPlansLoading}
        >
          {savedPlansLoading ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          Refresh
        </button>
      </div>
      <p className="your-plans-sub">
        Plans listed here match the <strong>User ID</strong> in the bar at the top.
        Each card shows that plan&apos;s live stats and unlocked milestones. Click{" "}
        <strong>Resume progress</strong> to reopen the roadmap on the <strong>Track</strong> tab.
      </p>

      {savedPlansLoading && !savedPlans.length ? (
        <p className="your-plans-empty">Loading your plans…</p>
      ) : null}

      {!savedPlansLoading && !savedPlans.length ? (
        <p className="your-plans-empty">
          No saved plans for this User ID yet. Generate one from the <strong>Plan</strong> tab.
        </p>
      ) : null}

      {savedPlans.length > 0 && (
        <ul className="your-plans-list">
          {savedPlans
            .filter((item) => item && typeof item.plan_id === "string")
            .map((item) => {
              const isCurrent = item.plan_id === activePlanId;
              const createdLabel = item.created_at
                ? new Date(item.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "";
              const badges = Array.isArray(item.unlocked_badges)
                ? item.unlocked_badges
                : [];
              return (
                <li
                  key={item.plan_id}
                  className={isCurrent ? "your-plan-card current" : "your-plan-card"}
                >
                  <header className="your-plan-card-head">
                    <div className="your-plan-title">
                      <h3>{titleForItem(item)}</h3>
                      <div className="your-plan-meta">
                        {createdLabel ? (
                          <span className="your-plan-date">Created {createdLabel}</span>
                        ) : null}
                        {isCurrent ? <span className="your-plan-tag">Active</span> : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="primary-btn resume-btn"
                      onClick={() => onResumePlan(item.plan_id)}
                    >
                      <Play size={16} /> Resume progress
                    </button>
                  </header>

                  <div className="your-plan-stats">
                    <article className="your-plan-stat">
                      <CircleCheckBig size={16} />
                      <div>
                        <p>Completion</p>
                        <h4>{item.completion_percent}%</h4>
                      </div>
                    </article>
                    <article className="your-plan-stat">
                      <BookOpen size={16} />
                      <div>
                        <p>Total Days</p>
                        <h4>
                          {item.completed_days_count}/{item.total_plan_days}
                        </h4>
                      </div>
                    </article>
                    <article className="your-plan-stat">
                      <Flame size={16} />
                      <div>
                        <p>Avg Quiz</p>
                        <h4>{item.average_quiz_percent ?? 0}%</h4>
                      </div>
                    </article>
                    <article className="your-plan-stat">
                      <TrendingUp size={16} />
                      <div>
                        <p>Current Streak</p>
                        <h4>{item.current_streak ?? 0} day(s)</h4>
                      </div>
                    </article>
                  </div>

                  <div className="your-plan-milestones">
                    <div className="your-plan-milestones-head">
                      <h4>
                        <Trophy size={14} /> Milestones
                      </h4>
                      <button
                        type="button"
                        className="danger-btn delete-plan-btn"
                        onClick={() => handleDelete(item)}
                        title="Delete this plan"
                        aria-label={`Delete roadmap ${item.syllabus_preview || item.plan_id}`}
                      >
                        <Trash2 size={16} /> Delete
                      </button>
                    </div>
                    <div className="your-plan-badges">
                      {badges.length ? (
                        badges.map((badge) => (
                          <span key={badge} className="badge-pill">
                            <Trophy size={12} /> {badge}
                          </span>
                        ))
                      ) : (
                        <span className="badge-pill muted">
                          No badges yet — keep your streak alive.
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

export default YourPlansView;