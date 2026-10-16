import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Check, Loader2, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import Badge from "@/components/Badge.jsx";
import SearchInput from "@/components/SearchInput.jsx";
import { adminApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const PLATFORMS = ["ios", "android", "web"];
const PLATFORM_LABEL = { ios: "iOS", android: "Android", web: "Web" };
const VERSION_RE = /^\d+(\.\d+){0,2}$/;
// Same comparison as the backend: "1.10" > "1.9", "1.1" == "1.1.0".
const compareVersions = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};
const LIMIT = 20;

const errMsg = (err) => err?.response?.data?.message || err.message;

// Tidies pasted lines: drops "##" and "•", "-", "*" prefixes, and turns a
// bulleted "• OpenAI — ad copy" into "OpenAI: ad copy", the form the apps list
// as an item. A plain sentence with a dash is left alone.
const BULLET = /^[•\-*·]\s+/;
const tidy = (l) => {
  const t = l.trim().replace(/^#{1,6}\s+/, "");
  if (!BULLET.test(t)) return t;
  return t.replace(BULLET, "").replace(/^([^:—–]{1,40}?)\s+[—–]\s+(.+)$/, "$1: $2");
};
const lines = (s) => s.split("\n").map(tidy).filter(Boolean);

// Textarea that grows with its content instead of scrolling inside itself.
function AutoTextarea({ value, onChange, minRows = 3, className = "", ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      className={`${className} resize-none overflow-hidden leading-relaxed`}
      {...rest}
    />
  );
}

// Form state -> the structured content the backend stores and the apps fetch:
// { title, intro: [paragraph], sections: [{ heading, paragraphs: [paragraph] }] }
function toContent({ title, intro, sections }) {
  return {
    title: title.trim(),
    intro: lines(intro),
    sections: sections
      .map((s) => ({ heading: tidy(s.heading).replace(/:+$/, "").trim(), paragraphs: lines(s.body) }))
      .filter((s) => s.heading || s.paragraphs.length),
  };
}

// "OpenAI: ad copy and images" reads as a labelled list row in the app.
const LABELLED = /^([^:]{1,40}):\s+(.+)$/;

function Paragraph({ text }) {
  const m = text.match(LABELLED);
  if (!m) return <p>{text}</p>;
  return (
    <p className="flex gap-2">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
      <span>
        <span className="font-semibold text-slate-900">{m[1]}</span>
        <span className="text-slate-600"> — {m[2]}</span>
      </span>
    </p>
  );
}

// Laid out like the consent screen in the apps: title, intro, then each
// section as a heading with its paragraphs.
function DisclosurePreview({ content, framed = true }) {
  const empty = !content?.title && !content?.intro?.length && !content?.sections?.length;
  if (empty) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
        <ShieldCheck className="h-6 w-6" />
        Fill in the title and sections to see how users will see it.
      </div>
    );
  }
  const body = (
    <div className="space-y-4 text-sm leading-relaxed text-slate-700">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h3 className="pt-1 text-lg font-semibold leading-snug text-slate-900">{content.title || "Untitled"}</h3>
      </div>
      {content.intro?.map((p, i) => <p key={i}>{p}</p>)}
      {content.sections?.map((s, i) => (
        <section key={i} className="space-y-1.5 rounded-lg bg-slate-50 p-3">
          <h4 className="font-semibold text-slate-900">{s.heading || <span className="text-slate-400">Section heading</span>}</h4>
          {s.paragraphs.length ? s.paragraphs.map((p, j) => <Paragraph key={j} text={p} />) : (
            <p className="text-slate-400">Section text</p>
          )}
        </section>
      ))}
    </div>
  );
  if (!framed) return body;
  return (
    <div className="max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-sm">{body}</div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100";
const emptySection = () => ({ id: Math.random().toString(36).slice(2), heading: "", body: "" });

function DisclosuresTab() {
  const [data, setData] = useState({ currentVersions: {}, disclosures: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [platforms, setPlatforms] = useState(["ios"]);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [sections, setSections] = useState([emptySection()]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [askAgain, setAskAgain] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const content = toContent({ title, intro, sections });
  const updateSection = (id, patch) => setSections((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSection = (id) => setSections((all) => (all.length > 1 ? all.filter((s) => s.id !== id) : [emptySection()]));

  // Filters for the published-versions table.
  const [fPlatform, setFPlatform] = useState("");
  const [fVersion, setFVersion] = useState("");
  const [page, setPage] = useState(1);

  function load() {
    setLoading(true);
    setError("");
    adminApi
      .aiConsentDisclosures({ platform: fPlatform || undefined, version: fVersion || undefined, page, limit: LIMIT })
      .then((res) => setData(res.data))
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [fPlatform, fVersion, page]);
  const pages = Math.max(1, Math.ceil((data.total || 0) / LIMIT));
  const filtered = fPlatform || fVersion;

  const togglePlatform = (p) =>
    setPlatforms((sel) => (sel.includes(p) ? sel.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || sel.includes(x))));
  const selectedLabel = platforms.map((p) => PLATFORM_LABEL[p]).join(", ");
  // The new version must beat every version already published on each
  // selected platform. "v2" is fine; it is sent as "2".
  const highestOf = (p) => data.highestVersions?.[p] || data.currentVersions?.[p];
  const highestSelected = platforms
    .map(highestOf)
    .filter(Boolean)
    .sort((a, b) => compareVersions(b, a))[0];
  const cleanVersion = version.trim().replace(/^v/i, "");
  const versionValid = VERSION_RE.test(cleanVersion);
  const tooLow = versionValid
    ? platforms.filter((p) => highestOf(p) && compareVersions(cleanVersion, highestOf(p)) <= 0)
    : [];
  // Same rules the backend applies, checked here so problems show before the
  // confirmation popup rather than after it.
  const problems = [];
  content.sections.forEach((s, i) => {
    const name = s.heading ? `"${s.heading}"` : `Section ${i + 1}`;
    if (!s.heading) problems.push(`Section ${i + 1} needs a heading`);
    if (!s.paragraphs.length) problems.push(`${name} needs some text`);
    if (s.paragraphs.some((p) => p.endsWith(":"))) problems.push(`A line in ${name} ends with ":" — end it differently`);
  });
  if (content.intro.some((p) => p.endsWith(":"))) problems.push('A line in the introduction ends with ":" — end it differently');
  const hasBody = content.intro.length > 0 || content.sections.length > 0;

  const canPublish =
    platforms.length > 0 && versionValid && !tooLow.length && content.title && hasBody && !problems.length && !publishing;

  // An old error no longer applies once the form changes.
  const formKey = JSON.stringify([platforms, version, content]);
  useEffect(() => setPublishError(""), [formKey]);

  function handlePublish(e) {
    e.preventDefault();
    if (!canPublish) return;
    setConfirm({
      title: `Publish v${cleanVersion} for ${selectedLabel}?`,
      body: askAgain
        ? `It becomes the current version right away, and ${selectedLabel} users who already agreed are asked to agree again. Published versions can't be edited, only deleted.`
        : `It becomes the current version right away. Users who already agreed stay agreed and aren't asked again; new users see this version. Published versions can't be edited, only deleted.`,
      confirmLabel: "Publish",
      onConfirm: () => publish(cleanVersion),
    });
  }

  function handleMakeCurrent(d) {
    const current = data.currentVersions?.[d.platform];
    setConfirm({
      title: `Make ${PLATFORM_LABEL[d.platform]} v${d.version} current?`,
      body: `${PLATFORM_LABEL[d.platform]} users see this version from now on${current ? ` instead of v${current}` : ""}. Users who agreed to an older version that no longer counts are asked again; users who agreed to a newer one are not.`,
      confirmLabel: "Make current",
      onConfirm: async () => {
        try {
          await adminApi.makeAiConsentDisclosureCurrent(d._id);
          load();
        } catch (err) {
          setError(errMsg(err));
        }
      },
    });
  }

  async function publish(v) {
    setPublishing(true);
    setPublishError("");
    const failed = [];
    for (const p of platforms) {
      try {
        await adminApi.publishAiConsentDisclosure({ platform: p, version: v, content, askAgain });
      } catch (err) {
        failed.push(`${PLATFORM_LABEL[p]}: ${errMsg(err)}`);
      }
    }
    if (failed.length) {
      const ok = platforms.length - failed.length;
      setPublishError(`${ok ? `Published for ${ok} platform(s), but failed for ` : "Failed — "}${failed.join("; ")}`);
    } else {
      setVersion("");
      setTitle("");
      setIntro("");
      setSections([emptySection()]);
      setAskAgain(true);
    }
    load();
    setPublishing(false);
  }

  function handleDeleted(d) {
    setDeleteTarget(null);
    if (openId === d._id) setOpenId(null);
    load();
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((p) => (
          <div key={p} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{PLATFORM_LABEL[p]}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {data.currentVersions?.[p] ? `v${data.currentVersions[p]}` : "—"}
            </div>
            <div className="text-xs text-slate-500">
              {data.currentVersions?.[p] ? "Current version" : "Nothing published"}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handlePublish} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Publish a new version</h2>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Platforms (select one or more)</label>
            <div className="flex overflow-hidden rounded-lg border border-slate-300">
              {PLATFORMS.map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-1.5 border-l border-slate-300 px-3 py-2 text-sm font-medium first:border-l-0 ${on ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : null}
                    {PLATFORM_LABEL[p]}
                  </button>
                );
              })}
            </div>
            {!platforms.length ? <p className="mt-1 text-xs text-rose-600">Select at least one platform</p> : null}
          </div>
          <div className="w-44">
            <label className="mb-1 block text-xs font-medium text-slate-600">Version</label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder={highestSelected ? `higher than ${highestSelected}, e.g. ${Number(highestSelected.split(".")[0]) + 1}` : "e.g. 1"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            />
            {version && !versionValid ? (
              <p className="mt-1 text-xs text-rose-600">Use a number like 2, 2.1 or v2</p>
            ) : tooLow.length ? (
              <p className="mt-1 text-xs text-rose-600">
                Must be higher than {tooLow.map((p) => `${PLATFORM_LABEL[p]} v${highestOf(p)}`).join(", ")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. How AdsGPT uses AI services"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Introduction</label>
              <AutoTextarea
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                minRows={2}
                placeholder="A short paragraph shown under the title"
                className={inputCls}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Sections</span>
                <button
                  type="button"
                  onClick={() => setSections((all) => [...all, emptySection()])}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Add section
                </button>
              </div>
              {sections.map((s, i) => (
                <div key={s.id} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-400">{i + 1}.</span>
                    <input
                      value={s.heading}
                      onChange={(e) => updateSection(s.id, { heading: e.target.value })}
                      placeholder="Section heading, e.g. What we share"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => removeSection(s.id)}
                      title="Remove section"
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <AutoTextarea
                    value={s.body}
                    onChange={(e) => updateSection(s.id, { body: e.target.value })}
                    placeholder={"Each line is its own paragraph.\nWrite \"Name: description\" to show a bullet, e.g.\nOpenAI: ad copy and images"}
                    className={`${inputCls} bg-white`}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="lg:sticky lg:top-4">
            <div className="mb-1 text-xs font-medium text-slate-600">Preview — how users see it</div>
            <DisclosurePreview content={content} />
          </div>
        </div>
        {problems.length ? (
          <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {problems.map((p) => <li key={p}>• {p}</li>)}
          </ul>
        ) : null}
        {publishError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{publishError}</div>
        ) : null}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={askAgain}
            onChange={(e) => setAskAgain(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Ask users to agree again</span>
            <span className="block text-xs text-slate-500">
              Keep on for real changes, like a new company or new data shared. Turn off for small wording fixes: users who
              already agreed stay agreed.
            </span>
          </span>
        </label>
        <button
          type="submit"
          disabled={!canPublish}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {platforms.length ? `Publish for ${selectedLabel}` : "Publish"}
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Published versions</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={fPlatform}
            onChange={(e) => { setFPlatform(e.target.value); setPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
          <SearchInput
            value={fVersion}
            onSearch={(v) => { setFVersion(v); setPage(1); }}
            placeholder="Version, e.g. 1.1"
            className="w-44"
          />
          {filtered ? (
            <button
              onClick={() => { setFPlatform(""); setFVersion(""); setPage(1); }}
              className="px-2 py-2 text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Platform</th>
              <th className="px-5 py-3">Version</th>
              <th className="px-5 py-3">Published</th>
              <th className="px-5 py-3">By</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-400">Loading…</td>
              </tr>
            ) : data.disclosures.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                  {filtered ? "No versions match these filters" : "No disclosures published yet"}
                </td>
              </tr>
            ) : (
              data.disclosures.map((d) => (
                <FragmentRow
                  key={d._id}
                  d={d}
                  isCurrent={data.currentVersions?.[d.platform] === d.version}
                  open={openId === d._id}
                  onToggle={() => setOpenId(openId === d._id ? null : d._id)}
                  onDelete={() => setDeleteTarget(d)}
                  onMakeCurrent={() => handleMakeCurrent(d)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{data.total || 0} version{data.total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Prev</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>

      {confirm ? <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} /> : null}

      {deleteTarget ? (
        <DeleteDisclosureDialog
          d={deleteTarget}
          isCurrent={data.currentVersions?.[deleteTarget.platform] === deleteTarget.version}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      ) : null}
    </div>
  );
}

// Delete confirmation. The first attempt is a normal delete; if users have
// agreed to this version the backend answers 409 IN_USE and the dialog lists
// them, explains what happens, and offers "Delete anyway" (force).
function DeleteDisclosureDialog({ d, isCurrent, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState(null);
  const [error, setError] = useState("");
  const label = `${PLATFORM_LABEL[d.platform]} v${d.version}`;

  async function remove(force) {
    setBusy(true);
    setError("");
    try {
      await adminApi.deleteAiConsentDisclosure(d._id, { force });
      onDeleted(d);
    } catch (err) {
      if (err?.response?.status === 409 && err.response.data?.code === "IN_USE") setInUse(err.response.data);
      else setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const outcome = inUse
    ? inUse.isCurrent
      ? inUse.nextCurrent
        ? `v${inUse.nextCurrent} becomes the current ${PLATFORM_LABEL[d.platform]} version, and these users will be asked to agree to it the next time they open the app.`
        : `No ${PLATFORM_LABEL[d.platform]} version will be left, so nobody on ${PLATFORM_LABEL[d.platform]} is asked for consent until you publish a new one. These users' agreement will point to a version that no longer exists.`
      : `This is an older version. These users are already behind v${inUse.nextCurrent} and will be asked to agree to it; deleting removes the text they originally agreed to.`
    : null;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <div className={`rounded-full p-2 ${inUse ? "bg-amber-100 text-amber-600" : "bg-rose-100 text-rose-600"}`}>
              {inUse ? <AlertTriangle className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-slate-900">
                {inUse ? `${inUse.userCount} user${inUse.userCount === 1 ? " has" : "s have"} agreed to ${label}` : `Delete ${label}?`}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">
                {inUse
                  ? outcome
                  : `${isCurrent ? "This is the current version. " : ""}The text is removed for good. Past user decisions stay in the history.`}
              </Dialog.Description>
            </div>
          </div>

          {inUse ? (
            <div className="mt-4 min-h-0 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Agreed</th>
                  </tr>
                </thead>
                <tbody>
                  {inUse.users.map((u) => (
                    <tr key={u.user_id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <Link to={`/users/${encodeURIComponent(u.user_id)}`} className="font-medium text-indigo-600 hover:underline">
                          {u.name?.trim() || u.user_id}
                        </Link>
                        <div className="text-xs text-slate-500">{u.email || u.user_id}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{u.agreed_at ? formatDate(u.agreed_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inUse.userCount > inUse.users.length ? (
                <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                  Showing the latest {inUse.users.length} of {inUse.userCount} users.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {inUse ? "Keep version" : "Cancel"}
            </button>
            <button
              onClick={() => remove(!!inUse)}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {inUse ? "Delete anyway" : "Delete"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// In-app confirmation, used instead of the browser's confirm() popup.
function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  }
  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-indigo-100 p-2 text-indigo-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-slate-900">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">{body}</Dialog.Description>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={run}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FragmentRow({ d, isCurrent, open, onToggle, onDelete, onMakeCurrent }) {
  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-5 py-3 font-medium text-slate-900">{PLATFORM_LABEL[d.platform] || d.platform}</td>
        <td className="px-5 py-3">
          v{d.version} {isCurrent ? <Badge tone="emerald">current</Badge> : null}{" "}
          {d.ask_again === false ? <span title="Users who agreed earlier were not asked again"><Badge tone="slate">wording fix</Badge></span> : null}
        </td>
        <td className="px-5 py-3 text-slate-600">{formatDate(d.created_at)}</td>
        <td className="px-5 py-3 text-slate-600">{d.created_by || "—"}</td>
        <td className="px-5 py-3 text-right whitespace-nowrap">
          {!isCurrent ? (
            <button onClick={onMakeCurrent} className="mr-4 text-xs font-medium text-emerald-700 hover:text-emerald-900">
              Make current
            </button>
          ) : null}
          <button onClick={onToggle} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            {open ? "Hide text" : "View text"}
          </button>
          <button
            onClick={onDelete}
            className="ml-4 inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={5} className="px-5 py-4">
            <div className="max-w-2xl"><DisclosurePreview content={d.content} framed={false} /></div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DecisionsTab() {
  const [platform, setPlatform] = useState("");
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    adminApi
      .aiConsentHistory({ platform: platform || undefined, action: action || undefined, userId: query || undefined, page, limit: LIMIT })
      .then((res) => setData(res.data))
      .catch((err) => setError(errMsg(err)))
      .finally(() => setLoading(false));
  }, [platform, action, query, page]);

  const pages = Math.max(1, Math.ceil((data.total || 0) / LIMIT));
  const selectCls = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
        </select>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">All decisions</option>
          <option value="grant">Granted ({data.counts?.grant ?? 0})</option>
          <option value="withdraw">Withdrawn ({data.counts?.withdraw ?? 0})</option>
        </select>
        <SearchInput
          value={query}
          onSearch={(v) => { setQuery(v); setPage(1); }}
          placeholder="Search name, email or user ID"
          className="w-72"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Decision</th>
                <th className="px-5 py-3">Platform</th>
                <th className="px-5 py-3" title="Version of the consent text the user agreed to or withdrew">Consent text</th>
                <th className="px-5 py-3" title="Version of the AdsGPT app the user was on (iOS/Android only)">App build</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">No decisions found</td></tr>
              ) : (
                data.items.map((h) => (
                  <tr key={h._id} className="border-t border-slate-100">
                    <td className="px-5 py-3">
                      <Link to={`/users/${encodeURIComponent(h.user_id)}`} className="font-medium text-indigo-600 hover:underline">
                        {h.user?.name || h.user_id}
                      </Link>
                      {h.user?.email ? <div className="text-xs text-slate-500">{h.user.email}</div> : null}
                      {h.user?.name ? <div className="text-xs text-slate-400">{h.user_id}</div> : null}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={h.action === "grant" ? "emerald" : "rose"}>{h.action === "grant" ? "granted" : "withdrawn"}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{PLATFORM_LABEL[h.platform] || h.platform || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{h.version ? `v${h.version}` : "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{h.app_version || "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(h.decided_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{data.total || 0} decisions</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Prev</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}

export default function AiConsentPage() {
  const [tab, setTab] = useState("disclosures");
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">AI Data Sharing</h1>
        <p className="text-sm text-slate-500">
          Consent text shown to users before their content goes to AI services, per platform, and every user decision.
        </p>
      </header>
      <div className="flex gap-1 border-b border-slate-200">
        {[["disclosures", "Disclosures"], ["decisions", "User decisions"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "disclosures" ? <DisclosuresTab /> : <DecisionsTab />}
    </div>
  );
}
