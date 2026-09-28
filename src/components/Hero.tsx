import type { ReactNode } from "react";

interface HeroProps {
  eyebrow?: string;
  heading: ReactNode;
  subheading?: string;
  actions?: ReactNode;
  visual?: ReactNode;
}

export default function Hero({
  eyebrow,
  heading,
  subheading,
  actions,
  visual,
}: HeroProps) {
  return (
    <section className="relative overflow-hidden bg-secondary-900 text-white">
      {/* Background gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(42%_0.210_256/0.35),transparent)]"
      />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-24 md:py-36">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Text column */}
          <div className="flex flex-col gap-6">
            {eyebrow && (
              <span className="inline-flex w-fit items-center px-3 py-1 rounded-full text-xs font-semibold bg-primary-500/20 text-primary-300 border border-primary-500/30 font-sans">
                {eyebrow}
              </span>
            )}
            <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold leading-tight font-sans">
              {heading}
            </h1>
            {subheading && (
              <p className="text-lg text-secondary-300 max-w-xl font-sans">
                {subheading}
              </p>
            )}
            {actions && <div className="flex flex-wrap gap-3 pt-2">{actions}</div>}
          </div>

          {/* Visual column */}
          {visual && (
            <div className="flex items-center justify-center">{visual}</div>
          )}
        </div>
      </div>
    </section>
  );
}
