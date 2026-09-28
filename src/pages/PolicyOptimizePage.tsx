import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis, YAxis,
} from "recharts";
import Alert from "../components/Alert";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import Spinner from "../components/Spinner";
import {
  analyzePolicy,
  getPolicyArtifact,
  listPolicyArtifacts,
  MODEL_DISPLAY_NAME,
  updatePolicyArtifact,
  type AnalysisPriority,
  type PolicyAnalysisResult,
  type PolicyArtifact,
  type PolicyArtifactSummary,
  type PolicyAssessment,
} from "../lib/ragApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lever {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

/** A policy from the database, joined with its category's lever template. */
interface OptimizablePolicy {
  id: string;
  title: string;
  category: string;
  /** Normalised category key used to pick the lever template. */
  categoryKey: string;
  label: string;
  icon: string;
  color: string;
  levers: Lever[];
  hasAnalysis: boolean;
  updatedAt: string;
}

/** The subset of the /rag/analyze payload this page renders. */
interface OptimizationResult {
  policyName: string;
  category: string;
  summary: string;
  evidenceStatus: PolicyAnalysisResult["evidence_status"];
  confidence: number;
  feasibility: PolicyAssessment;
  likelihood: PolicyAssessment;
  recommendations: {
    title: string;
    detail: string;
    impact: "high" | "medium" | "low";
    expectedImpact: string;
    timeframe: string;
  }[];
  /** Radar axes, normalised to 0–100. */
  dimensions: { label: string; score: number }[];
  /** Only metrics the model could ground with a baseline AND a projection. */
  metrics: {
    label: string;
    unit: string;
    baseline: number;
    projected: number;
    changePercent: number | null;
    rationale: string;
  }[];
  /** Mean of the metrics' change_percent, or null when the model gave none. */
  averageChange: number | null;
  citations: number;
  provider: string;
  model: string;
  /** True when the backend fell back to its canned template (no live model ran). */
  isDemo: boolean;
}

// ─── Category presentation + lever templates ──────────────────────────────────

/**
 * Presentation and lever templates are keyed off the `category` stored on each
 * policy in the database. The policies themselves are always loaded from
 * `GET /api/v1/policies` — nothing here invents a policy.
 */
interface CategoryConfig {
  label: string;
  icon: string;
  color: string;
  /** Levers offered for policies in this category. */
  levers: Lever[];
}

