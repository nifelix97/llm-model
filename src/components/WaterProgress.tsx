import { Check, CircleAlert, Droplets } from "lucide-react";

export type WaterProgressStatus = "queued" | "uploading" | "complete" | "error";

interface WaterProgressProps {
  progress: number;
  status: WaterProgressStatus;
  label: string;
}

export default function WaterProgress({ progress, status, label }: WaterProgressProps) {
  const value = Math.max(0, Math.min(100, progress));
  const statusLabel =
    status === "complete"
      ? `${label} upload complete`
      : status === "error"
        ? `${label} upload failed`
        : status === "uploading"
          ? `${label} upload ${value}% complete`
          : `${label} ready to upload`;

  return (
    <div
      className={["water-progress", `water-progress--${status}`].join(" ")}
      role="progressbar"
      aria-label={statusLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={status === "queued" ? 0 : value}
    >
      <div
        className="water-progress__fill"
        style={{ transform: `scaleY(${status === "complete" ? 1 : value / 100})` }}
      >
        <span className="water-progress__surface" aria-hidden="true" />
      </div>
      <span className="water-progress__icon" aria-hidden="true">
        {status === "complete" ? (
          <Check className="size-4" strokeWidth={2.8} />
        ) : status === "error" ? (
          <CircleAlert className="size-4" />
        ) : status === "uploading" ? (
          <Droplets className="size-4" />
        ) : (
          <Droplets className="size-4" />
        )}
      </span>
      <span className="sr-only">{statusLabel}</span>
    </div>
  );
}
