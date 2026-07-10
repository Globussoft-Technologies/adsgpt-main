import React, { useMemo, useState } from 'react';
import { Mail, Send, Loader2 } from 'lucide-react';

// ----------------------------------------------------------------------------
// AlertEmailsSection — optional per-job cycle-complete alert recipients.
//
// After every automation run cycle finishes (success / partial / failed), the
// backend emails a cycle summary to the addresses entered here. The field is a
// single comma-separated string (up to 5 addresses) — the backend splits +
// validates it (adsFactoryAlertService). Empty = no alert emails.
//
// "Send test" fires POST /jobs/:id/test-email so the user can verify delivery
// + rendering before trusting the automation. It requires a saved job, so the
// button is only enabled in edit mode (canTest) — otherwise it shows a hint to
// save first.
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
  const [touched, setTouched] = useState(false);

  const error = useMemo(() => validateEmailList(emailTo), [emailTo]);
  const tokens = useMemo(() => parseTokens(emailTo), [emailTo]);
  const showError = touched && !!error;

  const canSendTest = canTest && !testing && !error && tokens.length > 0;

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/2 px-4 py-3 transition ${
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
        {tokens.length > 0 && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-[#E3E3E3]">
            {tokens.length}/{MAX_RECIPIENTS}
          </span>
        )}
      </div>

      <p className="text-[12.5px] leading-relaxed text-[#8a8a90]">
        Get an email summary after every cycle finishes (success, partial, or
        failed). Separate up to {MAX_RECIPIENTS} addresses with commas. Leave
        blank for no emails.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={emailTo}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          placeholder="alice@company.com, bob@company.com"
          className={`h-10 w-full flex-1 rounded-full bg-[#383838]/50 px-5 text-sm text-white outline-none transition placeholder:text-[#AFAFAF] focus:bg-[#383838]/70 disabled:cursor-not-allowed disabled:opacity-50 ${
            showError ? 'ring-1 ring-red-400/60' : ''
          }`}
        />

        <button
          type="button"
          onClick={onSendTest}
          disabled={!canSendTest}
          title={
            !canTest
              ? 'Save the automation first, then send a test email'
              : tokens.length === 0
                ? 'Enter at least one email address'
                : 'Send a sample cycle-complete email'
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

      {showError ? (
        <p className="text-[12px] text-red-400">{error}</p>
      ) : (
        !canTest && (
          <p className="text-[12px] italic text-[#6a6a70]">
            Save the automation to enable the test email.
          </p>
        )
      )}
    </section>
  );
}
