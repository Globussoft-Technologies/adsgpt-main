import { useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, TriangleAlert } from "lucide-react";
import Badge from "@/components/Badge.jsx";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function PartnerApiKeysPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [partnerName, setPartnerName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [revealed, setRevealed] = useState(null); // { apiKey, partnerName }
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const copyTimerRef = useRef(null);

  function loadKeys() {
    setLoading(true);
    setError("");
    adminApi
      .partnerApiKeys()
      .then((res) => setKeys(res.data?.keys || []))
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadKeys();
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!partnerName.trim() || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await adminApi.createPartnerApiKey(partnerName.trim());
      setRevealed({ apiKey: res.data.apiKey, partnerName: res.data.partnerName });
      setPartnerName("");
      loadKeys();
    } catch (err) {
      setCreateError(err?.response?.data?.message || err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.apiKey);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied — the key is still visible on screen to copy manually.
    }
  }

  async function handleRevoke(key) {
    if (!window.confirm(`Revoke the API key for "${key.partnerName}"? This cannot be undone.`)) return;
    setRevokingId(key._id);
    try {
      await adminApi.revokePartnerApiKey(key._id);
      loadKeys();
    } catch (err) {
      setError(err?.response?.data?.message || err.message);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Partner API Keys</h1>
        <p className="text-sm text-slate-500">
          Credentials for the partner-facing Meta Ads reporting API (<code>/partner-api/v1/meta-ads</code>).
        </p>
      </header>

      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="min-w-60 flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-600">Partner name</label>
          <input
            type="text"
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </div>
        <button
          type="submit"
          disabled={!partnerName.trim() || creating}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Generate key
        </button>
      </form>
      {createError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{createError}</div>
      ) : null}

      {revealed ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
            <TriangleAlert className="h-4 w-4" />
            Store this key now for {revealed.partnerName} — it will not be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-800">
              {revealed.apiKey}
            </code>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setRevealed(null)}
            className="mt-3 text-sm font-medium text-amber-700 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Partner</th>
                <th className="px-5 py-3">Key prefix</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Last used</th>
                <th className="px-5 py-3">Created</th>
                <th className="w-24 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td colSpan={6} className="px-5 py-3">
                      <div className="h-9 animate-pulse rounded-md bg-slate-100" />
                    </td>
                  </tr>
                ))
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                    No partner API keys yet
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key._id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <KeyRound className="h-4 w-4 text-slate-400" />
                        {key.partnerName}
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{key.keyPrefix}…</td>
                    <td className="px-5 py-3">
                      <Badge tone={key.status === "active" ? "emerald" : "rose"}>{key.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(key.lastUsedAt)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(key.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {key.status === "active" ? (
                        <button
                          onClick={() => handleRevoke(key)}
                          disabled={revokingId === key._id}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                        >
                          {revokingId === key._id ? "Revoking…" : "Revoke"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
