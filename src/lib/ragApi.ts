/**
 * Shared client for the DC-TIM RAG + auth backend.
 * Sends Authorization Bearer tokens; workspace is derived server-side from the JWT.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Branded label shown in the UI instead of the underlying vendor/model id. */
export const MODEL_DISPLAY_NAME = "DC-TIM";

const TOKEN_KEY = "dc-tim-token";
const USER_KEY = "dc-tim-user";

export class RagApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RagApiError";
    this.status = status;
  }
}

export type SourceType = "document" | "knowledge" | "qa";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  workspace_id: string;
  role: UserRole;
  permissions: PermissionKey[];
}

export type UserRole = "admin" | "policy_manager" | "analyst" | "viewer";
export type PermissionKey =
  | "dashboard:view"
  | "policy:manage"
  | "prompt:use"
  | "optimize:run"
  | "data:view"
  | "data:manage"
  | "monitoring:view"
  | "users:manage";

export interface ManagedUser extends AuthUser {
  is_active: boolean;
}

export interface LoginResult {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface Citation {
  chunk_id: string;
  document_id: string;
  title: string;
  source_type: SourceType | string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface QueryResult {
  answer: string;
  trace_id: string;
  citations: Citation[];
  answer_mode?: "synthesized" | "evidence_only" | "insufficient";
  telemetry?: {
    embed_ms?: number;
    search_ms?: number;
    generate_ms?: number;
    total_ms?: number;
    citation_count?: number;
    citation_coverage?: number;
    embedding_provider?: string;
    embedding_model?: string;
    answer_provider?: string;
    answer_model?: string;
    intent?: string | null;
    search_strategy?: string;
    rerank_ms?: number;
    estimated_prompt_tokens?: number;
    estimated_completion_tokens?: number;
  } | null;
}

export type EvidenceStatus = "sufficient" | "partial" | "insufficient";
export type AnalysisPriority = "low" | "medium" | "high" | "critical";
export type MetricDirection = "increase" | "decrease" | "neutral";

export interface PolicyAssessment {
  score: number | null;
  rationale: string;
}

export interface PolicyRisk {
  title: string;
  detail: string;
  severity: AnalysisPriority;
  likelihood: number;
  impact: number;
  mitigation: string;
  evidence_refs: string[];
}

export interface PolicyRecommendation {
  title: string;
  detail: string;
  priority: AnalysisPriority;
  expected_impact: string;
  confidence: number;
  timeframe: string;
  evidence_refs: string[];
}

export interface PolicyMetric {
  label: string;
  baseline: number | null;
  projected: number | null;
  change_percent: number | null;
  unit: string;
  direction: MetricDirection;
  confidence: number;
  rationale: string;
  evidence_refs: string[];
}

export interface PolicyDimension {
  label: string;
  score: number;
  rationale: string;
}

export interface PolicyPhase {
  label: string;
  time_horizon: string;
  progress: number;
  actions: string[];
}

export interface PolicyAnalysisResult {
  policy_name: string;
  category: string;
  summary: string;
  evidence_status: EvidenceStatus;
  confidence: number;
  analysis_basis: string;
  feasibility: PolicyAssessment;
  likelihood: PolicyAssessment;
  risks: PolicyRisk[];
  recommendations: PolicyRecommendation[];
  metrics: PolicyMetric[];
  dimensions: PolicyDimension[];
  phases: PolicyPhase[];
  uncertainties: string[];
  next_steps: string[];
  citations: Citation[];
  trace_id: string;
  generated_at: string;
  provider: string;
  model: string;
  telemetry: Record<string, unknown>;
}

export interface ScrapePreviewResult {
  url: string;
  window_title: string | null;
  suggested_title: string;
  text: string;
  text_length: number;
}

export interface IngestResult {
  document_id: string;
  title: string;
  source_type: SourceType | string;
  chunk_count: number;
  file_path?: string | null;
}

export type PolicyStatus =
  | "created"
  | "approved"
  | "in_implementation"
  | "monitoring"
  | "completed"
  | "on_hold";

export interface PolicyArtifactSummary {
  id: string;
  title: string;
  category: string;
  status: PolicyStatus;
  analysis_trace_id: string | null;
  analysis_provider: string | null;
  has_analysis?: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface PolicyArtifact extends PolicyArtifactSummary {
  content: string;
  analysis: PolicyAnalysisResult | null;
}

export interface PolicyListResult {
  policies: PolicyArtifactSummary[];
  total: number;
}

export interface PolicyListParams {
  limit?: number;
  offset?: number;
}

export interface PolicyCreatePayload {
  title: string;
  content: string;
  category: string;
  status?: PolicyStatus;
  analysis_trace_id?: string | null;
  analysis_provider?: string | null;
  analysis?: PolicyAnalysisResult;
}

export interface PolicyUpdatePayload {
  title?: string;
  content?: string;
  category?: string;
  status?: PolicyStatus;
  analysis?: PolicyAnalysisResult;
}

export interface UploadResult extends IngestResult {
  filename: string;
  file_path: string;
  file_url?: string | null;
}

export type UploadProgressHandler = (progress: number) => void;

export interface BatchIngestResult {
  ingested: number;
  results: IngestResult[];
}

export interface DataEntry {
  id: string;
  title: string;
  source_type: SourceType | string;
  source_id: string | null;
  created_at: string;
  file_path: string | null;
  metadata: Record<string, unknown>;
  chunk_count: number;
  preview: string | null;
  tags: string[];
  category: string | null;
}

export interface DataSummary {
  total_entries: number;
  total_chunks: number;
  count_by_type: Record<string, number>;
}

export interface DataListResult {
  summary: DataSummary;
  total: number;
  entries: DataEntry[];
}

export interface DataListParams {
  source_type?: SourceType | string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BatchIngestPayload {
  qa: Array<{
    title: string;
    question: string;
    answer: string;
    category?: string | null;
  }>;
  knowledge: Array<{
    title: string;
    content: string;
    tags?: string[];
  }>;
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function persistSession(token: string, user: AuthUser): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(extra)) {
      for (const [key, value] of extra) headers[key] = value;
    } else {
      Object.assign(headers, extra);
    }
  }
  return headers;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item) =>
          typeof item === "object" && item && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : JSON.stringify(item)
        )
        .join("; ");
    }
  } catch {
    // fall through
  }
  return res.statusText || `Request failed (${res.status})`;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new RagApiError(await readErrorDetail(res), res.status);
  }
  return (await res.json()) as T;
}

