import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Compass, FileText, MessageCircle, Plus, RefreshCw, Save, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import Input from "../components/Input";
import Spinner from "../components/Spinner";
import Textarea from "../components/Textarea";
import {
  createTransformationCase,
  getCaseDiagnosis,
  getCaseMonitoring,
  getTransformationCase,
  linkCaseSource,
  listCaseIndicators,
  listCaseInterventions,
  listDataEntries,
  uploadDocument,
  updateCaseIndicator,
  type CaseMonitoring,
  listTransformationCases,
  RagApiError,
  updateTransformationCase,
  type DataEntry,
  type CaseDiagnosis,
  type CaseIndicator,
  type CaseIntervention,
  type TransformationCase,
  type TransformationCaseStatus,
} from "../lib/ragApi";

type CaseDraft = {
  title: string;
  problem_statement: string;
  desired_outcome: string;
  territory: string;
};

const EMPTY_DRAFT: CaseDraft = {
  title: "",
  problem_statement: "",
  desired_outcome: "",
  territory: "",
};

const STATUS_OPTIONS: TransformationCaseStatus[] = [
  "draft",
  "active",
  "monitoring",
  "completed",
  "archived",
];

function errorMessage(error: unknown): string {
  if (error instanceof RagApiError || error instanceof Error) return error.message;
  return "Could not reach the DC-TIM backend.";
}

function statusLabel(status: TransformationCaseStatus): string {
  return status.replace("_", " ").replace(/^\w/, (value) => value.toUpperCase());
}

