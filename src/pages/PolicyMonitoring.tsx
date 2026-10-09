import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Construction,
  GraduationCap,
  Hospital,
  Leaf,
  RefreshCw,
  Scale,
  TrendingUp,
} from "lucide-react";
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
import MarkdownContent from "../components/MarkdownContent";
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

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: {
  value: PolicyStatus;
  label: string;
  tone: "primary" | "success" | "error" | "secondary";
  color: string;
}[] = [
  { value: "created",           label: "Created",           tone: "secondary", color: "#94A3B8" },
  { value: "approved",          label: "Approved",          tone: "primary",   color: "#3B5BF6" },
  { value: "in_implementation", label: "In implementation", tone: "primary",   color: "#7C3AED" },
  { value: "monitoring",        label: "Monitoring",        tone: "primary",   color: "#0D9488" },
  { value: "completed",         label: "Completed",         tone: "success",   color: "#2E8B40" },
  { value: "on_hold",           label: "On hold",           tone: "error",     color: "#C0392B" },
];

type DetailTab = "overview" | "charts" | "briefing";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: PolicyStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "Created";
}

function statusTone(status: PolicyStatus) {
  return STATUS_OPTIONS.find((o) => o.value === status)?.tone ?? "secondary";
}

function policyIcon(category: string): ReactNode {
  const v = category.toLowerCase();
  if (/educ|school|teacher/.test(v)) return <GraduationCap className="size-4.5" />;
  if (/health|medical/.test(v))       return <Hospital       className="size-4.5" />;
  if (/econom|trade|growth/.test(v))  return <TrendingUp     className="size-4.5" />;
  if (/infra|road|water|energy/.test(v)) return <Construction className="size-4.5" />;
  if (/govern|law|corrupt/.test(v))   return <Scale          className="size-4.5" />;
  if (/environ|climate|forest/.test(v)) return <Leaf         className="size-4.5" />;
  return <ClipboardList className="size-4.5" />;
}

function errorMessage(error: unknown): string {
  if (error instanceof RagApiError || error instanceof Error) return error.message;
  return "Could not reach the backend.";
}

