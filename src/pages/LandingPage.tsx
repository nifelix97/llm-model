import { Link } from "react-router-dom";
import {
  BarChart3,
  Brain,
  Construction,
  FolderOpen,
  GraduationCap,
  Hospital,
  Leaf,
  Scale,
  Settings,
  TrendingUp,
} from "lucide-react";
import Badge from "../components/Badge";
import Button from "../components/Button";
import Card from "../components/Card";
import PublicLayout from "../components/PublicLayout";

// ─── Data ─────────────────────────────────────────────────────────────────────

const STATS = [
  { value: "6",    label: "Policy Categories" },
  { value: "180+", label: "Countries Analysed" },
  { value: "98%",  label: "Model Accuracy" },
  { value: "< 2s", label: "Avg Response Time" },
];

const FEATURES = [
  {
    icon: <BarChart3 className="size-6" />,
    title: "Model-Powered Dashboard",
    description:
      "Visualise development indicators across education, healthcare, economic, infrastructure, governance and environment — updated in real time by the model.",
    to: "/dashboard",
    cta: "Open Dashboard",
    badge: "Live",
  },
  {
    icon: <Settings className="size-6" />,
    title: "Policy Optimization",
    description:
      "Adjust policy levers and let the model project optimised outcomes. Surface high-impact interventions with before/after comparisons across every indicator.",
    to: "/optimize",
    cta: "Try Optimizer",
    badge: "Model",
  },
  {
    icon: <Brain className="size-6" />,
    title: "Model Prompt Interface",
    description:
      "Ask the model anything about national development policies. Get contextual, evidence-based answers drawn from your training data in real time.",
    to: "/prompt",
    cta: "Open Prompt",
    badge: null,
  },
  {
    icon: <FolderOpen className="size-6" />,
    title: "Train the Model",
    description:
      "Feed the model your own data — Q&A pairs, knowledge entries, and documents — to build a specialised model tailored to your policy context.",
    to: "/models/new",
    cta: "Add Training Data",
    badge: null,
  },
];

