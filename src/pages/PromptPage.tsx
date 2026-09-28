import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import { detectCategory, saveAnalysis } from "../context/AnalysisContext";
import { useAuth } from "../context/AuthContext";
import {
  appendConversationMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  optimizePromptRequest,
  queryRag,
  RagApiError,
  scorePercent,
  type ChatMessage,
  type ChatMessageInput,
  type Citation,
  type ConversationSummary,
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
}

interface Model {
  id: string;
  label: string;
  badge?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS: Model[] = [
  { id: "dc-tim-3-turbo", label: "DC-TIM 3 Turbo", badge: "Fast" },
  { id: "dc-tim-3-pro", label: "DC-TIM 3 Pro", badge: "Smart" },
  { id: "dc-tim-2", label: "DC-TIM 2", badge: "Legacy" },
];

const SUGGESTIONS = [
  "Summarize the key development policies of Sub-Saharan Africa.",
  "What factors drive GDP growth in developing nations?",
  "Compare healthcare infrastructure in low vs high-income countries.",
  "What are the best practices for renewable energy adoption?",
];

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
    },
  };
}

function revealAnswer(
  full: string,
  onPartial: (partial: string, done: boolean) => void,
  onDone: () => void
) {
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

function MessageBubble({
  message,
  onAnalyse,
}: {
  message: Message;
  onAnalyse?: (msg: Message) => void;
}) {
  const isUser = message.role === "user";
  const wasOptimized = isUser && message.originalInput && message.originalInput !== message.content;
  const isCompleteAI = !isUser && !message.streaming && message.content.length > 0 && !message.isError;

  return (
    <div className={["flex gap-3", isUser ? "flex-row-reverse" : "flex-row"].join(" ")}>
      <div
        className={[
          "shrink-0 flex size-8 items-center justify-center rounded-full text-sm font-bold font-sans mt-0.5",
          isUser ? "bg-primary-500 text-white" : "bg-secondary-800 border border-secondary-700 text-primary-400",
        ].join(" ")}
      >
        {isUser ? "U" : "M"}
      </div>

      <div className={["flex flex-col max-w-[75%]", isUser ? "items-end" : "items-start"].join(" ")}>
        {wasOptimized && (
          <p className="text-xs text-secondary-400 font-sans mb-1 px-1 line-through">{message.originalInput}</p>
        )}
        <div
          className={[
            "px-4 py-3 rounded-2xl text-sm font-sans leading-relaxed",
            isUser
              ? "bg-primary-500 text-white rounded-tr-sm"
              : message.isError
                ? "bg-error-50 text-error-800 border border-error-200 rounded-tl-sm"
                : "bg-white text-secondary-800 border border-secondary-200 rounded-tl-sm shadow-sm",
          ].join(" ")}
        >
          {message.streaming ? (
            <TypingDots />
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {!isUser && !message.streaming && message.citations && message.citations.length > 0 && (
          <CitationsPanel citations={message.citations} />
        )}

        {isCompleteAI && onAnalyse && (
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
        <span className="text-xs text-secondary-400 mt-1 font-sans px-1">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {message.traceId ? ` · ${message.traceId.slice(0, 8)}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PromptPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingOriginal, setPendingOriginal] = useState<string | null>(null);
  const [pendingOptimized, setPendingOptimized] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  // Per-user conversation history (persisted on the backend).
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  const { user } = useAuth();

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const historyBootedRef = useRef(false);

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
    setMessages(detail.messages.map(messageFromServer));
    activeIdRef.current = detail.id;
    setActiveId(detail.id);
    setShowSuggestions(detail.messages.length === 0);
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
    if (!historyEnabled) return;
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
    setInput("");
    await refreshConversations();
  }

  async function dispatchMessage(content: string, originalInput?: string) {
    setShowSuggestions(false);
    setInput("");
    setPendingOriginal(null);
    setPendingOptimized(null);

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

    try {
      const data = await queryRag(content, 5);
      const answer = data.answer || "No answer returned.";
      const citations = data.citations ?? [];
      const traceId = data.trace_id;

      revealAnswer(
        answer,
        (partial, done) => {
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
                  }
                : m
            )
          );
          if (done) {
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
            };
            void persistTurn(conversationId, userMsg, finalMsg);
          }
        },
        () => setIsStreaming(false)
      );
    } catch (err) {
      const message =
        err instanceof RagApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unexpected error talking to the RAG backend.";
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
      if (conversationId) void persistTurn(conversationId, userMsg, errorMsg);
    }
  }

  async function handleSend(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || isStreaming) return;
    setOptimizing(true);
    setPendingOriginal(trimmed);
    try {
      const res = await optimizePromptRequest(trimmed);
      const optimized = (res.optimized_prompt ?? "").trim();
      if (!optimized || optimized === trimmed) {
        setPendingOriginal(null);
        setPendingOptimized(null);
        dispatchMessage(trimmed);
      } else {
        setPendingOptimized(optimized);
      }
    } catch {
      setPendingOriginal(null);
      setPendingOptimized(null);
      dispatchMessage(trimmed);
    } finally {
      setOptimizing(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
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
    setShowSuggestions(true);
    setIsStreaming(false);
    setInput("");
    setPendingOriginal(null);
    setPendingOptimized(null);
    setOptimizing(false);
    await refreshConversations();
  }

  function handleAnalyse(msg: Message) {
    if (!user) return;
    saveAnalysis({
      prompt: msg.prompt ?? "",
      response: msg.content,
      category: detectCategory(msg.content),
      timestamp: Date.now(),
    }, user.workspace_id);
    navigate("/dashboard");
  }

  const currentModel = MODELS.find((m) => m.id === selectedModel)!;
  const showPreview = !!pendingOriginal && !!pendingOptimized;

  return (
    <AppLayout fullHeight>
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-14 border-b border-secondary-200 bg-white z-20">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-secondary-700 font-sans">Model Prompt</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-50 border border-primary-100 text-primary-600 text-xs font-semibold font-sans">
            Auto-optimize on
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedModel(e.target.value)}
              className="appearance-none bg-secondary-100 border border-secondary-200 text-secondary-800 text-sm font-semibold font-sans rounded-xl pl-3 pr-8 py-1.5 outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer transition-colors hover:border-secondary-300"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-secondary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {currentModel.badge && <Badge variant="primary">{currentModel.badge}</Badge>}
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 text-xs text-secondary-500 hover:text-secondary-800 px-3 py-1.5 rounded-lg hover:bg-secondary-100 transition-colors font-sans"
            >
              Clear chat
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

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto w-full max-w-3xl flex flex-col gap-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center pt-16 pb-8 text-center">
                  <div className="size-16 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center text-sm font-bold text-primary-600 font-sans mb-5">
                    Model
                  </div>
                  <h2 className="text-2xl font-extrabold text-secondary-900 font-sans mb-2">Ask the model anything</h2>
                  <p className="text-secondary-500 text-sm font-sans max-w-sm">
                    Powered by <span className="text-primary-500 font-semibold">{currentModel.label}</span>.
                    Answers include citations from your ingested workspace knowledge.
                  </p>
                </div>
              )}

              {showSuggestions && messages.length === 0 && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSend(s)}
                      className="text-left px-4 py-3.5 rounded-2xl border border-secondary-200 bg-white hover:bg-primary-50 hover:border-primary-200 transition-all group shadow-sm"
                    >
                      <p className="text-sm text-secondary-700 font-sans group-hover:text-secondary-900 transition-colors leading-snug">{s}</p>
                      <p className="text-xs text-secondary-400 mt-1.5 font-sans group-hover:text-primary-500 transition-colors">Click to ask →</p>
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onAnalyse={handleAnalyse} />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {optimizing && (
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
            <div className="shrink-0 border-t border-secondary-200 bg-white px-4 py-4">
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
                    placeholder={isStreaming ? "Model is responding…" : "Type your question — it will be optimized automatically"}
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
                  {currentModel.label}
                  {user?.workspace_id ? ` · workspace ${user.workspace_id}` : ""}
                  {" · grounded answers with citations · Enter to send"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
