import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Alert from "../components/Alert";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import {
  getPolicyArtifact,
  listPolicyArtifacts,
  MODEL_DISPLAY_NAME,
  queryRag,
  RagApiError,
  updatePolicyArtifact,
  type Citation,
  type PolicyArtifact,
  type PolicyArtifactSummary,
  type PolicyStatus,
  type QueryResult,
} from "../lib/ragApi";

const STATUS_OPTIONS: { value: PolicyStatus; label: string; tone: "primary" | "success" | "error" | "secondary" }[] = [
  { value: "created", label: "Created", tone: "secondary" },
  { value: "approved", label: "Approved", tone: "primary" },
  { value: "in_implementation", label: "In implementation", tone: "primary" },
  { value: "monitoring", label: "Monitoring", tone: "primary" },
  { value: "completed", label: "Completed", tone: "success" },
  { value: "on_hold", label: "On hold", tone: "error" },
];

function statusLabel(status: PolicyStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Created";
}

function policyIcon(category: string): string {
  const value = category.toLowerCase();
  if (/educ|school|teacher/.test(value)) return "🎓";
  if (/health|medical/.test(value)) return "🏥";
  if (/econom|trade|growth/.test(value)) return "📈";
  if (/infra|road|water|energy/.test(value)) return "🏗️";
  if (/govern|law|corrupt/.test(value)) return "⚖️";
  if (/environ|climate|forest/.test(value)) return "🌿";
  return "📋";
}

