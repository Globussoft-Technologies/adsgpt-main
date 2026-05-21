import { useEffect, useState } from "react";
import { Calculator, Coins, Image as ImageIcon, Loader2, RotateCcw, Video } from "lucide-react";
import { fetchModelCredits } from "../lib/api";

const GDP_TIERS = {
  high: { label: "High GDP", costPerCredit: 0.157 },
  low:  { label: "Low GDP",  costPerCredit: 0.079 },
};

const MAX_USD = 100_000_000_000;

function parseCredits(valueStr) {
  // "7 CREDITS/IMAGE" → 7   |   "3 CREDITS/SECOND" → 3
  return parseInt(valueStr, 10) || 0;
}

function calcImages(usd, costPerCredit, creditsPerImage) {
  if (!usd || usd <= 0 || !creditsPerImage) return 0;
  return Math.floor(usd / costPerCredit / creditsPerImage);
}

function calcSeconds(usd, costPerCredit, creditsPerSecond) {
  if (!usd || usd <= 0 || !creditsPerSecond) return 0;
  return Math.floor(usd / costPerCredit / creditsPerSecond);
}

export default function CalculatorPage() {
  const [amount, setAmount] = useState("");
  const [calculated, setCalculated] = useState(false);
  const [hasCalculatedOnce, setHasCalculatedOnce] = useState(false);
  const [error, setError] = useState("");
  const [gdpTier, setGdpTier] = useState("high");

  const [imageModels, setImageModels] = useState([]);
  const [videoModels, setVideoModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");

  useEffect(() => {
    setModelsLoading(true);
    fetchModelCredits()
      .then(({ imageModels: img, videoModels: vid }) => {
        setImageModels(img);
        setVideoModels(vid);
        if (!img.length && !vid.length) setModelsError("Failed to load model data. Please refresh.");
      })
      .finally(() => setModelsLoading(false));
  }, []);

  const costPerCredit = GDP_TIERS[gdpTier].costPerCredit;

  function handleAmountChange(e) {
    const val = e.target.value;
    const numVal = parseFloat(val);
    if (numVal < 0) return;
    if (numVal > MAX_USD) {
      setAmount(String(MAX_USD));
      return;
    }
    setAmount(val);
    if (!val || parseFloat(val) <= 0) {
      setCalculated(false);
      return;
    }
    if (hasCalculatedOnce) {
      setCalculated(true);
      setError("");
    }
  }

  function handleCalculate(e) {
    e?.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter a budget greater than 0");
      setCalculated(false);
      return;
    }
    setError("");
    setCalculated(true);
    setHasCalculatedOnce(true);
  }

  function handleReset() {
    setAmount("");
    setCalculated(false);
    setHasCalculatedOnce(false);
    setError("");
  }

  const usd = parseFloat(amount) || 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <Calculator className="h-5 w-5" />
            </span>
            Credit Estimator
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Plan a creative budget — see how many images or seconds of video each model will yield.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* GDP Toggle */}
          <div className="flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            {Object.entries(GDP_TIERS).map(([key, tier]) => (
              <button
                key={key}
                type="button"
                onClick={() => setGdpTier(key)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                  gdpTier === key
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tier.label}
              </button>
            ))}
          </div>

          <div className="hidden items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500 sm:flex">
            <span className="flex items-center gap-1.5 border-r border-slate-200 pr-3">
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              $1 = {(1 / costPerCredit).toFixed(2)} credits
            </span>
            <span>1 credit = ${costPerCredit}</span>
          </div>
        </div>
      </header>

      <form
        onSubmit={handleCalculate}
        className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
      >
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <span className="text-base font-semibold text-slate-400">$</span>
          </div>
          <input
            type="number"
            min="0"
            max={MAX_USD}
            value={amount}
            onChange={handleAmountChange}
            placeholder="Enter USD budget…"
            className="w-full appearance-none rounded-xl border-none bg-transparent py-2.5 pl-9 pr-4 text-base font-medium text-slate-900 tabular-nums placeholder:text-sm placeholder:font-normal placeholder:text-slate-400 outline-none focus:ring-0"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-linear-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition hover:from-indigo-700 hover:to-violet-700"
        >
          Calculate
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      {modelsError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{modelsError}</div>
      ) : null}

      {modelsLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-sm">Loading models…</span>
        </div>
      ) : calculated ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ResultPanel
            title="Image generation"
            icon={ImageIcon}
            iconClass="text-indigo-500"
          >
            {imageModels.map((m, i) => {
              const credits = parseCredits(m.value);
              const count = calcImages(usd, costPerCredit, credits);
              return (
                <ResultRow
                  key={`img-${i}`}
                  name={m.label}
                  meta={`${credits} credit${credits !== 1 ? "s" : ""} / image`}
                  primary={count.toLocaleString()}
                  primaryLabel="Images"
                  primaryColor="text-indigo-600"
                  hoverColor="group-hover:text-indigo-600"
                />
              );
            })}
          </ResultPanel>

          <ResultPanel
            title="Video generation"
            icon={Video}
            iconClass="text-rose-500"
          >
            {videoModels.map((m, i) => {
              const credits = parseCredits(m.value);
              const seconds = calcSeconds(usd, costPerCredit, credits);
              const mins = Math.floor(seconds / 60);
              const secs = seconds % 60;
              return (
                <ResultRow
                  key={`vid-${i}`}
                  name={m.label}
                  meta={`${credits} credits / sec`}
                  primary={
                    <span className="inline-flex items-baseline gap-1.5">
                      <span>{seconds.toLocaleString()}s</span>
                      {seconds >= 60 ? (
                        <span className="text-[11px] font-medium text-slate-400">
                          ({mins}m {secs}s)
                        </span>
                      ) : null}
                    </span>
                  }
                  primaryLabel="Total duration"
                  primaryColor="text-rose-600"
                  hoverColor="group-hover:text-rose-600"
                />
              );
            })}
          </ResultPanel>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
            <Calculator className="h-7 w-7" />
          </div>
          <h3 className="font-semibold text-slate-900">Ready to calculate?</h3>
          <p className="mt-1 text-sm text-slate-500">
            Enter a budget above to see how many images or seconds of video you can generate.
          </p>
        </div>
      )}
    </div>
  );
}

function ResultPanel({ title, icon: Icon, iconClass, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        <Icon className={`h-4 w-4 ${iconClass}`} />
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{title}</p>
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function ResultRow({ name, meta, primary, primaryLabel, primaryColor, hoverColor }) {
  return (
    <div className="group flex items-center justify-between px-5 py-4 transition hover:bg-slate-50/60">
      <div>
        <p className={`text-sm font-semibold uppercase tracking-tight text-slate-800 transition ${hoverColor}`}>
          {name}
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-slate-400">{meta}</p>
      </div>
      <div className="text-right">
        <div className="text-lg font-extrabold leading-none text-slate-900 tabular-nums">{primary}</div>
        <p className={`mt-1 text-[10px] font-bold uppercase tracking-wider ${primaryColor}`}>{primaryLabel}</p>
      </div>
    </div>
  );
}
