import type { TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export default function Textarea({
  label,
  error,
  hint,
  id,
  rows = 4,
  className = "",
  ...props
}: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-secondary-700 font-sans"
        >
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        rows={rows}
        className={[
          "w-full rounded-lg border px-4 py-2.5 text-secondary-900 text-sm font-sans",
          "bg-white placeholder:text-secondary-400 resize-y",
          "transition-colors duration-150 outline-none",
          "focus:ring-2 focus:ring-primary-400 focus:border-primary-400",
          error
            ? "border-error-400 focus:ring-error-400"
            : "border-secondary-200",
          "disabled:bg-secondary-50 disabled:cursor-not-allowed",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={!!error}
        aria-describedby={
          error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
        }
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-error-500 font-sans">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}-hint`} className="text-xs text-secondary-500 font-sans">
          {hint}
        </p>
      )}
    </div>
  );
}