export interface ApiOptions {
  /** Abort the request from the caller (e.g. an analysis timeout). */
  signal?: AbortSignal;
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
  { signal }: ApiOptions = {}
): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: init.signal ?? signal,
      headers: authHeaders(init.headers),
    });
  } catch (error) {
    // An abort is a caller-driven cancel, not a connectivity failure: rethrow it
    // so callers can distinguish a timeout from an unreachable backend.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new RagApiError(
      "Cannot reach the backend. Is it running at " + API_BASE + "?",
      0
    );
  }
}

export async function loginRequest(email: string, password: string): Promise<LoginResult> {
  const res = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseJson<LoginResult>(res);
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await apiFetch("/api/v1/auth/me");
  return parseJson<AuthUser>(res);
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const res = await apiFetch("/api/v1/auth/users");
  return parseJson<ManagedUser[]>(res);
}

export async function createManagedUser(payload: {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  permissions: PermissionKey[];
}): Promise<ManagedUser> {
  const res = await apiFetch("/api/v1/auth/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<ManagedUser>(res);
}

export async function updateManagedUser(id: string, payload: {
  role?: UserRole;
  permissions?: PermissionKey[];
  is_active?: boolean;
}): Promise<ManagedUser> {
  const res = await apiFetch(`/api/v1/auth/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<ManagedUser>(res);
}

export async function queryRag(
  query: string,
  topK = 5,
  options: ApiOptions = {},
): Promise<QueryResult> {
  const res = await apiFetch(
    "/api/v1/rag/query",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
    },
    options,
  );
  return parseJson<QueryResult>(res);
}

export async function analyzePolicy(
  query: string,
  topK = 8,
  options: ApiOptions = {}
): Promise<PolicyAnalysisResult> {
  const res = await apiFetch(
    "/api/v1/rag/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
    },
    options
  );
  return parseJson<PolicyAnalysisResult>(res);
}

export async function uploadDocument(
  file: File,
  filename = file.name,
  onProgress?: UploadProgressHandler,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, filename);

  // fetch() does not expose upload progress in browsers.  Keep this one
  // endpoint on XHR so the document card can reflect bytes sent while the
  // backend continues with extraction and embedding.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/v1/rag/upload`);
    Object.entries(authHeaders()).forEach(([key, value]) => {
      xhr.setRequestHeader(key, String(value));
    });

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // Keep the null fallback for a non-JSON error response.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(payload as UploadResult);
        return;
      }

      const detail =
        typeof payload === "object" && payload && "detail" in payload
          ? String((payload as { detail: unknown }).detail)
          : xhr.statusText || `Request failed (${xhr.status})`;
      reject(new RagApiError(detail, xhr.status));
    });

    xhr.addEventListener("error", () => {
      reject(new RagApiError("Cannot reach the backend. Is it running at " + API_BASE + "?", 0));
    });
    xhr.addEventListener("abort", () => {
      reject(new RagApiError("Upload was cancelled.", 0));
    });
    xhr.send(form);
  });
}

