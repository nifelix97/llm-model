import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  FileText,
  History,
  Layers,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
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
import Button from "../components/Button";
import MarkdownContent from "../components/MarkdownContent";
import Spinner from "../components/Spinner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { UiBadge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Separator } from "../components/ui/separator";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
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

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  primary:     "#3B5BF6",
  primarySoft: "#B3C0FB",
  success:     "#2E8B40",
  error:       "#C0392B",
  amber:       "#D97706",
  teal:        "#0D9488",
  violet:      "#7C3AED",
  slate:       "#CBD5E1",
  grid:        "#F1F5F9",
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_POLICY_QUERY_LENGTH   = 3900;
const MAX_POLICY_ANALYSIS_CONTENT = 2800;

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatPercent(value: number | null, fallback = "N/A"): string {
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
  const a = value as Partial<PolicyAnalysisResult>;
  return (
    typeof a.policy_name === "string" &&
    typeof a.summary === "string" &&
    typeof a.evidence_status === "string" &&
    typeof a.confidence === "number" &&
    typeof a.feasibility === "object" && a.feasibility !== null &&
    typeof a.likelihood === "object" && a.likelihood !== null &&
    Array.isArray(a.risks) && Array.isArray(a.recommendations) &&
    Array.isArray(a.metrics) && Array.isArray(a.dimensions) &&
    Array.isArray(a.phases) && Array.isArray(a.uncertainties) &&
    Array.isArray(a.next_steps) && Array.isArray(a.citations) &&
    typeof a.trace_id === "string" && typeof a.generated_at === "string" &&
    typeof a.provider === "string" && typeof a.model === "string"
  );
}

function limitPrompt(prompt: string, maxLength = MAX_POLICY_QUERY_LENGTH): string {
  return prompt.length > maxLength ? `${prompt.slice(0, maxLength - 1)}…` : prompt;
}

function buildPolicyPrompt(policy: PolicyArtifact): string | null {
  const content = policy.content.trim();
  if (content.length > MAX_POLICY_ANALYSIS_CONTENT) return null;
  const prompt = `Analyze the implementation of the saved policy artifact named "${policy.title}" in the ${policy.category} category. Use retrieved workspace evidence to evaluate feasibility, likelihood, numeric indicators, dimensions, implementation phases, risks, recommendations, uncertainties, next steps, and citations.\n\nSaved policy content:\n${content}`;
  return prompt.length <= MAX_POLICY_QUERY_LENGTH ? prompt : null;
}

function policyPayload(policy: PolicyArtifact, query: string, workspaceId: string): AnalysisPayload {
  return { prompt: query, response: `Selected policy artifact: ${policy.title}`, category: policy.category, timestamp: Date.now(), workspace_id: workspaceId };
}

function policyActionPrompt(result: PolicyAnalysisResult): string {
  const recs = result.recommendations.slice(0, 6).map((r) => `- ${r.title}: ${r.detail}`).join("\n");
  return limitPrompt(`Create a practical policy based on the analysis below. Include policy objective, target outcomes, implementation phases, measurable indicators, key risks and mitigations, and a monitoring plan.\n\nPolicy: ${result.policy_name}\nCategory: ${result.category}\nSummary: ${result.summary}\n${recs ? `Recommendations:\n${recs}` : ""}`);
}

function policyRevisionPrompt(result: PolicyAnalysisResult, currentDraft: string, changeRequest: string): string | null {
  if (currentDraft.length > MAX_POLICY_QUERY_LENGTH) return null;
  const prompt = `Revise the policy draft according to the user's requested change. Preserve unchanged parts, explain impact, and return a complete revised draft.\n\nPolicy: ${result.policy_name}\nCategory: ${result.category}\nSummary: ${limitPrompt(result.summary, 700)}\n\nCurrent draft:\n${currentDraft}\n\nRequested change:\n${limitPrompt(changeRequest, 900)}`;
  return prompt.length <= MAX_POLICY_QUERY_LENGTH ? prompt : null;
}

