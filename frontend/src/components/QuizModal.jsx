import { CheckCircle2, LoaderCircle, X, XCircle } from "lucide-react";

const TOTAL = 10;

// Case- and whitespace-insensitive equality used to compare quiz answers.
function normalizeAnswer(a, b) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

function QuizModal({
  open,
  dayNumber,
  questions,
  loading,
  error,
  answers,
  setAnswers,
  onClose,
  onSubmit,
  submitting,
  result,
}) {
  if (!open) return null;

  return (
    <div className="quiz-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="quiz-modal-title">
      <div className="quiz-modal">
        <div className="quiz-modal-head">
          <h2 id="quiz-modal-title">Day {dayNumber} quiz ({TOTAL} questions)</h2>
          <button type="button" className="quiz-modal-close" onClick={onClose} aria-label="Close quiz">
            <X size={20} />
          </button>
        </div>

        {loading && (
          <p className="quiz-modal-loading">
            <LoaderCircle className="spin" size={20} /> Generating your quiz…
          </p>
        )}
        {error && !loading && <p className="message err">{error}</p>}

        {!loading && questions.length > 0 && questions.length !== TOTAL && !result && (
          <p className="message err">
            Received {questions.length} questions instead of {TOTAL}. Close and try again.
          </p>
        )}

        {!loading && questions.length === TOTAL && !result && (
          <div className="quiz-modal-body">
            <p className="quiz-modal-hint">
              Pick an answer for each question — feedback appears immediately. Submit when all {TOTAL} are answered.
            </p>
            <ol className="quiz-question-list">
              {questions.map((q, idx) => {
                const picked = answers[idx];
                const locked = picked !== undefined;
                const pickedIsCorrect = locked && normalizeAnswer(picked, q.answer);
                return (
                  <li key={idx} className="quiz-question-item">
                    <p className="quiz-q-text">
                      <strong>Q{idx + 1}.</strong> {q.question}
                      {q.topic_covered ? (
                        <span className="quiz-topic-tag">{q.topic_covered}</span>
                      ) : null}
                    </p>
                    <div className="quiz-options">
                      {q.options.map((opt) => {
                        const isPicked = picked === opt;
                        const isCorrect = normalizeAnswer(opt, q.answer);
                        let stateClass = "";
                        if (locked) {
                          if (isCorrect) stateClass = "correct";
                          else if (isPicked) stateClass = "wrong";
                          else stateClass = "muted";
                        }
                        return (
                          <label
                            key={opt}
                            className={`quiz-option ${stateClass}`.trim()}
                          >
                            <input
                              type="radio"
                              name={`q-${idx}`}
                              checked={isPicked}
                              disabled={locked}
                              onChange={() => {
                                if (locked) return;
                                setAnswers((prev) => ({
                                  ...prev,
                                  [idx]: opt,
                                }));
                              }}
                            />
                            <span className="quiz-option-text">{opt}</span>
                            {locked && isCorrect && (
                              <CheckCircle2 size={16} className="quiz-option-icon correct" />
                            )}
                            {locked && isPicked && !isCorrect && (
                              <XCircle size={16} className="quiz-option-icon wrong" />
                            )}
                          </label>
                        );
                      })}
                    </div>
                    {locked && (
                      <div
                        className={`quiz-explanation ${pickedIsCorrect ? "ok" : "bad"}`}
                      >
                        <strong>
                          {pickedIsCorrect ? "Correct." : `Incorrect — answer: ${q.answer}.`}
                        </strong>{" "}
                        {q.explanation}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              className="primary-btn full"
              disabled={submitting || Object.keys(answers).length < TOTAL}
              onClick={() => onSubmit(questions, answers)}
            >
              {submitting ? "Submitting…" : "Submit quiz"}
            </button>
          </div>
        )}

        {result && (
          <div className="quiz-result">
            <h3>Score: {result.score} / {TOTAL}</h3>
            <p>{result.score >= 8 ? "Strong work!" : result.score >= 5 ? "Good progress — review weak topics." : "Review the topics below and try again later."}</p>
            {result.weakTopics?.length > 0 && (
              <div>
                <strong>Topics to review:</strong>
                <ul>
                  {result.weakTopics.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" className="primary-btn" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { QuizModal, normalizeAnswer, TOTAL };
