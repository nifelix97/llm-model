import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, FileText, History, Layers, LayoutGrid, Plus, Target, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
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
import { clearAnalysis, loadAnalysis, type AnalysisPayload } from "../context/AnalysisContext";
import { useAuth } from "../context/AuthContext";
import {
  analyzePolicy,
  createPolicyArtifact,
  getPolicyArtifact,
  listPolicyArtifacts,
  MODEL_DISPLAY_NAME,
  queryRag,
  updatePolicyArtifact,
  RagApiError,
  type Citation,
  type PolicyAnalysisResult,
  type PolicyArtifact,
  type PolicyArtifactSummary,
  type PolicyRecommendation,
  type PolicyRisk,
} from "../lib/ragApi";

const C = {
  primary: "#3B5BF6",
  primarySoft: "#B3C0FB",
  success: "#2E8B40",
  error: "#C0392B",
  amber: "#D97706",
  teal: "#0D9488",
  violet: "#7C3AED",
  slate: "#CBD5E1",
};

const MAX_POLICY_QUERY_LENGTH = 3900;
const MAX_POLICY_ANALYSIS_CONTENT = 2800;

interface AnalysisSeed {
  payload: AnalysisPayload | null;
  request: { query: string; attempt: number } | null;
  error: string | null;
}

interface DetailRequest {
  policy: PolicyArtifact;
  query: string | null;
  attempt: number;
  storedAnalysis: PolicyAnalysisResult | null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatPercent(value: number | null, fallback = "Not available"): string {
  return value === null ? fallback : `${Math.round(value * 100)}%`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof RagApiError || error instanceof Error) return error.message;
  return fallback;
}

function hasGroundedAnswer(response: { answer: string; citations: Citation[] }): boolean {
  return response.answer.trim().length > 0 && response.citations.length > 0;
}

function isStoredAnalysis(value: unknown): value is PolicyAnalysisResult {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Partial<PolicyAnalysisResult>;
  return typeof analysis.policy_name === "string"
    && typeof analysis.summary === "string"
    && typeof analysis.evidence_status === "string"
    && typeof analysis.confidence === "number"
    && typeof analysis.feasibility === "object"
    && analysis.feasibility !== null
    && typeof analysis.likelihood === "object"
    && analysis.likelihood !== null
    && Array.isArray(analysis.risks)
    && Array.isArray(analysis.recommendations)
    && Array.isArray(analysis.metrics)
    && Array.isArray(analysis.dimensions)
    && Array.isArray(analysis.phases)
    && Array.isArray(analysis.uncertainties)
    && Array.isArray(analysis.next_steps)
    && Array.isArray(analysis.citations)
    && typeof analysis.trace_id === "string"
    && typeof analysis.generated_at === "string"
    && typeof analysis.provider === "string"
    && typeof analysis.model === "string";
}

function limitPrompt(prompt: string, maxLength = MAX_POLICY_QUERY_LENGTH): string {
  return prompt.length > maxLength ? `${prompt.slice(0, maxLength - 1)}…` : prompt;
}

function buildPolicyPrompt(policy: PolicyArtifact): string | null {
  const content = policy.content.trim();
  if (content.length > MAX_POLICY_ANALYSIS_CONTENT) return null;
  const prompt = `Analyze the implementation of the saved policy artifact named "${policy.title}" in the ${policy.category} category. Treat the policy content below as the policy being assessed, not as a training document. Use retrieved workspace evidence to evaluate feasibility, likelihood, numeric indicators, dimensions, implementation phases, risks, recommendations, uncertainties, next steps, and citations. Distinguish evidence from projections and leave unsupported values unavailable.\n\nSaved policy content:\n${content}`;
  return prompt.length <= MAX_POLICY_QUERY_LENGTH ? prompt : null;
}

function policyPayload(policy: PolicyArtifact, query: string, workspaceId: string): AnalysisPayload {
  return {
    prompt: query,
    response: `Selected policy artifact: ${policy.title}`,
    category: policy.category,
    timestamp: Date.now(),
    workspace_id: workspaceId,
  };
}

