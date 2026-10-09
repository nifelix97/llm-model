import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Target } from "lucide-react";
import {
  AssistantRuntimeProvider,
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type AppendMessage,
  type MessageState,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import AppLayout from "../components/AppLayout";
import MarkdownContent from "../components/MarkdownContent";
import { detectCategory, saveAnalysis } from "../context/AnalysisContext";
import { useAuth } from "../context/AuthContext";
import {
  appendConversationMessages,
  approveCaseBaselines,
  approveCaseIndicators,
  approveCaseInterventions,
  compareCaseScenarios,
  createConversation,
  deleteConversation,
  getConversation,
  getTransformationCase,
  listConversations,
  optimizePromptRequest,
  proposeCaseBaselines,
  proposeCaseIndicators,
  proposeCaseInterventions,
  queryRag,
  RagApiError,
  scorePercent,
  type ChatMessage,
  type ChatMessageInput,
  type Citation,
  type ConversationSummary,
  type BaselineProposal,
  type IndicatorProposal,
  type InterventionProposal,
  type IntentResult,
  type QueryResult,
  type ScenarioComparison,
  type TransformationCase,
} from "../lib/ragApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "user" | "assistant" | "system";

interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  streaming?: boolean;
  originalInput?: string;
  prompt?: string;
  citations?: Citation[];
  traceId?: string;
  isError?: boolean;
  intent?: IntentResult;
  telemetry?: QueryResult["telemetry"];
  answerMode?: QueryResult["answer_mode"];
  action?: CaseAction;
  scenario?: ScenarioComparison;
}

type CaseActionKind = "indicators" | "baselines" | "interventions";
type CaseAction =
  | { kind: "indicators"; status: "pending" | "approved"; proposal: IndicatorProposal }
  | { kind: "baselines"; status: "pending" | "approved"; proposal: BaselineProposal }
  | { kind: "interventions"; status: "pending" | "approved"; proposal: InterventionProposal };

// ─── Constants ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Summarize the key development policies of Sub-Saharan Africa.",
  "What factors drive GDP growth in developing nations?",
  "Compare healthcare infrastructure in low vs high-income countries.",
  "What are the best practices for renewable energy adoption?",
];

const SETTLEMENT_SUGGESTIONS = [
  "Set up the settlement indicators for this case using the linked evidence.",
  "Extract explicit baseline values and exact source references for the approved indicators.",
  "Propose interventions that improve service access while controlling sprawl and environmental risk.",
  "Compare the available settlement actions and explain the main trade-offs.",
];

function detectCaseAction(prompt: string): CaseActionKind | null {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("baseline") || normalized.includes("extract values") || normalized.includes("current values")) return "baselines";
  if (normalized.includes("intervention") || normalized.includes("action option") || normalized.includes("settlement actions")) return "interventions";
  if (normalized.includes("indicator") || normalized.includes("measure progress") || normalized.includes("success measure")) return "indicators";
  return null;
}

function detectsScenarioPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (normalized.includes("compare") || normalized.includes("scenario") || normalized.includes("what-if") || normalized.includes("what if"))
    && (normalized.includes("rurban") || normalized.includes("consolidat") || normalized.includes("settlement") || normalized.includes("option"));
}

function actionLabel(kind: CaseActionKind): string {
  if (kind === "indicators") return "Indicators";
  if (kind === "baselines") return "Baseline evidence";
  return "Interventions";
}

async function buildCaseAction(caseId: string, kind: CaseActionKind, prompt: string): Promise<CaseAction> {
  if (kind === "indicators") return { kind, status: "pending", proposal: await proposeCaseIndicators(caseId, prompt) };
  if (kind === "baselines") return { kind, status: "pending", proposal: await proposeCaseBaselines(caseId, prompt) };
  return { kind, status: "pending", proposal: await proposeCaseInterventions(caseId, prompt) };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function messageFromServer(m: ChatMessage): Message {
  const meta = (m.metadata ?? {}) as Record<string, unknown>;
  const rawCitations = meta.citations;
  const citations =
    Array.isArray(rawCitations) && rawCitations.length > 0
      ? (rawCitations as Citation[])
      : undefined;
  const answerMode =
    (meta.answer_mode as QueryResult["answer_mode"]) ??
    (m.content.startsWith("I could not generate a synthesized answer right now.")
      ? "evidence_only"
      : undefined);
  return {
    id: m.id,
    role: m.role as Role,
    content: m.content,
    timestamp: new Date(m.created_at),
    originalInput: typeof meta.original_input === "string" ? meta.original_input : undefined,
    prompt: m.prompt ?? undefined,
    citations,
    traceId: m.trace_id ?? undefined,
    isError: meta.is_error === true ? true : undefined,
    intent: (meta.intent as IntentResult) ?? undefined,
    telemetry: (meta.telemetry as QueryResult["telemetry"]) ?? undefined,
    answerMode,
    action: meta.action as CaseAction | undefined,
    scenario: meta.scenario as ScenarioComparison | undefined,
  };
}

function toServerMessage(m: Message): ChatMessageInput {
  return {
    role: m.role as ChatMessageInput["role"],
    content: m.content,
    prompt: m.prompt ?? null,
    trace_id: m.traceId ?? null,
    metadata: {
      original_input: m.originalInput ?? null,
      citations: m.citations ?? [],
      is_error: m.isError === true,
      intent: m.intent ?? null,
      telemetry: m.telemetry ?? null,
      answer_mode: m.answerMode ?? null,
      action: m.action ?? null,
      scenario: m.scenario ?? null,
    },
  };
}

function revealAnswer(
  full: string,
  onPartial: (partial: string, done: boolean) => void,
  onDone: () => void
): () => void {
  let idx = 0;
  const interval = setInterval(() => {
    idx += Math.floor(Math.random() * 4) + 2;
    const done = idx >= full.length;
    onPartial(full.slice(0, idx), done);
    if (done) {
      clearInterval(interval);
      onDone();
    }
  }, 18);
  return () => clearInterval(interval);
}

// ─── Typing dots ──────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 h-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-primary-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
        />
      ))}
    </span>
  );
}

// ─── Citations ────────────────────────────────────────────────────────────────