const GENERIC_LEVERS: Lever[] = [
  { key: "budget",       label: "Programme Budget",       unit: "% of GDP", min: 0.5, max: 15,  step: 0.5, description: "Public allocation to this programme as % of GDP." },
  { key: "coverage",     label: "Target Coverage",        unit: "%",        min: 0,   max: 100, step: 5,   description: "Share of the eligible population reached." },
  { key: "staffing",     label: "Staff per 1,000",        unit: "per 1000", min: 0.1, max: 20,  step: 0.1, description: "Programme staffing relative to population." },
  { key: "delivery",     label: "Delivery Rate",          unit: "%",        min: 0,   max: 100, step: 5,   description: "Share of planned activities actually delivered." },
  { key: "equity",       label: "Equity Index",           unit: "index",    min: 0,   max: 100, step: 5,   description: "Distributional fairness and access across groups." },
];

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  education: {
    label: "Education", icon: "🎓", color: "#3B5BF6",
    levers: [
      { key: "budget",       label: "Education Budget",         unit: "% of GDP", min: 1,   max: 10,  step: 0.1, description: "Total public spending on education as % of GDP." },
      { key: "teacherPay",   label: "Teacher Salary Index",     unit: "index",    min: 50,  max: 200, step: 5,   description: "Teacher salaries relative to national average wage." },
      { key: "schoolRatio",  label: "Pupil-Teacher Ratio",      unit: "pupils",   min: 10,  max: 60,  step: 1,   description: "Number of pupils per trained teacher." },
      { key: "digital",      label: "Digital Access in Schools",unit: "%",        min: 0,   max: 100, step: 5,   description: "% of schools with internet and device access." },
      { key: "gender",       label: "Gender Parity Index",      unit: "index",    min: 0.5, max: 1.2, step: 0.05,description: "Ratio of female to male school enrolment." },
    ],
  },
  healthcare: {
    label: "Healthcare", icon: "🏥", color: "#2E8B40",
    levers: [
      { key: "budget",       label: "Health Budget",            unit: "% of GDP", min: 1,   max: 15,  step: 0.5, description: "Public health expenditure as % of GDP." },
      { key: "beds",         label: "Hospital Beds",            unit: "per 1000", min: 0.5, max: 8,   step: 0.5, description: "Hospital beds per 1,000 population." },
      { key: "doctors",      label: "Doctors Density",          unit: "per 1000", min: 0.1, max: 5,   step: 0.1, description: "Physicians per 1,000 population." },
      { key: "insurance",    label: "Health Insurance Cover",   unit: "%",        min: 0,   max: 100, step: 5,   description: "% of population with any health insurance." },
      { key: "prevention",   label: "Preventive Programs",      unit: "index",    min: 0,   max: 100, step: 5,   description: "Investment index in disease prevention & immunisation." },
    ],
  },
  economic: {
    label: "Economic", icon: "📈", color: "#D97706",
    levers: [
      { key: "taxRate",      label: "Corporate Tax Rate",       unit: "%",        min: 5,   max: 50,  step: 1,   description: "Effective corporate income tax rate." },
      { key: "tradeOpen",    label: "Trade Openness",           unit: "index",    min: 10,  max: 100, step: 5,   description: "Exports + imports as % of GDP." },
      { key: "infraSpend",   label: "Infrastructure Spend",     unit: "% of GDP", min: 0.5, max: 10,  step: 0.5, description: "Public infrastructure investment as % of GDP." },
      { key: "sme",          label: "SME Support Index",        unit: "index",    min: 0,   max: 100, step: 5,   description: "Ease of doing business and SME financing access." },
      { key: "inflation",    label: "Inflation Target",         unit: "%",        min: 1,   max: 20,  step: 0.5, description: "Central bank's target inflation rate." },
    ],
  },
  infrastructure: {
    label: "Infrastructure", icon: "🏗️", color: "#7C3AED",
    levers: [
      { key: "roadBudget",   label: "Roads & Transport Budget", unit: "% of GDP", min: 0.5, max: 8,   step: 0.5, description: "Annual spending on road and transport infrastructure." },
      { key: "energyMix",    label: "Renewable Energy Share",  unit: "%",        min: 0,   max: 100, step: 5,   description: "% of electricity from renewable sources." },
      { key: "waterAccess",  label: "Clean Water Access",      unit: "%",        min: 20,  max: 100, step: 5,   description: "% of population with access to clean water." },
      { key: "broadband",    label: "Broadband Penetration",   unit: "%",        min: 0,   max: 100, step: 5,   description: "% of households with broadband internet access." },
      { key: "housing",      label: "Affordable Housing Units", unit: "k/yr",     min: 0,   max: 500, step: 10,  description: "Affordable housing units built per year (thousands)." },
    ],
  },
  governance: {
    label: "Governance", icon: "⚖️", color: "#0D9488",
    levers: [
      { key: "openData",     label: "Open Data Index",          unit: "index",    min: 0,   max: 100, step: 5,   description: "Government transparency and open data availability." },
      { key: "corruption",   label: "Anti-Corruption Budget",   unit: "% of GDP", min: 0,   max: 3,   step: 0.1, description: "Spending on anti-corruption agencies and programs." },
      { key: "eGov",         label: "E-Government Services",    unit: "%",        min: 0,   max: 100, step: 5,   description: "% of public services available online." },
      { key: "civicEng",     label: "Civic Engagement Score",   unit: "index",    min: 0,   max: 100, step: 5,   description: "Voter participation, consultations, and civil society strength." },
      { key: "judicial",     label: "Judicial Independence",    unit: "index",    min: 0,   max: 100, step: 5,   description: "Perceived independence of the judiciary." },
    ],
  },
  environment: {
    label: "Environment", icon: "🌿", color: "#2E8B40",
    levers: [
      { key: "carbonTax",    label: "Carbon Tax Rate",          unit: "$/tCO₂",  min: 0,   max: 200, step: 5,   description: "Price on carbon emissions per tonne of CO₂." },
      { key: "renewable",    label: "Renewable Investment",     unit: "% of GDP", min: 0,   max: 5,   step: 0.1, description: "Public and private renewable energy investment." },
      { key: "forestProt",   label: "Forest Protection",        unit: "% cover",  min: 0,   max: 100, step: 5,   description: "% of national land under forest protection." },
      { key: "pollution",    label: "Pollution Regulation",     unit: "index",    min: 0,   max: 100, step: 5,   description: "Strength of environmental regulation enforcement." },
      { key: "biodiversity", label: "Biodiversity Reserves",    unit: "% land",   min: 0,   max: 50,  step: 1,   description: "% of land designated as biodiversity conservation area." },
    ],
  },
};

const DEFAULT_CATEGORY: CategoryConfig = {
  label: "Policy", icon: "📋", color: "#64748B", levers: GENERIC_LEVERS,
};

/** Match a stored category string ("Education", "education", "EDUCATION") to a key. */
function normaliseCategory(category: string): string {
  const key = category.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (CATEGORY_CONFIG[key]) return key;
  const match = Object.keys(CATEGORY_CONFIG).find((candidate) =>
    candidate.startsWith(key) || key.startsWith(candidate)
  );
  return match ?? "";
}