export default function SettlementCasesPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<TransformationCase[]>([]);
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const [current, setCurrent] = useState<TransformationCase | null>(null);
  const [draft, setDraft] = useState<CaseDraft>(EMPTY_DRAFT);
  const [selectedDocument, setSelectedDocument] = useState("");
  const [indicators, setIndicators] = useState<CaseIndicator[]>([]);
  const [diagnosis, setDiagnosis] = useState<CaseDiagnosis | null>(null);
  const [interventions, setInterventions] = useState<CaseIntervention[]>([]);
  const [monitoring, setMonitoring] = useState<CaseMonitoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseResult, dataResult] = await Promise.all([
        listTransformationCases(),
        listDataEntries({ limit: 200 }),
      ]);
      const details = await Promise.all(caseResult.cases.map((item) => getTransformationCase(item.id)));
      setCases(details);
      setEntries(dataResult.entries);
      setCurrent((previous) => details.find((item) => item.id === previous?.id) ?? details[0] ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!current) {
      setDraft(EMPTY_DRAFT);
      return;
    }
    setDraft({
      title: current.title,
      problem_statement: current.problem_statement,
      desired_outcome: current.desired_outcome,
      territory: current.territory ?? "",
    });
  }, [current]);

  useEffect(() => {
    if (!current) {
      setIndicators([]);
      setDiagnosis(null);
      setInterventions([]);
      setMonitoring(null);
      return;
    }
    let cancelled = false;
    void Promise.all([listCaseIndicators(current.id), getCaseDiagnosis(current.id), listCaseInterventions(current.id), getCaseMonitoring(current.id)])
      .then(([nextIndicators, nextDiagnosis, nextInterventions, nextMonitoring]) => {
        if (cancelled) return;
        setIndicators(nextIndicators);
        setDiagnosis(nextDiagnosis);
        setInterventions(nextInterventions);
        setMonitoring(nextMonitoring);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  const linkedDocumentIds = useMemo(
    () => new Set(current?.sources.map((source) => source.document_id) ?? []),
    [current],
  );
  const availableEntries = entries.filter((entry) => !linkedDocumentIds.has(entry.id));

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createTransformationCase({
        ...draft,
        status: "draft",
        success_criteria: [],
        indicators: [],
        constraints: [],
      });
      setCases((previous) => [created, ...previous]);
      setCurrent(created);
      setShowCreate(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTransformationCase(current.id, draft);
      setCurrent(updated);
      setCases((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(status: TransformationCaseStatus) {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTransformationCase(current.id, { status });
      setCurrent(updated);
      setCases((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkSource() {
    if (!current || !selectedDocument) return;
    setLinking(true);
    setError(null);
    try {
      await linkCaseSource(current.id, selectedDocument, "evidence");
      const updated = await getTransformationCase(current.id);
      setCurrent(updated);
      setDiagnosis(await getCaseDiagnosis(current.id));
      setCases((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedDocument("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLinking(false);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!current || !file) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const uploaded = await uploadDocument(file, file.name, setUploadProgress);
      await linkCaseSource(current.id, uploaded.document_id, "evidence");
      const refreshedEntries = await listDataEntries({ limit: 200 });
      setEntries(refreshedEntries.entries);
      const updated = await getTransformationCase(current.id);
      setCurrent(updated);
      setCases((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      setDiagnosis(await getCaseDiagnosis(current.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleMonitoringUpdate(indicator: CaseIndicator, value: string) {
    if (!current || value.trim() === "") return;
    try {
      await updateCaseIndicator(current.id, indicator.id, {
        current_value: Number(value),
        measurement_date: new Date().toISOString(),
        quality_status: "trusted",
      });
      setMonitoring(await getCaseMonitoring(current.id));
      setIndicators(await listCaseIndicators(current.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <AppLayout>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary-500">
              <Compass className="size-4" /> DC-TIM settlement cases
            </p>
            <h1 className="font-sans text-2xl font-extrabold text-secondary-900">Define the transformation case</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-secondary-500">
              Start the settlement workflow by defining the problem, desired outcome, territory, and evidence sources.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="size-4" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="size-4" /> New case
            </Button>
          </div>
        </div>

        {error && <Alert variant="error" title="Case workflow error" className="mb-5">{error}</Alert>}

        {current && (
          <Card className="mb-5 border-primary-200 bg-primary-50/20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-primary-500">Decision workspace</p>
                <h2 className="mt-1 font-sans text-base font-bold text-secondary-800">Ask DC-TIM from Chat</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-secondary-600">Use the existing Chat page for indicator design, evidence extraction, interventions, and scenario questions. This page keeps the case state and evidence visible for review.</p>
              </div>
              <Button size="sm" onClick={() => navigate(`/prompt?case_id=${encodeURIComponent(current.id)}`)}>
                <MessageCircle className="size-4" /> Open Chat
              </Button>
            </div>
          </Card>
        )}

        {showCreate && (
          <Card className="mb-5 border-primary-200 bg-primary-50/30">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-sans text-base font-bold text-secondary-900">New settlement case</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-secondary-400 hover:bg-white hover:text-secondary-700" aria-label="Close new case form">
                <X className="size-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="grid gap-4 lg:grid-cols-2">
              <Input label="Case title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Settlement accessibility pilot" />
              <Input label="Territory" value={draft.territory} onChange={(event) => setDraft({ ...draft, territory: event.target.value })} placeholder="District, municipality, or corridor" />
              <div className="lg:col-span-2"><Textarea label="Problem statement" required value={draft.problem_statement} onChange={(event) => setDraft({ ...draft, problem_statement: event.target.value })} placeholder="What settlement problem should DC-TIM help address?" /></div>
              <div className="lg:col-span-2"><Textarea label="Desired outcome" required value={draft.desired_outcome} onChange={(event) => setDraft({ ...draft, desired_outcome: event.target.value })} placeholder="What should improve, for whom, and by when?" /></div>
              <div className="flex justify-end gap-2 lg:col-span-2"><Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" loading={saving}>Create case</Button></div>
            </form>
          </Card>
        )}

        {loading ? <Spinner label="Loading settlement cases…" /> : (
          <div className="grid gap-5 lg:grid-cols-[minmax(230px,0.75fr)_minmax(0,1.6fr)]">
            <Card className="h-fit p-3">
              <div className="mb-2 flex items-center justify-between px-2 py-1"><h2 className="font-sans text-sm font-bold text-secondary-800">Cases</h2><Badge variant="secondary">{cases.length}</Badge></div>
              {cases.length === 0 ? <p className="px-2 py-6 text-sm text-secondary-500">No transformation cases yet.</p> : <div className="space-y-1">{cases.map((item) => <button key={item.id} type="button" onClick={() => setCurrent(item)} className={["w-full rounded-xl px-3 py-3 text-left transition-colors", current?.id === item.id ? "bg-primary-50 text-primary-800" : "hover:bg-secondary-50"].join(" ")}><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-secondary-500">{item.territory || "Territory not set"}</p><div className="mt-2 flex gap-1.5"><Badge variant={current?.id === item.id ? "primary" : "secondary"}>{statusLabel(item.status)}</Badge><span className="text-[11px] text-secondary-400">Rev {item.revision}</span></div></button>)}</div>}
            </Card>

            {current ? <Card>
              <div className="mb-5 flex flex-col gap-3 border-b border-secondary-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-wider text-primary-500">Transformation case</p><h2 className="mt-1 font-sans text-xl font-extrabold text-secondary-900">{current.title}</h2><p className="mt-1 text-sm text-secondary-500">Revision {current.revision} · {current.source_count} linked source{current.source_count === 1 ? "" : "s"}</p></div>
                <select aria-label="Case status" value={current.status} disabled={saving} onChange={(event) => void handleStatus(event.target.value as TransformationCaseStatus)} className="rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm font-semibold text-secondary-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100">{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
              </div>
              <div className="grid gap-4 lg:grid-cols-2"><Input label="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><Input label="Territory" value={draft.territory} onChange={(event) => setDraft({ ...draft, territory: event.target.value })} /><div className="lg:col-span-2"><Textarea label="Problem statement" value={draft.problem_statement} onChange={(event) => setDraft({ ...draft, problem_statement: event.target.value })} /></div><div className="lg:col-span-2"><Textarea label="Desired outcome" value={draft.desired_outcome} onChange={(event) => setDraft({ ...draft, desired_outcome: event.target.value })} /></div></div>
              <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => void handleSave()} loading={saving}><Save className="size-4" /> Save case</Button></div>

              <div className="mt-6 rounded-2xl border border-primary-200 bg-primary-50/30 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Evidence intake</p><h3 className="mt-1 font-sans text-sm font-extrabold text-secondary-900">Upload evidence to this case</h3><p className="mt-1 text-xs leading-relaxed text-secondary-600">The file is extracted, indexed, and linked automatically so DC-TIM can use it in the next diagnosis.</p></div>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-primary-200 bg-white px-3 py-2 font-sans text-xs font-bold text-primary-700 transition-colors hover:bg-primary-50">
                    <Upload className="size-3.5" /> {uploading ? `Uploading ${uploadProgress}%` : "Upload document"}
                    <input type="file" className="sr-only" accept=".pdf,.txt,.md,.csv,.docx,.json,.jsonl" disabled={uploading} onChange={(event) => { void handleUpload(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
                  </label>
                </div>
                {uploading && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary-100"><div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
              </div>


              <div className="mt-6 rounded-2xl border border-secondary-200 bg-secondary-50/60 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-secondary-500">After approval</p><h3 className="mt-1 font-sans text-base font-extrabold text-secondary-900">Monitoring</h3><p className="mt-1 text-xs text-secondary-600">Update current values as implementation progresses. Progress is calculated from the approved baseline and target.</p></div><div className="inline-flex items-center gap-2 text-primary-600"><Activity className="size-4" /><span className="text-xs font-bold capitalize">{monitoring?.overall_status.replaceAll("_", " ") ?? "loading"}</span></div></div>
                {monitoring?.indicators.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="border-b border-secondary-200 text-secondary-500"><tr><th className="px-2 py-2 font-semibold">Indicator</th><th className="px-2 py-2 font-semibold">Baseline</th><th className="px-2 py-2 font-semibold">Target</th><th className="px-2 py-2 font-semibold">Current</th><th className="px-2 py-2 font-semibold">Progress</th><th className="px-2 py-2 font-semibold">Status</th></tr></thead><tbody>{monitoring.indicators.map((row) => { const indicator = indicators.find((item) => item.id === row.indicator_id); return <tr key={row.indicator_id} className="border-b border-secondary-100"><td className="px-2 py-2 font-semibold text-secondary-700">{row.name}<span className="ml-1 font-normal text-secondary-400">({row.unit})</span></td><td className="px-2 py-2 text-secondary-500">{row.baseline_value ?? "—"}</td><td className="px-2 py-2 text-secondary-500">{row.target_value ?? "—"}</td><td className="px-2 py-2"><input aria-label={`Current ${row.name}`} type="number" defaultValue={row.current_value ?? ""} onBlur={(event) => indicator && void handleMonitoringUpdate(indicator, event.currentTarget.value)} className="w-24 rounded-md border border-secondary-200 bg-white px-2 py-1 text-xs outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100" /></td><td className="px-2 py-2 font-semibold text-primary-700">{row.progress_percent === null ? "—" : `${Math.round(row.progress_percent)}%`}</td><td className="px-2 py-2"><Badge variant={row.status === "on_target" ? "success" : row.status === "off_track" ? "error" : "secondary"}>{row.status.replaceAll("_", " ")}</Badge></td></tr>; })}</tbody></table></div> : <p className="mt-4 rounded-xl bg-white px-3 py-3 text-xs text-secondary-500">Approve indicators and targets to begin monitoring this case.</p>}
              </div>

              <div className="mt-6 border-t border-secondary-100 pt-5"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-sans text-sm font-bold text-secondary-800">Evidence sources</h3><p className="mt-1 text-xs text-secondary-500">Link uploaded documents to this case before diagnosis.</p></div><FileText className="size-5 text-primary-400" /></div><div className="flex flex-col gap-2 sm:flex-row"><select value={selectedDocument} onChange={(event) => setSelectedDocument(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"><option value="">Select an indexed source…</option>{availableEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} ({entry.source_type})</option>)}</select><Button size="sm" onClick={() => void handleLinkSource()} disabled={!selectedDocument} loading={linking}>Link source</Button></div>{current.sources.length > 0 && <div className="mt-3 space-y-2">{current.sources.map((source) => <div key={source.id} className="flex items-center justify-between rounded-lg bg-secondary-50 px-3 py-2 text-xs"><span className="truncate font-medium text-secondary-700">{entries.find((entry) => entry.id === source.document_id)?.title ?? source.document_id}</span><Badge variant="secondary">{source.source_role}</Badge></div>)}</div>}</div>

              <div className="mt-6 border-t border-secondary-100 pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <div><h3 className="font-sans text-sm font-bold text-secondary-800">Indicators and diagnosis</h3><p className="mt-1 text-xs text-secondary-500">Review the current indicator state and evidence quality. Ask DC-TIM in Chat when this needs to change.</p></div>
                  <Badge variant={diagnosis?.evidence_status === "sufficient" ? "success" : "secondary"}>{diagnosis?.evidence_status ?? "loading"}</Badge>
                </div>
                {diagnosis && <p className="mb-4 rounded-lg bg-secondary-50 px-3 py-2 text-xs leading-relaxed text-secondary-600">{diagnosis.summary}</p>}
                {indicators.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-secondary-100 text-secondary-500"><tr><th className="px-2 py-2 font-semibold">Indicator</th><th className="px-2 py-2 font-semibold">Unit</th><th className="px-2 py-2 font-semibold">Baseline</th><th className="px-2 py-2 font-semibold">Target</th><th className="px-2 py-2 font-semibold">Quality</th></tr></thead><tbody>{indicators.map((indicator) => <tr key={indicator.id} className="border-b border-secondary-50"><td className="px-2 py-2 font-semibold text-secondary-700">{indicator.name}</td><td className="px-2 py-2 text-secondary-500">{indicator.unit}</td><td className="px-2 py-2 text-secondary-500">{indicator.baseline_value ?? "—"}</td><td className="px-2 py-2 text-secondary-500">{indicator.target_value ?? "—"}</td><td className="px-2 py-2"><Badge variant="secondary">{indicator.quality_status}</Badge></td></tr>)}</tbody></table></div> : <p className="rounded-lg bg-secondary-50 px-3 py-3 text-xs text-secondary-500">No indicators have been approved for this case yet. Use Chat to ask DC-TIM to prepare them.</p>}
                {diagnosis && diagnosis.evidence_gaps.length > 0 && <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800"><strong>Evidence gaps:</strong> {diagnosis.evidence_gaps.join(" ")}</div>}
              </div>

              {interventions.length > 0 && <div className="mt-6 border-t border-secondary-100 pt-5"><div className="mb-3"><h3 className="font-sans text-sm font-bold text-secondary-800">Approved action options</h3><p className="mt-1 text-xs text-secondary-500">Approved interventions are shown here for review. Use Chat to propose the next option.</p></div><div className="space-y-2">{interventions.map((item) => <div key={item.id} className="rounded-lg border border-secondary-100 bg-secondary-50/60 px-3 py-2"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-secondary-800">{item.name}</span><Badge variant={item.status === "approved" ? "success" : "secondary"}>{item.status}</Badge><Badge variant="secondary">{item.priority}</Badge></div><p className="mt-1 text-xs text-secondary-500">{item.expected_impact}</p></div>)}</div></div>}
            </Card> : <Card><div className="flex min-h-72 flex-col items-center justify-center text-center"><Compass className="mb-3 size-10 text-primary-300" /><h2 className="font-sans text-lg font-bold text-secondary-800">Create the first settlement case</h2><p className="mt-1 max-w-sm text-sm text-secondary-500">Use the National Land-Use and Development Master Plan as an evidence source for the pilot.</p><Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}><Plus className="size-4" /> Create case</Button></div></Card>}
          </div>
        )}
      </main>
    </AppLayout>
  );
}