function CitationsPanel({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (citations.length === 0) return null;

  return (
    <div className="mt-2 w-full max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold font-sans text-secondary-600 hover:text-primary-600 hover:bg-primary-50 transition-colors"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        {citations.length} source{citations.length === 1 ? "" : "s"}
        <svg
          className={["size-3 transition-transform", open ? "rotate-180" : ""].join(" ")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {citations.map((c, i) => (
            <li
              key={c.chunk_id}
              className="rounded-xl border border-secondary-200 bg-secondary-50 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs font-semibold text-secondary-800 font-sans">
                  [{i + 1}] {c.title}
                </p>
                <span className="shrink-0 text-xs font-sans text-primary-600 bg-primary-50 border border-primary-100 px-1.5 py-0.5 rounded-md">
                  {scorePercent(c.score)}
                </span>
              </div>
              <p className="text-xs text-secondary-500 font-sans mb-1 capitalize">{c.source_type}</p>
              <p className="text-xs text-secondary-700 font-sans leading-relaxed line-clamp-4 whitespace-pre-wrap">
                {c.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Intent Badge ─────────────────────────────────────────────────────────────

function IntentBadge({ intent }: { intent: string | IntentResult }) {
  const intentStr = typeof intent === "string" ? intent : intent.intent;
  const category = typeof intent === "object" ? intent.category : undefined;
  const isScenario = typeof intent === "object" ? intent.is_scenario : false;

  const config: Record<string, { label: string; bg: string; text: string; icon: string }> = {
    conversational: {
      label: "Chat",
      bg: "bg-blue-50 border-blue-200",
      text: "text-blue-700",
      icon: "💬",
    },
    factual_rag: {
      label: "Factual Retrieval",
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-700",
      icon: "🔍",
    },
    policy_analysis: {
      label: "Policy Analysis",
      bg: "bg-purple-50 border-purple-200",
      text: "text-purple-700",
      icon: "📊",
    },
    keyword_lookup: {
      label: "Keyword Lookup",
      bg: "bg-amber-50 border-amber-200",
      text: "text-amber-700",
      icon: "🏷️",
    },
  };

  const item = config[intentStr] || {
    label: intentStr.replace(/_/g, " "),
    bg: "bg-secondary-50 border-secondary-200",
    text: "text-secondary-700",
    icon: "⚡",
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 font-sans">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${item.bg} ${item.text}`}
      >
        <span>{item.icon}</span>
        <span>{item.label}</span>
      </span>
      {category && category !== "general" && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-secondary-200 bg-white text-secondary-600 text-[11px] font-medium capitalize">
          {category}
        </span>
      )}
      {isScenario && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-[11px] font-medium">
          Scenario Simulation
        </span>
      )}
    </div>
  );
}

// ─── Telemetry panel ──────────────────────────────────────────────────────────

function TelemetryPanel({ telemetry }: { telemetry: NonNullable<QueryResult["telemetry"]> }) {
  const [open, setOpen] = useState(false);

  const totalMs = telemetry.total_ms ?? 0;
  const searchStrategy = telemetry.search_strategy ?? "hybrid_rrf";
  const rerankMs = telemetry.rerank_ms ?? 0;
  const searchMs = telemetry.search_ms ?? 0;
  const embedMs = telemetry.embed_ms ?? 0;
  const genMs = telemetry.generate_ms ?? 0;

  return (
    <div className="mt-2 w-full max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold font-sans text-secondary-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
        <span>{totalMs > 0 ? `${totalMs.toFixed(0)}ms` : "Pipeline Telemetry"}</span>
        {searchStrategy === "hybrid_rrf" && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
            Hybrid RRF
          </span>
        )}
        <svg
          className={["size-3 transition-transform", open ? "rotate-180" : ""].join(" ")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-secondary-200 bg-secondary-50/70 p-3 font-sans text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <div className="bg-white p-2 rounded-lg border border-secondary-200">
              <span className="text-secondary-400 block text-[10px] uppercase font-semibold">Strategy</span>
              <span className="text-secondary-800 font-medium capitalize">{searchStrategy.replace("_", " ")}</span>
            </div>
            <div className="bg-white p-2 rounded-lg border border-secondary-200">
              <span className="text-secondary-400 block text-[10px] uppercase font-semibold">Embed</span>
              <span className="text-secondary-800 font-medium">{embedMs.toFixed(1)} ms</span>
            </div>
            <div className="bg-white p-2 rounded-lg border border-secondary-200">
              <span className="text-secondary-400 block text-[10px] uppercase font-semibold">Search / Rerank</span>
              <span className="text-secondary-800 font-medium">{searchMs.toFixed(1)} / {rerankMs.toFixed(1)} ms</span>
            </div>
            <div className="bg-white p-2 rounded-lg border border-secondary-200">
              <span className="text-secondary-400 block text-[10px] uppercase font-semibold">Gen Latency</span>
              <span className="text-secondary-800 font-medium">{genMs.toFixed(1)} ms</span>
            </div>
          </div>

          {(telemetry.estimated_prompt_tokens !== undefined || telemetry.estimated_completion_tokens !== undefined) && (
            <div className="flex items-center justify-between text-[11px] text-secondary-500 pt-1 border-t border-secondary-200">
              <span>Estimated Tokens: ~{(telemetry.estimated_prompt_tokens ?? 0) + (telemetry.estimated_completion_tokens ?? 0)} total</span>
              <span>Prompt: ~{telemetry.estimated_prompt_tokens ?? 0} · Completion: ~{telemetry.estimated_completion_tokens ?? 0}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Optimize preview panel ───────────────────────────────────────────────────

function OptimizePreview({
  original,
  optimized,
  onAccept,
  onEdit,
  onSendOriginal,
  onDismiss,
}: {
  original: string;
  optimized: string;
  onAccept: (final: string) => void;
  onEdit: (edited: string) => void;
  onSendOriginal: () => void;
  onDismiss: () => void;
}) {
  const [currentOptimized, setCurrentOptimized] = useState(optimized);
  const [editMode, setEditMode] = useState(false);
  const [editedText, setEditedText] = useState(optimized);
  const [reoptimizing, setReoptimizing] = useState(false);
  const [history, setHistory] = useState<string[]>([optimized]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editMode) taRef.current?.focus();
  }, [editMode]);

  async function handleOptimizeEdited() {
    const current = editedText.trim();
    if (!current || reoptimizing) return;
    setReoptimizing(true);
    try {
      const res = await optimizePromptRequest(current);
      const next = (res.optimized_prompt ?? "").trim() || current;
      setHistory((prev) => [...prev, next]);
      setCurrentOptimized(next);
      setEditedText(next);
      setEditMode(false);
    } catch {
      setEditMode(false);
      setEditedText(currentOptimized);
    } finally {
      setReoptimizing(false);
    }
  }

  function handleStepBack() {
    if (history.length <= 1) return;
    const prev = history[history.length - 2];
    setHistory((h) => h.slice(0, -1));
    setCurrentOptimized(prev);
    setEditedText(prev);
    setEditMode(false);
  }

  return (
    <div className="shrink-0 border-t border-secondary-200 bg-white px-4 py-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-primary-200 bg-primary-50/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-primary-200 bg-primary-50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-primary-600 font-sans uppercase tracking-wider">
                Prompt optimized
              </span>
              {history.length > 1 && (
                <span className="text-xs text-primary-400 font-sans">· pass {history.length}</span>
              )}
            </div>
            <button type="button" onClick={onDismiss} aria-label="Discard this prompt" className="text-secondary-400 hover:text-secondary-700 transition-colors">
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-4 py-3 flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-secondary-400 font-sans mb-1">Original input</p>
              <p className="text-sm text-secondary-400 font-sans line-through leading-relaxed">{original}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-primary-600 font-sans">
                  {editMode ? "Your edits" : "Optimized prompt"}
                </p>
                {history.length > 1 && !editMode && (
                  <button type="button" onClick={handleStepBack} className="text-xs text-secondary-500 hover:text-secondary-800 font-sans transition-colors flex items-center gap-1">
                    Undo pass
                  </button>
                )}
              </div>

              {editMode ? (
                <textarea
                  ref={taRef}
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={4}
                  className="w-full text-sm text-secondary-900 font-sans bg-white border border-primary-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-primary-400 resize-none leading-relaxed"
                />
              ) : (
                <p className="text-sm text-secondary-800 font-sans leading-relaxed">{currentOptimized}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!editMode ? (
                <button
                  type="button"
                  onClick={() => onAccept(currentOptimized)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-500 text-white text-xs font-bold font-sans hover:bg-primary-600 transition-colors"
                >
                  Send optimized
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleOptimizeEdited}
                    disabled={reoptimizing || !editedText.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-500 text-white text-xs font-bold font-sans hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {reoptimizing ? "Optimizing…" : "Optimize again"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(editedText)}
                    disabled={reoptimizing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-secondary-200 bg-white text-secondary-700 text-xs font-semibold font-sans hover:border-primary-300 hover:text-primary-600 disabled:opacity-50 transition-colors"
                  >
                    Send as edited
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setEditedText(currentOptimized);
                    }}
                    className="px-4 py-2 rounded-xl border border-secondary-200 bg-white text-secondary-500 text-xs font-semibold font-sans hover:border-secondary-300 transition-colors"
                  >
                    Back
                  </button>
                </>
              )}

              {!editMode && (
                <button
                  type="button"
                  onClick={() => {
                    setEditMode(true);
                    setEditedText(currentOptimized);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-secondary-200 bg-white text-secondary-700 text-xs font-semibold font-sans hover:border-primary-300 hover:text-primary-600 transition-colors"
                >
                  Edit
                </button>
              )}

              <button
                type="button"
                onClick={onSendOriginal}
                className="px-4 py-2 rounded-xl border border-secondary-200 bg-white text-secondary-500 text-xs font-semibold font-sans hover:border-secondary-300 hover:text-secondary-700 transition-colors"
              >
                Send original
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="px-4 py-2 rounded-xl text-secondary-400 text-xs font-semibold font-sans hover:text-secondary-600 transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

type BriefSignal = {
  value: string;
  label: string;
};

function settlementSignals(content: string): BriefSignal[] {
  const signals: BriefSignal[] = [];
  const add = (value: string, label: string) => signals.push({ value, label });
  if (/182[\s,]*120\s*(?:to|→|->)\s*303[\s,]*120/i.test(content)) add("182,120 → 303,120", "water capacity · m³/day");
  if (/1[\s,]*500\s*MW/i.test(content)) add("1,500 MW", "power supply target");
  if (/3[\s,]*000\s+health posts/i.test(content)) add("3,000", "health posts by 2050");
  if (/3[\s,]*980\s*km²/i.test(content)) add("3,980 km²", "planned built area");
  return signals.slice(0, 4);
}

function SettlementDecisionInfographic({ content }: { content: string }) {
  const lower = content.toLowerCase();
  const isSettlementComparison = lower.includes("rurban") && (lower.includes("consolidat") || lower.includes("agglomeration"));
  if (!isSettlementComparison) return null;

  const signals = settlementSignals(content);
  return (
    <section className="mb-5 overflow-hidden rounded-[22px] border border-primary-200/80 bg-[linear-gradient(135deg,#f3f6ff_0%,#ffffff_54%,#f0fbfa_100%)]">
      <div className="flex flex-col gap-4 border-b border-primary-100/80 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary-600">Settlement decision map</p>
          <h3 className="mt-1.5 font-sans text-xl font-extrabold tracking-tight text-secondary-950">From scattered growth to planned concentration</h3>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-secondary-600">The evidence favors concentrating future investment in planned agglomerations while limiting further rurban expansion.</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm">
          <CheckCircle2 className="size-4" /> Preferred direction
        </div>
      </div>

      <div className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/75 p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-700">Current pattern</p>
          <p className="mt-2 font-sans text-lg font-extrabold text-secondary-900">Rurban spread</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary-600">Small settlements and trade centers dispersed across the territory, making service delivery and land management harder.</p>
        </div>
        <div className="flex items-center justify-center text-primary-500"><ArrowRight className="hidden size-6 md:block" /><ArrowRight className="size-6 rotate-90 md:hidden" /></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/75 p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">Preferred direction</p>
          <p className="mt-2 font-sans text-lg font-extrabold text-secondary-900">Planned agglomerations</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary-600">Direct growth and infrastructure toward stronger urban centers, with a freeze on uncontrolled expansion.</p>
        </div>
      </div>

      {signals.length > 0 && <div className="border-t border-primary-100/80 px-5 py-4"><div className="mb-3 flex items-center gap-2"><Target className="size-4 text-primary-600" /><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-secondary-600">Evidence-backed targets</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{signals.map((signal) => <div key={signal.label} className="rounded-xl border border-white/90 bg-white/80 px-3 py-3 shadow-sm"><p className="font-sans text-lg font-extrabold tracking-tight text-secondary-950">{signal.value}</p><p className="mt-1 text-[11px] font-medium leading-snug text-secondary-500">{signal.label}</p></div>)}</div></div>}

      <div className="flex flex-wrap items-center gap-2 border-t border-primary-100/80 px-5 py-3.5 text-[11px] font-semibold text-secondary-500">
        <span className="rounded-full bg-white/85 px-3 py-1.5 text-primary-700 shadow-sm">Evidence</span><ArrowRight className="size-3.5 text-secondary-300" /><span className="rounded-full bg-white/85 px-3 py-1.5">Compare options</span><ArrowRight className="size-3.5 text-secondary-300" /><span className="rounded-full bg-white/85 px-3 py-1.5">Approve next action</span>
      </div>
    </section>
  );
}

function CaseActionCard({
  action,
  onApprove,
  approving,
}: {
  action: CaseAction;
  onApprove: () => void;
  approving: boolean;
}) {
  const isApproved = action.status === "approved";
  const proposal = action.proposal;
  const items: Array<{ name?: string; indicator_name?: string; definition?: string; unit?: string; baseline_value?: number; rationale?: string; description?: string; quality_status?: string; priority?: string }> = action.kind === "indicators"
    ? action.proposal.indicators.slice(0, 4).map((item) => ({ name: item.name, definition: item.definition, unit: item.unit }))
    : action.kind === "baselines"
      ? action.proposal.updates.slice(0, 4).map((item) => ({ indicator_name: item.indicator_name, baseline_value: item.baseline_value, rationale: item.rationale, quality_status: item.quality_status }))
      : action.proposal.interventions.slice(0, 4).map((item) => ({ name: item.name, description: item.description, priority: item.priority }));
  return (
    <div className="mt-4 rounded-2xl border border-primary-200 bg-primary-50/45 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary-600">Case action · {actionLabel(action.kind)}</p>
          <p className="mt-1 text-sm font-semibold leading-relaxed text-secondary-800">{proposal.summary}</p>
        </div>
        <span className={["inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold", isApproved ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-amber-200 bg-amber-50 text-amber-700"].join(" ")}>{isApproved ? "Approved" : "Needs review"}</span>
      </div>
      {items.length > 0 && <div className="mt-3 space-y-2">{items.slice(0, 4).map((item, index) => {
        const title = action.kind === "indicators" ? item.name : action.kind === "baselines" ? item.indicator_name : item.name;
        const detail = action.kind === "indicators" ? item.definition : action.kind === "baselines" ? `Baseline: ${item.baseline_value} · ${item.rationale}` : item.description;
        return <div key={`${title}-${index}`} className="rounded-xl border border-white/90 bg-white/75 px-3 py-2.5"><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-secondary-800">{title}</p>{action.kind === "baselines" && <span className="text-[11px] font-bold text-primary-700">{item.quality_status}</span>}{action.kind === "interventions" && <span className="text-[11px] font-bold capitalize text-primary-700">{item.priority}</span>}</div><p className="mt-1 text-xs leading-relaxed text-secondary-600">{detail}</p></div>;
      })}</div>}
      {proposal.warnings.length > 0 && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">{proposal.warnings.join(" ")}</p>}
      {!isApproved && <div className="mt-4 flex items-center justify-between gap-3"><p className="text-[11px] leading-relaxed text-secondary-500">Review the grounded proposal before it changes the case.</p><button type="button" onClick={onApprove} disabled={approving || items.length === 0} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">{approving ? "Applying…" : `Approve ${actionLabel(action.kind).toLowerCase()}`}</button></div>}
    </div>
  );
}

function ScenarioComparisonCard({ comparison }: { comparison: ScenarioComparison }) {
  return (
    <section className="mb-5 overflow-hidden rounded-[22px] border border-secondary-200 bg-secondary-50/60">
      <div className="flex flex-col gap-3 border-b border-secondary-200 bg-white px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary-600">Scenario comparison</p><h3 className="mt-1 font-sans text-lg font-extrabold tracking-tight text-secondary-950">Rurban expansion vs. consolidated settlements</h3><p className="mt-1 max-w-2xl text-sm leading-relaxed text-secondary-600">{comparison.recommendation}</p></div>
        <span className={["inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold", comparison.evidence_status === "ready" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : comparison.evidence_status === "partial" ? "border border-amber-200 bg-amber-50 text-amber-700" : "border border-secondary-200 bg-secondary-100 text-secondary-600"].join(" ")}>{comparison.evidence_status} evidence</span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">{comparison.options.map((option) => <div key={option.key} className="rounded-2xl border border-secondary-200 bg-white p-4"><div className="flex items-center justify-between gap-2"><p className="font-sans text-sm font-extrabold text-secondary-900">{option.name}</p><span className="text-[10px] font-bold uppercase tracking-wider text-secondary-400">{option.quantification_status.replace("_", " ")}</span></div><dl className="mt-3 space-y-2 text-xs"><div><dt className="font-bold text-secondary-500">Service access</dt><dd className="mt-0.5 leading-relaxed text-secondary-700">{option.service_access}</dd></div><div><dt className="font-bold text-secondary-500">Sprawl</dt><dd className="mt-0.5 leading-relaxed text-secondary-700">{option.sprawl}</dd></div><div><dt className="font-bold text-secondary-500">Environmental risk</dt><dd className="mt-0.5 leading-relaxed text-secondary-700">{option.environmental_risk}</dd></div></dl></div>)}</div>
      {comparison.metrics.length > 0 && <div className="border-t border-secondary-200 bg-white px-4 py-4"><div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[0.12em] text-secondary-600">Indicator mathematics</p><p className="mt-1 text-xs text-secondary-500">Only values supported by approved case indicators are calculated.</p></div><span className="text-[11px] font-semibold text-secondary-400">{comparison.approved_intervention_count} approved intervention{comparison.approved_intervention_count === 1 ? "" : "s"}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b border-secondary-200 text-secondary-500"><tr><th className="px-2 py-2 font-semibold">Indicator</th><th className="px-2 py-2 font-semibold">Baseline</th><th className="px-2 py-2 font-semibold">Target</th><th className="px-2 py-2 font-semibold">Current</th><th className="px-2 py-2 font-semibold">Target gap</th><th className="px-2 py-2 font-semibold">Status</th></tr></thead><tbody>{comparison.metrics.map((metric) => <tr key={metric.indicator_id} className="border-b border-secondary-100"><td className="px-2 py-2 font-semibold text-secondary-800">{metric.name}<span className="ml-1 text-secondary-400">({metric.unit})</span></td><td className="px-2 py-2 text-secondary-600">{metric.baseline_value ?? "—"}</td><td className="px-2 py-2 text-secondary-600">{metric.target_value ?? "—"}</td><td className="px-2 py-2 text-secondary-600">{metric.current_value ?? "—"}</td><td className="px-2 py-2 font-semibold text-primary-700">{metric.target_gap ?? "—"}</td><td className="px-2 py-2"><span className="rounded-full bg-secondary-100 px-2 py-1 text-[10px] font-bold text-secondary-600">{metric.status.replaceAll("_", " ")}</span></td></tr>)}</tbody></table></div></div>}
      <details className="border-t border-secondary-200 px-4 py-3"><summary className="cursor-pointer text-xs font-bold text-secondary-600">Show equations and evidence gaps</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="text-[10px] font-extrabold uppercase tracking-wider text-secondary-400">Equations</p><ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary-600">{comparison.equations.map((equation) => <li key={equation}>• {equation}</li>)}</ul></div><div><p className="text-[10px] font-extrabold uppercase tracking-wider text-secondary-400">Evidence gaps</p>{comparison.evidence_gaps.length > 0 ? <ul className="mt-2 space-y-1 text-xs leading-relaxed text-amber-700">{comparison.evidence_gaps.map((gap) => <li key={gap}>• {gap}</li>)}</ul> : <p className="mt-2 text-xs text-emerald-700">No evidence gaps were detected.</p>}</div></div></details>
    </section>
  );
}

function MessageBubble({
  message,
  onAnalyse,
  onApproveAction,
  approvingActionId,
}: {
  message: Message;
  onAnalyse?: (msg: Message) => void;
  onApproveAction?: (messageId: string, action: CaseAction) => void;
  approvingActionId?: string | null;
}) {
  const isUser = message.role === "user";
  const wasOptimized = isUser && message.originalInput && message.originalInput !== message.content;
  const isCompleteAI = !isUser && !message.streaming && message.content.length > 0 && !message.isError;
  const isDashboardAnalyzable = message.answerMode !== "evidence_only" && message.answerMode !== "insufficient";

  return (
    <div className={["group flex gap-3", isUser ? "justify-end" : "justify-start"].join(" ")}>
      <div className={["flex flex-col", isUser ? "items-end max-w-[75%]" : "items-start w-full max-w-[92%] md:max-w-[86%]"].join(" ")}>
        {wasOptimized && (
          <p className="text-xs text-secondary-400 font-sans mb-1 px-1 line-through">{message.originalInput}</p>
        )}
        {isUser ? (
          <div className="rounded-[22px] rounded-br-md bg-primary-600 px-4 py-3 text-sm leading-relaxed text-white shadow-[0_8px_22px_rgba(26,46,204,0.16)]">
            <MarkdownContent content={message.content} isUser />
          </div>
        ) : message.isError ? (
          <div className="w-full rounded-[22px] rounded-tl-md border border-error-200 bg-error-50 px-4 py-3 text-sm leading-relaxed text-error-800">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-error-600">
              <span className="size-2 rounded-full bg-error-500" /> Unable to complete
            </div>
            <MarkdownContent content={message.content} />
          </div>
        ) : (
          <article className="relative w-full overflow-hidden rounded-[24px] border border-secondary-200/90 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.07)]">
            <div className="h-1 w-full bg-gradient-to-r from-primary-500 via-primary-400 to-sky-300" />
            <header className="flex items-center justify-between gap-3 border-b border-secondary-100 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-[10px] bg-primary-600 text-[9px] font-black tracking-[0.08em] text-white shadow-sm">DC</div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-secondary-500">Decision brief</p>
                  <p className="mt-0.5 text-xs text-secondary-400">Evidence-grounded policy analysis</p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Grounded
              </span>
            </header>
            {!message.streaming && message.scenario && <div className="px-5 pt-5"><ScenarioComparisonCard comparison={message.scenario} /></div>}
            {!message.streaming && <SettlementDecisionInfographic content={message.content} />}
            <div className="px-5 py-5 text-[15px] leading-[1.75] text-secondary-800 [&_h1]:mb-3 [&_h1]:font-sans [&_h1]:text-xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-sans [&_h2]:text-sm [&_h2]:font-extrabold [&_h2]:uppercase [&_h2]:tracking-[0.08em] [&_h2]:text-primary-700 [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-sans [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-secondary-900 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_strong]:text-secondary-950 [&_ul]:my-3 [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:pl-1 [&_li::marker]:font-bold [&_li::marker]:text-primary-500 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-primary-300 [&_blockquote]:bg-primary-50/60 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:font-medium [&_blockquote]:text-secondary-700 [&_a]:font-semibold [&_a]:text-primary-600">
              {message.streaming ? <TypingDots /> : <MarkdownContent content={message.content} />}
            </div>
            {!message.streaming && message.action && onApproveAction && <div className="px-5 pb-5"><CaseActionCard action={message.action} approving={approvingActionId === message.id} onApprove={() => onApproveAction(message.id, message.action!)} /></div>}
          </article>
        )}

        {!isUser && !message.streaming && (message.intent || message.telemetry?.intent) && (
          <IntentBadge intent={message.intent ?? message.telemetry?.intent ?? "unknown"} />
        )}

        {!isUser && !message.streaming && message.citations && message.citations.length > 0 && (
          <CitationsPanel citations={message.citations} />
        )}

        {!isUser && !message.streaming && message.telemetry && (
          <TelemetryPanel telemetry={message.telemetry} />
        )}

        {!isUser && !message.streaming && message.answerMode === "evidence_only" && (
          <span className="mt-2 px-1 text-xs text-secondary-500 font-sans">
            Evidence only — dashboard analysis is unavailable until a synthesized answer is produced.
          </span>
        )}

        {isCompleteAI && isDashboardAnalyzable && onAnalyse && (
          <button
            type="button"
            onClick={() => onAnalyse(message)}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-50 border border-primary-200 text-primary-600 text-xs font-semibold font-sans hover:bg-primary-100 hover:border-primary-300 transition-colors"
          >
            Analyse in Dashboard →
          </button>
        )}

        {wasOptimized && (
          <span className="text-xs text-primary-500 font-sans mt-1 px-1">Prompt optimized</span>
        )}
        <ActionBarPrimitive.Root
          autohide="always"
          className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ActionBarPrimitive.Copy asChild>
            <button type="button" aria-label="Copy message" className="rounded-md px-2 py-1 text-[11px] font-semibold text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 font-sans">
              Copy
            </button>
          </ActionBarPrimitive.Copy>
          {isUser && (
            <ActionBarPrimitive.Edit asChild>
              <button type="button" aria-label="Edit message" className="rounded-md px-2 py-1 text-[11px] font-semibold text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 font-sans">
                Edit
              </button>
            </ActionBarPrimitive.Edit>
          )}
          {!isUser && (
            <ActionBarPrimitive.Reload asChild>
              <button type="button" aria-label="Regenerate response" className="rounded-md px-2 py-1 text-[11px] font-semibold text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700 font-sans">
                Regenerate
              </button>
            </ActionBarPrimitive.Reload>
          )}
        </ActionBarPrimitive.Root>
        <span className="text-xs text-secondary-400 mt-1 font-sans px-1">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {message.traceId ? ` · ${message.traceId.slice(0, 8)}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type PromptMessageMetadata = {
  originalInput?: string;
  prompt?: string;
  citations?: Citation[];
  traceId?: string;
  isError?: boolean;
  intent?: IntentResult;
  telemetry?: QueryResult["telemetry"];
  answerMode?: QueryResult["answer_mode"];
  streaming?: boolean;
  action?: CaseAction;
  scenario?: ScenarioComparison;
};

function assistantMessageMetadata(message: Message): PromptMessageMetadata {
  return {
    originalInput: message.originalInput,
    prompt: message.prompt,
    citations: message.citations,
    traceId: message.traceId,
    isError: message.isError,
    intent: message.intent,
    telemetry: message.telemetry,
    answerMode: message.answerMode,
    streaming: message.streaming,
    action: message.action,
    scenario: message.scenario,
  };
}

function toAssistantMessage(message: Message): ThreadMessageLike {
  const isRunning = message.streaming === true;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.timestamp,
    ...(message.role === "assistant"
      ? {
          status: isRunning
            ? ({ type: "running" } as const)
            : message.isError
              ? ({ type: "incomplete", reason: "error" } as const)
              : ({ type: "complete", reason: "stop" } as const),
        }
      : {}),
    metadata: { custom: assistantMessageMetadata(message) },
  };
}

function appendMessageText(message: AppendMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function localMessageFromAssistantState(message: MessageState): Message {
  const custom = (message.metadata?.custom ?? {}) as PromptMessageMetadata;
  const content = typeof message.content === "string"
    ? message.content
    : message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  const isStreaming = message.status?.type === "running" || custom.streaming === true;
  return {
    id: message.id,
    role: message.role as Role,
    content,
    timestamp: message.createdAt ?? new Date(),
    streaming: isStreaming,
    originalInput: custom.originalInput,
    prompt: custom.prompt,
    citations: custom.citations,
    traceId: custom.traceId,
    isError: custom.isError === true || message.status?.type === "incomplete",
    intent: custom.intent,
    telemetry: custom.telemetry,
    answerMode: custom.answerMode,
    action: custom.action,
    scenario: custom.scenario,
  };
}

function AssistantUiMessage({
  message,
  onAnalyse,
  onApproveAction,
  approvingActionId,
}: {
  message: MessageState;
  onAnalyse?: (message: Message) => void;
  onApproveAction?: (messageId: string, action: CaseAction) => void;
  approvingActionId?: string | null;
}) {
  return (
    <MessagePrimitive.Root className="contents">
      <MessageBubble message={localMessageFromAssistantState(message)} onAnalyse={onAnalyse} onApproveAction={onApproveAction} approvingActionId={approvingActionId} />
    </MessagePrimitive.Root>
  );
}

function AssistantRuntimeBridge({
  messages,
  isStreaming,
  optimizing,
  onNew,
  onCancel,
  onReload,
  onEdit,
  children,
}: {
  messages: Message[];
  isStreaming: boolean;
  optimizing: boolean;
  onNew: (content: string) => Promise<void>;
  onCancel: () => void;
  onReload: (messageId: string) => Promise<void>;
  onEdit: (messageId: string, newContent: string) => Promise<void>;
  children: ReactNode;
}) {
  const assistantMessages = useMemo(
    () => messages.map(toAssistantMessage),
    [messages],
  );
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: assistantMessages,
    isRunning: isStreaming,
    isSendDisabled: isStreaming || optimizing,
    onNew: async (message) => {
      const content = appendMessageText(message).trim();
      if (content) await onNew(content);
    },
    onCancel: async () => onCancel(),
    // Reload: called when user clicks "Regenerate" on an assistant message.
    // parentId is the id of the user message that preceded it.
    onReload: async (parentId) => {
      if (parentId) await onReload(parentId);
    },
    // Edit: called when user submits an edited user message.
    // assistant-ui handles the branching; we just get the new content.
    onEdit: async (message) => {
      const content = appendMessageText(message).trim();
      if (!content) return;
      await onEdit("", content);
    },
    convertMessage: (message) => message,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function PromptComposer({
  workspaceId,
  autoOptimize,
  onToggleHistory,
}: {
  workspaceId?: string;
  autoOptimize: boolean;
  onToggleHistory: () => void;
}) {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEmpty = useAuiState((state) => state.composer.isEmpty);

  return (
    <div className="shrink-0 border-t border-secondary-200 bg-white px-4 py-4">
      <div className="mx-auto w-full max-w-3xl">
        <ComposerPrimitive.Root
          className={[
            "flex items-end gap-3 rounded-[28px] border px-4 py-3.5 transition-all bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)]",
            isRunning ? "border-primary-300 shadow-primary-500/10" : "border-secondary-300",
          ].join(" ")}
        >
          <button
            type="button"
            aria-label="Toggle history"
            onClick={onToggleHistory}
            className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-secondary-200 text-lg leading-none text-secondary-500 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 sm:flex"
          >
            <span aria-hidden>+</span>
          </button>

          <ComposerPrimitive.Input
            autoFocus={false}
            submitMode="enter"
            placeholder={isRunning ? "DC-TIM is responding…" : autoOptimize ? "Type your question — it will be optimized automatically" : "Type your question"}
            aria-label="Message input"
            className="flex-1 bg-transparent text-secondary-900 text-sm font-sans outline-none resize-none leading-relaxed min-h-6 max-h-40"
          />

          {isRunning ? (
            <ComposerPrimitive.Cancel
              asChild
              aria-label="Stop response"
              className="shrink-0 flex size-9 items-center justify-center rounded-xl bg-secondary-200 text-secondary-600 hover:bg-secondary-300 transition-colors"
            >
              <button type="button">
                <span className="size-3 rounded-sm bg-current" />
              </button>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send
              asChild
              aria-label="Send message"
              className={[
                "shrink-0 flex size-10 items-center justify-center rounded-full transition-all",
                !isEmpty
                  ? "bg-primary-500 text-white hover:bg-primary-600 active:scale-95 shadow-md shadow-primary-500/25"
                  : "bg-secondary-200 text-secondary-400 cursor-not-allowed",
              ].join(" ")}
            >
              <button type="submit">
                <svg className="size-4 translate-x-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </ComposerPrimitive.Send>
          )}
        </ComposerPrimitive.Root>
        <p className="text-center text-[11px] text-secondary-400 mt-2.5 font-sans">
          Grounded in workspace sources
          {workspaceId ? ` · workspace ${workspaceId}` : ""}
          {" · grounded answers with citations · Enter to send"}
        </p>
      </div>
    </div>
  );
}

export default function PromptPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const caseId = searchParams.get("case_id");
  const [messages, setMessages] = useState<Message[]>([]);
  const [caseContext, setCaseContext] = useState<TransformationCase | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [autoOptimize, setAutoOptimize] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingOriginal, setPendingOriginal] = useState<string | null>(null);
  const [pendingOptimized, setPendingOptimized] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [approvingActionId, setApprovingActionId] = useState<string | null>(null);

  // Per-user conversation history (persisted on the backend).
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  const { user } = useAuth();

  const activeIdRef = useRef<string | null>(null);
  const historyBootedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const activeRevealCancelRef = useRef<(() => void) | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!caseId) {
      setCaseContext(null);
      return;
    }
    let cancelled = false;
    void getTransformationCase(caseId)
      .then((caseDetail) => {
        if (!cancelled) setCaseContext(caseDetail);
      })
      .catch(() => {
        if (!cancelled) setCaseContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // ── Conversation history ──────────────────────────────────────────────────

  const openConversation = useCallback(async (id: string) => {
    const detail = await getConversation(id);
    // Error bubbles are transient UI state, never conversation history. This
    // also hides errors saved by older frontend versions when they are loaded.
    const savedMessages = detail.messages
      .map(messageFromServer)
      .filter((message) => !message.isError);
    setMessages(savedMessages);
    activeIdRef.current = detail.id;
    setActiveId(detail.id);
    setShowSuggestions(savedMessages.length === 0);
  }, []);

  useEffect(() => {
    if (historyBootedRef.current) return;
    historyBootedRef.current = true;
    void (async () => {
      try {
        const list = await listConversations(100);
        setConversations(list.conversations);
        if (list.conversations.length > 0) {
          await openConversation(list.conversations[0].id);
        } else {
          const conv = await createConversation();
          activeIdRef.current = conv.id;
          setActiveId(conv.id);
        }
      } catch {
        // Backend unreachable → keep local-only chat (previous behaviour).
        setHistoryEnabled(false);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [openConversation]);

  async function refreshConversations() {
    try {
      const list = await listConversations(100);
      setConversations(list.conversations);
    } catch {
      setHistoryEnabled(false);
    }
  }

  async function persistTurn(conversationId: string, userMsg: Message, aiMsg: Message) {
    if (!historyEnabled || aiMsg.isError) return;
     try {
       await appendConversationMessages(conversationId, [toServerMessage(userMsg), toServerMessage(aiMsg)]);
       await refreshConversations();
     } catch {

      setHistoryEnabled(false);
    }
  }

  async function handleDeleteConversation(id: string) {
    try {
      await deleteConversation(id);
    } catch {
      // ignore — refresh below will reflect the true server state
    }
    const list = await listConversations(100).catch(() => null);
    if (!list) return;
    setConversations(list.conversations);
    if (id === activeIdRef.current) {
      if (list.conversations.length === 0) {
        const conv = await createConversation();
        activeIdRef.current = conv.id;
        setActiveId(conv.id);
        setMessages([]);
        setShowSuggestions(true);
      } else {
        await openConversation(list.conversations[0].id);
      }
    }
  }

  async function startNewConversation() {
    const conv = await createConversation();
    activeIdRef.current = conv.id;
    setActiveId(conv.id);
    setMessages([]);
    setShowSuggestions(true);
    setIsStreaming(false);
    await refreshConversations();
  }

  async function dispatchMessage(content: string, originalInput?: string) {
    // Always clear optimizing/preview state before dispatching — this function
    // can be called directly (from OptimizePreview callbacks, suggestion clicks,
    // etc.) bypassing handleSend, so we must not rely on the caller to clean up.
    setOptimizing(false);
    setPendingOriginal(null);
    setPendingOptimized(null);
    setShowSuggestions(false);

    const conversationId = activeIdRef.current;
    const userMsg: Message = { id: uid(), role: "user", content, timestamp: new Date(), originalInput };
    const aiMsgId = uid();
    const sentAt = new Date();
    const aiPlaceholder: Message = {
      id: aiMsgId,
      role: "assistant",
      content: "",
      timestamp: sentAt,
      streaming: true,
      prompt: content,
    };

    setMessages((prev) => [...prev, userMsg, aiPlaceholder]);
    setIsStreaming(true);
    const controller = new AbortController();
    activeRequestRef.current = controller;
    activeMessageIdRef.current = aiMsgId;
    cancelledRef.current = false;

    try {
      if (caseContext && detectsScenarioPrompt(content)) {
        const comparison = await compareCaseScenarios(caseContext.id, content);
        if (cancelledRef.current) return;
        const answer = comparison.recommendation;
        const finalMsg: Message = {
          id: aiMsgId,
          role: "assistant",
          content: answer,
          timestamp: sentAt,
          streaming: false,
          prompt: content,
          scenario: comparison,
        };
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? finalMsg : m)));
        activeRequestRef.current = null;
        activeMessageIdRef.current = null;
        setIsStreaming(false);
        if (conversationId) void persistTurn(conversationId, userMsg, finalMsg);
        return;
      }
      const caseActionKind = caseContext ? detectCaseAction(content) : null;
      if (caseContext && caseActionKind) {
        const action = await buildCaseAction(caseContext.id, caseActionKind, content);
        if (cancelledRef.current) return;
        const answer = action.proposal.summary;
        const finalMsg: Message = {
          id: aiMsgId,
          role: "assistant",
          content: answer,
          timestamp: sentAt,
          streaming: false,
          prompt: content,
          action,
        };
        setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? finalMsg : m)));
        activeRequestRef.current = null;
        activeMessageIdRef.current = null;
        setIsStreaming(false);
        // Proposals are intentionally session-local in history: persisting a pending
        // approval card would make it look actionable after the case has changed.
        if (conversationId) void persistTurn(conversationId, userMsg, { ...finalMsg, action: undefined });
        return;
      }
      const queryContent = caseContext
        ? [
            `Settlement case context: ${caseContext.title}`,
            `Territory: ${caseContext.territory || "Not specified"}`,
            `Problem: ${caseContext.problem_statement}`,
            `Desired outcome: ${caseContext.desired_outcome}`,
            `User request: ${content}`,
          ].join("\n")
        : content;
      const data = await queryRag(queryContent, 5, { signal: controller.signal });
      if (cancelledRef.current) return;
      activeRequestRef.current = null;
      const answer = data.answer || "No answer returned.";
      const citations = data.citations ?? [];
      const traceId = data.trace_id;
      const telemetry = data.telemetry ?? undefined;
      const answerMode = data.answer_mode ?? "synthesized";

      activeRevealCancelRef.current = revealAnswer(
        answer,
        (partial, done) => {
          if (cancelledRef.current) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    content: partial,
                    streaming: !done,
                    prompt: content,
                    citations: done ? citations : m.citations,
                    traceId: done ? traceId : m.traceId,
                    telemetry: done ? telemetry : m.telemetry,
                    answerMode: done ? answerMode : m.answerMode,
                  }
                : m
            )
          );
          if (done) {
            activeRevealCancelRef.current = null;
            activeMessageIdRef.current = null;
            setIsStreaming(false);
            if (!conversationId) return;
            const finalMsg: Message = {
              id: aiMsgId,
              role: "assistant",
              content: answer,
              timestamp: sentAt,
              streaming: false,
              prompt: content,
              citations,
              traceId,
              telemetry,
              answerMode,
            };
            void persistTurn(conversationId, userMsg, finalMsg);
          }
        },
        () => setIsStreaming(false)
      );
    } catch (err) {
      if (cancelledRef.current || (err instanceof Error && err.name === "AbortError")) return;
      const message =
        err instanceof RagApiError && err.status === 422
          ? "Please enter a clear question about the sources in your workspace."
          : "DC-TIM is temporarily unavailable. Please try again in a moment.";
      const errorMsg: Message = {
        id: aiMsgId,
        role: "assistant",
        content: message,
        timestamp: sentAt,
        streaming: false,
        prompt: content,
        isError: true,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...errorMsg } : m))
      );
      setIsStreaming(false);
      activeRequestRef.current = null;
      activeMessageIdRef.current = null;
      // Errors are deliberately not persisted as assistant messages. They are
      // transient UI feedback and should never reappear in chat history.
    }
  }

  async function handleApproveAction(messageId: string, action: CaseAction) {
    if (!caseContext || action.status === "approved") return;
    setApprovingActionId(messageId);
    try {
      if (action.kind === "indicators") await approveCaseIndicators(caseContext.id, action.proposal);
      if (action.kind === "baselines") await approveCaseBaselines(caseContext.id, action.proposal);
      if (action.kind === "interventions") await approveCaseInterventions(caseContext.id, action.proposal);
      setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, action: { ...action, status: "approved" } } : message));
    } catch (err) {
      const detail = err instanceof RagApiError ? err.message : "The proposal could not be applied to this case.";
      setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, content: `${message.content}\n\n**Approval failed:** ${detail}` } : message));
    } finally {
      setApprovingActionId(null);
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    activeRevealCancelRef.current?.();
    activeRevealCancelRef.current = null;
    const activeMessageId = activeMessageIdRef.current;
    activeMessageIdRef.current = null;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === activeMessageId
          ? {
              ...message,
              content: "Response cancelled.",
              streaming: false,
              isError: true,
            }
          : message,
      ),
    );
    setIsStreaming(false);
  }

  async function handleSend(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || isStreaming || optimizing) return;
    if (!autoOptimize) {
      await dispatchMessage(trimmed);
      return;
    }
    setOptimizing(true);
    setPendingOriginal(trimmed);
    try {
      const res = await optimizePromptRequest(trimmed);
      const optimized = (res.optimized_prompt ?? "").trim();
      if (!optimized || optimized === trimmed) {
        setPendingOriginal(null);
        setPendingOptimized(null);
        await dispatchMessage(trimmed);
      } else {
        setPendingOptimized(optimized);
      }
    } catch {
      setPendingOriginal(null);
      setPendingOptimized(null);
      await dispatchMessage(trimmed);
    } finally {
      setOptimizing(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input);
    }
  }

  async function handleClear() {
    const id = activeIdRef.current;
    if (id) {
      try {
        await deleteConversation(id);
      } catch {
        // backend offline → just reset locally
      }
    }
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    handleCancel();
    setShowSuggestions(true);
    setIsStreaming(false);
    setPendingOriginal(null);
    setPendingOptimized(null);
    setOptimizing(false);
    await refreshConversations();
  }

  function handleAnalyse(msg: Message) {
    if (!user || msg.answerMode === "evidence_only" || msg.answerMode === "insufficient") return;
    saveAnalysis({
      prompt: msg.prompt ?? "",
      response: msg.content,
      category: detectCategory(msg.content),
      timestamp: Date.now(),
    }, user.workspace_id);
    navigate("/dashboard");
  }

  // Regenerate: find the user message with the given id and re-dispatch its content,
  // dropping the assistant message that followed it.
  async function handleReload(userMessageId: string) {
    const idx = messages.findIndex((m) => m.id === userMessageId);
    if (idx === -1 || isStreaming) return;
    const userMsg = messages[idx];
    if (userMsg.role !== "user") return;
    // Trim everything from this user message onwards so the thread is clean.
    setMessages((prev) => prev.slice(0, idx));
    await dispatchMessage(userMsg.content, userMsg.originalInput);
  }

  // Edit: replace the user message at parentId with new content, drop everything after.
  async function handleEdit(parentId: string, newContent: string) {
    if (!newContent.trim() || isStreaming) return;
    const idx = parentId
      ? messages.findIndex((m) => m.id === parentId)
      : -1;
    // Slice up to (and including) the parent, then append edited message.
    const keepUntil = idx >= 0 ? idx + 1 : 0;
    setMessages((prev) => prev.slice(0, keepUntil));
    await dispatchMessage(newContent.trim());
  }

  const showPreview = !!pendingOriginal && !!pendingOptimized;
  const suggestions = caseContext ? SETTLEMENT_SUGGESTIONS : SUGGESTIONS;

  return (
    <AppLayout fullHeight>
      <header className="relative z-20 flex h-[72px] shrink-0 items-center justify-between border-b border-secondary-200/80 bg-white px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-primary-600 text-[11px] font-black tracking-[0.12em] text-white shadow-[0_5px_14px_rgba(26,46,204,0.24)] font-sans">
            DC
          </div>
          <div className="min-w-0 leading-none">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-extrabold tracking-tight text-secondary-900 font-sans">DC-TIM</span>
              <span className="hidden rounded-md bg-secondary-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-secondary-500 sm:inline-flex font-sans">Workspace AI</span>
            </div>
            <p className="mt-1.5 truncate text-[11px] font-medium text-secondary-400 font-sans">Prompt lab <span className="text-secondary-300">/</span> grounded analysis</p>
          </div>
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-secondary-200 bg-secondary-50 px-3 py-1.5 md:flex">
          <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
          <span className="text-[11px] font-bold text-secondary-600 font-sans">Workspace grounded</span>
          <span className="mx-0.5 h-3.5 w-px bg-secondary-200" />
          <button
            type="button"
            onClick={() => setAutoOptimize((enabled) => !enabled)}
            disabled={optimizing}
            aria-pressed={autoOptimize}
            aria-label={`Auto-optimize ${autoOptimize ? "on" : "off"}. Toggle setting`}
            className="group inline-flex items-center gap-1.5 rounded-full outline-none transition-opacity disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <span className="text-[11px] font-semibold text-primary-600 font-sans">Auto-optimize</span>
            <span className={[
              "rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white transition-colors font-sans",
              autoOptimize ? "bg-primary-500" : "bg-secondary-400",
            ].join(" ")}>{autoOptimize ? "On" : "Off"}</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 sm:flex">
            <span className="size-2 rounded-full bg-primary-500" />
            <span className="text-xs font-bold text-primary-700 font-sans">DC-TIM</span>
            <span className="text-[10px] font-semibold text-primary-500 font-sans">grounded</span>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear chat"
              title="Clear chat"
              className="flex size-10 items-center justify-center rounded-xl border border-secondary-200 text-secondary-400 transition-colors hover:border-error-200 hover:bg-error-50 hover:text-error-500"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12m-9 0V4.8c0-.44.36-.8.8-.8h4.4c.44 0 .8.36.8.8V7m-8.8 0 .7 12.1c.03.51.45.9.96.9h7.08c.51 0 .93-.39.96-.9L17 7M10 11v5m4-5v5" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden" style={{ background: "oklch(97% 0.003 256)" }}>
        <aside
          className={[
            "shrink-0 flex-col bg-white border-r border-secondary-200 transition-all duration-200 overflow-hidden hidden sm:flex",
            sidebarOpen ? "w-56" : "w-0",
          ].join(" ")}
        >
          <div className="p-4 border-b border-secondary-100">
            <p className="text-xs font-semibold text-secondary-500 uppercase tracking-wider font-sans">History</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
            {historyLoading ? (
              <p className="text-xs text-secondary-400 font-sans px-2 pt-2">Loading history…</p>
            ) : !historyEnabled ? (
              <p className="text-xs text-secondary-400 font-sans px-2 pt-2">
                History unavailable — backend offline. Chat continues in this session only.
              </p>
            ) : conversations.length === 0 ? (
              <p className="text-xs text-secondary-400 font-sans px-2 pt-2">No conversations yet.</p>
            ) : (
              conversations.map((c) => {
                const active = c.id === activeId;
                return (
                  <div
                    key={c.id}
                    className={[
                      "group flex items-start gap-1 rounded-xl transition-colors",
                      active ? "bg-primary-500/10" : "hover:bg-secondary-100",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (c.id === activeId) return;
                        void openConversation(c.id);
                      }}
                      className="flex-1 min-w-0 text-left px-3 py-2.5"
                    >
                      <p className={["font-sans text-sm truncate", active ? "text-primary-600 font-semibold" : "text-secondary-800"].join(" ")}>
                        {c.title}
                      </p>
                      <p className="text-xs text-secondary-500 mt-0.5 font-sans truncate">
                        {c.last_message_preview ?? `${c.message_count} message${c.message_count === 1 ? "" : "s"}`}
                      </p>
                      <p className="text-[11px] text-secondary-400 mt-0.5 font-sans">
                        {new Date(c.updated_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${c.title}`}
                      onClick={() => void handleDeleteConversation(c.id)}
                      className="shrink-0 p-1.5 mt-2 mr-1.5 rounded-lg text-secondary-300 opacity-0 group-hover:opacity-100 hover:text-error-500 hover:bg-error-50 transition-all"
                    >
                      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="p-3 border-t border-secondary-100">
            <button
              type="button"
              onClick={() => void startNewConversation()}
              className="w-full flex items-center justify-center gap-2 text-xs text-secondary-500 hover:text-secondary-800 py-2 rounded-lg hover:bg-secondary-100 transition-colors font-sans"
            >
              + New conversation
            </button>
          </div>
        </aside>

        <AssistantRuntimeBridge
          messages={messages}
          isStreaming={isStreaming}
          optimizing={optimizing}
          onNew={handleSend}
           onCancel={handleCancel}
           onReload={handleReload}
           onEdit={handleEdit}
         >
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto w-full max-w-3xl flex flex-col gap-6">
               {caseContext && (
                 <div className="rounded-2xl border border-primary-200 bg-primary-50/70 px-4 py-3">
                   <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Settlement case context</p>
                   <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                     <p className="text-sm font-bold text-secondary-900">{caseContext.title}</p>
                     <p className="text-xs text-secondary-500">{caseContext.territory || "Territory not specified"}</p>
                   </div>
                   <p className="mt-2 text-xs leading-relaxed text-secondary-600">Chat actions will be interpreted against this case and its linked evidence.</p>
                 </div>
               )}

               {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center pt-20 pb-10 text-center">
                      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary-600 font-sans">
                        <span className="size-1.5 rounded-full bg-primary-500" />
                        Grounded workspace
                      </div>
                      <h2 className="text-3xl font-extrabold tracking-tight text-secondary-950 font-sans mb-3">What should we investigate?</h2>
                      <p className="text-secondary-500 text-sm font-sans max-w-md leading-relaxed">
                         {caseContext ? <>Ask <span className="text-primary-600 font-semibold">DC-TIM</span> to move this settlement case forward. Every supported answer returns workspace citations.</> : <>Ask <span className="text-primary-600 font-semibold">DC-TIM</span> about your ingested policies and documents. Every supported answer returns workspace citations.</>}
                      </p>
                </div>
              )}

              {showSuggestions && messages.length === 0 && (
                <div className="grid sm:grid-cols-2 gap-3">
                   {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSend(s)}
                      className="text-left px-4 py-4 rounded-[22px] border border-secondary-200/80 bg-white hover:-translate-y-0.5 hover:bg-primary-50 hover:border-primary-200 transition-all group shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
                    >
                      <p className="text-sm text-secondary-700 font-sans group-hover:text-secondary-900 transition-colors leading-snug">{s}</p>
                      <p className="text-xs text-secondary-400 mt-1.5 font-sans group-hover:text-primary-500 transition-colors">Click to ask →</p>
                    </button>
                  ))}
                </div>
              )}

              <ThreadPrimitive.Root className="contents">
                <ThreadPrimitive.Messages>
                {({ message }) => (
                    <AssistantUiMessage message={message} onAnalyse={handleAnalyse} onApproveAction={handleApproveAction} approvingActionId={approvingActionId} />
                  )}
                </ThreadPrimitive.Messages>
              </ThreadPrimitive.Root>
              <div ref={bottomRef} />
            </div>
          </div>

          {optimizing && !isStreaming && (
            <div className="shrink-0 border-t border-secondary-200 bg-white px-4 py-4">
              <div className="mx-auto w-full max-w-3xl">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-primary-200 bg-primary-50">
                  <span className="size-4 rounded-full border-2 border-primary-400 border-t-transparent animate-spin shrink-0" />
                  <p className="text-sm text-primary-600 font-semibold font-sans">Optimizing your prompt…</p>
                </div>
              </div>
            </div>
          )}

          {showPreview && (
            <OptimizePreview
              original={pendingOriginal!}
              optimized={pendingOptimized!}
              onAccept={(final) => dispatchMessage(final, pendingOriginal!)}
              onEdit={(edited) => dispatchMessage(edited, pendingOriginal!)}
              onSendOriginal={() => dispatchMessage(pendingOriginal!)}
              onDismiss={() => {
                setPendingOriginal(null);
                setPendingOptimized(null);
                setInput(pendingOriginal!);
                textareaRef.current?.focus();
              }}
            />
          )}

          {!showPreview && !optimizing && (
            <PromptComposer
              workspaceId={user?.workspace_id}
              autoOptimize={autoOptimize}
              onToggleHistory={() => setSidebarOpen((value) => !value)}
            />
          )}

          {!showPreview && !optimizing && (
            <div className="hidden">
              <div className="mx-auto w-full max-w-3xl">
                <div
                  className={[
                    "flex items-end gap-3 rounded-2xl border px-4 py-3 transition-colors bg-secondary-50",
                    isStreaming ? "border-primary-300" : "border-secondary-200",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    aria-label="Toggle history"
                    onClick={() => setSidebarOpen((v) => !v)}
                    className="shrink-0 p-1.5 rounded-lg text-secondary-400 hover:text-secondary-700 hover:bg-secondary-200 transition-colors hidden sm:flex"
                  >
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>

                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isStreaming ? "DC-TIM is responding…" : "Type your question — it will be optimized automatically"}
                    disabled={isStreaming}
                    rows={1}
                    aria-label="Message input"
                    className="flex-1 bg-transparent text-secondary-900 text-sm font-sans outline-none resize-none leading-relaxed disabled:cursor-not-allowed min-h-6 max-h-40"
                  />

                  <button
                    type="button"
                    onClick={() => handleSend(input)}
                    disabled={!input.trim() || isStreaming}
                    aria-label="Send message"
                    className={[
                      "shrink-0 flex size-9 items-center justify-center rounded-xl transition-all",
                      input.trim() && !isStreaming
                        ? "bg-primary-500 text-white hover:bg-primary-600 active:scale-95 shadow-md shadow-primary-500/25"
                        : "bg-secondary-200 text-secondary-400 cursor-not-allowed",
                    ].join(" ")}
                  >
                    {isStreaming ? (
                      <span className="size-4 rounded-full border-2 border-secondary-400 border-t-transparent animate-spin" />
                    ) : (
                      <svg className="size-4 translate-x-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-center text-xs text-secondary-400 mt-2.5 font-sans">
                  DC-TIM · grounded answers with citations · Enter to send
                </p>
              </div>
            </div>
          )}
        </div>
        </AssistantRuntimeBridge>
      </div>
    </AppLayout>
  );
}