function configFor(summary: PolicyArtifactSummary): CategoryConfig {
  const key = normaliseCategory(summary.category);
  return key ? CATEGORY_CONFIG[key] : DEFAULT_CATEGORY;
}

function toOptimizable(summary: PolicyArtifactSummary): OptimizablePolicy {
  const config = configFor(summary);
  return {
    id: summary.id,
    title: summary.title,
    category: summary.category,
    categoryKey: normaliseCategory(summary.category),
    label: config.label,
    icon: config.icon,
    color: config.color,
    levers: config.levers,
    hasAnalysis: summary.has_analysis ?? false,
    updatedAt: summary.updated_at,
  };
}

// ─── Backend call ─────────────────────────────────────────────────────────────

/** `/rag/analyze` is a long, non-streaming call — cap it in the browser. */
// Must stay above the backend's RAG_ANSWER_TIMEOUT_SECONDS (150s) so the server
// gets to respond with a real answer or a real error rather than being cancelled
// mid-flight. This is only a backstop against a truly hung connection.
const ANALYZE_TIMEOUT_MS = 180_000;

/** `PolicyAnalysisRequest.query` is capped at 4000 chars server-side. */
const MAX_QUERY_CHARS = 4000;
const TRUNCATION_NOTE = "\n(document truncated)";
const NO_BODY_PLACEHOLDER = "(no document body stored)";

function buildAnalysisQuery(
  policy: OptimizablePolicy,
  levers: Record<string, number>,
  content: string
): string {
  const targets = policy.levers
    .map((lever) => {
      const value = levers[lever.key];
      const formatted =
        value === undefined
          ? "not set"
          : `${Number.isInteger(value) ? value : value.toFixed(2)} ${lever.unit}`.trim();
      return `- ${lever.label}: ${formatted} (${lever.description})`;
    })
    .join("\n");

  const head = [
    `Scenario: a hypothetical intervention on the policy "${policy.title}"`,
    `(category: ${policy.category || policy.label}).`,
    "",
    "The following are the policy targets I have chosen (treat them as inputs to your",
    "scenario, not as claims that need verifying):",
    targets,
    "",
    "The current policy document reads:",
  ].join("\n");

  const tail = [
    "",
    "Using the evidence in my workspace as the factual baseline, analyse what these targets",
    `would do to the relevant ${policy.label.toLowerCase()} development indicators.`,
    "Report each indicator's current baseline from the evidence, then give your projected",
    "value under this scenario with a confidence score and a short rationale. Do not leave",
    "values null unless no evidence covers that indicator at all.",
    "Recommend the highest-impact policy adjustments, each with expected impact and timeframe.",
  ].join("\n");

  // The policy body is context, not the point. Reserve room for the separators and the
  // truncation note so the assembled query can never exceed the server's 4000-char limit.
  const fixed = head.length + tail.length + 1 + TRUNCATION_NOTE.length;
  const budget = Math.max(0, MAX_QUERY_CHARS - fixed);

  const trimmed = content.slice(0, budget).trim();
  const note = content.length > budget ? TRUNCATION_NOTE : "";
  const excerpt = trimmed.length > 0 ? `${trimmed}${note}` : NO_BODY_PLACEHOLDER;

  return `${head}\n${excerpt}${tail}`.slice(0, MAX_QUERY_CHARS);
}

/** Stored `analysis` is an untyped JSON blob, so validate before trusting it. */
function isStoredAnalysis(value: unknown): value is PolicyAnalysisResult {
  if (!value || typeof value !== "object") return false;
  const a = value as Partial<PolicyAnalysisResult>;
  return (
    typeof a.policy_name === "string" &&
    typeof a.summary === "string" &&
    typeof a.evidence_status === "string" &&
    typeof a.confidence === "number" &&
    Array.isArray(a.recommendations) &&
    Array.isArray(a.metrics) &&
    Array.isArray(a.dimensions) &&
    Array.isArray(a.citations) &&
    typeof a.trace_id === "string" &&
    typeof a.provider === "string" &&
    typeof a.model === "string"
  );
}

const IMPACT_BY_PRIORITY: Record<AnalysisPriority, "high" | "medium" | "low"> = {
  critical: "high",
  high: "high",
  medium: "medium",
  low: "low",
};

