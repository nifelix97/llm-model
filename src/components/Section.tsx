import type { HTMLAttributes } from "react";

interface SectionProps extends HTMLAttributes<HTMLElement> {
  /** Limit inner content width and center it */
  contained?: boolean;
  /** Add vertical padding */
  padded?: boolean;
}

export default function Section({
  contained = true,
  padded = true,
  children,
  className = "",
  ...props
}: SectionProps) {
  return (
    <section
      className={[padded ? "py-16 md:py-24" : "", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {contained ? (
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
