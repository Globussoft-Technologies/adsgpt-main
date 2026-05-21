import React, { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Send,
  Power,
  Bell,
  Mail,
  MessageSquare,
  Clock,
  Check,
  Zap,
  Eye,
  Heart,
  Smartphone,
  UserPlus,
  ShoppingBag,
} from 'lucide-react';
import {
  testSlack,
  testEmail,
  testTelegram,
  getAutopilotSettings,
  updateAutopilotSettings,
} from '@/apis/autopilot/autopilotApi';
import {
  SecondaryButton,
  DarkInput,
  Banner,
  CollapsibleCard,
  Switch,
  InfoTip,
} from './_atoms';
import UserRulesSection from './UserRules/UserRulesSection';

// Bot handle used in the Telegram onboarding copy. The dev deployment
// runs against a separate bot (`@adsgpt_dev_bot`) so test traffic doesn't
// land in production groups. Switched on `VITE_MODE=dev` — anything else
// (prod, staging, unset) falls back to the production bot.
const TELEGRAM_BOT_HANDLE =
  import.meta.env.VITE_MODE === 'dev'
    ? 'adsgpt_dev_bot'
    : 'adsgpt_autopilot_bot';

// v4: chips mirror the per-rule severity the user picks in their rule
// builder. The action-log row's `ruleSeverity` field is matched directly
// against this list — no more synthetic chips like budget_anomaly or
// flap (which were keyed off v3-only audit ids and skipReason patterns).
const ALERT_ON_OPTIONS = [
  { value: 'high', label: 'High', dot: '#f08070' },
  { value: 'medium', label: 'Medium', dot: '#e8c87a' },
  { value: 'low', label: 'Low', dot: '#7dd3a3' },
];

// v3→v4 severity remap. Pre-cutover settings docs may have alertOn arrays
// with legacy bucket names; remap on load so the user's chips render as
// checked instead of all-blank. Legacy synthetic chips (budget_anomaly /
// scale_action / flap) drop on the floor — their triggers don't exist
// in v4. Mirrors the backend shim in alertService.resolveAlertOn().
const LEGACY_SEVERITY_MAP = {
  critical: 'high',
  warning: 'medium',
  opportunity: 'low',
};
const remapLegacyAlertOn = (values) => {
  if (!Array.isArray(values)) return values;
  const out = new Set();
  for (const v of values) {
    if (LEGACY_SEVERITY_MAP[v]) out.add(LEGACY_SEVERITY_MAP[v]);
    else if (v === 'low' || v === 'medium' || v === 'high') out.add(v);
  }
  return Array.from(out);
};