/** Map the grounded analysis payload onto the shape this page renders. */
function toOptimizationResult(a: PolicyAnalysisResult): OptimizationResult {
  const metrics = a.metrics
    .filter(
      (m): m is typeof m & { baseline: number; projected: number } =>
        typeof m.baseline === "number" && typeof m.projected === "number"
    )
    .map((m) => ({
      label: m.label,
      unit: m.unit,
      baseline: m.baseline,
      projected: m.projected,
      changePercent: typeof m.change_percent === "number" ? m.change_percent : null,
      rationale: m.rationale,
    }));

  const withChange = metrics.filter((m) => m.changePercent !== null);
  const averageChange = withChange.length
    ? withChange.reduce((s, m) => s + (m.changePercent ?? 0), 0) / withChange.length
    : null;

  return {
    policyName: a.policy_name,
    category: a.category,
    summary: a.summary,
    evidenceStatus: a.evidence_status,
    confidence: a.confidence,
    feasibility: a.feasibility,
    likelihood: a.likelihood,
    recommendations: a.recommendations.map((r) => ({
      title: r.title,
      detail: r.detail,
      impact: IMPACT_BY_PRIORITY[r.priority] ?? "medium",
      expectedImpact: r.expected_impact,
      timeframe: r.timeframe,
    })),
    dimensions: a.dimensions.map((d) => ({
      label: d.label,
      score: Math.round(d.score * 100),
    })),
    metrics,
    averageChange: averageChange === null ? null : Math.round(averageChange * 10) / 10,
    citations: a.citations.length,
    provider: a.provider,
    model: a.model,
    // The backend silently substitutes a canned template when every live model
    // fails (rate limits, timeouts). That output is NOT a real analysis, so flag
    // it rather than presenting it as a model projection.
    isDemo: a.provider === "demo" || a.model === "demo",
  };
}

