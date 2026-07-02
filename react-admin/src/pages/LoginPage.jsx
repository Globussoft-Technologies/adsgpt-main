import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Loader2, ShieldCheck, Sparkles, Users } from "lucide-react";
import { adminApi } from "@/lib/api";
import { setAdminToken } from "@/lib/auth";
import { resetStoredDateRange } from "@/lib/dateRangeStore";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await adminApi.login(username, password);
      const token = res?.data?.token;
      if (!token) throw new Error("No token in response");
      setAdminToken(token);
      resetStoredDateRange();
      navigate("/", { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-5">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-linear-to-br from-indigo-600 via-violet-600 to-fuchsia-600 lg:col-span-3 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -right-24 h-112 w-md rounded-full bg-fuchsia-400/30 blur-3xl"
        />

        <div className="relative flex items-center gap-2 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">AdsGPT Admin</span>
        </div>

        <div className="relative max-w-lg text-white">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Visibility into every generation, in real dollars.
          </h2>
          <p className="mt-3 text-sm text-white/80">
            See who's creating what, what each model actually costs, and where credits are going —
            all in one read-only dashboard.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FeatureChip icon={BarChart3} label="Cost analytics" />
            <FeatureChip icon={Users} label="Per-user spend" />
            <FeatureChip icon={ShieldCheck} label="Read-only" />
          </div>
        </div>

        <div className="relative text-xs text-white/60">© AdsGPT</div>
      </aside>

      {/* Form panel */}
      <section className="flex items-center justify-center bg-slate-50 px-6 py-12 lg:col-span-2">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60"
        >
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in with your admin credentials.</p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Username</span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                required
              />
            </label>

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-linear-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FeatureChip({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white backdrop-blur">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
