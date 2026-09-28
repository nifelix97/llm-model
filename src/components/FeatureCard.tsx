import type { ReactNode } from "react";
import Card from "./Card";

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string;
}

export default function FeatureCard({
  icon,
  title,
  description,
  badge,
}: FeatureCardProps) {
  return (
    <Card hover className="flex flex-col gap-4">
      {/* Icon container */}
      <div className="flex items-center justify-between">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary-50 text-primary-500 text-2xl">
          {icon}
        </div>
        {badge && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700 font-sans">
            {badge}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-bold text-secondary-900 font-sans">{title}</h3>
        <p className="text-sm text-secondary-500 leading-relaxed font-sans">
          {description}
        </p>
      </div>
    </Card>
  );
}