function getDefaultLeverValues(policy: OptimizablePolicy): Record<string, number> {
  const defaults: Record<string, number> = {};
  policy.levers.forEach((lever) => {
    defaults[lever.key] = parseFloat(((lever.min + lever.max) / 2).toFixed(2));
  });
  return defaults;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const IMPACT_STYLES = {
  high:   { dot: "bg-success-500",   badge: "success" as const,   label: "High Impact"   },
  medium: { dot: "bg-primary-500",   badge: "primary" as const,   label: "Medium Impact" },
  low:    { dot: "bg-secondary-400", badge: "secondary" as const, label: "Low Impact"    },
};

function LeverSlider({
  lever,
  value,
  onChange,
}: {
  lever: Lever;
  value: number;
  onChange: (key: string, val: number) => void;
}) {
  const pct = ((value - lever.min) / (lever.max - lever.min)) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-secondary-800 font-sans">{lever.label}</p>
          <p className="text-xs text-secondary-400 font-sans">{lever.description}</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className="text-lg font-extrabold text-primary-500 font-sans tabular-nums">{value}</span>
          <span className="text-xs text-secondary-500 font-sans ml-1">{lever.unit}</span>
        </div>
      </div>
      <div className="relative">
        <div className="h-2 rounded-full bg-secondary-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={lever.min}
          max={lever.max}
          step={lever.step}
          value={value}
          onChange={(e) => onChange(lever.key, parseFloat(e.target.value))}
          aria-label={lever.label}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-2"
        />
      </div>
      <div className="flex justify-between text-xs text-secondary-400 font-sans">
        <span>{lever.min} {lever.unit}</span>
        <span>{lever.max} {lever.unit}</span>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-secondary-900 border border-secondary-700 rounded-xl px-3 py-2 shadow-xl">
      {label && <p className="text-xs text-secondary-400 font-sans mb-1">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="text-xs font-semibold font-sans" style={{ color: p.color }}>
          {p.name}: <span className="text-white">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PolicyOptimizePage() {
  const [policies, setPolicies]         = useState<OptimizablePolicy[]>([]);
  const [listLoading, setListLoading]   = useState(true);
  const [listError, setListError]       = useState<string | null>(null);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [detail, setDetail]             = useState<PolicyArtifact | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [leverValues, setLeverValues]   = useState<Record<string, number>>({});
  const [result, setResult]             = useState<OptimizationResult | null>(null);
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [alert, setAlert]               = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const loadRef = useRef(0);

  const policy = useMemo(
    () => policies.find((p) => p.id === selectedId) ?? null,
    [policies, selectedId]
  );

  // ── Load policies from the database ──
  const loadPolicies = useCallback(async () => {
    const requestId = ++loadRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const all: PolicyArtifactSummary[] = [];
      let offset = 0;
      let total = 0;
      // Page through the whole workspace, mirroring DashboardPage.
      for (;;) {
        const page = await listPolicyArtifacts({ limit: 200, offset });
        if (requestId !== loadRef.current) return;
        all.push(...page.policies);
        total = page.total;
        if (page.policies.length === 0 || all.length >= total) break;
        offset += page.policies.length;
      }
      setPolicies(all.map(toOptimizable));
      setSelectedId((current) =>
        current && all.some((p) => p.id === current) ? current : all[0]?.id ?? null
      );
    } catch (err) {
      if (requestId === loadRef.current) {
        setListError(errorMessage(err, "Could not load policies from this workspace."));
      }
    } finally {
      if (requestId === loadRef.current) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPolicies(), 0);
    return () => {
      window.clearTimeout(timer);
      loadRef.current += 1;
    };
  }, [loadPolicies]);

  // ── Load the selected policy's body + any stored analysis ──
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const requestId = ++loadRef.current;
    setDetailLoading(true);
    void getPolicyArtifact(selectedId)
      .then((artifact) => {
        if (requestId !== loadRef.current) return;
        setDetail(artifact);
        const stored = isStoredAnalysis(artifact.analysis) ? artifact.analysis : null;
        if (stored) {
          setResult(toOptimizationResult(stored));
          setAlert(
            stored.provider === "demo" || stored.model === "demo"
              ? "Showing the last saved analysis, which came from the placeholder template rather than a live model."
              : "Showing the last saved analysis for this policy. Move a lever and re-run to update it."
          );
        } else {
          setResult(null);
        }
      })
      .catch((err: unknown) => {
        if (requestId === loadRef.current) {
          setError(errorMessage(err, "That policy could not be opened."));
        }
      })
      .finally(() => {
        if (requestId === loadRef.current) setDetailLoading(false);
      });
  }, [selectedId]);

  // Reset lever defaults whenever the selected policy's lever set changes.
  useEffect(() => {
    if (!policy) return;
    setLeverValues(getDefaultLeverValues(policy));
    setSaved(false);
  }, [policy]);

  function handlePolicySelect(id: string) {
    setSelectedId(id);
    setResult(null);
    setAlert(null);
    setError(null);
    setSaved(false);
  }

  function handleLeverChange(key: string, val: number) {
    setLeverValues((prev) => ({ ...prev, [key]: val }));
    setResult(null);
    setAlert(null);
    setSaved(false);
  }

  async function handleOptimize() {
    if (!policy) return;
    setLoading(true);
    setAlert(null);
    setError(null);
    setSaved(false);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

    try {
      const analysis = await analyzePolicy(
        buildAnalysisQuery(policy, leverValues, detail?.content ?? ""),
        8,
        { signal: controller.signal }
      );
      setResult(toOptimizationResult(analysis));
      setAlert(
        analysis.provider === "demo" || analysis.model === "demo"
          ? "The live model tier was unavailable, so the backend returned a placeholder template. These numbers are NOT a real analysis of your scenario — retry later or configure a reliable model in Model Config."
          : analysis.evidence_status === "insufficient"
            ? "The model found too little supporting evidence to project this scenario. Ingest relevant documents and try again."
            : "Optimization complete. Review the projections below."
      );

      const isDemo = analysis.provider === "demo" || analysis.model === "demo";

      // Never persist a placeholder template — it would overwrite the policy's real
      // stored analysis with fabricated numbers and show up on the Dashboard as fact.
      if (isDemo) {
        setSaved(false);
        return;
      }

      // Persist the snapshot onto the policy record so the Dashboard can show it.
      setSaving(true);
      try {
        await updatePolicyArtifact(policy.id, { analysis });
        setSaved(true);
        setPolicies((prev) =>
          prev.map((p) => (p.id === policy.id ? { ...p, hasAnalysis: true } : p))
        );
      } catch (saveErr) {
        setAlert(
          (prev) =>
            `${prev ?? "Analysis complete."} It could not be saved to the policy record: ${errorMessage(saveErr, "save failed")}.`
        );
      } finally {
        setSaving(false);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setError(
          `The analysis exceeded ${ANALYZE_TIMEOUT_MS / 1000}s and was cancelled — try again in a moment.`
        );
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Unexpected error while running the analysis."
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  function handleReset() {
    if (!policy) return;
    setLeverValues(getDefaultLeverValues(policy));
    setResult(null);
    setAlert(null);
    setError(null);
  }

  const evidenceWeak = result !== null && result.evidenceStatus !== "sufficient";
  const hasMetrics = (result?.metrics.length ?? 0) > 0;
  const hasDimensions = (result?.dimensions.length ?? 0) > 0;

  // Radar: the model's own dimension scores (0–100). No invented baseline.
  const radarData = hasDimensions
    ? result!.dimensions.map((d) => ({ subject: d.label, Score: d.score }))
    : [];

  // Bar: baseline vs projected, only for metrics the model could ground.
  const barData = hasMetrics
    ? result!.metrics.map((m) => ({
        name: m.label,
        Baseline: m.baseline,
        Optimized: m.projected,
      }))
    : [];
  const barMax = barData.length
    ? Math.max(...barData.flatMap((d) => [d.Baseline, d.Optimized]))
    : 0;
  const barUnits = new Set(result?.metrics.map((m) => m.unit) ?? []);
  const barUnit = barUnits.size === 1 ? [...barUnits][0] : "";

  const changeLabel =
    result?.averageChange === null || result === null
      ? null
      : `${result.averageChange > 0 ? "+" : ""}${result.averageChange}%`;

  // ── No policy selected: nothing to optimize yet ──
  if (!listLoading && !listError && policies.length === 0) {
    return (
      <AppLayout>
        <div className="flex-1 py-10">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
            <Alert variant="info" title="No policies to optimize yet" className="mb-6">
              This page optimizes policies stored in your workspace. Create one from the
              Dashboard and it will appear here.
            </Alert>
            <Card className="text-center py-14">
              <p className="text-4xl mb-4">📋</p>
              <p className="text-base font-bold text-secondary-900 font-sans">
                No policies found in this workspace
              </p>
              <p className="text-sm text-secondary-500 font-sans mt-2">
                Generate a policy on the Dashboard, then return here to run scenarios
                against it.
              </p>
            </Card>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 py-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-primary-500">⚙️</span>
              <p className="text-xs font-semibold text-secondary-500 uppercase tracking-widest font-sans">
                Model Optimization
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold text-secondary-900 font-sans">
                  Policy Optimization
                </h1>
                <p className="mt-1 text-secondary-500 font-sans">
                  Adjust policy levers and let the model project the optimized outcome across development indicators.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-secondary-500 font-sans bg-white border border-secondary-200 rounded-xl px-3 py-2 w-fit shrink-0">
                <span className="size-2 rounded-full bg-success-500 animate-pulse" />
                {result ? MODEL_DISPLAY_NAME : "Grounded in your workspace"}
              </div>
            </div>
          </div>

          {listError && (
            <Alert variant="error" title="Could not load policies" onClose={() => setListError(null)} className="mb-6">
              <div className="flex flex-col items-start gap-3">
                <span>{listError}</span>
                <Button size="sm" variant="secondary" onClick={() => void loadPolicies()}>
                  Try again
                </Button>
              </div>
            </Alert>
          )}

          {/* Alert */}
          {alert && (
            <Alert
              variant={result?.isDemo || evidenceWeak ? "warning" : "success"}
              onClose={() => setAlert(null)}
              className="mb-6"
            >
              {alert}
            </Alert>
          )}

          {saved && !saving && (
            <Alert variant="success" className="mb-6">
              Saved to the policy record and visible on the Dashboard.
            </Alert>
          )}

          {error && (
            <Alert variant="error" onClose={() => setError(null)} className="mb-6">
              {error}
            </Alert>
          )}

          {/* Policy selector — sourced from the workspace's saved policies */}
          {listLoading ? (
            <Card className="mb-8 flex items-center justify-center py-8">
              <Spinner label="Loading policies…" />
            </Card>
          ) : (
            policies.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-8 p-1.5 bg-white rounded-2xl border border-secondary-100 shadow-sm">
                {policies.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePolicySelect(p.id)}
                    className={[
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold font-sans transition-all",
                      selectedId === p.id
                        ? "bg-primary-500 text-white shadow-sm"
                        : "text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900",
                    ].join(" ")}
                  >
                    <span>{p.icon}</span>
                    <span className="max-w-[220px] truncate">{p.title}</span>
                    {p.hasAnalysis && (
                      <span
                        className={[
                          "size-1.5 rounded-full",
                          selectedId === p.id ? "bg-white/70" : "bg-success-500",
                        ].join(" ")}
                        title="Has a saved analysis"
                      />
                    )}
                  </button>
                ))}
              </div>
            )
          )}

          {!policy ? null : (
          <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">

            {/* ── Left: levers + results ── */}
            <div className="flex flex-col gap-6">

              {/* Levers card */}
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex size-10 items-center justify-center rounded-xl text-xl"
                      style={{ background: policy.color + "18" }}
                    >
                      {policy.icon}
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-secondary-900 font-sans">
                        {policy.title}
                      </h2>
                      <p className="text-xs text-secondary-500 font-sans">
                        {policy.category || policy.label} · drag each lever to set a target value
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs text-secondary-500 hover:text-secondary-800 underline underline-offset-2 font-sans transition-colors"
                  >
                    Reset
                  </button>
                </div>

                <div className="flex flex-col divide-y divide-secondary-100">
                  {policy.levers.map((lever) => (
                    <div key={lever.key} className="py-5 first:pt-0 last:pb-0">
                      <LeverSlider
                        lever={lever}
                        value={leverValues[lever.key] ?? lever.min}
                        onChange={handleLeverChange}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={handleOptimize}
                    loading={loading}
                    size="md"
                    fullWidth
                    disabled={detailLoading}
                  >
                    {loading ? "Optimizing…" : "Run Model Optimization"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleReset}
                    disabled={loading || detailLoading}
                    className="sm:w-auto w-full"
                  >
                    Reset levers
                  </Button>
                </div>
              </Card>

              {/* Results stay mounted during reruns; the button itself shows loading state. */}
              {result && (
                <>
                  {/* Summary */}
                <Card
                  className={
                    result?.isDemo
                      ? "border-warning-200 bg-warning-50/40"
                      : evidenceWeak
                        ? "border-warning-200 bg-warning-50/40"
                        : "border-success-200 bg-success-50/40"
                  }
                >
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 flex size-10 items-center justify-center rounded-xl bg-success-100 text-xl">
                      {result.isDemo ? "⚠" : "🤖"}
                    </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <p className="text-sm font-bold text-secondary-900 font-sans">
                            Model Optimization Summary
                          </p>
                          {changeLabel && <Badge variant="success">{changeLabel} avg change</Badge>}
                          {result.isDemo && <Badge variant="primary">placeholder</Badge>}
                          <Badge variant={evidenceWeak ? "primary" : "secondary"}>
                            {result.evidenceStatus} evidence
                          </Badge>
                          <Badge variant="secondary">{Math.round(result.confidence * 100)}% confidence</Badge>
                        </div>
                        <p className="text-sm text-secondary-700 font-sans leading-relaxed">
                          {result.summary}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-secondary-500 font-sans">
                          {result.feasibility.score !== null && (
                            <span>
                              Feasibility{" "}
                              <strong className="text-secondary-800">
                                {Math.round(result.feasibility.score * 100)}%
                              </strong>
                            </span>
                          )}
                          {result.likelihood.score !== null && (
                            <span>
                              Likelihood{" "}
                              <strong className="text-secondary-800">
                                {Math.round(result.likelihood.score * 100)}%
                              </strong>
                            </span>
                          )}
                          <span>
                            Grounded on <strong className="text-secondary-800">{result.citations}</strong>{" "}
                            {result.citations === 1 ? "source" : "sources"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Recommendations */}
                  {result.recommendations.length > 0 && (
                    <Card>
                      <h3 className="text-sm font-bold text-secondary-900 font-sans mb-5">
                        Recommended Actions
                      </h3>
                      <div className="flex flex-col gap-4">
                        {result.recommendations.map((rec, i) => {
                          const s = IMPACT_STYLES[rec.impact];
                          return (
                            <div key={i} className="flex gap-4 p-4 rounded-xl bg-secondary-50 border border-secondary-100">
                              <div className={["shrink-0 size-2.5 rounded-full mt-1.5", s.dot].join(" ")} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <p className="text-sm font-bold text-secondary-900 font-sans">{rec.title}</p>
                                  <Badge variant={s.badge}>{s.label}</Badge>
                                  {rec.timeframe && (
                                    <span className="text-xs text-secondary-400 font-sans">
                                      {rec.timeframe}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-secondary-600 font-sans leading-relaxed">{rec.detail}</p>
                                {rec.expectedImpact && (
                                  <p className="text-xs text-primary-600 font-sans mt-1.5">
                                    Expected impact: {rec.expectedImpact}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}

                  {/* Baseline vs projected */}
                  <Card>
                    <h3 className="text-sm font-bold text-secondary-900 font-sans mb-1">
                      Baseline vs Projected — Evidence-backed Indicators
                    </h3>
                    <p className="text-xs text-secondary-500 font-sans mb-5">
                      {barUnit
                        ? `Reported in ${barUnit}. Only indicators supported by workspace evidence are shown.`
                        : "Only indicators supported by workspace evidence are shown."}
                    </p>
                    {hasMetrics ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={barData} barGap={3}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9A9A9A", fontFamily: "Exo, sans-serif" }} axisLine={false} tickLine={false} />
                          <YAxis domain={[0, Math.ceil(barMax * 1.15) || 1]} tick={{ fontSize: 11, fill: "#9A9A9A", fontFamily: "Exo, sans-serif" }} axisLine={false} tickLine={false} />
                          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(59,91,246,0.04)" }} />
                          <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Exo, sans-serif" }} />
                          <Bar dataKey="Baseline"  fill="#CBD5E1" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="Optimized" fill={policy.color} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-secondary-500 font-sans py-8 text-center">
                        The model did not return a baseline and projection for any indicator. Ingest
                        documents covering {policy.label.toLowerCase()} outcomes to enable this chart.
                      </p>
                    )}
                  </Card>
                </>
              )}
            </div>

            {/* ── Right: radar chart (sticky) ── */}
            <div className="flex flex-col gap-5 lg:sticky lg:top-24">

              {/* Radar */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-secondary-900 font-sans">
                    Indicator Radar
                  </h3>
                  {result && changeLabel && (
                    <Badge variant="success">{changeLabel} avg</Badge>
                  )}
                </div>

                {hasDimensions ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                      <PolarGrid stroke="#E5E7EB" />
                      <PolarAngleAxis
                        dataKey="subject"
                        tick={{ fontSize: 11, fill: "#6B7280", fontFamily: "Exo, sans-serif" }}
                      />
                      <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#9A9A9A" }} angle={30} />
                      <Radar
                        name="Score"
                        dataKey="Score"
                        stroke={policy.color}
                        strokeWidth={2.5}
                        fill={policy.color}
                        fillOpacity={0.2}
                        dot={{ r: 4, fill: policy.color }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Exo, sans-serif" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center px-4 text-center">
                    <p className="text-sm text-secondary-400 font-sans">
                      {result
                        ? "The model did not return scored dimensions for this scenario."
                        : "Run optimization to see the model's dimension scores."}
                    </p>
                  </div>
                )}

                {result && (
                  <p className="text-xs text-center text-secondary-400 font-sans mt-2">
                    Dimension scores out of 100, as assessed by the model from workspace evidence
                  </p>
                )}
              </Card>

              {/* Indicator table */}
              <Card>
                <h3 className="text-sm font-bold text-secondary-900 font-sans mb-4">
                  {result ? "Projected Indicators" : "Indicator Scores"}
                </h3>
                {hasMetrics ? (
                  <div className="flex flex-col gap-3">
                    {result!.metrics.map((m) => {
                      const delta = m.projected - m.baseline;
                      const peak = Math.max(m.baseline, m.projected) || 1;
                      return (
                        <div key={m.label} className="flex flex-col gap-1">
                          <div className="flex items-center gap-3">
                            <p className="text-xs text-secondary-700 font-sans flex-1 min-w-0 truncate">
                              {m.label}
                              {m.unit && <span className="text-secondary-400"> ({m.unit})</span>}
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                              <span className="text-xs text-secondary-500 font-sans">
                                {m.baseline}
                              </span>
                              <span className="text-xs text-secondary-300 font-sans">→</span>
                              <span className="text-xs font-bold text-secondary-800 font-sans">
                                {m.projected}
                              </span>
                              <span
                                className={[
                                  "text-xs font-bold font-sans w-14 text-right",
                                  delta > 0
                                    ? "text-success-600"
                                    : delta < 0
                                      ? "text-error-600"
                                      : "text-secondary-400",
                                ].join(" ")}
                              >
                                {delta > 0 ? "+" : ""}
                                {Math.round(delta * 100) / 100}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 h-1.5">
                            <div
                              className="h-full rounded-full bg-secondary-300 transition-all"
                              style={{ width: `${(m.baseline / peak) * 100}%` }}
                            />
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${(m.projected / peak) * 100}%`, background: policy.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-secondary-400 font-sans py-6 text-center">
                    {result
                      ? "No evidence-backed indicator projections were returned."
                      : "Run optimization to see baseline vs projected values."}
                  </p>
                )}
                {result && changeLabel && (
                  <div className="mt-4 pt-4 border-t border-secondary-100 flex items-center justify-between">
                    <p className="text-xs text-secondary-500 font-sans">Average change</p>
                    <Badge variant="success">{changeLabel}</Badge>
                  </div>
                )}
              </Card>

              {/* Help card */}
              <Card className="bg-secondary-900 border-secondary-800">
                <p className="text-xs font-semibold text-secondary-400 uppercase tracking-widest mb-2 font-sans">
                  How it works
                </p>
                <p className="text-sm text-secondary-300 font-sans leading-relaxed">
                  Choose a policy from this workspace, adjust its levers, then click{" "}
                  <strong className="text-white">Run Model Optimization</strong>. The policy body and your
                  targets are sent to <strong className="text-white">POST /api/v1/rag/analyze</strong>, which
                  retrieves supporting passages from your ingested workspace and asks the model for grounded
                  projections.{" "}
                  {saving ? (
                    <strong className="text-white">Saving this run to the policy record…</strong>
                  ) : (
                    result && (
                      <>
                        {result.isDemo ? (
                          <>
                            Last run fell back to the{" "}
                            <strong className="text-warning-400">placeholder template</strong> because no live
                            model was available, so the values above are not a real projection
                            {result.citations > 0
                              ? `, even though ${result.citations} retrieved ${result.citations === 1 ? "source was" : "sources were"} found`
                              : ""}
                            .
                          </>
                        ) : (
                          <>
                            Last run:{" "}
                            <strong className="text-white">
                              {MODEL_DISPLAY_NAME}
                            </strong>
                            {result.citations > 0
                              ? ` across ${result.citations} retrieved ${result.citations === 1 ? "source" : "sources"}`
                              : " with no supporting sources"}
                            .
                          </>
                        )}
                      </>
                    )
                  )}
                </p>
              </Card>
            </div>
          </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