function policyActionPrompt(result: PolicyAnalysisResult): string {
  const recommendations = result.recommendations
    .slice(0, 6)
    .map((recommendation) => `- ${recommendation.title}: ${recommendation.detail}`)
    .join("\n");
  const context = [
    `Policy: ${result.policy_name}`,
    `Category: ${result.category}`,
    `Summary: ${result.summary}`,
    recommendations ? `Current recommendations:\n${recommendations}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return limitPrompt(
    `Create a practical policy based on the analysis below. Include the policy objective, target outcomes, implementation phases, measurable indicators, key risks and mitigations, and a monitoring plan. Use the workspace evidence as the basis and clearly label assumptions.\n\n${context}`,
  );
}

function policyRevisionPrompt(result: PolicyAnalysisResult, currentDraft: string, changeRequest: string): string | null {
  const requestedChange = limitPrompt(changeRequest, 900);
  if (currentDraft.length > MAX_POLICY_QUERY_LENGTH) return null;
  const prompt = `Revise the policy draft below according to the user's requested change. Preserve the parts that are not affected, explain the impact of the change, and return a complete updated policy draft.\n\nPolicy analysis:\nPolicy: ${result.policy_name}\nCategory: ${result.category}\nSummary: ${limitPrompt(result.summary, 700)}\n\nCurrent policy draft:\n${currentDraft}\n\nRequested change:\n${requestedChange}`;
  return prompt.length <= MAX_POLICY_QUERY_LENGTH ? prompt : null;
}

function readAnalysisSeed(workspaceId: string | null | undefined): AnalysisSeed {
  const payload = loadAnalysis(workspaceId);
  if (!payload) return { payload: null, request: null, error: null };
  const query = payload.prompt.trim() || payload.response.trim();
  return {
    payload,
    request: query ? { query, attempt: 0 } : null,
    error: query ? null : "The selected prompt did not contain a question to analyze.",
  };
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-secondary-700 bg-secondary-900 px-3 py-2 shadow-xl">
      {label && <p className="mb-1 font-sans text-xs text-secondary-400">{label}</p>}
      {payload.map((item) => (
        <p key={item.name} className="font-sans text-xs font-semibold" style={{ color: item.color ?? C.primary }}>
          {item.name}: <span className="text-white">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

function ChartCard({ title, subtitle, badge, children }: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-sans text-sm font-bold text-secondary-900">{title}</h3>
          {subtitle && <p className="mt-0.5 font-sans text-xs text-secondary-500">{subtitle}</p>}
        </div>
        {badge && <Badge variant="primary" className="shrink-0">{badge}</Badge>}
      </div>
      {children}
    </Card>
  );
}

function StatCard({ label, value, sub, icon }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <Card className="flex items-center gap-4">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-500">{icon}</div>
      <div className="min-w-0">
        <p className="font-sans text-xs font-semibold uppercase tracking-wider text-secondary-500">{label}</p>
        <p className="font-sans text-2xl font-extrabold text-secondary-900">{value}</p>
        {sub && <p className="mt-0.5 truncate font-sans text-xs text-secondary-400">{sub}</p>}
      </div>
    </Card>
  );
}

function riskVariant(severity: PolicyRisk["severity"]): "error" | "primary" | "success" {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "primary";
  return "success";
}

function RiskList({ risks }: { risks: PolicyRisk[] }) {
  if (risks.length === 0) return <p className="font-sans text-sm text-secondary-500">No risks were identified from the retrieved evidence.</p>;
  return (
    <div className="flex flex-col gap-3">
      {risks.map((risk) => (
        <div key={`${risk.title}-${risk.severity}`} className="rounded-xl border border-secondary-200 bg-secondary-50/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-sans text-sm font-bold text-secondary-900">{risk.title}</h4>
            <Badge variant={riskVariant(risk.severity)}>{risk.severity}</Badge>
            <span className="font-sans text-xs text-secondary-500">Likelihood {formatPercent(risk.likelihood)} · Impact {formatPercent(risk.impact)}</span>
          </div>
          <p className="mt-2 font-sans text-sm leading-relaxed text-secondary-700">{risk.detail}</p>
          <p className="mt-3 font-sans text-xs leading-relaxed text-secondary-600"><span className="font-bold text-secondary-800">Mitigation:</span> {risk.mitigation}</p>
          {risk.evidence_refs.length > 0 && <p className="mt-2 font-sans text-[11px] text-secondary-400">Evidence references: {risk.evidence_refs.join(", ")}</p>}
        </div>
      ))}
    </div>
  );
}

function RecommendationList({ recommendations }: { recommendations: PolicyRecommendation[] }) {
  if (recommendations.length === 0) return <p className="font-sans text-sm text-secondary-500">No recommendations were returned for this analysis.</p>;
  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((recommendation) => (
        <div key={`${recommendation.title}-${recommendation.timeframe}`} className="rounded-xl border border-primary-100 bg-primary-50/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-sans text-sm font-bold text-secondary-900">{recommendation.title}</h4>
            <Badge variant={recommendation.priority === "low" ? "success" : "primary"}>{recommendation.priority}</Badge>
            <span className="font-sans text-xs text-secondary-500">{recommendation.timeframe}</span>
          </div>
          <p className="mt-2 font-sans text-sm leading-relaxed text-secondary-700">{recommendation.detail}</p>
          <p className="mt-3 font-sans text-xs leading-relaxed text-secondary-600"><span className="font-bold text-secondary-800">Expected impact:</span> {recommendation.expected_impact}</p>
          <p className="mt-1 font-sans text-xs text-secondary-500">Confidence {formatPercent(recommendation.confidence)}</p>
        </div>
      ))}
    </div>
  );
}

function CitationList({ citations }: { citations: PolicyAnalysisResult["citations"] }) {
  if (citations.length === 0) return <p className="font-sans text-sm text-secondary-500">No citations were returned because the workspace had no relevant evidence.</p>;
  return (
    <div className="flex flex-col gap-3">
      {citations.map((citation, index) => (
        <div key={`${citation.chunk_id}-${index}`} className="rounded-xl border border-secondary-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-sans text-sm font-bold text-secondary-900">[{index + 1}] {citation.title}</h4>
            <span className="rounded-lg bg-primary-50 px-2 py-1 font-sans text-xs font-bold text-primary-700">{formatPercent(citation.score)}</span>
          </div>
          <p className="mt-1 font-sans text-xs capitalize text-secondary-500">{citation.source_type}</p>
          <p className="mt-2 font-sans text-sm leading-relaxed text-secondary-700">{citation.text}</p>
        </div>
      ))}
    </div>
  );
}

function PolicyAnalysisView({
  payload,
  result,
  loading,
  error,
  onRetry,
  onBack,
  onPolicySaved,
  existingPolicy,
  canManagePolicies,
}: {
  payload: AnalysisPayload;
  result: PolicyAnalysisResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onBack?: () => void;
  onPolicySaved?: (artifact: PolicyArtifact) => void | Promise<void>;
  existingPolicy?: PolicyArtifact;
  canManagePolicies: boolean;
}) {
  const [draft, setDraft] = useState<{ content: string; citations: Citation[] } | null>(
    existingPolicy
      ? { content: existingPolicy.content, citations: existingPolicy.analysis?.citations ?? [] }
      : null
  );
  const [savedPolicy, setSavedPolicy] = useState<PolicyArtifact | null>(existingPolicy ?? null);
  const [actionLoading, setActionLoading] = useState<"create" | "edit" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(Boolean(existingPolicy));
  const [editRequest, setEditRequest] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex-1 py-16">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <Card className="flex flex-col items-center py-16 text-center">
              <Spinner size="lg" label="Analyzing policy" />
              <h1 className="mt-5 font-sans text-xl font-extrabold text-secondary-900">Analyzing your policy</h1>
              <p className="mt-2 max-w-xl font-sans text-sm leading-relaxed text-secondary-500">The workspace model is retrieving evidence and preparing chart-ready feasibility, likelihood, risk, and implementation insights.</p>
              <p className="mt-4 rounded-lg bg-secondary-50 px-3 py-2 font-sans text-xs text-secondary-600">{payload.prompt}</p>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !result) {
    return (
      <AppLayout>
        <div className="flex-1 py-16">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
            <Card className="border-error-200 bg-error-50/50">
              <p className="font-sans text-xs font-bold uppercase tracking-wider text-error-600">Analysis unavailable</p>
              <h1 className="mt-2 font-sans text-xl font-extrabold text-secondary-900">The policy analysis could not be loaded</h1>
              <p className="mt-2 font-sans text-sm leading-relaxed text-secondary-600">{error ?? "No structured analysis was returned."}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={onRetry}>Try again</Button>
                {onBack && <Button variant="secondary" onClick={onBack}>Back to policies</Button>}
                <Link to="/prompt" className="inline-flex items-center rounded-lg border border-secondary-200 bg-white px-5 py-2.5 font-sans text-base font-semibold text-secondary-700 hover:border-primary-300 hover:text-primary-600">Back to prompt</Link>
              </div>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  const scoreData = [
    { label: "Feasibility", score: result.feasibility.score },
    { label: "Outcome likelihood", score: result.likelihood.score },
  ].filter((item): item is { label: string; score: number } => item.score !== null);
  const dimensionData = result.dimensions.map((dimension) => ({ dimension: dimension.label, score: dimension.score * 100 }));
  const metricData = result.metrics
    .filter((metric) => metric.baseline !== null || metric.projected !== null)
    .map((metric) => ({ label: metric.label, Baseline: metric.baseline ?? undefined, Projected: metric.projected ?? undefined }));
  const riskData = result.risks.map((risk) => ({ ...risk, likelihood: risk.likelihood * 100, impact: risk.impact * 100 }));
  const phaseData = result.phases.map((phase) => ({ ...phase, progress: phase.progress * 100 }));
  const activeDraft = draft;
  const policyTitle = savedPolicy?.title ?? result.policy_name;
  const policyCategory = savedPolicy?.category ?? result.category;
  const isSavedPolicy = savedPolicy !== null;
  const isIllustrative = result.provider === "demo" || result.analysis_basis === "demo_template";
  const statusClass = result.evidence_status === "insufficient"
    ? "border-error-200 bg-error-50 text-error-700"
    : result.evidence_status === "partial"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-success-200 bg-success-50 text-success-700";

  const savePolicy = async (content: string): Promise<PolicyArtifact | null> => {
    const title = policyTitle;
    const category = policyCategory;
    let artifact: PolicyArtifact;
    try {
      artifact = savedPolicy
        ? await updatePolicyArtifact(savedPolicy.id, { title, content, category, analysis: result })
        : await createPolicyArtifact({
            title,
            content,
            category,
            analysis_trace_id: result.trace_id,
            analysis_provider: result.provider,
            analysis: result,
          });
    } catch (saveError) {
      setActionError(`The draft was generated but could not be saved: ${errorMessage(saveError, "The workspace rejected the policy.")}`);
      return null;
    }

    setSavedPolicy(artifact);
    setDraftSaved(true);
    try {
      await onPolicySaved?.(artifact);
    } catch (refreshError) {
      setActionError(`The policy was saved, but the dashboard could not refresh: ${errorMessage(refreshError, "Try refreshing the page.")}`);
    }
    return artifact;
  };

  const createPolicy = async () => {
    setActionLoading("create");
    setActionError(null);
    setDraftSaved(false);
    try {
      const response = await queryRag(policyActionPrompt(result), 5);
      if (!hasGroundedAnswer(response)) {
        setActionError("No grounded workspace evidence was returned, so the policy was not changed.");
        return;
      }
      setDraft({ content: response.answer, citations: response.citations });
      setEditOpen(false);
      await savePolicy(response.answer);
    } catch (actionError) {
      setActionError(errorMessage(actionError, "The model could not create the policy draft."));
    } finally {
      setActionLoading(null);
    }
  };

  const applyPolicyEdit = async () => {
    const requestedChange = editRequest.trim();
    if (!requestedChange) {
      setActionError("Tell the model what you want to change before applying the edit.");
      return;
    }
    const query = policyRevisionPrompt(result, activeDraft?.content ?? result.summary, requestedChange);
    if (!query) {
      setActionError("This policy is too long for a safe single-request model edit. No changes were saved.");
      return;
    }
    setActionLoading("edit");
    setActionError(null);
    setDraftSaved(false);
    try {
      const response = await queryRag(query, 5);
      if (!hasGroundedAnswer(response)) {
        setActionError("No grounded workspace evidence was returned, so the existing policy was not changed.");
        return;
      }
      setDraft({ content: response.answer, citations: response.citations });
      setEditRequest("");
      await savePolicy(response.answer);
    } catch (actionError) {
      setActionError(errorMessage(actionError, "The model could not apply that change."));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 py-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="mb-3 flex flex-wrap items-center gap-2 font-sans text-xs font-semibold text-secondary-500">
              {onBack && <button type="button" onClick={onBack} className="font-bold text-primary-600 hover:text-primary-700">Policies</button>}
              {onBack && <span>/</span>}
              <span className="text-primary-500">Policy analysis</span>
              <span>/</span>
              <span>{policyCategory}</span>
            </div>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h1 className="font-sans text-3xl font-extrabold text-secondary-900">{policyTitle}</h1>
                <p className="mt-2 max-w-3xl font-sans text-sm leading-relaxed text-secondary-500">{result.summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={["rounded-full border px-3 py-1 font-sans text-xs font-bold", statusClass].join(" ")}>{result.evidence_status} evidence</span>
                <span className="rounded-full border border-secondary-200 bg-white px-3 py-1 font-sans text-xs font-semibold text-secondary-600">{MODEL_DISPLAY_NAME}</span>
                <Link to="/prompt" className="rounded-xl bg-primary-500 px-3 py-2 font-sans text-xs font-bold text-white hover:bg-primary-600">New analysis</Link>
              </div>
            </div>
            <p className="mt-3 font-sans text-xs text-secondary-400">Generated {new Date(result.generated_at).toLocaleString()} · Trace {result.trace_id.slice(0, 12)} · {result.citations.length} citation{result.citations.length === 1 ? "" : "s"}</p>
          </div>

          {isIllustrative && <Alert variant="warning" title="Illustrative analysis" className="mb-6">This workspace is using a placeholder analysis template. Scores and actions are illustrative and should be validated against complete policy evidence.</Alert>}
          {result.evidence_status === "insufficient" && <Alert variant="error" title="Evidence gap" className="mb-6">No relevant workspace evidence was retrieved. Numeric scores and projections are intentionally left unavailable.</Alert>}

          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={<Check className="size-5" />} label="Feasibility" value={formatPercent(result.feasibility.score)} sub={result.feasibility.score === null ? "Evidence gap" : "Implementation readiness"} />
            <StatCard icon={<TrendingUp className="size-5" />} label="Outcome likelihood" value={formatPercent(result.likelihood.score)} sub={result.likelihood.score === null ? "Evidence gap" : "Policy success potential"} />
            <StatCard icon={<Target className="size-5" />} label="Confidence" value={formatPercent(result.confidence)} sub={result.analysis_basis.replaceAll("_", " ")} />
            <StatCard icon={<Layers className="size-5" />} label="Evidence sources" value={result.citations.length} sub={result.evidence_status === "sufficient" ? "Broad coverage" : "Limited coverage"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Feasibility and likelihood" subtitle="Model assessment scores (0–100%)" badge={policyCategory}>
              {scoreData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={scoreData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" domain={[0, 1]} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => formatPercent(Number(value))} />
                    <Bar dataKey="score" name="Score" fill={C.primary} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">The evidence does not support a numeric feasibility or likelihood score.</p>}
              <div className="grid gap-2 font-sans text-xs text-secondary-600 sm:grid-cols-2">
                <p><span className="font-bold text-secondary-800">Feasibility:</span> {result.feasibility.rationale}</p>
                <p><span className="font-bold text-secondary-800">Likelihood:</span> {result.likelihood.rationale}</p>
              </div>
            </ChartCard>

            <ChartCard title="Policy dimensions" subtitle="Assessment dimensions returned by the model" badge="Dimensions">
              {dimensionData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart data={dimensionData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="#E5E7EB" />
                    <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "#6B7280" }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#9A9A9A" }} />
                    <Radar name="Score" dataKey="score" stroke={C.violet} fill={C.violet} fillOpacity={0.22} strokeWidth={2.5} />
                    <Tooltip formatter={(value) => `${Math.round(Number(value))}%`} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">No dimension scores were supported by the retrieved evidence.</p>}
            </ChartCard>

            <ChartCard title="Baseline versus projection" subtitle="Numeric metrics returned by the analysis" badge="Outcomes">
              {metricData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={metricData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Baseline" fill={C.primarySoft} radius={[0, 5, 5, 0]} />
                    <Bar dataKey="Projected" fill={C.amber} radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">The evidence did not contain enough numeric data to chart a baseline and projection.</p>}
            </ChartCard>

            <ChartCard title="Risk exposure" subtitle="Likelihood versus impact for identified risks" badge="Risks">
              {riskData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart margin={{ top: 12, right: 24, bottom: 12, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" dataKey="likelihood" name="Likelihood" domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                    <YAxis type="number" dataKey="impact" name="Impact" domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter name="Risk" data={riskData} fill={C.error}>
                      {riskData.map((risk) => <Cell key={risk.title} fill={risk.severity === "critical" ? C.error : risk.severity === "high" ? C.amber : C.primary} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">No risk signals were supported by the retrieved evidence.</p>}
            </ChartCard>

            <ChartCard title="Implementation phases" subtitle="Progress reported by the policy analysis" badge="Delivery">
              {phaseData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={phaseData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${Math.round(Number(value))}%`} tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => `${Math.round(Number(value))}%`} />
                    <Bar dataKey="progress" name="Progress" fill={C.teal} radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">No implementation phases were returned.</p>}
            </ChartCard>

            <ChartCard title="Recommendation priorities" subtitle="Priority and confidence for each recommendation" badge="Actions">
              {result.recommendations.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={result.recommendations.map((recommendation) => ({ label: recommendation.title, confidence: recommendation.confidence * 100 }))} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${Math.round(Number(value))}%`} tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => `${Math.round(Number(value))}%`} />
                    <Bar dataKey="confidence" name="Confidence" fill={C.primary} radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">No recommendations were returned.</p>}
            </ChartCard>
          </div>

          {canManagePolicies && <Card className="mt-6 border-primary-200 bg-primary-50/40">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                 <h2 className="font-sans text-base font-extrabold text-secondary-900">{isSavedPolicy ? "Update this saved policy" : "Turn this analysis into action"}</h2>
                 <p className="mt-1 font-sans text-sm leading-relaxed text-secondary-600">{isSavedPolicy ? "Regenerate the saved policy or tell the model exactly what you want changed." : "Create a policy from the grounded analysis, or tell the model exactly what you want changed in the saved draft."}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                 <Button onClick={() => void createPolicy()} disabled={actionLoading !== null}>{isSavedPolicy ? "Regenerate policy" : "Create policy"}</Button>
                <Button variant="secondary" onClick={() => { setActionError(null); setEditOpen(true); }} disabled={actionLoading !== null}>Edit with Model</Button>
              </div>
            </div>
            {actionError && <p role="alert" className="mt-4 rounded-xl border border-error-200 bg-error-50 px-3 py-2 font-sans text-sm text-error-700">{actionError}</p>}
            {actionLoading && <p role="status" className="mt-4 font-sans text-sm font-semibold text-primary-700">{actionLoading === "create" ? "Model is creating the policy draft..." : "Model is applying your requested change..."}</p>}
            {activeDraft && (
              <div className="mt-5 rounded-2xl border border-primary-100 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                     <p className="font-sans text-xs font-bold uppercase tracking-wider text-primary-600">{isSavedPolicy ? "Saved policy artifact" : "Model-generated policy draft"}</p>
                     <h3 className="mt-1 font-sans text-lg font-extrabold text-secondary-900">{policyTitle}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={draftSaved ? "success" : "secondary"}>{draftSaved ? "Saved to policies" : `${activeDraft.citations.length} workspace source${activeDraft.citations.length === 1 ? "" : "s"}`}</Badge>
                  </div>
                </div>
                <p className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary-700">{activeDraft.content}</p>
              </div>
            )}
            {editOpen && (
              <div className="mt-5 rounded-2xl border border-secondary-200 bg-white p-5">
                <label htmlFor="policy-edit-request" className="font-sans text-sm font-bold text-secondary-900">What should the model change?</label>
                <p className="mt-1 font-sans text-xs text-secondary-500">Describe the change in plain language. The model will return and save a complete revised policy draft.</p>
                <textarea id="policy-edit-request" value={editRequest} onChange={(event) => setEditRequest(event.target.value)} placeholder="Describe the implementation change you need." rows={4} className="mt-3 w-full resize-y rounded-xl border border-secondary-200 bg-secondary-50 px-3 py-2.5 font-sans text-sm text-secondary-800 outline-none placeholder:text-secondary-400 focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100" />
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button onClick={() => void applyPolicyEdit()} disabled={actionLoading !== null || !editRequest.trim()}>{actionLoading === "edit" ? "Applying change..." : "Apply change with Model"}</Button>
                  <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={actionLoading !== null}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="Risks and mitigations" subtitle="Actionable risk register" badge={`${result.risks.length} risks`}><RiskList risks={result.risks} /></ChartCard>
            <ChartCard title="Recommendations" subtitle="Prioritised policy actions" badge={`${result.recommendations.length} actions`}><RecommendationList recommendations={result.recommendations} /></ChartCard>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="font-sans text-sm font-bold text-secondary-900">Uncertainties</h3>
              {result.uncertainties.length > 0 ? <ul className="mt-4 flex flex-col gap-2">{result.uncertainties.map((item) => <li key={item} className="flex gap-2 font-sans text-sm leading-relaxed text-secondary-700"><span className="text-amber-500">•</span><span>{item}</span></li>)}</ul> : <p className="mt-4 font-sans text-sm text-secondary-500">No additional uncertainties were returned.</p>}
            </Card>
            <Card>
              <h3 className="font-sans text-sm font-bold text-secondary-900">Next steps</h3>
              {result.next_steps.length > 0 ? <ol className="mt-4 flex flex-col gap-2">{result.next_steps.map((item, index) => <li key={item} className="flex gap-2 font-sans text-sm leading-relaxed text-secondary-700"><span className="font-bold text-primary-600">{index + 1}.</span><span>{item}</span></li>)}</ol> : <p className="mt-4 font-sans text-sm text-secondary-500">No next steps were returned.</p>}
            </Card>
          </div>

          <div className="mt-6"><ChartCard title="Evidence and sources" subtitle="Workspace evidence used for this policy assessment" badge={`${result.citations.length} sources`}><CitationList citations={result.citations} /></ChartCard></div>
          <details className="mt-6 rounded-2xl border border-secondary-200 bg-white px-5 py-4 shadow-sm">
            <summary className="cursor-pointer font-sans text-sm font-bold text-secondary-800">Original grounded prompt</summary>
            <p className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary-700">{payload.prompt}</p>
          </details>
        </div>
      </div>
    </AppLayout>
  );
}

function PolicyDocumentView({ policy, onBack }: { policy: PolicyArtifact; onBack: () => void }) {
  return (
    <AppLayout>
      <div className="flex-1 py-10">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="mb-3 flex flex-wrap items-center gap-2 font-sans text-xs font-semibold text-secondary-500">
              <button type="button" onClick={onBack} className="font-bold text-primary-600 hover:text-primary-700">Policies</button>
              <span>/</span>
              <span className="text-primary-500">Policy document</span>
            </div>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-sans text-xs font-bold uppercase tracking-wider text-primary-600">{policy.category}</p>
                <h1 className="mt-2 font-sans text-3xl font-extrabold text-secondary-900">{policy.title}</h1>
                <p className="mt-2 font-sans text-sm text-secondary-500">Revision {policy.revision} · Updated {formatDate(policy.updated_at)}</p>
              </div>
              <Button variant="secondary" onClick={onBack}>Back to policies</Button>
            </div>
          </div>
          <Alert variant="info" title="Saved policy document" className="mb-6">This artifact does not have a structured analysis snapshot yet. Its complete saved policy content is shown below without truncating it.</Alert>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-sans text-lg font-extrabold text-secondary-900">Policy content</h2>
              <Badge variant="secondary">Full document</Badge>
            </div>
            <p className="mt-5 whitespace-pre-wrap font-sans text-sm leading-7 text-secondary-700">{policy.content}</p>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function PolicyOverviewCharts({ policies }: { policies: PolicyArtifactSummary[] }) {
  const categoryData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const policy of policies) {
      const category = policy.category.trim() || "Uncategorized";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [policies]);
  const timeline = useMemo(() => {
    const counts = new Map<string, number>();
    for (const policy of policies) {
      const date = new Date(policy.created_at);
      if (Number.isNaN(date.getTime())) continue;
      const month = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}`;
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<Array<{ month: string; added: number; cumulative: number }>>((rows, [month, added]) => {
        const previous = rows[rows.length - 1]?.cumulative ?? 0;
        return [...rows, { month, added, cumulative: previous + added }];
      }, []);
  }, [policies]);

  return (
    <div className="mb-8 grid gap-6 lg:grid-cols-2">
      <ChartCard title="Policies by category" subtitle="Created policy artifacts in this workspace" badge="Artifacts">
        {categoryData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Policies" fill={C.primary} radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">No policy categories are available.</p>}
      </ChartCard>
      <ChartCard title="Policy creation history" subtitle="New and cumulative policy artifacts over time" badge="History">
        {timeline.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9A9A9A" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="cumulative" name="Cumulative policies" stroke={C.primary} strokeWidth={2.5} dot={{ r: 4, fill: C.primary }} />
              <Line type="monotone" dataKey="added" name="Created this month" stroke={C.amber} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4, fill: C.amber }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="py-12 text-center font-sans text-sm text-secondary-500">No policy history is available.</p>}
      </ChartCard>
    </div>
  );
}

function PolicyCard({ policy, onSelect }: { policy: PolicyArtifactSummary; onSelect: (policy: PolicyArtifactSummary) => void }) {
  return (
    <button type="button" onClick={() => onSelect(policy)} className="group w-full rounded-2xl border border-secondary-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-sans text-base font-extrabold text-secondary-900">{policy.title}</h3>
            <Badge variant="success">Created policy</Badge>
            {policy.has_analysis && <Badge variant="secondary">JSON analysis</Badge>}
          </div>
          <p className="mt-1 font-sans text-xs capitalize text-secondary-500">{policy.category}</p>
        </div>
        <span className="font-sans text-xs font-bold text-primary-600 opacity-0 transition group-hover:opacity-100">Open analysis →</span>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3">
        <div><p className="font-sans text-xs text-secondary-400">Revision</p><p className="font-sans text-lg font-extrabold text-secondary-900">{policy.revision}</p></div>
      </div>
      <p className="mt-4 font-sans text-xs text-secondary-400">Updated {formatDate(policy.updated_at)}</p>
    </button>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const canManagePolicies = Boolean(user?.permissions?.includes("policy:manage"));
  const canManageData = Boolean(user?.permissions?.includes("data:manage"));
  const [analysisSeed] = useState(() => readAnalysisSeed(user?.workspace_id));
  const [showSeedAnalysis, setShowSeedAnalysis] = useState(true);
  const [analysisRequest, setAnalysisRequest] = useState(analysisSeed.request);
  const [seedAnalysis, setSeedAnalysis] = useState<PolicyAnalysisResult | null>(null);
  const [seedError, setSeedError] = useState<string | null>(analysisSeed.error);
  const [policies, setPolicies] = useState<PolicyArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(null);
  const [detailAnalysis, setDetailAnalysis] = useState<PolicyAnalysisResult | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    if (analysisSeed.payload) clearAnalysis();
  }, [analysisSeed.payload]);

  useEffect(() => {
    if (!analysisRequest) return;
    let cancelled = false;
    void analyzePolicy(analysisRequest.query)
      .then((result) => {
        if (!cancelled) setSeedAnalysis(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSeedError(errorMessage(error, "The policy analysis request failed."));
      });
    return () => {
      cancelled = true;
    };
  }, [analysisRequest]);

  const loadPolicies = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const allPolicies: PolicyArtifactSummary[] = [];
      let nextOffset = 0;
      let total = 0;
      while (true) {
        const page = await listPolicyArtifacts({ limit: 200, offset: nextOffset });
        if (requestId !== loadRequestRef.current) return;
        allPolicies.push(...page.policies);
        total = page.total;
        if (page.policies.length === 0 || allPolicies.length >= total) break;
        nextOffset += page.policies.length;
      }
      setPolicies(allPolicies);
      setDetailRequest((current) => current && allPolicies.some((policy) => policy.id === current.policy.id) ? current : null);
    } catch (error) {
      if (requestId === loadRequestRef.current) setLoadError(errorMessage(error, "Failed to load created policies."));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPolicies();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadRequestRef.current += 1;
    };
  }, [loadPolicies]);

  useEffect(() => {
    if (!detailRequest || detailRequest.query === null || detailRequest.storedAnalysis !== null) return;
    let cancelled = false;
    void analyzePolicy(detailRequest.query)
      .then((result) => {
        if (!cancelled) setDetailAnalysis(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(errorMessage(error, "The policy analysis request failed."));
      });
    return () => {
      cancelled = true;
    };
  }, [detailRequest]);

  const selectPolicy = async (policy: PolicyArtifactSummary) => {
    setDetailLoading(true);
    setDetailAnalysis(null);
    setDetailError(null);
    try {
      const artifact = await getPolicyArtifact(policy.id);
      const storedAnalysis = isStoredAnalysis(artifact.analysis) ? artifact.analysis : null;
      if (storedAnalysis) {
        setDetailAnalysis(storedAnalysis);
        setDetailRequest({
          policy: artifact,
          query: `Stored structured analysis for ${artifact.title}.`,
          attempt: 0,
          storedAnalysis,
        });
        return;
      }
      const query = buildPolicyPrompt(artifact);
      setDetailRequest({
        policy: artifact,
        query,
        attempt: 0,
        storedAnalysis: null,
      });
    } catch (error) {
      setLoadError(errorMessage(error, "The policy artifact could not be opened."));
    } finally {
      setDetailLoading(false);
    }
  };

  const retryDetail = () => {
    setDetailAnalysis(null);
    setDetailError(null);
    setDetailRequest((current) => current ? { ...current, attempt: current.attempt + 1 } : null);
  };

  const closeDetail = () => {
    setDetailAnalysis(null);
    setDetailError(null);
    setDetailRequest(null);
  };

  if (analysisSeed.payload && showSeedAnalysis) {
    return (
      <PolicyAnalysisView
        key="analysis-seed"
        payload={analysisSeed.payload}
        result={seedAnalysis}
        loading={analysisRequest !== null && seedAnalysis === null && seedError === null}
        error={seedError}
        onRetry={() => {
          setSeedAnalysis(null);
          setSeedError(null);
          setAnalysisRequest((current) => current ? { ...current, attempt: current.attempt + 1 } : analysisSeed.request);
        }}
        onBack={() => setShowSeedAnalysis(false)}
        canManagePolicies={canManagePolicies}
        onPolicySaved={async () => {
          await loadPolicies();
          setShowSeedAnalysis(false);
        }}
      />
    );
  }

  if (detailLoading) {
    return (
      <AppLayout>
        <div className="flex flex-1 items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3"><Spinner size="lg" label="Opening policy" /><p className="font-sans text-sm text-secondary-500">Loading the policy artifact…</p></div>
        </div>
      </AppLayout>
    );
  }

  if (detailRequest) {
    if (detailRequest.query === null) {
      return <PolicyDocumentView policy={detailRequest.policy} onBack={closeDetail} />;
    }
    const detailPayload = policyPayload(detailRequest.policy, detailRequest.query, user?.workspace_id ?? "");
    return (
      <PolicyAnalysisView
        key={detailRequest.policy.id}
        payload={detailPayload}
        result={detailAnalysis}
        loading={detailAnalysis === null && detailError === null}
        error={detailError}
        onRetry={retryDetail}
        onBack={closeDetail}
        canManagePolicies={canManagePolicies}
        onPolicySaved={async (artifact) => {
          await loadPolicies();
          const storedAnalysis = isStoredAnalysis(artifact.analysis) ? artifact.analysis : null;
          if (storedAnalysis) {
            setDetailAnalysis(storedAnalysis);
            setDetailError(null);
            setDetailRequest((current) => current && current.policy.id === artifact.id ? { ...current, policy: artifact, query: `Stored structured analysis for ${artifact.title}.`, attempt: current.attempt, storedAnalysis } : current);
            return;
          }
          const query = buildPolicyPrompt(artifact);
          if (!query) return;
          setDetailAnalysis(null);
          setDetailError(null);
          setDetailRequest((current) => current && current.policy.id === artifact.id ? { ...current, policy: artifact, query, attempt: current.attempt + 1, storedAnalysis: null } : current);
        }}
        existingPolicy={detailRequest.policy}
      />
    );
  }

  const totalCategories = new Set(policies.map((policy) => policy.category.trim() || "Uncategorized")).size;
  const totalUpdates = policies.reduce((sum, policy) => sum + Math.max(0, policy.revision - 1), 0);
  const latestUpdate = policies.reduce<string | null>(
    (latest, policy) => !latest || new Date(policy.updated_at).getTime() > new Date(latest).getTime() ? policy.updated_at : latest,
    null
  );

  return (
    <AppLayout>
      <div className="flex-1 py-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 font-sans text-xs font-semibold uppercase tracking-widest text-secondary-500"><span className="text-primary-500">Workspace policies</span></div>
              <h1 className="font-sans text-3xl font-extrabold text-secondary-900">Policy Dashboard</h1>
              <p className="mt-1 font-sans text-secondary-500">Select a created policy artifact to inspect its implementation indicators, risks, and full analysis.</p>
            </div>
            <div className="flex items-center gap-2">
              {canManageData && <Link to="/models/new"><Button variant="ghost" size="sm">Add data</Button></Link>}
              <Button variant="secondary" size="sm" onClick={() => void loadPolicies()} loading={loading}>Refresh</Button>
            </div>
          </div>

          {loadError && <Alert variant="error" title="Could not load workspace policies" onClose={() => setLoadError(null)} className="mb-6"><div className="flex flex-col items-start gap-3"><span>{loadError}</span><Button size="sm" variant="secondary" onClick={() => void loadPolicies()}>Try again</Button></div></Alert>}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24"><Spinner size="lg" label="Loading created policies" /><p className="font-sans text-sm text-secondary-500">Reading policy artifacts from the workspace…</p></div>
          ) : policies.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-secondary-200 bg-secondary-50 px-6 py-16 text-center">
              <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-white text-primary-500"><Plus className="size-7" /></div>
              <h2 className="font-sans text-base font-bold text-secondary-800">No created policies in this workspace yet</h2>
              <p className="mt-1 max-w-md font-sans text-sm text-secondary-500">Create a policy from the analysis workspace. Data-lake documents and datasets remain separate as supporting evidence.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">{user?.permissions.includes("prompt:use") && <Link to="/prompt"><Button>Open policy analysis</Button></Link>}{canManageData && <Link to="/models/new"><Button variant="secondary">Add data</Button></Link>}</div>
            </div>
          ) : (
            <>
              <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard icon={<FileText className="size-5" />} label="Policies" value={policies.length} sub="created artifacts" />
                <StatCard icon={<LayoutGrid className="size-5" />} label="Categories" value={totalCategories} sub="policy areas" />
                <StatCard icon={<History className="size-5" />} label="Updates" value={totalUpdates} sub="saved revisions" />
                <StatCard icon={<Clock className="size-5" />} label="Latest update" value={latestUpdate ? formatDate(latestUpdate) : "None"} sub="workspace artifact" />
              </div>
              <PolicyOverviewCharts policies={policies} />
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="font-sans text-lg font-extrabold text-secondary-900">Your created policies</h2><p className="mt-1 font-sans text-sm text-secondary-500">Click any artifact to load its detailed API-backed analysis.</p></div>
                <Badge variant="primary">{policies.length} available</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {policies.map((policy) => <PolicyCard key={policy.id} policy={policy} onSelect={selectPolicy} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
