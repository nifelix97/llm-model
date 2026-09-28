import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Brain,
  Clock,
  Database,
  FileText,
  FolderOpen,
  MessageSquare,
  Puzzle,
  Search,
} from "lucide-react";
import Alert from "../components/Alert";
import AppLayout from "../components/AppLayout";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import Input from "../components/Input";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import {
  listDataEntries,
  RagApiError,
  type DataEntry,
  type DataListResult,
  type DataSummary,
} from "../lib/ragApi";

const PAGE_SIZE = 25;

type Filter = "all" | "document" | "knowledge" | "qa";

const TYPE_ICON: Record<string, ReactNode> = {
  qa: <MessageSquare className="size-5" />,
  knowledge: <BookOpen className="size-5" />,
  document: <FileText className="size-5" />,
};

const TYPE_LABEL: Record<string, string> = {
  qa: "Q&A",
  knowledge: "Knowledge",
  document: "Document",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function fileExtension(name: string | null): string {
  if (!name) return "";
  const ext = name.split(".").pop();
  return ext ? ext.toUpperCase() : "";
}

// Cloudinary-backed entries store the delivery URL in file_path; local storage
// stores a relative path that the browser cannot open on its own.
function isRemoteFile(name: string | null): boolean {
  return !!name && /^https?:\/\//i.test(name);
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <Card
      className={[
        "p-4 flex items-center gap-3",
        accent ? "border-primary-200 bg-primary-50/40" : "",
      ].join(" ")}
    >
      <span className="shrink-0 size-10 rounded-xl bg-white border border-secondary-100 flex items-center justify-center text-primary-500 shadow-sm">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold text-secondary-900 font-sans leading-none">
          {value}
        </p>
        <p className="text-xs text-secondary-500 font-sans mt-1 truncate">{label}</p>
      </div>
    </Card>
  );
}

// ─── Filter tab ───────────────────────────────────────────────────────────────

function FilterTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold font-sans transition-all",
        active
          ? "bg-primary-500 text-white shadow-sm"
          : "text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900",
      ].join(" ")}
    >
      <span>{label}</span>
      {count !== undefined && (
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

// ─── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: DataEntry }) {
  const sourceType = entry.source_type as string;
  const tags = Array.isArray(entry.tags) ? entry.tags : [];

  return (
    <div className="rounded-xl border border-secondary-100 bg-white px-4 py-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <span className="shrink-0 size-10 rounded-xl bg-secondary-50 border border-secondary-100 flex items-center justify-center text-secondary-400">
          {TYPE_ICON[sourceType] ?? <FolderOpen className="size-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-secondary-900 font-sans break-words">
              {entry.title || "Untitled"}
            </h3>
            <Badge variant="secondary">{TYPE_LABEL[sourceType] ?? entry.source_type}</Badge>
            {entry.category && <Badge variant="primary">{entry.category}</Badge>}
            {fileExtension(entry.file_path) && (
              <Badge variant="secondary">{fileExtension(entry.file_path)}</Badge>
            )}
            {isRemoteFile(entry.file_path) && (
              <a
                href={entry.file_path as string}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-primary-500 hover:text-primary-400 underline underline-offset-2"
              >
                Open file
              </a>
            )}
          </div>

          {entry.preview && (
            <p className="text-sm text-secondary-500 font-sans mt-1.5 line-clamp-2 whitespace-pre-wrap">
              {entry.preview}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-secondary-400 font-sans">
            <span className="inline-flex items-center gap-1.5">
              <Puzzle className="size-3.5" />
              {entry.chunk_count} chunk{entry.chunk_count === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {formatDate(entry.created_at)}
            </span>
            {tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <Badge key={t} variant="primary">
                    {t}
                  </Badge>
                ))}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataLakePage() {
  const { user } = useAuth();
  const canManageData = Boolean(user?.permissions?.includes("data:manage"));

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      const requestId = ++requestIdRef.current;
      if (!append) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const result: DataListResult = await listDataEntries({
          source_type: filter === "all" ? "" : filter,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (requestId !== requestIdRef.current) return;

        setEntries((prev) => (append ? [...prev, ...result.entries] : result.entries));
        setSummary(result.summary);
        setTotal(result.total);
        setOffset(nextOffset);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(
          err instanceof RagApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load data lake."
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filter, search]
  );

  // Reset + reload when the filter or debounced search changes.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPage(0, false);
    }, filter === "all" && !search ? 0 : 300);
    return () => window.clearTimeout(timer);
  }, [filter, search, fetchPage]);

  const hasMore = offset + entries.length < total;

  return (
    <AppLayout>
      <div className="flex-1 py-10">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-primary-500"><Brain className="size-4" /></span>
              <p className="text-xs font-semibold text-secondary-500 uppercase tracking-widest font-sans">
                Data Lake
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-extrabold text-secondary-900 font-sans">
                  Created Data
                </h1>
                <p className="mt-1 text-secondary-500 font-sans">
                  Everything ingested into workspace{" "}
                  <span className="font-semibold text-secondary-700">
                    {user?.workspace_id ?? "unknown"}
                  </span>
                  , newest first.
                </p>
              </div>
              {canManageData && <Link to="/models/new">
                <Button variant="ghost" size="md">
                  + Add data
                </Button>
              </Link>}
            </div>
          </div>

          {/* Error */}
          {error && (
            <Alert
              variant="error"
              title="Could not load data"
              onClose={() => setError(null)}
              className="mb-6"
            >
              {error}
            </Alert>
          )}

          {/* Summary stats */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
              <StatCard icon={<Database className="size-5" />} label="Total entries" value={summary.total_entries} />
              <StatCard icon={<Puzzle className="size-5" />} label="Total chunks" value={summary.total_chunks} />
              <StatCard icon={<MessageSquare className="size-5" />} label="Q&A pairs" value={summary.count_by_type["qa"] ?? 0} />
              <StatCard
                icon={<BookOpen className="size-5" />}
                label="Knowledge + documents"
                value={(summary.count_by_type["knowledge"] ?? 0) + (summary.count_by_type["document"] ?? 0)}
              />
            </div>
          )}

          {/* Toolbar */}
          <Card className="p-4 mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="lg:w-80 shrink-0">
                <Input
                  placeholder="Search titles and content…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search data lake"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterTab active={filter === "all"} onClick={() => setFilter("all")} label="All" count={summary?.total_entries} />
                <FilterTab active={filter === "qa"} onClick={() => setFilter("qa")} label="Q&A" count={summary?.count_by_type["qa"]} />
                <FilterTab active={filter === "knowledge"} onClick={() => setFilter("knowledge")} label="Knowledge" count={summary?.count_by_type["knowledge"]} />
                <FilterTab active={filter === "document"} onClick={() => setFilter("document")} label="Documents" count={summary?.count_by_type["document"]} />
              </div>
              <button
                type="button"
                aria-label="Refresh"
                title="Refresh"
                onClick={() => void fetchPage(0, false)}
                disabled={loading}
                className="ml-auto shrink-0 p-2 rounded-lg text-secondary-400 hover:text-primary-500 hover:bg-primary-50 transition-colors disabled:opacity-50"
              >
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </Card>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Spinner size="lg" label="Loading data lake…" />
              <p className="text-sm text-secondary-500 font-sans">Loading your data…</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-2xl border-2 border-dashed border-secondary-200 bg-secondary-50 text-center px-6">
              <span className="mb-3 text-secondary-300">
                {filter !== "all" || search ? <Search className="size-9" /> : <FolderOpen className="size-9" />}
              </span>
              <p className="text-sm font-semibold text-secondary-600 font-sans">
                {filter !== "all" || search ? "No matching data" : "No data created yet"}
              </p>
              <p className="text-xs text-secondary-400 font-sans mt-1 max-w-sm">
                {filter !== "all" || search
                  ? `Nothing matches the current ${filter !== "all" ? `“${TYPE_LABEL[filter]?.toLowerCase()}” filter` : "search"}. Try broadening your search.`
                  : "Add Q&A pairs, knowledge entries, or upload documents from the Data Lake → Add Data page."}
              </p>
              {filter === "all" && !search && canManageData && (
                <Link to="/models/new" className="mt-4">
                  <Button size="sm" variant="ghost">
                    Create your first data
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-secondary-500 font-sans mb-3">
                Showing {entries.length} of {total} result{total === 1 ? "" : "s"}
                {filter === "all" ? "" : ` for ${TYPE_LABEL[filter]?.toLowerCase()}`}
                {search ? ` matching “${search}”` : ""}
              </p>
              <div className="flex flex-col gap-3">
                {entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center mt-6">
                  <Button
                    variant="secondary"
                    onClick={() => void fetchPage(offset + PAGE_SIZE, true)}
                    loading={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