function readAnalysisSeed(workspaceId: string | null | undefined): AnalysisSeed {
  const payload = loadAnalysis(workspaceId);
  if (!payload) return { payload: null, request: null, error: null };
  const query = payload.prompt.trim() || payload.response.trim();
  return { payload, request: query ? { query, attempt: 0 } : null, error: query ? null : "The selected prompt did not contain a question to analyze." };
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-secondary-700/60 bg-secondary-900 px-3 py-2 shadow-xl">
      {label && <p className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wider text-secondary-400">{label}</p>}
      {payload.map((item) => (
        <p key={item.name} className="font-sans text-xs font-semibold" style={{ color: item.color ?? C.primary }}>
          {item.name}: <span className="text-white">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, trend, color = "primary" }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  trend?: { value: string; up?: boolean };
  color?: "primary" | "success" | "amber" | "violet" | "teal";
}) {
  const palette = {
    primary: { bg: "bg-primary-50",  text: "text-primary-500",  ring: "ring-primary-100" },
    success: { bg: "bg-success-50",  text: "text-success-500",  ring: "ring-success-100" },
    amber:   { bg: "bg-amber-50",    text: "text-amber-600",    ring: "ring-amber-100"   },
    violet:  { bg: "bg-violet-50",   text: "text-violet-600",   ring: "ring-violet-100"  },
    teal:    { bg: "bg-teal-50",     text: "text-teal-600",     ring: "ring-teal-100"    },
  }[color];

  return (
    <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
      {/* subtle gradient accent */}
      <div className={cn("absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity", `bg-gradient-to-br from-transparent to-${color === "primary" ? "primary" : color}-50/40`)} />
      <CardContent className="flex items-start gap-4 p-5">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl ring-4", palette.bg, palette.text, palette.ring)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-wider text-secondary-400">{label}</p>
          <p className="mt-0.5 font-sans text-2xl font-extrabold tabular-nums text-secondary-900">{value}</p>
          <div className="mt-1 flex items-center gap-2">
            {sub && <p className="truncate font-sans text-xs text-secondary-400">{sub}</p>}
            {trend && (
              <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-sans text-[10px] font-bold", trend.up ? "bg-success-50 text-success-600" : "bg-error-50 text-error-600")}>
                {trend.up ? "↑" : "↓"} {trend.value}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({ title, subtitle, badge, children, className }: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription className="mt-0.5">{subtitle}</CardDescription>}
          </div>
          {badge && <UiBadge variant="default" className="shrink-0">{badge}</UiBadge>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Severity badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: PolicyRisk["severity"] }) {
  const map: Record<PolicyRisk["severity"], "error" | "warning" | "default" | "success"> = {
    critical: "error", high: "error", medium: "warning", low: "success",
  };
  return <UiBadge variant={map[severity]}>{severity}</UiBadge>;
}

// ─── Risk list ────────────────────────────────────────────────────────────────

function RiskList({ risks }: { risks: PolicyRisk[] }) {
  if (risks.length === 0)
    return <p className="py-6 text-center font-sans text-sm text-secondary-400">No risks were identified from the retrieved evidence.</p>;
  return (
    <div className="flex flex-col gap-3">
      {risks.map((risk, i) => (
        <div key={`${risk.title}-${i}`} className="rounded-xl border border-secondary-100 bg-secondary-50/50 p-4 transition-colors hover:border-secondary-200 hover:bg-white">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-sans text-sm font-bold text-secondary-900">{risk.title}</h4>
            <SeverityBadge severity={risk.severity} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="font-sans text-[10px] font-semibold uppercase tracking-wider text-secondary-400">Likelihood</p>
              <p className="mt-1 font-sans text-sm font-bold text-secondary-800">{formatPercent(risk.likelihood)}</p>
              <Progress value={(risk.likelihood ?? 0) * 100} className="mt-1 h-1.5" indicatorClassName={risk.likelihood > 0.6 ? "bg-error-500" : risk.likelihood > 0.3 ? "bg-amber-500" : "bg-success-500"} />
            </div>
            <div>
              <p className="font-sans text-[10px] font-semibold uppercase tracking-wider text-secondary-400">Impact</p>
              <p className="mt-1 font-sans text-sm font-bold text-secondary-800">{formatPercent(risk.impact)}</p>
              <Progress value={(risk.impact ?? 0) * 100} className="mt-1 h-1.5" indicatorClassName={risk.impact > 0.6 ? "bg-error-500" : risk.impact > 0.3 ? "bg-amber-500" : "bg-success-500"} />
            </div>
          </div>
          <p className="mt-3 font-sans text-sm leading-relaxed text-secondary-700">{risk.detail}</p>
          <div className="mt-3 rounded-lg bg-white px-3 py-2 border border-secondary-100">
            <p className="font-sans text-xs text-secondary-600"><span className="font-bold text-secondary-800">Mitigation: </span>{risk.mitigation}</p>
          </div>
          {risk.evidence_refs.length > 0 && (
            <p className="mt-2 font-sans text-[11px] text-secondary-400">Evidence: {risk.evidence_refs.join(", ")}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Recommendation list ──────────────────────────────────────────────────────

function RecommendationList({ recommendations }: { recommendations: PolicyRecommendation[] }) {
  if (recommendations.length === 0)
    return <p className="py-6 text-center font-sans text-sm text-secondary-400">No recommendations were returned for this analysis.</p>;
  const priorityColor: Record<string, string> = {
    critical: "border-l-error-500", high: "border-l-amber-500", medium: "border-l-primary-500", low: "border-l-success-500",
  };
  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((rec, i) => (
        <div key={`${rec.title}-${i}`} className={cn("rounded-xl border border-secondary-100 bg-white p-4 border-l-4 transition-all hover:shadow-sm", priorityColor[rec.priority] ?? "border-l-secondary-300")}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-sans text-sm font-bold text-secondary-900">{rec.title}</h4>
            <UiBadge variant={rec.priority === "low" ? "success" : rec.priority === "high" || rec.priority === "critical" ? "error" : "default"}>{rec.priority}</UiBadge>
            <span className="font-sans text-[11px] text-secondary-400">{rec.timeframe}</span>
          </div>
          <p className="mt-2 font-sans text-sm leading-relaxed text-secondary-700">{rec.detail}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-sans text-xs text-secondary-600"><span className="font-bold text-secondary-800">Expected impact: </span>{rec.expected_impact}</p>
            <div className="flex items-center gap-2">
              <p className="font-sans text-[11px] text-secondary-400">Confidence</p>
              <div className="flex items-center gap-1.5">
                <Progress value={(rec.confidence ?? 0) * 100} className="w-16 h-1.5" />
                <span className="font-sans text-[11px] font-bold text-secondary-600">{formatPercent(rec.confidence)}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Citation list ────────────────────────────────────────────────────────────

function CitationList({ citations }: { citations: PolicyAnalysisResult["citations"] }) {
  if (citations.length === 0)
    return <p className="py-6 text-center font-sans text-sm text-secondary-400">No citations were returned because the workspace had no relevant evidence.</p>;
  return (
    <div className="flex flex-col gap-3">
      {citations.map((c, i) => (
        <div key={`${c.chunk_id}-${i}`} className="rounded-xl border border-secondary-100 bg-white p-4 hover:border-secondary-200 transition-colors">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-sans text-sm font-bold text-secondary-900">[{i + 1}] {c.title}</h4>
              <p className="mt-0.5 font-sans text-[11px] capitalize text-secondary-400">{c.source_type}</p>
            </div>
            <TooltipProvider>
              <UiTooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary-100">
                      <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.round(c.score * 100)}%` }} />
                    </div>
                    <span className="font-sans text-xs font-bold text-primary-600">{formatPercent(c.score)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Relevance score</TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          </div>
          <p className="mt-2.5 font-sans text-sm leading-relaxed text-secondary-700 line-clamp-4">{c.text}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Policy analysis view ─────────────────────────────────────────────────────

function PolicyAnalysisView({
  payload, result, loading, error, onRetry, onBack,
  onPolicySaved, existingPolicy, canManagePolicies,
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
    existingPolicy ? { content: existingPolicy.content, citations: existingPolicy.analysis?.citations ?? [] } : null,
  );
  const [savedPolicy, setSavedPolicy] = useState<PolicyArtifact | null>(existingPolicy ?? null);
  const [actionLoading, setActionLoading] = useState<"create" | "edit" | null>(null);
  const [actionError, setActionError]     = useState<string | null>(null);
  const [draftSaved, setDraftSaved]       = useState(Boolean(existingPolicy));
  const [editRequest, setEditRequest]     = useState("");
  const [editOpen, setEditOpen]           = useState(false);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-20">
        <div className="relative flex size-20 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary-100" />
          <div className="relative flex size-14 items-center justify-center rounded-full bg-primary-50 ring-4 ring-primary-100">
            <Sparkles className="size-6 text-primary-500" />
          </div>
        </div>
        <div className="text-center">
          <p className="font-sans text-base font-bold text-secondary-900">Analyzing policy</p>
          <p className="mt-1 font-sans text-sm text-secondary-500">Retrieving workspace evidence and building chart-ready insights…</p>
        </div>
        <Card className="w-full max-w-xl">
          <CardContent className="p-4">
            <p className="font-sans text-xs leading-relaxed text-secondary-500 line-clamp-3">{payload.prompt}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error state ──
  if (error || !result) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 px-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-error-50 ring-4 ring-error-100">
          <AlertTriangle className="size-6 text-error-500" />
        </div>
        <div className="text-center">
          <p className="font-sans text-base font-bold text-secondary-900">Analysis unavailable</p>
          <p className="mt-1 max-w-md font-sans text-sm text-secondary-500">{error ?? "No structured analysis was returned."}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onRetry}><RefreshCw className="mr-1.5 size-3.5" />Try again</Button>
          {onBack && <Button variant="secondary" onClick={onBack}><ArrowLeft className="mr-1.5 size-3.5" />Back to policies</Button>}
          <Link to="/prompt" className="inline-flex items-center gap-1.5 rounded-xl border border-secondary-200 bg-white px-4 py-2.5 font-sans text-sm font-semibold text-secondary-700 hover:border-primary-300 hover:text-primary-600 transition-colors">
            Back to prompt
          </Link>
        </div>
      </div>
    );
  }

  // ── Data prep ──
  const scoreData = [
    { label: "Feasibility", score: result.feasibility.score },
    { label: "Likelihood", score: result.likelihood.score },
  ].filter((d): d is { label: string; score: number } => d.score !== null);

  const dimensionData = result.dimensions.map((d) => ({ dimension: d.label, score: d.score * 100 }));
  const metricData    = result.metrics.filter((m) => m.baseline !== null || m.projected !== null).map((m) => ({ label: m.label, Baseline: m.baseline ?? undefined, Projected: m.projected ?? undefined }));
  const riskData      = result.risks.map((r) => ({ ...r, likelihood: r.likelihood * 100, impact: r.impact * 100 }));
  const phaseData     = result.phases.map((p) => ({ ...p, progress: p.progress * 100 }));
  const recData       = result.recommendations.map((r) => ({ label: r.title, confidence: r.confidence * 100 }));

  const policyTitle    = savedPolicy?.title ?? result.policy_name;
  const policyCategory = savedPolicy?.category ?? result.category;
  const isSavedPolicy  = savedPolicy !== null;
  const isIllustrative = result.provider === "demo" || result.analysis_basis === "demo_template";

  const evidenceStatusConfig = {
    sufficient:   { label: "Sufficient evidence",  variant: "success"  as const, icon: <Check className="size-3" /> },
    partial:      { label: "Partial evidence",      variant: "warning"  as const, icon: <AlertTriangle className="size-3" /> },
    insufficient: { label: "Insufficient evidence", variant: "error"    as const, icon: <AlertTriangle className="size-3" /> },
  }[result.evidence_status] ?? { label: result.evidence_status, variant: "secondary" as const, icon: null };

  const savePolicy = async (content: string): Promise<PolicyArtifact | null> => {
    try {
      const artifact = savedPolicy
        ? await updatePolicyArtifact(savedPolicy.id, { title: policyTitle, content, category: policyCategory, analysis: result })
        : await createPolicyArtifact({ title: policyTitle, content, category: policyCategory, analysis_trace_id: result.trace_id, analysis_provider: result.provider, analysis: result });
      setSavedPolicy(artifact);
      setDraftSaved(true);
      try { await onPolicySaved?.(artifact); } catch { /* refresh error is non-fatal */ }
      return artifact;
    } catch (e) {
      setActionError(errorMessage(e, "The workspace rejected the policy."));
      return null;
    }
  };

  const createPolicy = async () => {
    setActionLoading("create"); setActionError(null); setDraftSaved(false);
    try {
      const res = await queryRag(policyActionPrompt(result), 5);
      if (!hasGroundedAnswer(res)) { setActionError("No grounded workspace evidence was returned."); return; }
      setDraft({ content: res.answer, citations: res.citations });
      setEditOpen(false);
      await savePolicy(res.answer);
    } catch (e) { setActionError(errorMessage(e, "The model could not create the policy draft.")); }
    finally     { setActionLoading(null); }
  };

  const applyPolicyEdit = async () => {
    if (!editRequest.trim()) { setActionError("Describe what to change before applying."); return; }
    const q = policyRevisionPrompt(result, draft?.content ?? result.summary, editRequest);
    if (!q) { setActionError("This policy is too long for a single-request edit."); return; }
    setActionLoading("edit"); setActionError(null); setDraftSaved(false);
    try {
      const res = await queryRag(q, 5);
      if (!hasGroundedAnswer(res)) { setActionError("No grounded workspace evidence was returned."); return; }
      setDraft({ content: res.answer, citations: res.citations });
      setEditRequest("");
      await savePolicy(res.answer);
    } catch (e) { setActionError(errorMessage(e, "The model could not apply that change.")); }
    finally     { setActionLoading(null); }
  };

  // ── Render ──
  return (
    <AppLayout>
      <div className="flex-1 py-8">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">

          {/* Breadcrumb + header */}
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-1.5 font-sans text-xs text-secondary-400">
              {onBack && (
                <>
                  <button type="button" onClick={onBack} className="font-semibold text-primary-600 hover:text-primary-700 transition-colors">Policies</button>
                  <ChevronRight className="size-3" />
                </>
              )}
              <span>Policy analysis</span>
              <ChevronRight className="size-3" />
              <span className="text-secondary-600">{policyCategory}</span>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <h1 className="font-sans text-2xl font-extrabold tracking-tight text-secondary-900 lg:text-3xl">{policyTitle}</h1>
                <p className="mt-2 max-w-3xl font-sans text-sm leading-relaxed text-secondary-500">{result.summary}</p>
                <p className="mt-2 font-sans text-[11px] text-secondary-400">
                  Generated {new Date(result.generated_at).toLocaleString()} · Trace {result.trace_id.slice(0, 12)} · {result.citations.length} citation{result.citations.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                <UiBadge variant={evidenceStatusConfig.variant} className="gap-1">
                  {evidenceStatusConfig.icon}{evidenceStatusConfig.label}
                </UiBadge>
                <UiBadge variant="outline">{MODEL_DISPLAY_NAME}</UiBadge>
                <Link to="/prompt" className="inline-flex items-center gap-1.5 rounded-xl bg-primary-500 px-3 py-1.5 font-sans text-xs font-bold text-white hover:bg-primary-600 transition-colors">
                  <Zap className="size-3" />New analysis
                </Link>
              </div>
            </div>
          </div>

          {/* Alerts */}
          {isIllustrative && <Alert variant="warning" title="Illustrative analysis" className="mb-5">Scores are based on a placeholder template. Validate against complete policy evidence.</Alert>}
          {result.evidence_status === "insufficient" && <Alert variant="error" title="Evidence gap" className="mb-5">No relevant workspace evidence was retrieved. Numeric scores and projections are unavailable.</Alert>}

          {/* Stat bar */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={<Check className="size-5" />} label="Feasibility" value={formatPercent(result.feasibility.score)} sub={result.feasibility.score === null ? "Insufficient evidence" : result.feasibility.rationale} color="primary" />
            <StatCard icon={<TrendingUp className="size-5" />} label="Likelihood" value={formatPercent(result.likelihood.score)} sub={result.likelihood.score === null ? "Insufficient evidence" : result.likelihood.rationale} color="success" />
            <StatCard icon={<Target className="size-5" />} label="Confidence" value={formatPercent(result.confidence)} sub={result.analysis_basis.replaceAll("_", " ")} color="violet" />
            <StatCard icon={<Layers className="size-5" />} label="Evidence sources" value={result.citations.length} sub={result.evidence_status === "sufficient" ? "Broad coverage" : result.evidence_status === "partial" ? "Partial coverage" : "Insufficient coverage"} color="teal" />
          </div>

          {/* Main tabbed content */}
          <Tabs defaultValue="overview">
            <TabsList className="mb-6 flex-wrap gap-y-1 h-auto">
              <TabsTrigger value="overview"><BarChart3 className="size-3.5" />Overview</TabsTrigger>
              <TabsTrigger value="risks"><Shield className="size-3.5" />Risks <span className="ml-1 rounded-full bg-secondary-200 px-1.5 py-0.5 text-[10px] font-bold text-secondary-600">{result.risks.length}</span></TabsTrigger>
              <TabsTrigger value="recommendations"><Lightbulb className="size-3.5" />Actions <span className="ml-1 rounded-full bg-secondary-200 px-1.5 py-0.5 text-[10px] font-bold text-secondary-600">{result.recommendations.length}</span></TabsTrigger>
              <TabsTrigger value="implementation"><ListChecks className="size-3.5" />Implementation</TabsTrigger>
              <TabsTrigger value="evidence"><BookOpen className="size-3.5" />Evidence <span className="ml-1 rounded-full bg-secondary-200 px-1.5 py-0.5 text-[10px] font-bold text-secondary-600">{result.citations.length}</span></TabsTrigger>
            </TabsList>

            {/* ── Tab: Overview ── */}
            <TabsContent value="overview">
              <div className="grid gap-5 lg:grid-cols-2">
                <ChartCard title="Feasibility & likelihood" subtitle="Model-assessed scores against workspace evidence">
                  {scoreData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={scoreData} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                        <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v) => formatPercent(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
                        <Bar dataKey="score" name="Score" fill={C.primary} radius={[0, 8, 8, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="py-10 text-center font-sans text-sm text-secondary-400">Evidence does not support numeric scores.</p>}
                  <Separator className="my-3" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <p className="font-sans text-xs text-secondary-600"><span className="font-bold text-secondary-800">Feasibility: </span>{result.feasibility.rationale}</p>
                    <p className="font-sans text-xs text-secondary-600"><span className="font-bold text-secondary-800">Likelihood: </span>{result.likelihood.rationale}</p>
                  </div>
                </ChartCard>

                <ChartCard title="Policy dimensions" subtitle="Multi-axis assessment from retrieved evidence">
                  {dimensionData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <RadarChart data={dimensionData} cx="50%" cy="50%" outerRadius="68%">
                        <PolarGrid stroke={C.grid} />
                        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "#64748B" }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#94A3B8" }} />
                        <Radar name="Score" dataKey="score" stroke={C.violet} fill={C.violet} fillOpacity={0.20} strokeWidth={2.5} />
                        <Tooltip formatter={(v) => `${Math.round(Number(v))}%`} contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : <p className="py-10 text-center font-sans text-sm text-secondary-400">No dimension scores were supported.</p>}
                </ChartCard>

                <ChartCard title="Baseline vs projection" subtitle="Numeric indicators from analysis">
                  {metricData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={metricData.length * 50 + 40}>
                      <BarChart data={metricData} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                        <Bar dataKey="Baseline"  fill={C.primarySoft} radius={[0, 6, 6, 0]} maxBarSize={24} />
                        <Bar dataKey="Projected" fill={C.amber}       radius={[0, 6, 6, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="py-10 text-center font-sans text-sm text-secondary-400">Insufficient numeric data for a baseline/projection chart.</p>}
                </ChartCard>

                <ChartCard title="Recommendation confidence" subtitle="Model confidence per recommended action">
                  {recData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={recData.length * 50 + 40}>
                      <BarChart data={recData} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${Math.round(Number(v))}%`} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10, fill: "#64748B" }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v) => `${Math.round(Number(v))}%`} contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
                        <Bar dataKey="confidence" name="Confidence" fill={C.teal} radius={[0, 6, 6, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="py-10 text-center font-sans text-sm text-secondary-400">No recommendations were returned.</p>}
                </ChartCard>
              </div>
            </TabsContent>

            {/* ── Tab: Risks ── */}
            <TabsContent value="risks">
              <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
                <Card>
                  <CardHeader>
                    <CardTitle>Risk register</CardTitle>
                    <CardDescription>Actionable risks from workspace evidence — ordered by severity</CardDescription>
                  </CardHeader>
                  <CardContent><RiskList risks={result.risks} /></CardContent>
                </Card>

                {riskData.length > 0 && (
                  <ChartCard title="Risk exposure map" subtitle="Likelihood vs impact">
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart margin={{ top: 12, right: 16, bottom: 12, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                        <XAxis type="number" dataKey="likelihood" name="Likelihood" domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} label={{ value: "Likelihood", position: "insideBottom", offset: -4, fontSize: 10, fill: "#94A3B8" }} />
                        <YAxis type="number" dataKey="impact"     name="Impact"     domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} label={{ value: "Impact", angle: -90, position: "insideLeft", offset: 8, fontSize: 10, fill: "#94A3B8" }} />
                        <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
                        <Scatter name="Risk" data={riskData} fill={C.error}>
                          {riskData.map((r, i) => <Cell key={i} fill={r.severity === "critical" ? C.error : r.severity === "high" ? C.amber : C.primary} />)}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </div>
            </TabsContent>

            {/* ── Tab: Recommendations ── */}
            <TabsContent value="recommendations">
              <Card>
                <CardHeader>
                  <CardTitle>Policy actions</CardTitle>
                  <CardDescription>Prioritised recommendations grounded in workspace evidence</CardDescription>
                </CardHeader>
                <CardContent><RecommendationList recommendations={result.recommendations} /></CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab: Implementation ── */}
            <TabsContent value="implementation">
              <div className="grid gap-5 lg:grid-cols-2">
                {phaseData.length > 0 && (
                  <ChartCard title="Implementation phases" subtitle="Reported progress per phase" className="lg:col-span-2">
                    <ResponsiveContainer width="100%" height={phaseData.length * 52 + 40}>
                      <BarChart data={phaseData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${Math.round(Number(v))}%`} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v) => `${Math.round(Number(v))}%`} contentStyle={{ borderRadius: 12, border: "1px solid #E2E8F0" }} />
                        <Bar dataKey="progress" name="Progress" fill={C.teal} radius={[0, 8, 8, 0]} maxBarSize={32} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}

                <Card>
                  <CardHeader><CardTitle>Uncertainties</CardTitle></CardHeader>
                  <CardContent>
                    {result.uncertainties.length > 0
                      ? <ul className="flex flex-col gap-2">{result.uncertainties.map((u) => <li key={u} className="flex gap-2 font-sans text-sm leading-relaxed text-secondary-700"><span className="mt-0.5 shrink-0 text-amber-500">◆</span><span>{u}</span></li>)}</ul>
                      : <p className="font-sans text-sm text-secondary-400">No uncertainties were returned.</p>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Next steps</CardTitle></CardHeader>
                  <CardContent>
                    {result.next_steps.length > 0
                      ? <ol className="flex flex-col gap-2">{result.next_steps.map((s, i) => <li key={s} className="flex gap-2.5 font-sans text-sm leading-relaxed text-secondary-700"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-50 font-bold text-[11px] text-primary-600">{i + 1}</span><span>{s}</span></li>)}</ol>
                      : <p className="font-sans text-sm text-secondary-400">No next steps were returned.</p>}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Tab: Evidence ── */}
            <TabsContent value="evidence">
              <Card>
                <CardHeader>
                  <CardTitle>Evidence & sources</CardTitle>
                  <CardDescription>Workspace documents retrieved and used in this analysis</CardDescription>
                </CardHeader>
                <CardContent><CitationList citations={result.citations} /></CardContent>
              </Card>
              <details className="mt-4 rounded-2xl border border-secondary-100 bg-white px-5 py-4 shadow-sm">
                <summary className="cursor-pointer font-sans text-sm font-semibold text-secondary-600 select-none hover:text-secondary-900 transition-colors">Original grounded prompt</summary>
                <p className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-secondary-600">{payload.prompt}</p>
              </details>
            </TabsContent>
          </Tabs>

          {/* Policy draft panel */}
          {canManagePolicies && (
            <Card className="mt-6 border-primary-100 bg-gradient-to-br from-primary-50/60 to-white">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">{isSavedPolicy ? "Update this saved policy" : "Turn this analysis into action"}</CardTitle>
                    <CardDescription className="mt-1">{isSavedPolicy ? "Regenerate the saved policy or apply targeted changes." : "Create a policy document from the grounded analysis."}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void createPolicy()} disabled={actionLoading !== null} size="sm">
                      <Sparkles className="mr-1.5 size-3.5" />{isSavedPolicy ? "Regenerate" : "Create policy"}
                    </Button>
                    <Button variant="secondary" onClick={() => { setActionError(null); setEditOpen(true); }} disabled={actionLoading !== null} size="sm">
                      Edit with model
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {actionError && <Alert variant="error" className="mb-4">{actionError}</Alert>}
                {actionLoading && (
                  <div className="mb-4 flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-2">
                    <Spinner size="sm" /><p className="font-sans text-sm font-semibold text-primary-700">{actionLoading === "create" ? "Creating policy draft…" : "Applying change…"}</p>
                  </div>
                )}
                {draft && (
                  <div className="rounded-2xl border border-primary-100 bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-sans text-[10px] font-bold uppercase tracking-wider text-primary-600">{isSavedPolicy ? "Saved policy artifact" : "Model-generated draft"}</p>
                        <h3 className="mt-1 font-sans text-lg font-extrabold text-secondary-900">{policyTitle}</h3>
                      </div>
                      <UiBadge variant={draftSaved ? "success" : "secondary"}>{draftSaved ? "Saved to policies" : `${draft.citations.length} source${draft.citations.length === 1 ? "" : "s"}`}</UiBadge>
                    </div>
                    <Separator className="my-4" />
                    <div className="max-h-96 overflow-y-auto">
                      <MarkdownContent content={draft.content} />
                    </div>
                  </div>
                )}
                {editOpen && (
                  <div className="mt-4 rounded-2xl border border-secondary-200 bg-white p-5">
                    <label htmlFor="policy-edit-request" className="font-sans text-sm font-bold text-secondary-900">What should the model change?</label>
                    <p className="mt-0.5 font-sans text-xs text-secondary-500">Describe the change in plain language. The model will return a complete revised draft.</p>
                    <textarea
                      id="policy-edit-request"
                      value={editRequest}
                      onChange={(e) => setEditRequest(e.target.value)}
                      placeholder="Describe the implementation change you need."
                      rows={4}
                      className="mt-3 w-full resize-y rounded-xl border border-secondary-200 bg-secondary-50 px-3 py-2.5 font-sans text-sm text-secondary-800 outline-none placeholder:text-secondary-400 focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => void applyPolicyEdit()} disabled={actionLoading !== null || !editRequest.trim()} size="sm">{actionLoading === "edit" ? "Applying…" : "Apply change"}</Button>
                      <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={actionLoading !== null} size="sm">Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Policy document view (no analysis) ──────────────────────────────────────

function PolicyDocumentView({ policy, onBack }: { policy: PolicyArtifact; onBack: () => void }) {
  return (
    <AppLayout>
      <div className="flex-1 py-8">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-1.5 font-sans text-xs text-secondary-400">
              <button type="button" onClick={onBack} className="font-semibold text-primary-600 hover:text-primary-700 transition-colors">Policies</button>
              <ChevronRight className="size-3" />
              <span>Policy document</span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <UiBadge variant="default" className="mb-2">{policy.category}</UiBadge>
                <h1 className="font-sans text-2xl font-extrabold text-secondary-900">{policy.title}</h1>
                <p className="mt-1 font-sans text-xs text-secondary-400">Revision {policy.revision} · Updated {formatDate(policy.updated_at)}</p>
              </div>
              <Button variant="secondary" onClick={onBack} size="sm"><ArrowLeft className="mr-1.5 size-3.5" />Back</Button>
            </div>
          </div>
          <Alert variant="info" title="Saved policy document" className="mb-5">No structured analysis snapshot exists for this artifact yet.</Alert>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Policy content</CardTitle>
                <UiBadge variant="secondary">Full document</UiBadge>
              </div>
            </CardHeader>
            <CardContent><MarkdownContent content={policy.content} /></CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

// ─── Overview charts (policy list) ───────────────────────────────────────────

function PolicyOverviewCharts({ policies }: { policies: PolicyArtifactSummary[] }) {
  const categoryData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of policies) counts.set(p.category.trim() || "Uncategorized", (counts.get(p.category.trim() || "Uncategorized") ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count }));
  }, [policies]);

  const timeline = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of policies) {
      const d = new Date(p.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const month = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).reduce<Array<{ month: string; added: number; cumulative: number }>>((rows, [month, added]) => {
      const prev = rows[rows.length - 1]?.cumulative ?? 0;
      return [...rows, { month, added, cumulative: prev + added }];
    }, []);
  }, [policies]);

  return (
    <div className="mb-6 grid gap-5 lg:grid-cols-2">
      <ChartCard title="Policies by category" subtitle="Created artifacts per policy area">
        {categoryData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(200, categoryData.length * 44)}>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Policies" fill={C.primary} radius={[0, 8, 8, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="py-10 text-center font-sans text-sm text-secondary-400">No category data available.</p>}
      </ChartCard>

      <ChartCard title="Policy creation history" subtitle="New and cumulative artifacts over time">
        {timeline.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={timeline} margin={{ top: 4, right: 20, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Line type="monotone" dataKey="cumulative" name="Total" stroke={C.primary} strokeWidth={2.5} dot={{ r: 3, fill: C.primary }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="added" name="New this month" stroke={C.amber} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, fill: C.amber }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <p className="py-10 text-center font-sans text-sm text-secondary-400">No history available.</p>}
      </ChartCard>
    </div>
  );
}

// ─── Policy card (grid) ───────────────────────────────────────────────────────

function PolicyCard({ policy, onSelect }: { policy: PolicyArtifactSummary; onSelect: (p: PolicyArtifactSummary) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(policy)}
      className="group w-full rounded-2xl border border-secondary-100 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate font-sans text-sm font-bold text-secondary-900 group-hover:text-primary-700 transition-colors">{policy.title}</h3>
          </div>
          <p className="mt-0.5 font-sans text-xs capitalize text-secondary-400">{policy.category}</p>
        </div>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-secondary-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-500" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <UiBadge variant="success">Created</UiBadge>
        {policy.has_analysis && <UiBadge variant="default">Analysis</UiBadge>}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-sans text-[11px] text-secondary-400">
          <History className="size-3" />
          Rev {policy.revision}
        </div>
        <p className="font-sans text-[11px] text-secondary-400">{formatDate(policy.updated_at)}</p>
      </div>
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyPolicies({ canManageData, canUsePrompt }: { canManageData: boolean; canUsePrompt: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-secondary-200 bg-secondary-50/50 px-6 py-20 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-4 ring-primary-50 text-primary-400">
        <FileText className="size-8" />
      </div>
      <h2 className="font-sans text-base font-bold text-secondary-800">No policies yet</h2>
      <p className="mt-2 max-w-sm font-sans text-sm text-secondary-500 leading-relaxed">
        Use the policy analysis workspace to generate evidence-grounded policy documents. They'll appear here with full analysis.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {canUsePrompt && <Link to="/prompt"><Button><Sparkles className="mr-1.5 size-4" />Open analysis workspace</Button></Link>}
        {canManageData && <Link to="/models/new"><Button variant="secondary">Add data to workspace</Button></Link>}
      </div>
    </div>
  );
}

// ─── Main DashboardPage ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const canManagePolicies = Boolean(user?.permissions?.includes("policy:manage"));
  const canManageData     = Boolean(user?.permissions?.includes("data:manage"));
  const canUsePrompt      = Boolean(user?.permissions?.includes("prompt:use"));

  const [analysisSeed]   = useState(() => readAnalysisSeed(user?.workspace_id));
  const [showSeedAnalysis, setShowSeedAnalysis] = useState(true);
  const [analysisRequest, setAnalysisRequest]   = useState(analysisSeed.request);
  const [seedAnalysis, setSeedAnalysis]         = useState<PolicyAnalysisResult | null>(null);
  const [seedError, setSeedError]               = useState<string | null>(analysisSeed.error);

  const [policies, setPolicies]           = useState<PolicyArtifactSummary[]>([]);
  const [loading, setLoading]             = useState(true);
  const [loadError, setLoadError]         = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<DetailRequest | null>(null);
  const [detailAnalysis, setDetailAnalysis] = useState<PolicyAnalysisResult | null>(null);
  const [detailError, setDetailError]     = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => { if (analysisSeed.payload) clearAnalysis(); }, [analysisSeed.payload]);

  useEffect(() => {
    if (!analysisRequest) return;
    let cancelled = false;
    void analyzePolicy(analysisRequest.query)
      .then((r) => { if (!cancelled) setSeedAnalysis(r); })
      .catch((e: unknown) => { if (!cancelled) setSeedError(errorMessage(e, "Policy analysis failed.")); });
    return () => { cancelled = true; };
  }, [analysisRequest]);

  const loadPolicies = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true); setLoadError(null);
    try {
      const all: PolicyArtifactSummary[] = [];
      let offset = 0, total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await listPolicyArtifacts({ limit: 200, offset });
        if (requestId !== loadRequestRef.current) return;
        all.push(...page.policies);
        total = page.total;
        if (page.policies.length === 0 || all.length >= total) break;
        offset += page.policies.length;
      }
      setPolicies(all);
      setDetailRequest((cur) => cur && all.some((p) => p.id === cur.policy.id) ? cur : null);
    } catch (e) {
      if (requestId === loadRequestRef.current) setLoadError(errorMessage(e, "Failed to load policies."));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadPolicies(), 0);
    return () => { window.clearTimeout(t); loadRequestRef.current += 1; };
  }, [loadPolicies]);

  useEffect(() => {
    if (!detailRequest || detailRequest.query === null || detailRequest.storedAnalysis !== null) return;
    let cancelled = false;
    void analyzePolicy(detailRequest.query)
      .then((r) => { if (!cancelled) setDetailAnalysis(r); })
      .catch((e: unknown) => { if (!cancelled) setDetailError(errorMessage(e, "Policy analysis failed.")); });
    return () => { cancelled = true; };
  }, [detailRequest]);

  const selectPolicy = async (policy: PolicyArtifactSummary) => {
    setDetailLoading(true); setDetailAnalysis(null); setDetailError(null);
    try {
      const artifact = await getPolicyArtifact(policy.id);
      const stored   = isStoredAnalysis(artifact.analysis) ? artifact.analysis : null;
      if (stored) {
        setDetailAnalysis(stored);
        setDetailRequest({ policy: artifact, query: `Stored analysis for ${artifact.title}.`, attempt: 0, storedAnalysis: stored });
        return;
      }
      setDetailRequest({ policy: artifact, query: buildPolicyPrompt(artifact), attempt: 0, storedAnalysis: null });
    } catch (e) {
      setLoadError(errorMessage(e, "The policy artifact could not be opened."));
    } finally {
      setDetailLoading(false);
    }
  };

  const retryDetail = () => {
    setDetailAnalysis(null); setDetailError(null);
    setDetailRequest((c) => c ? { ...c, attempt: c.attempt + 1 } : null);
  };

  const closeDetail = () => { setDetailAnalysis(null); setDetailError(null); setDetailRequest(null); };

  // ── Seed analysis view ──
  if (analysisSeed.payload && showSeedAnalysis) {
    return (
      <PolicyAnalysisView
        key="analysis-seed"
        payload={analysisSeed.payload}
        result={seedAnalysis}
        loading={analysisRequest !== null && seedAnalysis === null && seedError === null}
        error={seedError}
        onRetry={() => { setSeedAnalysis(null); setSeedError(null); setAnalysisRequest((c) => c ? { ...c, attempt: c.attempt + 1 } : analysisSeed.request); }}
        onBack={() => setShowSeedAnalysis(false)}
        canManagePolicies={canManagePolicies}
        onPolicySaved={async () => { await loadPolicies(); setShowSeedAnalysis(false); }}
      />
    );
  }

  // ── Detail loading ──
  if (detailLoading) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
          <div className="relative flex size-16 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-primary-100" />
            <div className="relative flex size-12 items-center justify-center rounded-full bg-primary-50 ring-4 ring-primary-100">
              <FileText className="size-5 text-primary-500" />
            </div>
          </div>
          <p className="font-sans text-sm text-secondary-500">Loading policy artifact…</p>
        </div>
      </AppLayout>
    );
  }

  // ── Detail view ──
  if (detailRequest) {
    if (detailRequest.query === null) return <PolicyDocumentView policy={detailRequest.policy} onBack={closeDetail} />;
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
          const stored = isStoredAnalysis(artifact.analysis) ? artifact.analysis : null;
          if (stored) {
            setDetailAnalysis(stored); setDetailError(null);
            setDetailRequest((c) => c && c.policy.id === artifact.id ? { ...c, policy: artifact, query: `Stored analysis for ${artifact.title}.`, storedAnalysis: stored } : c);
            return;
          }
          const q = buildPolicyPrompt(artifact);
          if (!q) return;
          setDetailAnalysis(null); setDetailError(null);
          setDetailRequest((c) => c && c.policy.id === artifact.id ? { ...c, policy: artifact, query: q, attempt: c.attempt + 1, storedAnalysis: null } : c);
        }}
        existingPolicy={detailRequest.policy}
      />
    );
  }

  // ── Derived stats ──
  const totalCategories = new Set(policies.map((p) => p.category.trim() || "Uncategorized")).size;
  const totalUpdates    = policies.reduce((s, p) => s + Math.max(0, p.revision - 1), 0);
  const latestUpdate    = policies.reduce<string | null>((l, p) => !l || new Date(p.updated_at).getTime() > new Date(l).getTime() ? p.updated_at : l, null);

  // ── Main list view ──
  return (
    <AppLayout>
      <div className="flex-1 py-8">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">

          {/* Page header */}
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 font-sans text-[11px] font-bold uppercase tracking-widest text-primary-500">Workspace policies</p>
              <h1 className="font-sans text-2xl font-extrabold tracking-tight text-secondary-900">Policy Dashboard</h1>
              <p className="mt-1 font-sans text-sm text-secondary-500">Select any policy artifact to view its implementation analysis.</p>
            </div>
            <div className="flex items-center gap-2">
              {canManageData && <Link to="/models/new"><Button variant="ghost" size="sm">Add data</Button></Link>}
              <Button variant="secondary" size="sm" onClick={() => void loadPolicies()} loading={loading}>
                <RefreshCw className={cn("mr-1.5 size-3.5", loading && "animate-spin")} />Refresh
              </Button>
            </div>
          </div>

          {loadError && (
            <Alert variant="error" title="Could not load policies" onClose={() => setLoadError(null)} className="mb-6">
              <div className="flex flex-wrap items-center gap-3">
                <span>{loadError}</span>
                <Button size="sm" variant="secondary" onClick={() => void loadPolicies()}>Try again</Button>
              </div>
            </Alert>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24">
              <Spinner size="lg" label="Loading policies" />
              <p className="font-sans text-sm text-secondary-400">Reading workspace artifacts…</p>
            </div>
          ) : policies.length === 0 ? (
            <EmptyPolicies canManageData={canManageData} canUsePrompt={canUsePrompt} />
          ) : (
            <>
              {/* Stat cards */}
              <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard icon={<FileText className="size-5" />}  label="Policies"       value={policies.length}                              sub="created artifacts"   color="primary" />
                <StatCard icon={<LayoutGrid className="size-5" />} label="Categories"    value={totalCategories}                              sub="policy areas"        color="violet"  />
                <StatCard icon={<History className="size-5" />}    label="Revisions"      value={totalUpdates}                                sub="saved updates"       color="amber"   />
                <StatCard icon={<Clock className="size-5" />}      label="Last updated"   value={latestUpdate ? formatDate(latestUpdate) : "—"} sub="workspace artifact" color="teal"    />
              </div>

              {/* Overview charts */}
              <PolicyOverviewCharts policies={policies} />

              <Separator className="mb-6" />

              {/* Policy grid */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-sans text-base font-bold text-secondary-900">Saved policies</h2>
                  <p className="mt-0.5 font-sans text-xs text-secondary-500">Click any card to open its full evidence analysis.</p>
                </div>
                <UiBadge variant="default">{policies.length} artifact{policies.length === 1 ? "" : "s"}</UiBadge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {policies.map((p) => <PolicyCard key={p.id} policy={p} onSelect={selectPolicy} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
