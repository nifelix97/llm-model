import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Alert from "../components/Alert";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import Input from "../components/Input";
import Spinner from "../components/Spinner";
import Textarea from "../components/Textarea";
import { useAuth } from "../context/AuthContext";
import {
  ingestBatch,
  RagApiError,
  scrapePreview,
  type ScrapePreviewResult,
  uploadDocument,
} from "../lib/ragApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = "qa" | "knowledge" | "documents" | "web";

interface QAEntry {
  id: string;
  question: string;
  answer: string;
  category: string;
}

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string;
}

interface DocEntry {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
}

interface WebEntry {
  id: string;
  url: string;
  title: string;
  content: string;
  tags: string;
}

type SubmitStatus = "idle" | "submitting" | "success" | "error";

interface SubmitSummary {
  documents: number;
  batchItems: number;
  totalChunks: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED = ".pdf,.txt,.md,.csv,.docx,.json,.jsonl";

// ─── Small pieces ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold font-sans transition-all",
        active
          ? "bg-primary-500 text-white shadow-sm"
          : "text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900",
      ].join(" ")}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {count > 0 && (
        <span
          className={[
            "inline-flex items-center justify-center size-5 rounded-full text-xs font-bold",
            active ? "bg-primary-400 text-white" : "bg-secondary-200 text-secondary-700",
          ].join(" ")}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove"
      onClick={onClick}
      className="shrink-0 p-1.5 rounded-lg text-secondary-300 hover:text-error-500 hover:bg-error-50 transition-colors"
    >
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18" />
      </svg>
    </button>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 rounded-2xl border-2 border-dashed border-secondary-200 bg-secondary-50 text-center">
      <span className="text-3xl mb-3">{icon}</span>
      <p className="text-sm font-semibold text-secondary-600 font-sans">{title}</p>
      <p className="text-xs text-secondary-400 font-sans mt-1">{subtitle}</p>
    </div>
  );
}

// ─── Q&A Tab ──────────────────────────────────────────────────────────────────