function errorMessage(error: unknown): string {
  if (error instanceof RagApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Could not reach the backend.";
}

function buildMonitorPrompt(policy: PolicyArtifact): string {
  const instructions = [
    `Prepare an evidence-grounded implementation monitoring briefing for the policy "${policy.title}" (${policy.category}).`,
    `The policy's current workflow status is ${statusLabel(policy.status)}. Treat this as workflow metadata, not proof of implementation progress.`,
    "Use only retrieved workspace evidence to report implementation progress, relevant indicators, risks or bottlenecks, and recommended monitoring or corrective actions. Clearly say when evidence does not establish progress.",
    "Policy text:",
  ].join("\n\n");
  const separator = "\n\n";
  const maxQueryLength = 4000;
  const policyTextLength = Math.max(0, maxQueryLength - instructions.length - separator.length);
  return `${instructions}${separator}${policy.content.slice(0, policyTextLength)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="rounded-xl border border-secondary-100 bg-secondary-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-secondary-800 font-sans">{citation.title || "Untitled source"}</p>
        <Badge variant="secondary">{citation.source_type}</Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-secondary-600 font-sans whitespace-pre-wrap">
        {citation.text.length > 360 ? `${citation.text.slice(0, 360)}…` : citation.text}
      </p>
      <p className="mt-2 text-xs font-semibold text-secondary-400 font-sans">{Math.round(citation.score * 100)}% match</p>
    </div>
  );
}

export default function PolicyMonitoring() {
  const { user } = useAuth();
  const [policies, setPolicies] = useState<PolicyArtifactSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<PolicyArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<QueryResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const selectedIdRef = useRef<string | null>(null);

  const runAnalysis = useCallback(async (policy: PolicyArtifact) => {
    setAiLoading(true);
    setAiError(null);
    setAnalysis(null);
    try {
      setAnalysis(await queryRag(buildMonitorPrompt(policy), 6));
    } catch (error) {
      setAiError(errorMessage(error));
    } finally {
      setAiLoading(false);
    }
  }, []);

  const openPolicy = useCallback(async (id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setDetailLoading(true);
    setAiError(null);
    setAnalysis(null);
    try {
      const policy = await getPolicyArtifact(id);
      if (selectedIdRef.current !== id) return;
      setCurrent(policy);
      void runAnalysis(policy);
    } catch (error) {
      if (selectedIdRef.current === id) setLoadError(errorMessage(error));
    } finally {
      if (selectedIdRef.current === id) setDetailLoading(false);
    }
  }, [runAnalysis]);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const all: PolicyArtifactSummary[] = [];
      let offset = 0;
      let total = 0;
      while (all.length === 0 || all.length < total) {
        const page = await listPolicyArtifacts({ limit: 200, offset });
        if (page.policies.length === 0) break;
        all.push(...page.policies);
        total = page.total;
        offset += page.policies.length;
      }
      setPolicies(all);
      if (all.length === 0) {
        selectedIdRef.current = null;
        setSelectedId(null);
        setCurrent(null);
      } else {
        const target = all.find((policy) => policy.id === selectedIdRef.current) ?? all[0];
        void openPolicy(target.id);
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [openPolicy]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPolicies(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPolicies]);

  const statusCounts = useMemo(
    () => Object.fromEntries(STATUS_OPTIONS.map(({ value }) => [value, policies.filter((policy) => policy.status === value).length])) as Record<PolicyStatus, number>,
    [policies]
  );
  const lifecycleData = useMemo(
    () => STATUS_OPTIONS.map((option) => ({ stage: option.label, policies: statusCounts[option.value] })),
    [statusCounts]
  );
  const projectedMetrics = useMemo(
    () => (current?.analysis?.metrics ?? [])
      .filter((metric) => metric.change_percent !== null)
      .map((metric) => ({ label: metric.label, change: metric.change_percent as number })),
    [current]
  );
  const dimensions = useMemo(
    () => (current?.analysis?.dimensions ?? [])
      .map((dimension) => ({ label: dimension.label, score: Math.round(dimension.score * 100) })),
    [current]
  );

  async function changeStatus(status: PolicyStatus) {
    if (!current || current.status === status) return;
    setStatusSaving(true);
    setLoadError(null);
    try {
      const updated = await updatePolicyArtifact(current.id, { status });
      setCurrent(updated);
      setPolicies((items) => items.map((policy) => policy.id === updated.id ? { ...policy, status: updated.status, updated_at: updated.updated_at } : policy));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <AppLayout>
      <div className="flex-1 pt-10 pb-0">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-secondary-500 font-sans">Policy lifecycle</p>
              <h1 className="text-3xl font-extrabold text-secondary-900 font-sans">Policy Monitoring</h1>
              <p className="mt-1 text-secondary-500 font-sans">Track saved policies through approval, implementation, monitoring, and completion.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-secondary-500 font-sans bg-white border border-secondary-200 rounded-xl px-3 py-2 w-fit">
              <span className="size-2 rounded-full bg-success-500" /> Workspace {user?.workspace_id ?? "unknown"}
            </div>
          </div>

          {loadError && (
            <Alert variant="error" title="Could not load policies" onClose={() => setLoadError(null)} className="mb-6">
              <div className="flex flex-wrap items-center gap-3"><span>{loadError}</span><Button size="sm" variant="secondary" onClick={() => void loadPolicies()}>Try again</Button></div>
            </Alert>
          )}

          {loading ? (
            <div className="flex justify-center py-24"><Spinner size="lg" label="Loading policies…" /></div>
          ) : policies.length === 0 ? (
            <Card className="flex flex-col items-center py-16 text-center">
              <span className="mb-3 text-4xl">📋</span>
              <h2 className="text-base font-bold text-secondary-800 font-sans">No saved policies yet</h2>
              <p className="mt-2 max-w-md text-sm text-secondary-500 font-sans">Create a policy from the Dashboard. It will appear here with the status Created. Documents and knowledge in the Data Lake are used as evidence for model analysis.</p>
              <Link to="/dashboard" className="mt-5"><Button variant="primary" size="sm">Go to Dashboard</Button></Link>
            </Card>
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {STATUS_OPTIONS.map((option) => (
                  <Card key={option.value} className="p-4">
                    <p className="text-xs text-secondary-500 font-sans">{option.label}</p>
                    <p className="mt-1 text-2xl font-extrabold text-secondary-900 font-sans">{statusCounts[option.value]}</p>
                  </Card>
                ))}
              </div>

              <Card className="mb-6">
                <h2 className="text-sm font-bold text-secondary-900 font-sans">Policies by lifecycle stage</h2>
                <p className="mt-1 text-xs text-secondary-500 font-sans">Counts reflect the current status saved on each policy.</p>
                <div className="mt-4 h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={lifecycleData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="stage" tick={{ fontSize: 11 }} interval={0} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="policies" name="Policies" fill="#3B5BF6" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)]">
                <Card className="h-fit">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-secondary-900 font-sans">Saved policies</h2>
                    <Button size="sm" variant="ghost" onClick={() => void loadPolicies()}>Refresh</Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {policies.map((policy) => (
                      <button key={policy.id} type="button" onClick={() => void openPolicy(policy.id)} className={`rounded-xl border p-3 text-left transition-colors ${selectedId === policy.id ? "border-primary-300 bg-primary-50" : "border-secondary-100 hover:bg-secondary-50"}`}>
                        <div className="flex items-start gap-3">
                          <span className="text-xl">{policyIcon(policy.category)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-secondary-800 font-sans">{policy.title}</span>
                            <span className="mt-1 block text-xs text-secondary-500 font-sans">{policy.category}</span>
                            <span className="mt-2 inline-flex"><Badge variant={STATUS_OPTIONS.find((option) => option.value === policy.status)?.tone ?? "secondary"}>{statusLabel(policy.status)}</Badge></span>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>

                <div className="flex min-w-0 flex-col gap-6">
                  {detailLoading || !current ? (
                    <Card className="flex justify-center py-16"><Spinner label="Loading policy…" /></Card>
                  ) : (
                    <>
                      <Card>
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 gap-3">
                            <span className="text-3xl">{policyIcon(current.category)}</span>
                            <div className="min-w-0">
                              <h2 className="text-xl font-bold text-secondary-900 font-sans">{current.title}</h2>
                              <p className="mt-1 text-sm text-secondary-500 font-sans">{current.category} · Created {formatDate(current.created_at)}</p>
                            </div>
                          </div>
                          <label className="flex shrink-0 flex-col gap-1 text-xs font-semibold text-secondary-500 font-sans">
                            Lifecycle status
                            <select value={current.status} disabled={statusSaving} onChange={(event) => void changeStatus(event.target.value as PolicyStatus)} className="rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm text-secondary-800">
                              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="mt-5 border-t border-secondary-100 pt-4">
                          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary-500 font-sans">Policy</h3>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-secondary-700 font-sans">{current.content.length > 2400 ? `${current.content.slice(0, 2400)}…` : current.content}</p>
                        </div>
                      </Card>

                      {(projectedMetrics.length > 0 || dimensions.length > 0) && (
                        <section>
                          <div className="mb-3">
                            <h2 className="text-sm font-bold text-secondary-900 font-sans">Saved optimization charts</h2>
                            <p className="mt-1 text-xs text-secondary-500 font-sans">Model projections from the latest saved model optimization, not measured implementation results.</p>
                          </div>
                          <div className="grid gap-6 xl:grid-cols-2">
                            {dimensions.length > 0 && (
                              <Card>
                                <h3 className="mb-4 text-sm font-semibold text-secondary-800 font-sans">Development dimensions</h3>
                                <ResponsiveContainer width="100%" height={Math.max(220, dimensions.length * 44)}>
                                  <BarChart data={dimensions} layout="vertical" margin={{ left: 8, right: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" domain={[0, 100]} />
                                    <YAxis type="category" dataKey="label" width={125} tick={{ fontSize: 11 }} />
                                    <Tooltip formatter={(value) => [`${value}/100`, "Score"]} />
                                    <Bar dataKey="score" name="Score" fill="#3B5BF6" radius={[0, 4, 4, 0]} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </Card>
                            )}
                            {projectedMetrics.length > 0 && (
                              <Card>
                                <h3 className="mb-4 text-sm font-semibold text-secondary-800 font-sans">Projected indicator change</h3>
                                <ResponsiveContainer width="100%" height={Math.max(220, projectedMetrics.length * 44)}>
                                  <BarChart data={projectedMetrics} layout="vertical" margin={{ left: 8, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" unit="%" />
                                    <YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 11 }} />
                                    <Tooltip formatter={(value) => [`${value}%`, "Projected change"]} />
                                    <Bar dataKey="change" name="Projected change" radius={[0, 4, 4, 0]}>
                                      {projectedMetrics.map((metric) => <Cell key={metric.label} fill={metric.change >= 0 ? "#2E8B40" : "#C0392B"} />)}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </Card>
                            )}
                          </div>
                        </section>
                      )}

                      <Card>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-sm font-bold text-secondary-900 font-sans">Model implementation briefing</h2>
                            <p className="mt-1 text-xs text-secondary-500 font-sans">Uses retrieved Data Lake evidence to assess this saved policy.</p>
                          </div>
                          <Button size="sm" variant="secondary" disabled={aiLoading} onClick={() => void runAnalysis(current)}>{aiLoading ? "Analyzing…" : "Run analysis"}</Button>
                        </div>
                        {aiError && <Alert variant="error" title="Model analysis unavailable" onClose={() => setAiError(null)}>{aiError}</Alert>}
                        {aiLoading ? (
                          <div className="flex items-center gap-3 py-10"><Spinner label="Analyzing evidence…" /><p className="text-sm text-secondary-500 font-sans">Searching the Data Lake for evidence about this policy.</p></div>
                        ) : analysis ? (
                          <>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-secondary-700 font-sans">{analysis.answer}</p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Badge variant="secondary">{analysis.citations.length} evidence source{analysis.citations.length === 1 ? "" : "s"}</Badge>
                              {analysis.telemetry?.answer_model && <Badge variant="secondary">{MODEL_DISPLAY_NAME}</Badge>}
                            </div>
                            {analysis.citations.length > 0 && (
                              <div className="mt-5 border-t border-secondary-100 pt-4">
                                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-secondary-500 font-sans">Evidence used by the model</h3>
                                <div className="flex flex-col gap-3">{analysis.citations.map((citation, index) => <CitationCard key={citation.chunk_id || index} citation={citation} />)}</div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="py-8 text-center text-sm text-secondary-500 font-sans">Run an analysis to retrieve evidence related to this policy.</p>
                        )}
                      </Card>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
