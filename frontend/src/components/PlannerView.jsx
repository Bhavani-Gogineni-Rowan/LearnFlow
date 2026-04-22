import { LoaderCircle, Sparkles } from "lucide-react";

function PlannerView({
  days,
  setDays,
  hours,
  setHours,
  textInput,
  setTextInput,
  pdfFile,
  setPdfFile,
  planName,
  setPlanName,
  onGeneratePlan,
  isGenerating,
  message,
  error,
}) {
  const planNameRequired = Boolean(pdfFile);
  return (
    <>
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
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="full">
            <span>
              Plan Name {planNameRequired ? <em className="required-mark">*required for PDFs</em> : <em className="optional-mark">(optional)</em>}
            </span>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              maxLength={120}
              placeholder={
                planNameRequired
                  ? "e.g. CKAD prep, DSA crash course"
                  : "Leave blank to use the syllabus text as the title"
              }
              required={planNameRequired}
            />
          </label>
          <button type="submit" className="primary-btn full" disabled={isGenerating}>
            {isGenerating ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
            {isGenerating ? "Generating..." : "Generate Study Plan"}
          </button>
        </form>
      </section>

      {message && <p className="message ok">{message}</p>}
      {error && <p className="message err">{error}</p>}
    </>
  );
}

export default PlannerView;