function QATab({
  entries,
  onAdd,
  onDelete,
}: {
  entries: QAEntry[];
  onAdd: (e: QAEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [category, setCategory] = useState("");
  const [errors, setErrors] = useState<{ question?: string; answer?: string }>({});

  function handleAdd() {
    const errs: typeof errors = {};
    if (!question.trim()) errs.question = "Question is required.";
    if (!answer.trim()) errs.answer = "Answer is required.";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onAdd({ id: uid(), question, answer, category });
    setQuestion(""); setAnswer(""); setCategory("");
    setErrors({});
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Input form */}
      <Card>
        <p className="text-xs font-semibold uppercase tracking-widest text-secondary-500 mb-5 font-sans">
          New Q&A Pair
        </p>
        <div className="flex flex-col gap-4">
          <Textarea
            label="Question"
            placeholder="What is …?"
            value={question}
            onChange={(e) => { setQuestion(e.target.value); setErrors((p) => ({ ...p, question: undefined })); }}
            rows={2}
            error={errors.question}
          />
          <Textarea
            label="Answer"
            placeholder="The answer is …"
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); setErrors((p) => ({ ...p, answer: undefined })); }}
            rows={4}
            error={errors.answer}
          />
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <Input
              label="Category (optional)"
              placeholder="e.g. product, billing, technical"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleAdd} size="md" className="shrink-0 sm:mb-0">
              Add pair
            </Button>
          </div>
        </div>
      </Card>

      {/* List */}
      {entries.length === 0 ? (
        <EmptyState icon="💬" title="No Q&A pairs yet" subtitle="Fill the form above and click Add pair" />
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((e, i) => (
            <div key={e.id} className="rounded-xl border border-secondary-100 bg-white overflow-hidden hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-3 px-4 pt-3 pb-2">
                <span className="shrink-0 flex size-6 items-center justify-center rounded-full bg-primary-50 text-primary-500 text-xs font-bold font-sans mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div>
                    <p className="text-xs font-semibold text-secondary-400 uppercase tracking-wider font-sans mb-0.5">Q</p>
                    <p className="text-sm text-secondary-900 font-sans">{e.question}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-secondary-400 uppercase tracking-wider font-sans mb-0.5">A</p>
                    <p className="text-sm text-secondary-600 font-sans whitespace-pre-wrap">{e.answer}</p>
                  </div>
                  {e.category && <Badge variant="secondary">{e.category}</Badge>}
                </div>
                <DeleteButton onClick={() => onDelete(e.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Knowledge Tab ────────────────────────────────────────────────────────────

function KnowledgeTab({
  entries,
  onAdd,
  onDelete,
}: {
  entries: KnowledgeEntry[];
  onAdd: (e: KnowledgeEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});

  function handleAdd() {
    const errs: typeof errors = {};
    if (!title.trim()) errs.title = "Title is required.";
    if (!content.trim()) errs.content = "Content is required.";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onAdd({ id: uid(), title, content, tags });
    setTitle(""); setContent(""); setTags("");
    setErrors({});
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-widest text-secondary-500 mb-5 font-sans">
          New Knowledge Entry
        </p>
        <div className="flex flex-col gap-4">
          <Input
            label="Title"
            placeholder="e.g. Company Refund Policy"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setErrors((p) => ({ ...p, title: undefined })); }}
            error={errors.title}
          />
          <Textarea
            label="Content"
            placeholder="Write or paste the knowledge content here…"
            value={content}
            onChange={(e) => { setContent(e.target.value); setErrors((p) => ({ ...p, content: undefined })); }}
            rows={6}
            error={errors.content}
            hint={`${content.length} characters`}
          />
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <Input
              label="Tags (optional)"
              placeholder="policy, refund, shipping"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              hint="Comma-separated."
              className="flex-1"
            />
            <Button onClick={handleAdd} size="md" className="shrink-0">
              Add entry
            </Button>
          </div>
        </div>
      </Card>

      {entries.length === 0 ? (
        <EmptyState icon="📚" title="No knowledge entries yet" subtitle="Fill the form above and click Add entry" />
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((e) => {
            const parsedTags = e.tags.split(",").map((t) => t.trim()).filter(Boolean);
            return (
              <div key={e.id} className="rounded-xl border border-secondary-100 bg-white px-4 py-3 hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-secondary-900 font-sans">{e.title}</p>
                    <p className="text-sm text-secondary-500 font-sans mt-1 line-clamp-2 whitespace-pre-wrap">
                      {e.content}
                    </p>
                    {parsedTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {parsedTags.map((t) => <Badge key={t} variant="primary">{t}</Badge>)}
                      </div>
                    )}
                  </div>
                  <DeleteButton onClick={() => onDelete(e.id)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Documents Tab ────────────────────────────────────────────────────────────

function DocumentsTab({
  entries,
  onAdd,
  onDelete,
}: {
  entries: DocEntry[];
  onAdd: (e: DocEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function processFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      onAdd({ id: uid(), name: file.name, size: file.size, type: file.type, file });
    });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    processFiles(e.dataTransfer.files);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    processFiles(e.target.files);
    e.target.value = "";
  }

  function fileIcon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    const map: Record<string, string> = {
      pdf: "📄", txt: "📝", md: "📝", csv: "📊",
      docx: "📃", json: "🗂️", jsonl: "🗂️",
    };
    return map[ext ?? ""] ?? "📁";
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={[
          "flex flex-col items-center justify-center gap-3 py-14 rounded-2xl border-2 border-dashed cursor-pointer transition-colors",
          dragging
            ? "border-primary-400 bg-primary-50"
            : "border-secondary-200 bg-white hover:border-primary-300 hover:bg-primary-50/40",
        ].join(" ")}
      >
        <span className="text-4xl">{dragging ? "📂" : "⬆️"}</span>
        <div className="text-center">
          <p className="text-sm font-semibold text-secondary-700 font-sans">
            {dragging ? "Drop files here" : "Drag & drop files, or click to browse"}
          </p>
          <p className="text-xs text-secondary-400 font-sans mt-1">
            Supports PDF, TXT, MD, CSV, DOCX, JSON, JSONL
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          onChange={handleChange}
          className="hidden"
          aria-hidden
        />
      </div>

      {/* File list */}
      {entries.length === 0 ? (
        <EmptyState icon="🗂️" title="No documents uploaded" subtitle="Upload files using the area above" />
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-secondary-100 bg-white px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <span className="text-2xl shrink-0">{fileIcon(e.name)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-secondary-900 font-sans truncate">{e.name}</p>
                <p className="text-xs text-secondary-400 font-sans">{formatBytes(e.size)}</p>
              </div>
              <Badge variant="secondary">{e.name.split(".").pop()?.toUpperCase()}</Badge>
              <DeleteButton onClick={() => onDelete(e.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Web Scraping Tab ─────────────────────────────────────────────────────────

function WebTab({
  entries,
  onAdd,
  onDelete,
}: {
  entries: WebEntry[];
  onAdd: (e: WebEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScrapePreviewResult | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [errors, setErrors] = useState<{ url?: string; title?: string }>({});

  async function handleFetch() {
    const trimmed = url.trim();
    if (!trimmed) { setErrors({ url: "Enter a URL to scrape." }); return; }
    setErrors({});
    setError(null);
    setPreview(null);
    setFetching(true);
    try {
      const res = await scrapePreview(trimmed);
      setPreview(res);
      setTitle(res.suggested_title);
      setTags("");
    } catch (err) {
      setError(
        err instanceof RagApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Scrape failed."
      );
    } finally {
      setFetching(false);
    }
  }

  function handleAdd() {
    if (!preview) return;
    const errs: typeof errors = {};
    if (!title.trim()) errs.title = "Title is required.";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onAdd({ id: uid(), url: preview.url, title: title.trim(), content: preview.text, tags });
    setUrl("");
    setPreview(null);
    setTitle("");
    setTags("");
    setErrors({});
  }

  const shownBody =
    preview && preview.text.length > 1200
      ? `${preview.text.slice(0, 1200)}…`
      : preview?.text ?? "";

  return (
    <div className="flex flex-col gap-6">
      {/* Fetch form */}
      <Card>
        <p className="text-xs font-semibold uppercase tracking-widest text-secondary-500 mb-5 font-sans">
          New Web Source
        </p>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <Input
              label="URL"
              placeholder="https://example.com/page"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setErrors((p) => ({ ...p, url: undefined })); }}
              error={errors.url}
              hint="Public page; scraped text is not ingested until you add it."
              className="flex-1"
            />
            <Button onClick={handleFetch} size="md" disabled={fetching} className="shrink-0">
              {fetching ? (
                <>
                  <Spinner size="sm" label="Fetching…" />
                  Fetching…
                </>
              ) : (
                "Fetch preview"
              )}
            </Button>
          </div>

          {error && (
            <Alert variant="error" title="Could not fetch page" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {preview && (
            <div className="rounded-xl border border-secondary-100 bg-secondary-50 p-4 flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none mt-0.5">🌐</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-secondary-400 uppercase tracking-wider font-sans mb-1">
                    Previews <span className="normal-case">{preview.text_length.toLocaleString()} characters</span>
                  </p>
                  <p className="text-xs text-secondary-500 font-sans truncate">{preview.url}</p>
                  {preview.window_title && (
                    <p className="text-xs text-secondary-400 font-sans mt-0.5">
                      Page title: {preview.window_title}
                    </p>
                  )}
                </div>
              </div>
              <Input
                label="Title"
                placeholder="Title for this source"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setErrors((p) => ({ ...p, title: undefined })); }}
                error={errors.title}
              />
              <Input
                label="Tags (optional)"
                placeholder="policy, education, budget"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                hint="Comma-separated."
              />
              <div>
                <p className="text-xs font-semibold text-secondary-400 uppercase tracking-wider font-sans mb-1">
                  Extracted text
                </p>
                <div className="max-h-48 overflow-auto rounded-lg bg-white border border-secondary-200 p-3">
                  <p className="text-xs text-secondary-700 font-sans whitespace-pre-wrap break-words">
                    {shownBody}
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleAdd} size="md">
                  Add page
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {entries.length === 0 ? (
        <EmptyState
          icon="🌐"
          title="No web sources yet"
          subtitle="Enter a URL above, review the preview, then click Add page"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map((e) => {
            const parsedTags = e.tags.split(",").map((t) => t.trim()).filter(Boolean);
            return (
              <div key={e.id} className="rounded-xl border border-secondary-100 bg-white px-4 py-3 hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-3">
                  <span className="text-2xl shrink-0 leading-none">🌐</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-secondary-900 font-sans">{e.title}</p>
                    <p className="text-xs text-secondary-400 font-sans mt-0.5 truncate">{e.url}</p>
                    <p className="text-xs text-secondary-500 font-sans mt-1 line-clamp-2 whitespace-pre-wrap">
                      {e.content}
                    </p>
                    {parsedTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {parsedTags.map((t) => <Badge key={t} variant="primary">{t}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">{e.content.length.toLocaleString()} chars</Badge>
                    <DeleteButton onClick={() => onDelete(e.id)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ModelConfigPage() {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<TabId>("qa");
  const [qaEntries, setQaEntries] = useState<QAEntry[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [docEntries, setDocEntries] = useState<DocEntry[]>([]);
  const [webEntries, setWebEntries] = useState<WebEntry[]>([]);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSummary, setSubmitSummary] = useState<SubmitSummary | null>(null);
  const [modelName, setModelName] = useState("");

  const totalItems = qaEntries.length + knowledgeEntries.length + docEntries.length + webEntries.length;

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (totalItems === 0) return;
    setSubmitStatus("submitting");
    setSubmitError(null);
    setSubmitSummary(null);

    try {
      const uploadResults = await Promise.all(
        docEntries.map(async (doc) => {
          try {
            return await uploadDocument(doc.file, doc.name);
          } catch (err) {
            const detail = err instanceof RagApiError ? err.message : "upload failed";
            throw new Error(`File "${doc.name}": ${detail}`, { cause: err });
          }
        })
      );

      const batchResult =
        qaEntries.length > 0 || knowledgeEntries.length > 0 || webEntries.length > 0
          ? await ingestBatch({
              model_name: modelName,
              qa: qaEntries.map((e) => ({
                title: e.question.slice(0, 80) || "Q&A Entry",
                question: e.question,
                answer: e.answer,
                category: e.category || null,
              })),
              knowledge: [
                ...knowledgeEntries.map((e) => ({
                  title: e.title,
                  content: e.content,
                  tags: e.tags
                    ? e.tags.split(",").map((t) => t.trim()).filter(Boolean)
                    : [],
                })),
                ...webEntries.map((e) => ({
                  title: e.title,
                  content: e.content,
                  tags: e.tags
                    ? e.tags.split(",").map((t) => t.trim()).filter(Boolean)
                    : [],
                })),
              ],
            })
          : null;

      const totalChunks =
        uploadResults.reduce((sum, r) => sum + (r.chunk_count ?? 0), 0) +
        (batchResult?.results ?? []).reduce((sum, r) => sum + (r.chunk_count ?? 0), 0);

      setSubmitSummary({
        documents: uploadResults.length,
        batchItems: batchResult?.ingested ?? 0,
        totalChunks,
      });
      setSubmitStatus("success");
      setQaEntries([]);
      setKnowledgeEntries([]);
      setDocEntries([]);
      setWebEntries([]);
      setModelName("");
    } catch (err) {
      setSubmitStatus("error");
      setSubmitError(
        err instanceof RagApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "An unexpected error occurred."
      );
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="flex-1 py-10">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-primary-500">🧠</span>
              <p className="text-xs font-semibold text-secondary-500 uppercase tracking-widest font-sans">
                Model Training
              </p>
            </div>
            <h1 className="text-3xl font-extrabold text-secondary-900 font-sans">
              Feed the Model
            </h1>
            <p className="mt-1 text-secondary-500 font-sans">
              Add Q&A pairs, knowledge entries, and documents, or scrape public web pages, for workspace{" "}
              <span className="font-semibold text-secondary-700">
                {user?.workspace_id ?? "unknown"}
              </span>
              . Ingested data is searchable only within your workspace.
            </p>
          </div>

          {submitStatus === "success" && (
            <Alert
              variant="success"
              title="Ingestion complete"
              onClose={() => {
                setSubmitStatus("idle");
                setSubmitSummary(null);
              }}
              className="mb-6"
            >
              {submitSummary
                ? `Indexed ${submitSummary.documents + submitSummary.batchItems} source${
                    submitSummary.documents + submitSummary.batchItems === 1 ? "" : "s"
                  } into ${submitSummary.totalChunks} chunk${
                    submitSummary.totalChunks === 1 ? "" : "s"
                  }. They are now searchable from the Prompt page.`
                : "Your data has been ingested and is now searchable in the model."}
            </Alert>
          )}

          {/* Error alert */}
          {submitStatus === "error" && submitError && (
            <Alert
              variant="error"
              title="Ingestion failed"
              onClose={() => {
                setSubmitStatus("idle");
                setSubmitError(null);
              }}
              className="mb-6"
            >
              {submitError}
            </Alert>
          )}

          <div className="flex flex-col gap-6">

            {/* Model target */}
            <Card>
              <div className="flex flex-col sm:flex-row gap-4 items-end">
                <Input
                  label="Target model"
                  placeholder="e.g. san-3-turbo, my-custom-model"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  hint="Which model should this data be applied to."
                  className="flex-1"
                />
                <div className="flex items-center gap-3 shrink-0 pb-0.5">
                  <div className={[
                    "flex items-center gap-2 text-xs font-semibold font-sans px-3 py-2 rounded-lg border",
                    totalItems > 0
                      ? "bg-success-50 border-success-200 text-success-700"
                      : "bg-secondary-100 border-secondary-200 text-secondary-500",
                  ].join(" ")}>
                    <span className={["size-2 rounded-full", totalItems > 0 ? "bg-success-500" : "bg-secondary-400"].join(" ")} />
                    {totalItems > 0 ? `${totalItems} item${totalItems === 1 ? "" : "s"} ready` : "No data yet"}
                  </div>
                </div>
              </div>
            </Card>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2 p-1.5 bg-white rounded-2xl border border-secondary-100 shadow-sm">
              <TabButton active={activeTab === "qa"} onClick={() => setActiveTab("qa")} icon="💬" label="Q&A Pairs" count={qaEntries.length} />
              <TabButton active={activeTab === "knowledge"} onClick={() => setActiveTab("knowledge")} icon="📚" label="Knowledge" count={knowledgeEntries.length} />
              <TabButton active={activeTab === "documents"} onClick={() => setActiveTab("documents")} icon="📁" label="Documents" count={docEntries.length} />
              <TabButton active={activeTab === "web"} onClick={() => setActiveTab("web")} icon="🌐" label="Web" count={webEntries.length} />
            </div>

            {/* Tab content */}
            {activeTab === "qa" && (
              <QATab
                entries={qaEntries}
                onAdd={(e) => setQaEntries((prev) => [...prev, e])}
                onDelete={(id) => setQaEntries((prev) => prev.filter((e) => e.id !== id))}
              />
            )}
            {activeTab === "knowledge" && (
              <KnowledgeTab
                entries={knowledgeEntries}
                onAdd={(e) => setKnowledgeEntries((prev) => [...prev, e])}
                onDelete={(id) => setKnowledgeEntries((prev) => prev.filter((e) => e.id !== id))}
              />
            )}
            {activeTab === "documents" && (
              <DocumentsTab
                entries={docEntries}
                onAdd={(e) => setDocEntries((prev) => [...prev, e])}
                onDelete={(id) => setDocEntries((prev) => prev.filter((e) => e.id !== id))}
              />
            )}
            {activeTab === "web" && (
              <WebTab
                entries={webEntries}
                onAdd={(e) => setWebEntries((prev) => [...prev, e])}
                onDelete={(id) => setWebEntries((prev) => prev.filter((e) => e.id !== id))}
              />
            )}

            {/* Summary + submit bar */}
            <div className="sticky bottom-4 z-10">
              <div className="bg-secondary-900/95 backdrop-blur rounded-2xl border border-secondary-700 px-5 py-4 shadow-xl">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white font-sans">
                      Submit training data
                    </p>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5">
                      {qaEntries.length > 0 && (
                        <span className="text-xs text-secondary-400 font-sans">
                          💬 {qaEntries.length} Q&A pair{qaEntries.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {knowledgeEntries.length > 0 && (
                        <span className="text-xs text-secondary-400 font-sans">
                          📚 {knowledgeEntries.length} knowledge entr{knowledgeEntries.length !== 1 ? "ies" : "y"}
                        </span>
                      )}
                      {docEntries.length > 0 && (
                        <span className="text-xs text-secondary-400 font-sans">
                          📁 {docEntries.length} document{docEntries.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {webEntries.length > 0 && (
                        <span className="text-xs text-secondary-400 font-sans">
                          🌐 {webEntries.length} page{webEntries.length !== 1 ? "s" : ""}
                        </span>
                      )}
                      {totalItems === 0 && (
                        <span className="text-xs text-secondary-500 font-sans">
                          Add data using the tabs above
                        </span>
                      )}
                    </div>
                  </div>

                  <Button
                    size="md"
                    disabled={totalItems === 0 || submitStatus === "submitting" || submitStatus === "success"}
                    onClick={handleSubmit}
                    className="shrink-0 w-full sm:w-auto"
                  >
                    {submitStatus === "submitting" ? (
                      <>
                        <Spinner size="sm" label="Submitting…" />
                        Submitting…
                      </>
                    ) : submitStatus === "success" ? (
                      "✓ Submitted"
                    ) : (
                      "Submit to model"
                    )}
                  </Button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}
