import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export default function Input({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-secondary-100 font-sans"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={[
          "w-full rounded-lg border px-4 py-2.5 text-secondary-100 text-sm font-sans",
          "bg-primary-50 placeholder:text-secondary-100",
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
