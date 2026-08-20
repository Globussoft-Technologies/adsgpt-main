import React, { useState } from 'react';
import { Mail, Plus, X } from 'lucide-react';
import { CHIP, CONTROL, FAINT, FOCUS_WITHIN, LABEL } from './_tokens';

// ----------------------------------------------------------------------------
// AlertEmails — who hears about each cycle.
//
// `briefToJobPayload` has read `brief.alertEmails` since the day it was
// written, and the brief schema had no such field. Every read returned
// undefined, so no Quick setup job ever had alerts configured — a code path
// that looked wired, passed review, and did nothing. The field exists now, and
// this is the control that fills it.
//
// Deliberately quiet: an automation that works needs no email, so this is a
// row of chips and an input rather than a section demanding attention. Five
// recipients max, matching what adsFactoryAlertService actually sends to.
// ----------------------------------------------------------------------------

const MAX = 5;

// Same shape the backend validates with. Kept loose on purpose — this is here
// to catch a typo before a round trip, not to be the authority.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AlertEmails({ value = [], onChange, disabled = false }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const emails = Array.isArray(value) ? value : [];
  const full = emails.length >= MAX;

  const add = () => {
    const next = draft.trim().toLowerCase();
    if (!next) return;
    if (!LOOKS_LIKE_EMAIL.test(next)) {
      setError("That doesn't look like an email address.");
      return;
    }
    if (emails.includes(next)) {
      // Not an error — the address is already on the list, which is what they
      // wanted. Just clear the box.
      setDraft('');
      setError('');
      return;
    }
    onChange?.([...emails, next]);
    setDraft('');
    setError('');
  };

  const remove = (email) => onChange?.(emails.filter((e) => e !== email));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Mail className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF] dark:text-[#8B939E]" />
        <span className={LABEL}>Email me after each run</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {emails.map((email) => (
          <span
            key={email}
            className={`inline-flex items-center gap-1.5 py-1.5 pr-2 pl-3 ${CHIP}`}
          >
            <span className="max-w-56 truncate">{email}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(email)}
              aria-label={`Remove ${email}`}
              className="text-[#9CA3AF] transition-colors hover:text-[#111827] disabled:opacity-50 dark:text-[#8B939E] dark:hover:text-[#ECEFF3]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {!full && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 ${CONTROL} ${FOCUS_WITHIN}`}>
            <input
              type="email"
              value={draft}
              disabled={disabled}
              placeholder={emails.length ? 'Add another' : 'you@company.com'}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError('');
              }}
              // Enter commits. Comma and Tab too — pasting a list is the
              // obvious thing to try, and losing the entry to a blur is the
              // obvious way to annoy someone.
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  add();
                }
              }}
              onBlur={add}
              className="w-44 bg-transparent text-13 outline-none placeholder:text-[#9CA3AF] disabled:opacity-60 dark:placeholder:text-[#6C7480]"
            />
            <button
              type="button"
              disabled={disabled || !draft.trim()}
              onClick={add}
              aria-label="Add recipient"
              className="text-[#9CA3AF] transition-colors hover:text-[#111827] disabled:opacity-30 dark:text-[#8B939E] dark:hover:text-[#ECEFF3]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {error && <p className="text-13 text-red-600 dark:text-red-400">{error}</p>}

      {!error && (
        <p className={FAINT}>
          {emails.length === 0
            ? 'Optional — nobody is emailed unless you add an address.'
            : full
              ? `${MAX} is the maximum.`
              : 'A short summary after every cycle: what went live, and what failed.'}
        </p>
      )}
    </div>
  );
}
