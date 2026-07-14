import React, { useMemo, useRef, useState } from 'react';
import { Mail, Send, Loader2, X } from 'lucide-react';

// ----------------------------------------------------------------------------
// AlertEmailsSection — optional per-job cycle-complete alert recipients.
//
// After every automation run cycle finishes (success / partial / failed), the
// backend emails a cycle summary to the addresses entered here. The value is a
// single comma-separated string (up to 5 addresses) — the backend splits +
// validates it (adsFactoryAlertService). Empty = no alert emails.
//
// The UI is a compact chip/token field: each committed address renders as a
// removable pill and a shared inline input adds the next one, so up to 5
// recipients fit without stacking multiple rows. The value stays a
// comma-separated string on the way out, preserving the parent + backend
// contract.
//
// "Send test" fires POST /jobs/:id/test-email so the user can verify delivery
// works — independent of whether the automation has been saved yet. Sends to
// whatever addresses are currently entered, saved or not.
// ----------------------------------------------------------------------------

const MAX_RECIPIENTS = 5;

// Same permissive shape the backend's Joi email rule accepts (tlds off) — a
// local-part@domain with a dot in the domain. Kept intentionally loose; the
// backend is the source of truth, this only catches obvious typos early.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Split the raw comma-separated value into trimmed, non-empty tokens.
function parseTokens(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Returns a client-side validation message, or '' when the value is valid
// (including empty, which is allowed — it just means "no alert emails").
export function validateEmailList(raw) {
  const tokens = parseTokens(raw);
  if (tokens.length === 0) return '';
  if (tokens.length > MAX_RECIPIENTS) {
    return `Up to ${MAX_RECIPIENTS} addresses (you entered ${tokens.length}).`;
  }
  const bad = tokens.find((t) => !EMAIL_RE.test(t));
  if (bad) return `"${bad}" is not a valid email address.`;
  return '';
}

export default function AlertEmailsSection({
  value,
  onChange,
  disabled,
  canTest,
  testing,
  onSendTest,
}) {
  const emailTo = typeof value === 'string' ? value : '';
  const tokens = useMemo(() => parseTokens(emailTo), [emailTo]);

  // `draft` is the uncommitted text in the inline input. It never lives in the
  // emitted value until it's promoted to a chip, so partial typing doesn't
  // pollute validation.
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const inputRef = useRef(null);

  const atCapacity = tokens.length >= MAX_RECIPIENTS;
  // Committed chips are always valid (we only add valid, deduped tokens), so a
  // Send-test only needs at least one recipient and no in-flight request.
  const canSendTest = canTest && !testing && tokens.length > 0;

  const emit = (nextTokens) => onChange?.(nextTokens.join(', '));

  // Promote the current draft (which may itself be comma/paste-separated) into
  // chips. Returns true when nothing was left rejected, so callers can decide
  // whether to keep focus for a fix.
  const commitDraft = () => {
    const candidates = parseTokens(draft);
    if (candidates.length === 0) {
      setDraft('');
      setDraftError('');
      return true;
    }

    const next = [...tokens];
    let rejected = '';
    for (const raw of candidates) {
      if (next.length >= MAX_RECIPIENTS) {
        rejected = `Up to ${MAX_RECIPIENTS} addresses.`;
        break;
      }
      if (!EMAIL_RE.test(raw)) {
        rejected = `"${raw}" is not a valid email address.`;
        break;
      }
      // Case-insensitive dedupe — silently skip repeats.
      if (next.some((t) => t.toLowerCase() === raw.toLowerCase())) continue;
      next.push(raw);
    }

    if (next.length !== tokens.length) emit(next);
    setDraft(rejected ? draftTailFor(candidates, next) : '');
    setDraftError(rejected);
    return !rejected;
  };

  // When a commit stops early (invalid / over cap), keep the offending token in
  // the input so the user can fix it instead of losing what they typed.
  const draftTailFor = (candidates, accepted) => {
    const acceptedLower = new Set(accepted.map((t) => t.toLowerCase()));
    const leftover = candidates.filter((c) => !acceptedLower.has(c.toLowerCase()));
    return leftover.join(', ');
  };

  const removeAt = (idx) => {
    emit(tokens.filter((_, i) => i !== idx));
    setDraftError('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && tokens.length > 0) {
      // Backspace on an empty input pops the last chip.
      e.preventDefault();
      removeAt(tokens.length - 1);
    }
  };

  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border border-white/10 bg-white/2 px-4 py-3 transition ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-white 2xl:text-base">
            Alert emails
            <span className="ml-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[#AFAFAF]">
              optional
            </span>
          </h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-[#E3E3E3]">
          {tokens.length}/{MAX_RECIPIENTS}
        </span>
      </div>

      <p className="text-[12.5px] leading-relaxed text-[#8a8a90]">
        Cycle summary after each run — press Enter to add, up to {MAX_RECIPIENTS}.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div
          onClick={() => inputRef.current?.focus()}
          className={`flex min-h-10 w-full flex-1 cursor-text flex-wrap items-center gap-1.5 rounded-2xl bg-[#383838]/50 px-2.5 py-1.5 text-sm transition focus-within:bg-[#383838]/70 ${
            draftError ? 'ring-1 ring-red-400/60' : ''
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {tokens.map((token, idx) => (
            <span
              key={`${token}-${idx}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#15DCFF]/25 bg-[#15DCFF]/10 py-1 pr-1 pl-3 text-xs text-[#c6f7ff]"
            >
              <span className="truncate">{token}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(idx);
                }}
                disabled={disabled}
                aria-label={`Remove ${token}`}
                className="grid size-4 shrink-0 place-items-center rounded-full text-[#15DCFF]/70 transition hover:bg-[#15DCFF]/20 hover:text-white"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}

          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (draftError) setDraftError('');
            }}
            onKeyDown={handleKeyDown}
            onBlur={commitDraft}
            disabled={disabled || atCapacity}
            placeholder={
              atCapacity
                ? `Max ${MAX_RECIPIENTS} reached`
                : tokens.length === 0
                  ? 'alice@company.com'
                  : 'Add another…'
            }
            className="h-7 min-w-30 flex-1 bg-transparent px-1.5 text-white outline-none placeholder:text-[#AFAFAF] disabled:cursor-not-allowed"
          />
        </div>

        <button
          type="button"
          onClick={onSendTest}
          disabled={!canSendTest}
          title={
            tokens.length === 0
              ? 'Enter at least one email address'
              : 'Send a test email to verify delivery'
          }
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-4 text-sm font-semibold text-[#15DCFF] transition hover:bg-[#15DCFF]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          {testing ? 'Sending…' : 'Send test'}
        </button>
      </div>

      {draftError && <p className="text-[12px] text-red-400">{draftError}</p>}
    </section>
  );
}