export async function ingestBatch(payload: BatchIngestPayload): Promise<BatchIngestResult> {
  const res = await apiFetch("/api/v1/rag/ingest/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<BatchIngestResult>(res);
}

export async function listPolicyArtifacts(
  params: PolicyListParams = {}
): Promise<PolicyListResult> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await apiFetch(`/api/v1/policies${suffix}`);
  return parseJson<PolicyListResult>(res);
}

export async function createPolicyArtifact(
  payload: PolicyCreatePayload
): Promise<PolicyArtifact> {
  const res = await apiFetch("/api/v1/policies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<PolicyArtifact>(res);
}

export async function getPolicyArtifact(id: string): Promise<PolicyArtifact> {
  const res = await apiFetch(`/api/v1/policies/${encodeURIComponent(id)}`);
  return parseJson<PolicyArtifact>(res);
}

export async function updatePolicyArtifact(
  id: string,
  payload: PolicyUpdatePayload
): Promise<PolicyArtifact> {
  const res = await apiFetch(`/api/v1/policies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<PolicyArtifact>(res);
}

export async function listDataEntries(params: DataListParams = {}): Promise<DataListResult> {
  const qs = new URLSearchParams();
  if (params.source_type) qs.set("source_type", params.source_type);
  if (params.search) qs.set("search", params.search);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await apiFetch(`/api/v1/rag/entries${suffix}`);
  return parseJson<DataListResult>(res);
}

export async function scrapePreview(url: string): Promise<ScrapePreviewResult> {
  const res = await apiFetch("/api/v1/rag/scrape/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return parseJson<ScrapePreviewResult>(res);
}

export interface PromptOptimizeResult {
  optimized_prompt: string;
}

export async function optimizePromptRequest(prompt: string): Promise<PromptOptimizeResult> {
  const res = await apiFetch("/api/v1/rag/prompt/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return parseJson<PromptOptimizeResult>(res);
}

export interface IntentResult {
  intent: "conversational" | "factual_rag" | "policy_analysis" | "keyword_lookup" | string;
  confidence: number;
  category: string;
  is_scenario: boolean;
  search_terms: string[];
  suggested_action: string;
  expanded_query: string;
}

export async function detectQueryIntent(query: string): Promise<IntentResult> {
  const res = await apiFetch("/api/v1/rag/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return parseJson<IntentResult>(res);
}

// ─── Chat history (per-user conversations) ────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  prompt?: string | null;
  trace_id?: string | null;
  metadata: Record<string, unknown>;
}

export interface ChatMessageInput {
  role: "user" | "assistant" | "system";
  content: string;
  prompt?: string | null;
  trace_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
}

export interface ConversationListResult {
  conversations: ConversationSummary[];
  total: number;
}

export interface AppendMessagesResult {
  appended: number;
  messages: ChatMessage[];
}

export async function listConversations(limit = 50): Promise<ConversationListResult> {
  const res = await apiFetch(`/api/v1/chat/conversations?limit=${limit}`);
  return parseJson<ConversationListResult>(res);
}

export async function createConversation(title?: string): Promise<ConversationSummary> {
  const res = await apiFetch("/api/v1/chat/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  return parseJson<ConversationSummary>(res);
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await apiFetch(`/api/v1/chat/conversations/${encodeURIComponent(id)}`);
  return parseJson<ConversationDetail>(res);
}

export async function renameConversation(id: string, title: string): Promise<ConversationSummary> {
  const res = await apiFetch(`/api/v1/chat/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return parseJson<ConversationSummary>(res);
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/chat/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new RagApiError(await readErrorDetail(res), res.status);
}

export async function appendConversationMessages(
  id: string,
  messages: ChatMessageInput[]
): Promise<AppendMessagesResult> {
  const res = await apiFetch(`/api/v1/chat/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  return parseJson<AppendMessagesResult>(res);
}

export function scorePercent(score: number): string {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  return `${pct.toFixed(0)}%`;
}