const AutopilotSettings = () => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [slackResult, setSlackResult] = useState(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [emailResult, setEmailResult] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [telegramResult, setTelegramResult] = useState(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // ───────────────────────────────────────────────────────────────────────────
  // load
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const r = await getAutopilotSettings();
        if (alive) {
          const next = r.settings || null;
          if (next?.alerts?.alertOn) {
            next.alerts = {
              ...next.alerts,
              alertOn: remapLegacyAlertOn(next.alerts.alertOn),
            };
          }
          setSettings(next);
        }
      } catch (e) {
        if (alive)
          setLoadError(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // setters
  // ───────────────────────────────────────────────────────────────────────────
  const patchSettings = (fn) => {
    setSettings((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
    setSaveMessage(null);
  };

  const setBool = (key) => (val) =>
    patchSettings((prev) => ({ ...prev, [key]: !!val }));

  const setAlertField = (key) => (e) =>
    patchSettings((prev) => ({
      ...prev,
      alerts: { ...prev.alerts, [key]: e.target.value },
    }));

  const toggleAlertOn = (value) => () =>
    patchSettings((prev) => {
      const prevList = prev.alerts?.alertOn || [];
      const has = prevList.includes(value);
      const next = has
        ? prevList.filter((v) => v !== value)
        : Array.from(new Set([...prevList, value]));
      return { ...prev, alerts: { ...prev.alerts, alertOn: next } };
    });

  // ───────────────────────────────────────────────────────────────────────────
  // save + tests
  // ───────────────────────────────────────────────────────────────────────────

  // Map raw Joi field names → user-facing labels so error toasts read like
  // English instead of API field-paths. Joi reports `slackWebhookUrl must
  // be a valid URL` — what users want to see is `Slack Webhook URL must
  // be a valid URL`.
  const FIELD_LABELS = {
    slackWebhookUrl: 'Slack Webhook URL',
    emailTo: 'Alert Email(s)',
    telegramChatId: 'Telegram Chat ID',
    alertOn: 'Notify-me-about chips',
    enabled: 'Autopilot toggle',
    dryRunGlobal: 'Dry-run preview toggle',
    severityFloor: 'Severity floor',
    selectedAdAccountIds: 'Selected ad accounts',
    perAccountOverrides: 'Per-account overrides',
  };
  const friendlyDetail = (msg) => {
    if (typeof msg !== 'string') return msg;
    let out = msg;
    for (const [api, label] of Object.entries(FIELD_LABELS)) {
      // Replace standalone occurrences of the field name. The lookahead
      // avoids mangling unrelated text that happens to contain the path
      // (e.g. inside an embedded URL).
      out = out.replace(new RegExp(`\\b${api}\\b`, 'g'), label);
    }
    // Trim Joi's noisy `.alerts.` prefixes that sometimes leak through.
    out = out.replace(/"?alerts\."?/g, '');
    return out;
  };

  // Tracks the latest `settings` object identity. Used by `onSave` to
  // decide whether a save's response should clear the dirty flag — if
  // the user typed during the save, the snapshot we sent is stale and
  // we leave dirty=true so the next auto-save tick picks up their edits.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const saveInFlightRef = useRef(false);

  const onSave = async () => {
    if (!settings || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const snapshot = settingsRef.current;
    setSaving(true);
    setSaveMessage(null);
    try {
      const { _id, userId, createdAt, updatedAt, __v, ...patch } = snapshot;
      const r = await updateAutopilotSettings(patch);
      if (r.status) {
        // Only clear dirty if no edits happened during the save — otherwise
        // the next debounced tick will catch up.
        if (settingsRef.current === snapshot) setDirty(false);
        setSaveMessage({ ok: true, text: 'Saved.' });
      } else {
        setSaveMessage({
          ok: false,
          text: friendlyDetail(r.error) || 'Save failed (unknown error).',
        });
      }
    } catch (e) {
      const details = e?.response?.data?.details;
      const joined = Array.isArray(details)
        ? details.map(friendlyDetail).join('; ')
        : null;
      setSaveMessage({
        ok: false,
        text:
          joined ||
          friendlyDetail(e?.response?.data?.error) ||
          e.message ||
          'Save failed',
      });
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  // Auto-save — every edit marks dirty; this effect debounces persistence
  // by 800ms so a stream of keystrokes collapses to a single PATCH. Boolean
  // toggles also flow through the same path so the user never sees a save
  // button.
  useEffect(() => {
    if (!dirty || !settings) return undefined;
    if (saveInFlightRef.current) return undefined;
    const t = setTimeout(() => {
      onSave();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, settings]);

  // Briefly show the "Saved." banner, then auto-dismiss so it doesn't
  // hang around as visual noise. Errors are sticky — user needs to see
  // them long enough to fix.
  useEffect(() => {
    if (!saveMessage?.ok) return undefined;
    const t = setTimeout(() => setSaveMessage(null), 1500);
    return () => clearTimeout(t);
  }, [saveMessage]);

  // Pre-flight URL / email format check before hitting the test endpoint —
  // otherwise an obvious typo round-trips through the server only to come
  // back as a generic "Save failed" / 400. Slack webhook URLs always live
  // under hooks.slack.com (or a private domain enterprise customers can
  // self-host); we accept any well-formed https URL to keep the door open.
  const isValidUrl = (s) => {
    if (!s) return false;
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  };
  const isValidEmail = (s) =>
    typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

  // Max recipients on the emailTo comma-separated list. Mirrors the
  // backend cap in Validations/autopilotSettings.validator.js so users
  // see "5 max" inline instead of round-tripping a 400.
  const MAX_EMAIL_RECIPIENTS = 5;

  // Tokenize the comma-separated emailTo field. Returns
  // `{ recipients, bad }` — `recipients` is the deduped/trimmed list,
  // `bad` is the first invalid token (or null if everything parsed).
  // The caller decides whether to surface the bad token, count overflow,
  // or both as inline errors.
  const parseEmailField = (s) => {
    const parts = String(s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const seen = new Set();
    const recipients = [];
    let bad = null;
    for (const p of parts) {
      if (!isValidEmail(p)) {
        bad = bad || p;
        continue;
      }
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(p);
    }
    return { recipients, bad, total: parts.length };
  };

  // Each test handler walks the same gates as the old `testEnabled` flag
  // would have — empty value, malformed value, unsaved local changes — but
  // surfaces a specific inline error per gate instead of falling back to
  // the previous "disabled button + tooltip" UX, which the testers
  // (correctly) read as "the button does nothing." Only after every gate
  // passes do we hit the actual /test-slack or /test-email API.
  // Flush any pending auto-save before hitting a test endpoint — tests
  // post against the SAVED config, so a still-dirty edit would otherwise
  // be invisible to the test.
  const flushPendingSave = async () => {
    if (saveInFlightRef.current) {
      // Wait for current save to finish.
      while (saveInFlightRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (dirty) await onSave();
  };

  const onTestSlack = async () => {
    const url = settings?.alerts?.slackWebhookUrl || '';
    if (!url) {
      setSlackResult({ sent: false, error: 'Add a Slack webhook URL first.' });
      return;
    }
    if (!isValidUrl(url)) {
      setSlackResult({
        sent: false,
        error:
          "Slack webhook URL doesn't look right. Paste the full https://hooks.slack.com/... URL.",
      });
      return;
    }
    setSlackLoading(true);
    setSlackResult(null);
    try {
      await flushPendingSave();
      setSlackResult(await testSlack());
    } catch (e) {
      setSlackResult({ sent: false, error: e?.response?.data?.error || e.message });
    } finally {
      setSlackLoading(false);
    }
  };

  const onTestEmail = async () => {
    const to = settings?.alerts?.emailTo || '';
    if (!to.trim()) {
      setEmailResult({ sent: false, error: 'Add an email address first.' });
      return;
    }
    const { recipients, bad, total } = parseEmailField(to);
    if (bad) {
      setEmailResult({
        sent: false,
        error: `"${bad}" doesn't look like a valid email. Use commas to separate multiple addresses.`,
      });
      return;
    }
    if (total > MAX_EMAIL_RECIPIENTS) {
      setEmailResult({
        sent: false,
        error: `Up to ${MAX_EMAIL_RECIPIENTS} recipients allowed (you have ${total}). Trim the list or use a distribution group.`,
      });
      return;
    }
    if (!recipients.length) {
      setEmailResult({ sent: false, error: 'Add an email address first.' });
      return;
    }
    setEmailLoading(true);
    setEmailResult(null);
    try {
      await flushPendingSave();
      setEmailResult(await testEmail());
    } catch (e) {
      setEmailResult({ sent: false, error: e?.response?.data?.error || e.message });
    } finally {
      setEmailLoading(false);
    }
  };

  // Telegram preflight: chat id must be a signed int or `@channelname`.
  // The bot itself is shared (AdsGPT-owned, env-configured) so users
  // only need to enter where to send, not which bot to send from.
  const isValidTelegramChatId = (s) =>
    typeof s === 'string' &&
    /^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(s.trim());

  const onTestTelegram = async () => {
    const chatId = settings?.alerts?.telegramChatId || '';
    if (!chatId) {
      setTelegramResult({
        sent: false,
        error:
          `Add a chat id first. Add @${TELEGRAM_BOT_HANDLE} to your group (or DM it) — it greets you with the chat id to paste here.`,
      });
      return;
    }
    if (!isValidTelegramChatId(chatId)) {
      setTelegramResult({
        sent: false,
        error:
          "Chat ID should be a number like 123456789 / -1001234567890, or a public @channelname.",
      });
      return;
    }
    setTelegramLoading(true);
    setTelegramResult(null);
    try {
      await flushPendingSave();
      setTelegramResult(await testTelegram());
    } catch (e) {
      setTelegramResult({
        sent: false,
        error: e?.response?.data?.error || e.message,
      });
    } finally {
      setTelegramLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // derived previews — what each card shows when collapsed
  // ───────────────────────────────────────────────────────────────────────────
  const slackOn = !!settings?.alerts?.slackWebhookUrl;
  const emailOn = !!settings?.alerts?.emailTo;
  // Telegram is on as long as the user has supplied a chat id — the
  // bot token is server-side (env), not part of user settings.
  const telegramOn = !!settings?.alerts?.telegramChatId;
  const alertCategoryCount = settings?.alerts?.alertOn?.length || 0;
  const alertsPreview =
    !slackOn && !emailOn && !telegramOn
      ? 'No channels configured'
      : [
          slackOn ? `Slack ✓` : null,
          emailOn ? `Email ✓` : null,
          telegramOn ? `Telegram ✓` : null,
          alertCategoryCount
            ? `${alertCategoryCount} severit${alertCategoryCount === 1 ? 'y' : 'ies'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const isOn = !!settings?.enabled;
  const isDryRun = !!settings?.dryRunGlobal;

  // ───────────────────────────────────────────────────────────────────────────
  // render
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex w-full flex-col">
      {/* Sticky preference header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-5 lg:px-6 2xl:py-6">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-white sm:text-base 2xl:text-[17px]">
            Autopilot preferences
          </h3>
          <InfoTip text="Set how Autopilot behaves across your ad accounts. Changes take effect on the next run." />
        </div>
        <SaveStatus
          saving={saving}
          dirty={dirty}
          saveMessage={saveMessage}
        />
      </div>

      <div className="flex flex-col gap-3 px-4 py-5 sm:px-5 sm:py-6 lg:px-6 2xl:py-8 2xl:pt-0 sm:pt-0 pt-0">
        {loading && <p className="text-sm text-white/70 2xl:text-15">Loading…</p>}

        {loadError && (
          <Banner variant="error">Failed to load settings: {loadError}</Banner>
        )}

        {/* Save errors stay as a banner so the user sees the validator
            message; success is signalled by the inline SaveStatus chip
            in the header and auto-dismisses. */}
        {saveMessage && !saveMessage.ok && (
          <Banner variant="error">{saveMessage.text}</Banner>
        )}

        {settings && (
          <>
            {/* ── Card 1: Basics ───────────────────────────────────────── */}
            <CollapsibleCard
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/[0.07] text-white/85 2xl:h-8 2xl:w-8">
                    <Power className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                  </span>
                  <StatusPill on={isOn} dryRun={isDryRun} />
                </span>
              }
              defaultOpen
            >
              <BasicsPanel
                on={isOn}
                setOn={setBool('enabled')}
                dryRun={isDryRun}
                setDryRun={setBool('dryRunGlobal')}
              />
            </CollapsibleCard>

            {/* ── Card 2: Campaign templates — temporarily disabled per
                product decision. Re-enable by uncommenting the block
                below. Data + components (`CAMPAIGN_TEMPLATES`,
                `CampaignTemplatesPanel`, `TemplateCard`, `TemplateBadge`)
                are kept at the bottom of the file for an easy revert. */}
            {/*
            <CollapsibleCard
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/6 text-white/75">
                    <Zap className="h-3.5 w-3.5" />
                  </span>
                  <span>Campaign templates</span>
                  <span className="hidden text-13 font-normal text-white/65 sm:inline 2xl:text-sm">
                    · Quick-start by Meta objective
                  </span>
                  <InfoTip text="Pre-configured Autopilot setups for each Meta campaign objective. Open a template to see its defaults, then duplicate it to make it your own." />
                </span>
              }
              preview={`${CAMPAIGN_TEMPLATES.length} templates · 0 custom`}
              defaultOpen
            >
              <CampaignTemplatesPanel />
            </CollapsibleCard>
            */}

            {/* ── Card 3: Your Autopilot rules — kept as existing section
                The internal table + drawer is the next phase of revamp. */}
            <UserRulesSection />

            {/* ── Card 4: Alerts ──────────────────────────────────────── */}
            <CollapsibleCard
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/12 bg-white/[0.07] text-white/85 2xl:h-8 2xl:w-8">
                    <Bell className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                  </span>
                  <span>Alerts</span>
                  <span className="hidden text-13 font-normal text-white/65 sm:inline 2xl:text-sm">
                    · Where Autopilot tells you what it did
                  </span>
                  <InfoTip text="Choose where to send cycle summaries — Slack, email, and/or Telegram. The severity chips below control which rule findings actually notify." />
                </span>
              }
              preview={alertsPreview}
            >
              <AlertsPanel
                slackUrl={settings.alerts?.slackWebhookUrl || ''}
                onSlackUrlChange={setAlertField('slackWebhookUrl')}
                emailTo={settings.alerts?.emailTo || ''}
                onEmailChange={setAlertField('emailTo')}
                telegramChatId={settings.alerts?.telegramChatId || ''}
                onTelegramChatIdChange={setAlertField('telegramChatId')}
                alertOn={settings.alerts?.alertOn || []}
                onToggleAlertOn={toggleAlertOn}
                slackLoading={slackLoading}
                emailLoading={emailLoading}
                telegramLoading={telegramLoading}
                slackResult={slackResult}
                emailResult={emailResult}
                telegramResult={telegramResult}
                onTestSlack={onTestSlack}
                onTestEmail={onTestEmail}
                onTestTelegram={onTestTelegram}
                dirty={dirty}
              />
            </CollapsibleCard>
          </>
        )}
      </div>
    </div>
  );
};

// ─── SaveStatus ─────────────────────────────────────────────────────────────
// Inline replacement for the old "Save changes" button. The Settings tab now
// auto-saves on edit; this widget just narrates state — saving, last-save
// confirmation, or surfaced error.
const SaveStatus = ({ saving, dirty, saveMessage }) => {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-white/75 2xl:text-13">
        <Loader2 className="h-3 w-3 animate-spin 2xl:h-3.5 2xl:w-3.5" /> Saving…
      </span>
    );
  }
  if (saveMessage && !saveMessage.ok) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-red-400 2xl:text-13"
        title={saveMessage.text}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Save failed
      </span>
    );
  }
  if (saveMessage?.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 2xl:text-13">
        <Check className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" strokeWidth={3} /> Saved
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-white/75 2xl:text-13">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Unsaved
        changes
      </span>
    );
  }
  return null;
};

// ─── StatusPill ─────────────────────────────────────────────────────────────
const StatusPill = ({ on, dryRun }) => {
  const tone = !on
    ? {
        fg: 'text-white/60',
        bg: 'bg-white/8',
        ring: 'border-white/10',
        dot: 'bg-white/40',
        label: 'Autopilot · Off',
      }
    : dryRun
      ? {
          fg: 'text-amber-300',
          bg: 'bg-amber-500/10',
          ring: 'border-amber-400/30',
          dot: 'bg-amber-300',
          label: 'Autopilot · Dry-run',
        }
      : {
          fg: 'text-emerald-300',
          bg: 'bg-emerald-500/10',
          ring: 'border-emerald-400/30',
          dot: 'bg-emerald-300',
          label: 'Autopilot · Live',
        };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-10 font-bold uppercase tracking-wide 2xl:px-2.5 2xl:py-1 2xl:text-[11px] ${tone.fg} ${tone.bg} ${tone.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
};

// ─── CampaignTemplatesPanel ─────────────────────────────────────────────────
// Static for now — the active/last-used counts are placeholders. When the
// templates feature comes online, swap CAMPAIGN_TEMPLATES for data sourced
// from the API and wire each card's CTA to its create flow.
const CAMPAIGN_TEMPLATES = [
  {
    id: 'awareness',
    label: 'Awareness',
    desc: 'Reach people most likely to remember your ad',
    icon: Eye,
    accent: 'indigo',
    active: 4,
    lastUsed: '5d ago',
  },
  {
    id: 'traffic',
    label: 'Traffic',
    desc: 'Send people to a destination — site, app, Messenger',
    icon: Send,
    accent: 'cyan',
    active: 8,
    lastUsed: '1d ago',
  },
  {
    id: 'engagement',
    label: 'Engagement',
    desc: 'Get more messages, video views, post engagement',
    icon: Heart,
    accent: 'rose',
    badges: ['beta'],
    active: 2,
    lastUsed: '12d ago',
  },
  {
    id: 'leads',
    label: 'Leads',
    desc: 'Collect leads via forms, calls or sign-ups',
    icon: UserPlus,
    accent: 'emerald',
    badges: ['beta'],
    active: 6,
    lastUsed: '2d ago',
  },
  {
    id: 'app-promotion',
    label: 'App promotion',
    desc: 'Drive installs and app activity',
    icon: Smartphone,
    accent: 'amber',
    badges: ['beta'],
    active: 1,
    lastUsed: '30d ago',
  },
  {
    id: 'sales',
    label: 'Sales',
    desc: 'Find people likely to buy your product or service',
    icon: ShoppingBag,
    accent: 'violet',
    badges: ['beta', 'most-used'],
    active: 9,
    lastUsed: '3h ago',
  },
];

const TEMPLATE_ACCENTS = {
  indigo: {
    iconBg: 'bg-indigo-500/15 text-indigo-300',
    bar: 'bg-indigo-400/60',
  },
  cyan: {
    iconBg: 'bg-cyan-500/15 text-cyan-300',
    bar: 'bg-cyan-400/60',
  },
  rose: {
    iconBg: 'bg-rose-500/15 text-rose-300',
    bar: 'bg-rose-400/60',
  },
  emerald: {
    iconBg: 'bg-emerald-500/15 text-emerald-300',
    bar: 'bg-emerald-400/60',
  },
  amber: {
    iconBg: 'bg-amber-500/15 text-amber-300',
    bar: 'bg-amber-400/60',
  },
  violet: {
    iconBg: 'bg-violet-500/15 text-violet-300',
    bar: 'bg-violet-400/60',
  },
};

const CampaignTemplatesPanel = () => (
  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
    {CAMPAIGN_TEMPLATES.map((t) => (
      <TemplateCard key={t.id} template={t} />
    ))}
  </div>
);

const TemplateCard = ({ template }) => {
  const Icon = template.icon;
  const accent = TEMPLATE_ACCENTS[template.accent] || TEMPLATE_ACCENTS.cyan;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/6 bg-white/3 p-3 transition-all hover:border-white/10 hover:bg-white/5">
      <span className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${accent.bar}`} />
      <div className="flex items-start gap-3 pl-2">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent.iconBg}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-white">{template.label}</span>
            {(template.badges || []).map((b) => (
              <TemplateBadge key={b} kind={b} />
            ))}
          </div>
          <p className="mt-0.5 text-xs text-white/70 2xl:text-13">{template.desc}</p>
          <div className="mt-2 flex items-center gap-2 text-10 text-white/65 2xl:text-[11px]">
            <span>
              <span className="font-medium text-white/70">
                {template.active}
              </span>{' '}
              active
            </span>
            <span className="text-white/20">·</span>
            <span>last used {template.lastUsed}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const TemplateBadge = ({ kind }) => {
  const styles =
    kind === 'most-used'
      ? {
          label: 'MOST USED',
          cls: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
        }
      : {
          label: 'BETA',
          cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
        };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${styles.cls}`}
    >
      {styles.label}
    </span>
  );
};

// ─── BasicsPanel ────────────────────────────────────────────────────────────
const BasicsPanel = ({ on, setOn, dryRun, setDryRun }) => (
  <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <ToggleChip
        label="Autopilot"
        info="Master switch. When off, nothing runs automatically — your saved rules and alerts stay intact for when you turn it back on."
        value={on}
        onChange={setOn}
        accent="cyan"
      />
      <ToggleChip
        label="Dry-run preview only"
        info="Evaluate rules and write findings to the action log, but never actually pause anything on Meta. Recommended while you tune new rules."
        value={dryRun}
        onChange={setDryRun}
        accent="amber"
        disabled={!on}
      />
      <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-white/75 2xl:text-13">
        <Clock className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" /> Runs every 1 hour
      </span>
    </div>
  </div>
);

// ToggleChip — pill-shaped toggle with a label, info icon, and inline switch.
const ToggleChip = ({ label, info, value, onChange, accent = 'cyan', disabled }) => {
  const accentRing =
    accent === 'amber'
      ? value
        ? 'border-amber-400/40 bg-amber-500/8'
        : 'border-white/10 bg-white/2'
      : value
        ? 'border-[#15DCFF]/40 bg-[#15DCFF]/6'
        : 'border-white/10 bg-white/2';
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all 2xl:px-3.5 2xl:py-2.5 ${accentRing} ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-white/4'
      }`}
    >
      <span className="text-xs font-bold text-white 2xl:text-13">{label}</span>
      {info && <InfoTip text={info} />}
      <Switch checked={value} onChange={onChange} disabled={disabled} size="sm" />
    </button>
  );
};

// ─── AlertsPanel ────────────────────────────────────────────────────────────
const AlertsPanel = ({
  slackUrl,
  onSlackUrlChange,
  emailTo,
  onEmailChange,
  telegramChatId,
  onTelegramChatIdChange,
  alertOn,
  onToggleAlertOn,
  slackLoading,
  emailLoading,
  telegramLoading,
  slackResult,
  emailResult,
  telegramResult,
  onTestSlack,
  onTestEmail,
  onTestTelegram,
  dirty,
}) => (
  <div className="flex flex-col gap-4">
    {/* Channel cards */}
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <ChannelCard
        kind="slack"
        title="Slack"
        connected={!!slackUrl}
        connectedLabel={slackUrl ? 'Configured · Webhook saved' : 'Not configured'}
        placeholder="https://hooks.slack.com/services/…"
        value={slackUrl}
        onChange={onSlackUrlChange}
        onTest={onTestSlack}
        testLoading={slackLoading}
        testResult={slackResult}
        successMessage="✓ Test message posted to Slack."
        dirty={dirty}
        hint={
          <>
            1. In Slack, open the destination channel and go to{' '}
            <span className="text-white/60">
              Channel name → Integrations → Add an App
            </span>{' '}
            and pick{' '}
            <a
              href="https://my.slack.com/services/new/incoming-webhook"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#15DCFF] hover:underline"
            >
              Incoming Webhooks
            </a>
            .
            <br />
            2. Authorize, choose the channel, click{' '}
            <span className="text-white/60">Add Incoming Webhooks integration</span>.
            <br />
            3. Copy the{' '}
            <span className="font-mono">https://hooks.slack.com/services/…</span>{' '}
            URL it gives you, paste above, hit Test.
          </>
        }
      />
      <ChannelCard
        kind="email"
        title="Email"
        connected={!!emailTo}
        connectedLabel={
          emailTo
            ? `${emailTo.split(',').filter(Boolean).length} recipient(s)`
            : 'Not configured'
        }
        placeholder="ops@company.com, growth@company.com"
        value={emailTo}
        onChange={onEmailChange}
        onTest={onTestEmail}
        testLoading={emailLoading}
        testResult={emailResult}
        successMessage="✓ Test email sent. Check your inbox."
        dirty={dirty}
        hint={
          <>
            1. Type one email address, or up to 5 separated by commas.
            <br />
            2. Each cycle sends a single summary to every address —
            same content, visible-to-all in the To: header (good for
            small teams; for one-recipient-per-send semantics use a
            distribution group).
            <br />
            3. Hit Test to verify delivery before the first live cycle.
          </>
        }
      />
      <TelegramCard
        chatId={telegramChatId}
        onChatIdChange={onTelegramChatIdChange}
        onTest={onTestTelegram}
        testLoading={telegramLoading}
        testResult={telegramResult}
        dirty={dirty}
      />
    </div>

    {/* Severity routing */}
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-10 font-bold uppercase tracking-wider text-white/60 2xl:text-[11px]">
          Notify me about
        </span>
        <InfoTip text="Pick which rule severities trigger an alert. Per-channel routing follows the channels you've configured above." />
      </div>
      <div className="flex flex-wrap gap-2">
        {ALERT_ON_OPTIONS.map((opt) => {
          const active = alertOn.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={onToggleAlertOn(opt.value)}
              className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all 2xl:px-3.5 2xl:py-2 2xl:text-13 ${
                active
                  ? 'border-[#15DCFF]/40 bg-[#15DCFF]/10 text-[#15DCFF]'
                  : 'border-white/15 bg-white/[0.04] text-white/75 hover:border-white/25 hover:text-white'
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: opt.dot }}
              />
              {opt.label}
              {active && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      <p className="text-10 leading-relaxed text-white/60 2xl:text-xs">
        Severity is set per rule. Toggling these chips controls which severities
        of rule findings actually send to Slack / Email.
      </p>
    </div>
  </div>
);

// ─── ChannelCard ───────────────────────────────────────────────────────────
// `hint` is an optional node rendered below the input. Used to surface
// channel-specific setup instructions (where to grab the Slack webhook
// URL, how to format the email recipient list) so users don't have to
// hunt around the docs after seeing an empty input.
const ChannelCard = ({
  kind,
  title,
  connected,
  connectedLabel,
  placeholder,
  value,
  onChange,
  onTest,
  testLoading,
  testResult,
  successMessage,
  dirty,
  hint,
}) => {
  const Icon = kind === 'slack' ? MessageSquare : Mail;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-white/15 bg-white/5 p-4 2xl:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border 2xl:h-10 2xl:w-10 ${
              connected
                ? 'border-[#15DCFF]/30 bg-[#15DCFF]/8 text-[#15DCFF]'
                : 'border-white/15 bg-white/[0.06] text-white/70'
            }`}
          >
            <Icon className="h-4 w-4 2xl:h-4.5 2xl:w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-13 font-bold text-white 2xl:text-sm">{title}</span>
              {connected && (
                <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-300">
                  Connected
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-10 text-white/65 2xl:text-[11px]">
              {connectedLabel}
            </p>
          </div>
        </div>
        <SecondaryButton
          onClick={onTest}
          disabled={testLoading}
          title={
            !value
              ? `Add a ${kind === 'slack' ? 'Slack webhook' : 'recipient'} first.`
              : dirty
                ? 'Save your changes first, then test.'
                : 'Send a test now.'
          }
          className="shrink-0"
        >
          {testLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Testing
            </>
          ) : (
            <>
              <Send className="h-3 w-3" /> Test
            </>
          )}
        </SecondaryButton>
      </div>
      <DarkInput
        // `type="email"` blocks the comma character on some browsers,
        // which prevents typing the multi-recipient form. Use plain
        // text and let our parser + Joi handle validation.
        type={kind === 'slack' ? 'url' : 'text'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="font-mono"
      />
      {hint && (
        <p className="text-10 leading-relaxed text-white/60 2xl:text-xs">{hint}</p>
      )}
      {testResult && (
        <Banner variant={testResult.sent ? 'success' : 'error'}>
          {testResult.sent
            ? successMessage
            : `✗ ${testResult.error || testResult.reason || 'unknown error'}`}
        </Banner>
      )}
    </div>
  );
};

// ─── TelegramCard ──────────────────────────────────────────────────────────
// Single chat-id input. The bot itself is owned by AdsGPT (token lives
// in the server's AUTOPILOT_TELEGRAM_BOT_TOKEN env), so users only need
// to add @adsgpt_autopilot_bot to their group and paste the chat id
// with — no @BotFather dance, no getUpdates JSON-grepping.
const TelegramCard = ({
  chatId,
  onChatIdChange,
  onTest,
  testLoading,
  testResult,
  dirty,
}) => {
  const connected = !!chatId;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-white/15 bg-white/5 p-4 2xl:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border 2xl:h-10 2xl:w-10 ${
              connected
                ? 'border-[#15DCFF]/30 bg-[#15DCFF]/8 text-[#15DCFF]'
                : 'border-white/15 bg-white/[0.06] text-white/70'
            }`}
          >
            <Send className="h-4 w-4 -rotate-45" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-13 font-bold text-white">Telegram</span>
              {connected && (
                <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-300">
                  Connected
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-10 text-white/65 2xl:text-[11px]">
              {connected ? 'Chat configured' : 'Not configured'}
            </p>
          </div>
        </div>
        <SecondaryButton
          onClick={onTest}
          disabled={testLoading}
          title={
            !chatId
              ? 'Add a chat ID first.'
              : dirty
                ? 'Save your changes first, then test.'
                : 'Send a test now.'
          }
          className="shrink-0"
        >
          {testLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Testing
            </>
          ) : (
            <>
              <Send className="h-3 w-3" /> Test
            </>
          )}
        </SecondaryButton>
      </div>

      <DarkInput
        type="text"
        placeholder="Chat ID — 123456789 or @channelname"
        value={chatId}
        onChange={onChatIdChange}
        autoComplete="off"
        className="font-mono"
      />

      <p className="text-10 leading-relaxed text-white/60 2xl:text-xs">
        1. Add{' '}
        <a
          href={`https://t.me/${TELEGRAM_BOT_HANDLE}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#15DCFF] hover:underline"
        >
          @{TELEGRAM_BOT_HANDLE}
        </a>{' '}
        to your group.
        <br />
        2. The bot greets you with the chat id automatically. If you
        miss it, type <span className="font-mono">/start</span> in the
        chat — same reply.
        <br />
        3. Copy the chat id (groups are a negative number like{' '}
        <span className="font-mono">-1001234567890</span>), paste it
        above, and hit Test.
      </p>

      {testResult && (
        <Banner variant={testResult.sent ? 'success' : 'error'}>
          {testResult.sent
            ? '✓ Test message sent to Telegram.'
            : `✗ ${testResult.error || testResult.reason || 'unknown error'}`}
        </Banner>
      )}
    </div>
  );
};

export default AutopilotSettings;