const POLICY_AREAS = [
  { icon: <GraduationCap className="size-4" />, label: "Education",      color: "bg-primary-50   border-primary-100   text-primary-600"   },
  { icon: <Hospital className="size-4" />,       label: "Healthcare",     color: "bg-success-50   border-success-100   text-success-700"   },
  { icon: <TrendingUp className="size-4" />,     label: "Economic",       color: "bg-amber-50     border-amber-100     text-amber-700",     },
  { icon: <Construction className="size-4" />,   label: "Infrastructure", color: "bg-violet-50    border-violet-100    text-violet-700"    },
  { icon: <Scale className="size-4" />,          label: "Governance",     color: "bg-teal-50      border-teal-100      text-teal-700"      },
  { icon: <Leaf className="size-4" />,           label: "Environment",    color: "bg-success-50   border-success-100   text-success-700"   },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Feed the model",
    description: "Upload Q&A pairs, knowledge documents, and policy data to train the model on your specific development context.",
  },
  {
    step: "02",
    title: "Analyse indicators",
    description: "The model analyses data across all six policy categories and generates visual dashboards with key insights.",
  },
  {
    step: "03",
    title: "Optimize & act",
    description: "Adjust policy levers, receive model-projected outcomes, and export prioritised recommendations for decision-makers.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <PublicLayout>

        {/* ── Hero ── */}
        <section className="relative overflow-hidden bg-primary-800/60">
          {/* Grid background */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(oklch(30% 0.01 256 / 0.4) 1px, transparent 1px), linear-gradient(90deg, oklch(30% 0.01 256 / 0.4) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          {/* Glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-225 h-125 rounded-full"
            style={{
              background:
                "radial-gradient(ellipse at center, oklch(42% 0.210 256 / 0.18) 0%, transparent 70%)",
            }}
          />

          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-24 pb-20 md:pt-36 md:pb-28">
            <div className="flex flex-col items-center text-center gap-8 max-w-4xl mx-auto">

              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary-500/30 bg-primary-500/10 text-primary-300 text-xs font-semibold font-sans">
                <span className="size-1.5 rounded-full bg-primary-400 animate-pulse" />
                Powered by DC-TIM 3 Pro · Now in public beta
              </div>

              <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold text-white font-sans leading-tight">
                Model-Driven Analysis for{" "}
                <span className="text-primary-400">
                  Country Development
                </span>{" "}
                Policy
              </h1>

              <p className="text-lg text-secondary-300 max-w-2xl font-sans leading-relaxed">
                DC-TIM combines advanced analytics with structured policy data to help
                governments, researchers and NGOs analyse, optimise and act on national
                development strategies — across six critical policy domains.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link to="/dashboard">
                  <Button size="lg">Explore Dashboard →</Button>
                </Link>
                <Link to="/prompt">
                  <Button
                    variant="ghost"
                    size="lg"
                    className="border-secondary-600 text-secondary-200 hover:bg-secondary-800"
                  >
                    Ask the Model
                  </Button>
                </Link>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-2xl pt-4 border-t border-secondary-800">
                {STATS.map((s) => (
                  <div key={s.label} className="flex flex-col items-center gap-1">
                    <span className="text-2xl font-extrabold text-white font-sans">{s.value}</span>
                    <span className="text-xs text-secondary-500 font-sans text-center">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Policy areas ── */}
        <section className="bg-secondary-800/50 border-y border-primary-800">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <p className="text-xs font-semibold text-secondary-500 uppercase tracking-widest font-sans text-center mb-6">
              Policy categories covered
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {POLICY_AREAS.map((p) => (
                <span
                  key={p.label}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-secondary-900/60 border-secondary-700 text-secondary-300 text-sm font-semibold font-sans"
                >
                  <span className="text-secondary-400">{p.icon}</span>
                  {p.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section className="bg-primary-900/60 py-24">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center gap-4 mb-14">
              <Badge variant="primary">Platform</Badge>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white font-sans">
                Everything in one platform
              </h2>
              <p className="text-secondary-400 max-w-2xl font-sans">
                Four interconnected tools that take you from raw policy data to
                Model-powered recommendations and optimised action plans.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {FEATURES.map((f) => (
                <Card
                  key={f.title}
                  hover
                  className="bg-secondary-800 border-secondary-700 flex flex-col gap-4 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-primary-500/10 border border-primary-500/20 text-2xl">
                      {f.icon}
                    </div>
                    {f.badge && <Badge variant="primary">{f.badge}</Badge>}
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <h3 className="text-base font-bold text-white font-sans">{f.title}</h3>
                    <p className="text-sm text-secondary-400 font-sans leading-relaxed flex-1">
                      {f.description}
                    </p>
                  </div>
                  <Link
                    to={f.to}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-400 hover:text-primary-300 transition-colors font-sans group-hover:gap-2.5"
                  >
                    {f.cta}
                    <svg className="size-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="bg-primary-800/40 border-y border-secondary-800 py-24">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center gap-4 mb-14">
              <Badge variant="secondary">Workflow</Badge>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white font-sans">
                How it works
              </h2>
            </div>

            <div className="grid sm:grid-cols-3 gap-8 relative">
              {/* Connector line (desktop) */}
              <div
                aria-hidden
                className="hidden sm:block absolute top-9 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px border-t border-dashed border-secondary-700"
              />

              {HOW_IT_WORKS.map((step, i) => (
                <div key={step.step} className="flex flex-col items-center text-center gap-4 relative">
                  <div className={[
                    "flex size-18 items-center justify-center rounded-full border-2 text-2xl font-extrabold font-sans bg-secondary-900 z-10",
                    i === 0 ? "border-primary-500 text-primary-400" :
                    i === 1 ? "border-secondary-500 text-secondary-400" :
                              "border-success-500 text-success-400",
                  ].join(" ")}>
                    {step.step}
                  </div>
                  <h3 className="text-base font-bold text-white font-sans">{step.title}</h3>
                  <p className="text-sm text-secondary-400 font-sans leading-relaxed max-w-xs">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Live preview strip ── */}
        <section className="bg-primary-900 py-24">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="flex flex-col gap-6">
                <Badge variant="primary">Model Prompt</Badge>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white font-sans leading-tight">
                  Ask complex policy questions,<br />get structured answers
                </h2>
                <p className="text-secondary-400 font-sans leading-relaxed">
                  The model draws on your training data to answer nuanced questions about
                  governance, economic indicators, healthcare access, and more — with
                  full source traceability.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link to="/prompt">
                    <Button size="md">Open Model Prompt</Button>
                  </Link>
                  <Link to="/models/new">
                    <Button variant="ghost" size="md" className="border-secondary-600 text-secondary-300 hover:bg-secondary-800">
                      Add training data
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Mock chat window */}
              <div className="rounded-2xl border border-secondary-700 bg-primary-800 overflow-hidden shadow-2xl">
                {/* Window chrome */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-700 bg-secondary-900/60">
                  <div className="flex gap-1.5">
                    <span className="size-2.5 rounded-full bg-error-500/70" />
                    <span className="size-2.5 rounded-full bg-secondary-600" />
                    <span className="size-2.5 rounded-full bg-success-500/70" />
                  </div>
                  <span className="text-xs text-secondary-500 font-sans">DC-TIM 3 Pro — Model Prompt</span>
                  <div className="size-4" aria-hidden />
                </div>
                {/* Messages */}
                <div className="p-5 flex flex-col gap-4">
                  <div className="flex gap-3 justify-end">
                    <div className="bg-primary-500 text-white text-sm font-sans rounded-2xl rounded-tr-sm px-4 py-3 max-w-xs leading-relaxed">
                      What are the top 3 infrastructure gaps in low-income countries?
                    </div>
                    <div className="shrink-0 size-7 rounded-full bg-primary-500 flex items-center justify-center text-xs font-bold text-white font-sans mt-1">U</div>
                  </div>
                  <div className="flex gap-3">
                    <div className="shrink-0 size-7 rounded-full bg-secondary-700 border border-secondary-600 flex items-center justify-center text-xs font-bold text-primary-400 font-sans mt-1">M</div>
                    <div className="bg-secondary-700 border border-secondary-600 text-secondary-200 text-sm font-sans rounded-2xl rounded-tl-sm px-4 py-3 max-w-sm leading-relaxed">
                      Based on available data, the three most critical gaps are:<br /><br />
                      <span className="text-primary-300 font-semibold">1. Digital connectivity</span> — only 48/100 score<br />
                      <span className="text-primary-300 font-semibold">2. Energy access</span> — 55/100, often unreliable<br />
                      <span className="text-primary-300 font-semibold">3. Road networks</span> — rural areas remain isolated
                    </div>
                  </div>
                  {/* Typing indicator */}
                  <div className="flex gap-3 items-center">
                    <div className="shrink-0 size-7 rounded-full bg-secondary-700 border border-secondary-600 flex items-center justify-center text-xs font-bold text-primary-400 font-sans">M</div>
                    <div className="bg-secondary-700 border border-secondary-600 rounded-2xl rounded-tl-sm px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        {[0,1,2].map((i) => (
                          <span key={i} className="size-1.5 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="bg-primary-600 relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(oklch(50% 0.22 256 / 0.3) 1px, transparent 1px), linear-gradient(90deg, oklch(50% 0.22 256 / 0.3) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-20 flex flex-col items-center text-center gap-6">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white font-sans">
              Start analysing your policies today
            </h2>
            <p className="text-primary-200 max-w-xl font-sans text-lg">
              No setup required. Open the dashboard, explore model insights, and begin optimising
              national development strategies in minutes.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link to="/dashboard">
                <Button
                  size="lg"
                  className="bg-primary-600 text-primary-600 hover:bg-primary-50 focus-visible:ring-white shadow-xl"
                >
                  Open Dashboard
                </Button>
              </Link>
              <Link to="/prompt">
                <Button
                  size="lg"
                  variant="ghost"
                  className="border-primary-300 text-white hover:bg-primary-700"
                >
                  Ask the Model
                </Button>
              </Link>
            </div>
          </div>
        </section>

    </PublicLayout>
  );
}