function buildMonitorPrompt(policy: PolicyArtifact): string {
  const instructions = [
    `Prepare an evidence-grounded implementation monitoring briefing for the policy "${policy.title}" (${policy.category}).`,
    `The policy's current workflow status is ${statusLabel(policy.status)}. Treat this as workflow metadata, not proof of implementation progress.`,
    "Use only retrieved workspace evidence to report implementation progress, relevant indicators, risks or bottlenecks, and recommended monitoring or corrective actions. Clearly say when evidence does not establish progress.",
    "Policy text:",
  ].join("\n\n");
  const maxLen = 4000;
  const textLen = Math.max(0, maxLen - instructions.length - 2);
  return `${instructions}\n\n${policy.content.slice(0, textLen)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [open, setOpen] = useState(false);
  const preview = citation.text.length > 240 ? `${citation.text.slice(0, 240)}…` : citation.text;
  return (
    <div className="rounded-xl border border-secondary-100 bg-secondary-50/60 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-secondary-800 font-sans leading-snug">
            [{index + 1}] {citation.title || "Untitled source"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{citation.source_type}</Badge>
            <span className="inline-flex items-center rounded-md bg-primary-50 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-primary-700">
              {Math.round(citation.score * 100)}% match
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg p-1 text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 transition-colors"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {open && (
        <p className="mt-2.5 text-xs leading-relaxed text-secondary-600 font-sans whitespace-pre-wrap border-t border-secondary-100 pt-2.5">
          {citation.text}
        </p>
      )}
      {!open && (
        <p className="mt-2 text-xs leading-relaxed text-secondary-500 font-sans">{preview}</p>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-3.5 py-2 rounded-lg font-sans text-xs font-semibold transition-colors",
        active
          ? "bg-primary-500 text-white shadow-sm"
          : "text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ─── Policy detail panel ──────────────────────────────────────────────────────

function PolicyDetail({
  current,
  aiLoading,
  aiError,
  analysis,
  statusSaving,
  onChangeStatus,
  onRunAnalysis,
  onDismissError,
}: {
  current: PolicyArtifact;
  aiLoading: boolean;
  aiError: string | null;
  analysis: QueryResult | null;
  statusSaving: boolean;
  onChangeStatus: (status: PolicyStatus) => void;
  onRunAnalysis: () => void;
  onDismissError: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [showFullPolicy, setShowFullPolicy] = useState(false);

  const projectedMetrics = useMemo(
    () =>
      (current.analysis?.metrics ?? [])
        .filter((m) => m.change_percent !== null)
        .map((m) => ({ label: m.label, change: m.change_percent as number })),
    [current],
  );
  const dimensions = useMemo(
    () =>
      (current.analysis?.dimensions ?? []).map((d) => ({
        label: d.label,
        score: Math.round(d.score * 100),
      })),
    [current],
  );

  const hasCharts = projectedMetrics.length > 0 || dimensions.length > 0;
  const TRUNCATE_AT = 600;
  const policyText = current.content;
  const isLong = policyText.length > TRUNCATE_AT;
  const displayedText = isLong && !showFullPolicy ? `${policyText.slice(0, TRUNCATE_AT)}…` : policyText;

  return (
    <div className="flex min-w-0 flex-col">
      {/* ── Header card ── */}
      <Card className="mb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-xl bg-primary-50 p-2.5 text-primary-500">
              {policyIcon(current.category)}
            </span>
            <div className="min-w-0">
              <h2 className="font-sans text-lg font-extrabold leading-snug text-secondary-900">
                {current.title}
              </h2>
              <p className="mt-0.5 font-sans text-xs text-secondary-500">
                {current.category} · Rev {current.revision} · Updated {formatDate(current.updated_at)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <label className="font-sans text-[10px] font-semibold uppercase tracking-wider text-secondary-500">
              Lifecycle status
            </label>
            <select
              value={current.status}
              disabled={statusSaving}
              onChange={(e) => onChangeStatus(e.target.value as PolicyStatus)}
              className="rounded-lg border border-secondary-200 bg-white px-3 py-1.5 font-sans text-sm text-secondary-800 shadow-xs focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* ── Tabs ── */}
      <div className="mb-4 flex justify-end">
        <Link
          to={`/digital-twin?policy=${encodeURIComponent(current.id)}`}
          state={{ policy: current, briefing: analysis }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 font-sans text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          Open {current.title} in Digital Twin <span aria-hidden="true">→</span>
        </Link>
      </div>      <div className="mb-4 flex items-center gap-1 rounded-xl border border-secondary-100 bg-secondary-50 p-1 w-fit">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
        <TabButton active={tab === "charts"} onClick={() => setTab("charts")}>
          Charts {!hasCharts && <span className="ml-1 opacity-50">·</span>}
        </TabButton>
        <TabButton active={tab === "briefing"} onClick={() => setTab("briefing")}>
          Briefing
          {aiLoading && (
            <span className="ml-1.5 inline-flex size-1.5 rounded-full bg-primary-400 animate-pulse" />
          )}
        </TabButton>
      </div>

      {/* ── Tab: Overview ── */}
      {tab === "overview" && (
        <Card>
          <h3 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wider text-secondary-500">
            Policy content
          </h3>
          <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary-700">
            {displayedText}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setShowFullPolicy((v) => !v)}
              className="mt-3 font-sans text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors"
            >
              {showFullPolicy ? "Show less ↑" : "Show full policy ↓"}
            </button>
          )}
        </Card>
      )}

      {/* ── Tab: Charts ── */}
      {tab === "charts" && (
        <>
          {!hasCharts ? (
            <Card className="flex flex-col items-center py-12 text-center">
              <p className="font-sans text-sm text-secondary-500">
                No optimization charts are saved for this policy yet.
              </p>
              <p className="mt-1 font-sans text-xs text-secondary-400">
                Run an optimization from the Dashboard to generate charts.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {dimensions.length > 0 && (
                <Card>
                  <h3 className="mb-4 font-sans text-sm font-semibold text-secondary-800">
                    Development dimensions
                  </h3>
                  <ResponsiveContainer width="100%" height={Math.max(200, dimensions.length * 40)}>
                    <BarChart data={dimensions} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${v}/100`, "Score"]} />
                      <Bar dataKey="score" name="Score" fill="#3B5BF6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
              {projectedMetrics.length > 0 && (
                <Card>
                  <h3 className="mb-4 font-sans text-sm font-semibold text-secondary-800">
                    Projected indicator change
                  </h3>
                  <ResponsiveContainer width="100%" height={Math.max(200, projectedMetrics.length * 40)}>
                    <BarChart data={projectedMetrics} layout="vertical" margin={{ left: 8, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${v}%`, "Projected change"]} />
                      <Bar dataKey="change" name="Projected change" radius={[0, 4, 4, 0]}>
                        {projectedMetrics.map((m) => (
                          <Cell key={m.label} fill={m.change >= 0 ? "#2E8B40" : "#C0392B"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Tab: Briefing ── */}
      {tab === "briefing" && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-sans text-sm font-bold text-secondary-900">
                Model implementation briefing
              </h3>
              <p className="mt-0.5 font-sans text-xs text-secondary-500">
                Evidence-grounded assessment retrieved from the Data Lake.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={aiLoading}
              onClick={onRunAnalysis}
            >
              {aiLoading ? (
                <span className="flex items-center gap-1.5">
                  <Spinner size="sm" /> Analyzing…
                </span>
              ) : (
                "Re-run"
              )}
            </Button>
          </div>

          {aiError && (
            <Alert
              variant="error"
              title="Model analysis unavailable"
              onClose={onDismissError}
              className="mb-4"
            >
              {aiError}
            </Alert>
          )}

          {aiLoading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Spinner size="lg" label="Searching Data Lake…" />
              <p className="font-sans text-sm text-secondary-500">
                Retrieving evidence for this policy…
              </p>
            </div>
          ) : analysis ? (
            <>
              {/* Markdown answer */}
              <div className="rounded-xl bg-secondary-50/60 px-4 py-4 border border-secondary-100">
                <MarkdownContent content={analysis.answer} />
              </div>

              {/* Metadata row */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {analysis.citations.length} evidence source
                  {analysis.citations.length === 1 ? "" : "s"}
                </Badge>
                {analysis.telemetry?.answer_model && (
                  <Badge variant="secondary">{MODEL_DISPLAY_NAME}</Badge>
                )}
              </div>

              {/* Citations — collapsible list */}
              {analysis.citations.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer font-sans text-xs font-semibold text-secondary-600 hover:text-secondary-900 transition-colors select-none">
                    Evidence sources ({analysis.citations.length})
                  </summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {analysis.citations.map((citation, i) => (
                      <CitationCard key={citation.chunk_id || i} citation={citation} index={i} />
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="font-sans text-sm text-secondary-500">
                No briefing yet for this policy.
              </p>
              <p className="mt-1 font-sans text-xs text-secondary-400">
                Analysis runs automatically when you select a policy.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PolicyMonitoring() {
  const { user } = useAuth();
  const [policies, setPolicies]           = useState<PolicyArtifactSummary[]>([]);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [current, setCurrent]             = useState<PolicyArtifact | null>(null);
  const [loading, setLoading]             = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusSaving, setStatusSaving]   = useState(false);
  const [loadError, setLoadError]         = useState<string | null>(null);
  const [aiError, setAiError]             = useState<string | null>(null);
  const [analysis, setAnalysis]           = useState<QueryResult | null>(null);
  const [aiLoading, setAiLoading]         = useState(false);
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

  const openPolicy = useCallback(
    async (id: string) => {
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
    },
    [runAnalysis],
  );

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
        const target = all.find((p) => p.id === selectedIdRef.current) ?? all[0];
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
    () =>
      Object.fromEntries(
        STATUS_OPTIONS.map(({ value }) => [
          value,
          policies.filter((p) => p.status === value).length,
        ]),
      ) as Record<PolicyStatus, number>,
    [policies],
  );

  const lifecycleData = useMemo(
    () => STATUS_OPTIONS.map((o) => ({ stage: o.label, policies: statusCounts[o.value], color: o.color })),
    [statusCounts],
  );

  async function changeStatus(status: PolicyStatus) {
    if (!current || current.status === status) return;
    setStatusSaving(true);
    setLoadError(null);
    try {
      const updated = await updatePolicyArtifact(current.id, { status });
      setCurrent(updated);
      setPolicies((items) =>
        items.map((p) =>
          p.id === updated.id ? { ...p, status: updated.status, updated_at: updated.updated_at } : p,
        ),
      );
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <AppLayout>
      <div className="flex-1 py-8">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">

          {/* ── Page header ── */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="mb-1 font-sans text-xs font-semibold uppercase tracking-widest text-secondary-500">
                Policy lifecycle
              </p>
              <h1 className="font-sans text-2xl font-extrabold text-secondary-900">
                Policy Monitoring
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-xl border border-secondary-200 bg-white px-3 py-1.5 font-sans text-xs text-secondary-500">
                <span className="size-1.5 rounded-full bg-success-500" />
                Workspace {user?.workspace_id ?? "unknown"}
              </span>
              <button
                type="button"
                onClick={() => void loadPolicies()}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-xl border border-secondary-200 bg-white px-3 py-1.5 font-sans text-xs font-semibold text-secondary-600 hover:border-secondary-300 hover:text-secondary-900 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={["size-3.5", loading ? "animate-spin" : ""].join(" ")} />
                Refresh
              </button>
            </div>
          </div>

          {loadError && (
            <Alert
              variant="error"
              title="Could not load policies"
              onClose={() => setLoadError(null)}
              className="mb-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span>{loadError}</span>
                <Button size="sm" variant="secondary" onClick={() => void loadPolicies()}>
                  Try again
                </Button>
              </div>
            </Alert>
          )}

          {loading ? (
            <div className="flex justify-center py-24">
              <Spinner size="lg" label="Loading policies…" />
            </div>
          ) : policies.length === 0 ? (
            <Card className="flex flex-col items-center py-16 text-center">
              <ClipboardList className="mb-3 size-9 text-secondary-300" />
              <h2 className="font-sans text-base font-bold text-secondary-800">
                No saved policies yet
              </h2>
              <p className="mt-2 max-w-md font-sans text-sm text-secondary-500">
                Create a policy from the Dashboard. It will appear here once saved.
              </p>
              <Link to="/dashboard" className="mt-5">
                <Button size="sm">Go to Dashboard</Button>
              </Link>
            </Card>
          ) : (
            <>
              {/* ── Status pill strip + mini lifecycle chart ── */}
              <div className="mb-5 flex flex-wrap items-stretch gap-3">
                {/* Status counters */}
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((o) => (
                    <div
                      key={o.value}
                      className="flex items-center gap-2 rounded-xl border border-secondary-100 bg-white px-3 py-2 shadow-xs"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: o.color }}
                      />
                      <span className="font-sans text-xs text-secondary-500">{o.label}</span>
                      <span className="font-sans text-sm font-extrabold text-secondary-900">
                        {statusCounts[o.value]}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Compact lifecycle bar */}
                <Card className="flex-1 min-w-[260px] py-3">
                  <ResponsiveContainer width="100%" height={64}>
                    <BarChart data={lifecycleData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                      <XAxis dataKey="stage" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        formatter={(v) => [v, "Policies"]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="policies" name="Policies" radius={[3, 3, 0, 0]}>
                        {lifecycleData.map((d) => (
                          <Cell key={d.stage} fill={d.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              {/* ── Main two-column split ── */}
              <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">

                {/* Policy list */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-1">
                    <p className="font-sans text-xs font-semibold text-secondary-500">
                      {policies.length} polic{policies.length === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {policies.map((policy) => (
                      <button
                        key={policy.id}
                        type="button"
                        onClick={() => void openPolicy(policy.id)}
                        className={[
                          "w-full rounded-xl border p-3 text-left transition-all",
                          selectedId === policy.id
                            ? "border-primary-300 bg-primary-50 shadow-sm"
                            : "border-secondary-100 bg-white hover:border-secondary-200 hover:bg-secondary-50",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={[
                              "mt-0.5 shrink-0 rounded-lg p-1.5",
                              selectedId === policy.id
                                ? "bg-primary-100 text-primary-600"
                                : "bg-secondary-100 text-secondary-500",
                            ].join(" ")}
                          >
                            {policyIcon(policy.category)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-sans text-xs font-semibold text-secondary-800">
                              {policy.title}
                            </span>
                            <span className="mt-0.5 block font-sans text-[11px] text-secondary-400">
                              {policy.category}
                            </span>
                            <span className="mt-1.5 inline-flex">
                              <Badge variant={statusTone(policy.status)}>
                                {statusLabel(policy.status)}
                              </Badge>
                            </span>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Detail panel */}
                {detailLoading || !current ? (
                  <Card className="flex items-center justify-center py-20">
                    <Spinner size="lg" label="Loading policy…" />
                  </Card>
                ) : (
                  <PolicyDetail
                    current={current}
                    aiLoading={aiLoading}
                    aiError={aiError}
                    analysis={analysis}
                    statusSaving={statusSaving}
                    onChangeStatus={(s) => void changeStatus(s)}
                    onRunAnalysis={() => void runAnalysis(current)}
                    onDismissError={() => setAiError(null)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
