import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import Button from "../components/Button";
import Input from "../components/Input";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();

  // Redirect back to the page the user tried to visit, or default to dashboard
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/dashboard";

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [showPw, setShowPw]     = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  function validate() {
    const errs: typeof fieldErrors = {};
    if (!email.trim())    errs.email    = "Email is required.";
    if (!password.trim()) errs.password = "Password is required.";
    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const errs = validate();
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});

    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? "Login failed.");
      return;
    }

    navigate(from, { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-primary-900/95 relative overflow-hidden">

      {/* Background grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(oklch(30% 0.01 256 / 0.35) 1px, transparent 1px), linear-gradient(90deg, oklch(30% 0.01 256 / 0.35) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-96 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse at center, oklch(42% 0.210 256 / 0.15) 0%, transparent 70%)",
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 h-16">
        <Link to="/" className="font-extrabold text-xl font-sans text-primary-400">
          DC-TIM
        </Link>
        <Link
          to="/"
          className="text-xs text-secondary-500 hover:text-secondary-300 font-sans transition-colors"
        >
          ← Back to home
        </Link>
      </header>

      {/* Card */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-primary-500/10 border border-primary-500/20 text-3xl mb-4">
              🧠
            </div>
            <h1 className="text-2xl font-extrabold text-white font-sans">
              Sign in to DC-TIM
            </h1>
            <p className="text-secondary-400 text-sm font-sans mt-2">
              Access the model policy analysis platform
            </p>
          </div>

          {/* Form card */}
          <div className="bg-primary-800/80 backdrop-blur border border-secondary-700 rounded-2xl p-8 shadow-2xl">

            {error && (
              <Alert variant="error" onClose={() => setError(null)} className="mb-6">
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              <Input
                label="Email address"
                type="email"
                placeholder="you@dc-tim.ai"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((p) => ({ ...p, email: undefined }));
                }}
                error={fieldErrors.email}
                autoComplete="email"
                className="bg-secondary-700 border-secondary-600 text-primary-50 placeholder-secondary-100 focus:ring-primary-400"
              />

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-secondary-300 font-sans">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="text-xs text-secondary-100 hover:text-secondary-300 font-sans transition-colors"
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((p) => ({ ...p, password: undefined }));
                  }}
                  autoComplete="current-password"
                  aria-invalid={!!fieldErrors.password}
                  className={[
                    "w-full rounded-lg border px-4 py-2.5 text-white text-sm font-sans",
                    "bg-secondary-700",
                    "transition-colors duration-150 outline-none",
                    "focus:ring-2 focus:ring-primary-400",
                    fieldErrors.password ? "border-error-400" : "border-secondary-600",
                  ].join(" ")}
                />
                {fieldErrors.password && (
                  <p className="text-xs text-error-400 font-sans">{fieldErrors.password}</p>
                )}
              </div>

              <Button
                type="submit"
                size="md"
                fullWidth
                loading={loading}
                className="mt-2"
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            {/* Demo credentials hint */}
            <div className="mt-6 pt-6 border-t border-secondary-700">
              <p className="text-xs font-semibold text-secondary-600 uppercase tracking-wider font-sans mb-3">
                Demo credentials
              </p>
              <div className="flex flex-col gap-2">
                {[
                  { email: "admin@dc-tim.ai",   password: "admin123",   role: "Admin"    },
                  { email: "analyst@dc-tim.ai", password: "analyst123", role: "Analyst"  },
                ].map((cred) => (
                  <button
                    key={cred.email}
                    type="button"
                    onClick={() => { setEmail(cred.email); setPassword(cred.password); setError(null); setFieldErrors({}); }}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-secondary-700/60 border border-secondary-600/60 hover:border-primary-500/40 hover:bg-secondary-700 transition-colors text-left group"
                  >
                    <div>
                      <p className="text-xs font-semibold text-secondary-200 font-sans group-hover:text-white transition-colors">
                        {cred.email}
                      </p>
                      <p className="text-xs text-secondary-500 font-sans">{cred.role}</p>
                    </div>
                    <span className="text-xs text-secondary-600 group-hover:text-primary-400 font-sans transition-colors">
                      Use →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-secondary-600 font-sans mt-6">
            Don't have an account?{" "}
            <Link to="/" className="text-primary-400 hover:text-primary-300 transition-colors">
              Contact us
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
