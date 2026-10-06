import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
  className?: string;
  isUser?: boolean;
}

function CodeBlock({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeString = String(children).replace(/\n$/, "");

  if (inline) {
    return (
      <code
        className="px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-800 font-mono text-xs border border-secondary-200"
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-secondary-700 bg-secondary-900 text-secondary-100 font-mono text-xs shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-secondary-950/80 border-b border-secondary-800 text-[11px] text-secondary-400">
        <span className="font-semibold uppercase tracking-wider">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-sans text-secondary-400 hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <svg className="size-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
                />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto">
        <code className={className} {...props}>
          {children}
        </code>
      </div>
    </div>
  );
}

export default function MarkdownContent({
  content,
  className = "",
  isUser = false,
}: MarkdownContentProps) {
  if (isUser) {
    return <span className={`whitespace-pre-wrap ${className}`}>{content}</span>;
  }

  return (
    <div className={`prose-content text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="text-base font-bold text-secondary-900 mt-4 mb-2 first:mt-0 font-sans border-b border-secondary-200 pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold text-secondary-900 mt-3 mb-1.5 first:mt-0 font-sans">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-secondary-800 mt-2.5 mb-1 first:mt-0 font-sans">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary-700 mt-2 mb-1 first:mt-0 font-sans">
              {children}
            </h4>
          ),

          // Paragraphs & text
          p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed font-sans">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-secondary-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-2 space-y-1 font-sans text-secondary-800">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-2 space-y-1 font-sans text-secondary-800">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-4 border-primary-400 bg-primary-50/50 px-3 py-1.5 text-secondary-700 italic rounded-r-lg">
              {children}
            </blockquote>
          ),

          // Code
          code: ({ className, children, ...props }: { className?: string; children?: ReactNode }) => {
            const isMultiLine = typeof children === "string" && children.includes("\n");
            const hasLang = Boolean(className?.includes("language-"));
            const inline = !isMultiLine && !hasLang;
            return (
              <CodeBlock inline={inline} className={className} {...props}>
                {children}
              </CodeBlock>
            );
          },

          // Tables (GFM)
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-secondary-200 bg-white shadow-xs">
              <table className="w-full text-left border-collapse text-xs font-sans">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-secondary-50 border-b border-secondary-200 text-secondary-700 font-semibold">
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody className="divide-y divide-secondary-100">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-secondary-50/50 transition-colors">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 font-semibold text-secondary-800">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-secondary-700">{children}</td>,

          // Links & Horizontal rules
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:text-primary-700 underline font-medium inline-flex items-center gap-0.5"
            >
              <span>{children}</span>
              <svg className="size-3 inline-block opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          ),
          hr: () => <hr className="my-3 border-secondary-200" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
