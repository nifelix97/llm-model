type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "size-4 border-2",
  md: "size-8 border-[3px]",
  lg: "size-12 border-4",
};

export default function Spinner({
  size = "md",
  label = "Loading…",
  className = "",
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={["inline-flex items-center justify-center", className].join(" ")}
    >
      <span
        className={[
          "rounded-full border-primary-200 border-t-primary-500 animate-spin",
          sizeClasses[size],
        ].join(" ")}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
