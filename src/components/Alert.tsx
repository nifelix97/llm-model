import { Check, Info, TriangleAlert, X, XCircle } from "lucide-react";

type AlertVariant = "info" | "success" | "error" | "warning";

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

const styles: Record<AlertVariant, { wrapper: string; icon: string; title: string; body: string }> = {
  info: {
    wrapper: "bg-primary-50 border-primary-200",
    icon: "text-primary-500",
    title: "text-primary-800",
    body: "text-primary-700",
  },
  success: {
    wrapper: "bg-success-50 border-success-200",
    icon: "text-success-500",
    title: "text-success-800",
    body: "text-success-700",
  },
  error: {
    wrapper: "bg-error-50 border-error-200",
    icon: "text-error-500",
    title: "text-error-800",
    body: "text-error-700",
  },
  warning: {
    wrapper: "bg-secondary-50 border-secondary-300",
    icon: "text-secondary-600",
    title: "text-secondary-800",
    body: "text-secondary-700",
  },
};

const icons: Record<AlertVariant, React.ReactNode> = {
  info: <Info className="size-5" />,
  success: <Check className="size-5" />,
  error: <XCircle className="size-5" />,
  warning: <TriangleAlert className="size-5" />,
};

export default function Alert({
  variant = "info",
  title,
  children,
  onClose,
  className = "",
}: AlertProps) {
  const s = styles[variant];

  return (
    <div
      role="alert"
      className={[
        "flex gap-3 rounded-xl border px-4 py-3 font-sans",
        s.wrapper,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={["shrink-0 mt-0.5", s.icon].join(" ")} aria-hidden>
        {icons[variant]}
      </span>
      <div className="flex-1 min-w-0">
        {title && (
          <p className={["text-sm font-semibold mb-0.5", s.title].join(" ")}>
            {title}
          </p>
        )}
        <div className={["text-sm", s.body].join(" ")}>{children}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss alert"
          className={["shrink-0 hover:opacity-70 transition-opacity", s.icon].join(" ")}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
