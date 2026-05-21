import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { FaMeta } from 'react-icons/fa6';
import {
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Loader2,
  Target,
  Layers,
  Image as ImageIcon,
  Eye,
  Megaphone,
  MousePointerClick,
  Heart,
  ShoppingCart,
  UserPlus,
  Smartphone,
  Upload,
  AlertCircle,
  Wallet,
  Globe2,
  Instagram,
  ShieldAlert,
  CalendarDays,
  Sparkles,
  Languages,
  Link2,
} from 'lucide-react';
import { Calendar } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import {
  getMetaPages,
  getMetaSavedAudiences,
  createMetaCampaign,
  createMetaAdSet,
  uploadMetaAdImage,
  createMetaAd,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';
import LibraryPicker from './LibraryPicker';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const _currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => _currentYear - i);

// ─── account status decoder ───────────────────────────────────────────────────

// Meta's account_status enum. Anything other than ACTIVE will block any
// create/edit Marketing API call, so the wizard surfaces this up-front
// instead of letting the user fill out 4 steps before Meta rejects the
// submission with a generic "Invalid parameter".
const ACCOUNT_STATUS_LABELS = {
  1: { label: 'Active', tone: 'ok' },
  2: { label: 'Disabled', tone: 'block' },
  3: { label: 'Unsettled', tone: 'block' },
  7: { label: 'Pending risk review', tone: 'block' },
  8: { label: 'Pending settlement', tone: 'block' },
  9: { label: 'In grace period', tone: 'warn' },
  100: { label: 'Pending closure', tone: 'block' },
  101: { label: 'Closed', tone: 'block' },
  201: { label: 'Active', tone: 'ok' },
  202: { label: 'Closed', tone: 'block' },
};

function decodeAccountStatus(status) {
  return ACCOUNT_STATUS_LABELS[status] || { label: `Status ${status}`, tone: 'warn' };
}

// ─── static option lists ──────────────────────────────────────────────────────

// `beta: true` flags an objective whose end-to-end flow we haven't fully
// hardened yet (creative requirements, optimization-goal coverage, lead-form
// plumbing, app-install SDK linkage, etc.). Only Awareness + Traffic are
// considered fully shipped today; the rest render with a "Beta" pill in
// the picker so users know to expect rougher edges.
const OBJECTIVES = [
  { value: 'OUTCOME_AWARENESS', label: 'Awareness', desc: 'Reach people most likely to remember your ad', icon: Eye },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic', desc: 'Send people to a destination — site, app, Messenger', icon: MousePointerClick },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', desc: 'Get more messages, video views, post engagement', icon: Heart, beta: true },
  { value: 'OUTCOME_LEADS', label: 'Leads', desc: 'Collect leads via forms, calls or sign-ups', icon: UserPlus, beta: true },
  { value: 'OUTCOME_APP_PROMOTION', label: 'App promotion', desc: 'Drive installs and app activity', icon: Smartphone, beta: true },
  { value: 'OUTCOME_SALES', label: 'Sales', desc: 'Find people likely to buy your product or service', icon: ShoppingCart, beta: true },
];

const OPTIMIZATION_GOALS_BY_OBJECTIVE = {
  OUTCOME_AWARENESS: ['REACH', 'IMPRESSIONS'],
  OUTCOME_TRAFFIC: ['LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'IMPRESSIONS', 'REACH'],
  OUTCOME_ENGAGEMENT: ['POST_ENGAGEMENT', 'PAGE_LIKES', 'THRUPLAY', 'VIDEO_VIEWS'],
  OUTCOME_LEADS: ['LEAD_GENERATION', 'QUALITY_LEAD'],
  OUTCOME_APP_PROMOTION: ['APP_INSTALLS'],
  OUTCOME_SALES: ['OFFSITE_CONVERSIONS', 'VALUE'],
};

const BILLING_EVENTS = ['IMPRESSIONS', 'LINK_CLICKS', 'PAGE_LIKES', 'POST_ENGAGEMENT', 'VIDEO_VIEWS', 'THRUPLAY'];

// Note: `CREDIT` was replaced by `FINANCIAL_PRODUCTS_SERVICES` on Jan 14,
// 2025 — Meta now rejects CREDIT for US-targeting campaigns. We omit it from
// the UI; the backend validator still allows it for API consumers.
const SPECIAL_AD_CATEGORIES = [
  { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'HOUSING', label: 'Housing' },
  { value: 'FINANCIAL_PRODUCTS_SERVICES', label: 'Financial products & services' },
  { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Issues / Politics' },
  { value: 'ONLINE_GAMBLING_AND_GAMING', label: 'Gambling / Gaming' },
];

const BID_STRATEGIES = [
  { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Highest volume (lowest cost)' },
  { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap' },
  { value: 'COST_CAP', label: 'Cost cap' },
  // LOWEST_COST_WITH_MIN_ROAS intentionally omitted — it requires a different
  // field shape (`bid_constraints.roas_average_floor`) than the other capped
  // strategies, and exposing it here without a dedicated input would just hand
  // users another "Invalid parameter" failure.
];

// Strategies where Meta requires a bid_amount alongside bidStrategy. Picking
// any of these flips the wizard to ask for the cap value.
const CAPPED_BID_STRATEGIES = new Set(['LOWEST_COST_WITH_BID_CAP', 'COST_CAP']);

// Conversion location depends on the campaign objective. We surface the
// commonly-used surfaces; "AUTO" lets Meta pick (no destination_type sent).
const CONVERSION_LOCATIONS_BY_OBJECTIVE = {
  OUTCOME_AWARENESS: [{ value: '', label: 'No specific' }],
  OUTCOME_TRAFFIC: [
    { value: '', label: 'No specific' },
    { value: 'WEBSITE', label: 'Website' },
    { value: 'APP', label: 'App' },
    { value: 'MESSENGER', label: 'Messenger' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
    { value: 'PHONE_CALL', label: 'Calls' },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: '', label: 'No specific' },
    { value: 'ON_AD', label: 'On your ad' },
    { value: 'MESSENGER', label: 'Messenger' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
    { value: 'INSTAGRAM_DIRECT', label: 'Instagram DM' },
  ],
  OUTCOME_LEADS: [
    { value: '', label: 'No specific' },
    { value: 'ON_AD', label: 'Instant form (on your ad)' },
    { value: 'MESSENGER', label: 'Messenger' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
    { value: 'PHONE_CALL', label: 'Calls' },
    { value: 'WEBSITE', label: 'Website' },
  ],
  OUTCOME_APP_PROMOTION: [{ value: 'APP', label: 'App' }],
  OUTCOME_SALES: [
    { value: '', label: 'No specific' },
    { value: 'WEBSITE', label: 'Website' },
    { value: 'APP', label: 'App' },
    { value: 'MESSENGER', label: 'Messenger' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
  ],
};

// A small curated list of Meta locale numeric ids — see
// https://www.facebook.com/audiencenetwork/resources/blog/locale-ids
// Sufficient for the wizard; users with niche requirements can extend later.
const LANGUAGE_LOCALES = [
  { id: 6, label: 'English (US)' },
  { id: 24, label: 'English (UK)' },
  { id: 9, label: 'Spanish' },
  { id: 5, label: 'German' },
  { id: 8, label: 'French' },
  { id: 26, label: 'Portuguese' },
  { id: 16, label: 'Italian' },
  { id: 22, label: 'Hindi' },
  { id: 7, label: 'Arabic' },
  { id: 27, label: 'Japanese' },
  { id: 28, label: 'Chinese (Simplified)' },
];

const CTA_OPTIONS = [
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'SUBSCRIBE',
  'CONTACT_US',
  'DOWNLOAD',
  'BOOK_TRAVEL',
  'GET_QUOTE',
  'APPLY_NOW',
  'GET_OFFER',
  'ORDER_NOW',
  'WATCH_MORE',
  'MESSAGE_PAGE',
  'NO_BUTTON',
];

// Short list of common targeting countries — users can extend manually.
const COMMON_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'AE', name: 'UAE' },
  { code: 'SG', name: 'Singapore' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
];

const STEPS = [
  { id: 'campaign', label: 'Campaign', icon: Target },
  { id: 'adset', label: 'Ad Set', icon: Layers },
  { id: 'ad', label: 'Ad', icon: ImageIcon },
  { id: 'review', label: 'Review', icon: Check },
];

// Defaults the wizard restores to whenever it opens fresh OR the user
// confirms a discard. Kept top-level so both `useState` and the discard
// handler can hand back a deep-equal-by-value copy.
const buildInitialForm = () => ({
  // campaign
  campaignName: '',
  objective: 'OUTCOME_TRAFFIC',
  specialAdCategories: [],
  cbo: false,
  campaignBudgetType: 'daily',
  campaignBudget: '',

  // adset
  adSetName: '',
  pageId: '',
  instagramActorId: '',
  optimizationGoal: 'LINK_CLICKS',
  billingEvent: 'IMPRESSIONS',
  bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  bidAmount: '',
  destinationType: '',
  adSetBudgetType: 'daily',
  adSetBudget: '',
  startTime: '',
  endTime: '',
  hasEndTime: false,
  useSavedAudience: false,
  savedAudienceId: '',
  worldwide: false,
  countries: ['IN'],
  ageMin: 18,
  ageMax: 65,
  genders: [],
  locales: [],
  advantageAudience: true,

  // ad
  adName: '',
  // Mutually exclusive: imageFile = uploaded from disk; imageUrl = picked
  // from the user's generated-media library (backend fetches it server-side
  // when the wizard hands it to /upload-image).
  imageFile: null,
  imageUrl: null,
  headline: '',
  primaryText: '',
  description: '',
  linkUrl: '',
  urlTags: '',
  callToAction: 'LEARN_MORE',
});

// ─── small helpers ────────────────────────────────────────────────────────────

const labelize = (s) => (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function FieldLabel({ children, hint }) {
  return (
    <label className="mb-2 flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5 text-sm font-medium text-[#afafaf] 2xl:text-base">
      <span>{children}</span>
      {hint && <span className="text-[11px] font-normal text-white/45 2xl:text-xs">{hint}</span>}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', maxLength, sizingClass = 'px-4 py-2.5 2xl:py-3' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`w-full rounded-full border border-white/5 bg-[#909294]/15 ${sizingClass} text-[13px] placeholder:text-[13px] 2xl:placeholder:text-[15px] text-white placeholder:text-[#AFAFAF] transition-colors hover:border-white/15 focus:border-white/20 focus:outline-none 2xl:text-base`}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, maxLength }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      className="w-full resize-none rounded-[16px] border border-white/5 bg-[#909294]/15 px-5 py-3 text-sm text-white placeholder:text-[#AFAFAF] transition-colors hover:border-white/15 focus:border-white/20 focus:outline-none 2xl:text-base"
    />
  );
}

// Custom select that mirrors the dashboard's account-picker visual: a dark
// floating panel with item buttons that show selected/hover state and a
// check on the active row. Drop-in replacement for the previous native
// <select> — same `value` / `onChange` / `options` API (string array OR
// `{value, label}[]`), so callers don't change.
function SelectInput({ value, onChange, options, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Recompute fixed coords from the trigger's bounding rect — re-run on
  // open, scroll (capture phase to catch the modal body's own scroll), and
  // resize so the portaled menu tracks the trigger.
  useEffect(() => {
    if (!open) return undefined;
    const updatePos = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    updatePos();
    const onDocClick = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inTrigger && !inMenu) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Close on any outside scroll (modal body, window). Ignore scroll inside
    // the menu's own options list — the user scrolling through items
    // shouldn't dismiss the menu.
    const onScroll = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  const items = options.map((o) =>
    typeof o === 'string' ? { value: o, label: labelize(o) } : o,
  );
  const selected = items.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`flex w-full items-center justify-between gap-2 rounded-full border bg-[#909294]/15 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:border-white/15 focus:outline-none 2xl:py-3 2xl:text-base ${
          open ? 'border-white/20' : 'border-white/5'
        }`}
      >
        <span className={`min-w-0 truncate ${selected ? 'text-white' : 'text-[#AFAFAF]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/55 transition-transform duration-150 ${
            open ? 'rotate-180 text-white/85' : ''
          }`}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
              className="z-[200] overflow-hidden rounded-xl border border-white/12 bg-[#0F0F0F]/98 shadow-xl backdrop-blur-xl"
            >
              <div className="scrollbar-thin max-h-25 overflow-y-auto p-1.5 2xl:max-h-30">
                {items.map((o) => {
                  const isSelected = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-[7px] 2xl:py-2 text-left text-[11px] font-medium transition-all 2xl:text-sm ${
                        isSelected
                          ? 'bg-white/10 text-white'
                          : 'text-white/85 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="min-w-0 truncate">{o.label}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ─── toggle ───────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 2xl:h-6 2xl:w-11 ${
        value ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]' : 'bg-white/15'
      } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 left-1 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 2xl:h-4 2xl:w-4 ${
          value ? 'translate-x-4 2xl:translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function InlineDropdown({ value, options, onChange, renderLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[90px] items-center justify-between gap-1 rounded-sm px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#464951]"
      >
        {renderLabel(value)}
        <ChevronDown size={14} className="opacity-70" />
      </button>
      {open && (
        <div className="scrollbar-thin absolute top-full left-0 z-[60] mt-1 max-h-[220px] w-max min-w-[110px] overflow-y-auto rounded-md border border-[#3a3c44] bg-[#303030] py-1 shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => {
                if (opt.disabled) return;
                onChange(opt.value);
                setOpen(false);
              }}
              className={`mt-1 block w-full px-3 py-1.5 text-left text-sm ${
                opt.disabled
                  ? 'cursor-not-allowed text-white/30'
                  : opt.value === value
                  ? 'bg-[#464951] text-white'
                  : 'text-white/80 hover:bg-[#464951] hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Scroll-list column for hour/minute selection — visually mirrors the
// calendar's selected-date pill so the time picker reads as part of the
// same control rather than a separate native widget.
function TimeColumn({ values, selected, onChange, label }) {
  const ref = useRef(null);

  // Center the current selection whenever the popover opens or the value
  // changes externally — without this the user would have to scroll to
  // confirm what's selected on mid/late hours.
  useEffect(() => {
    const node = ref.current?.querySelector('[data-selected="true"]');
    if (node) node.scrollIntoView({ block: 'center' });
  }, [selected]);

  return (
    <div className="flex flex-col items-center">
      <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">
        {label}
      </span>
      <div ref={ref} className="scrollbar-hide h-[200px] w-12 overflow-y-auto pr-0.5">
        {values.map((v) => {
          const isSel = v === selected;
          return (
            <button
              key={v}
              type="button"
              data-selected={isSel}
              onClick={() => onChange(v)}
              className={`my-0.5 block w-full rounded py-1.5 text-center text-xs transition-colors ${
                isSel ? 'bg-[#434343] text-white' : 'text-white/70 hover:bg-[#3a3c44] hover:text-white'
              }`}
            >
              {String(v).padStart(2, '0')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── datetime picker ──────────────────────────────────────────────────────────
// Custom replacement for the native datetime-local input — gives us full
// styling control so the popover matches the rest of the modal (and the
// usage-graph picker on the Profile screen) instead of falling back to the
// browser's native chrome.
function DateTimePicker({ value, onChange, disabled, minDate }) {
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState(null);
  const [tempTime, setTempTime] = useState('');
  const ref = useRef(null);

  // Sync popover state from the external value whenever the popover opens
  // — keeps Cancel actually cancelling (it discards in-progress edits).
  useEffect(() => {
    if (!open) return;
    if (value) {
      const d = new Date(value);
      setTempDate(d);
      setTempTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      setTempDate(null);
      setTempTime('');
    }
  }, [open, value]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const display = useMemo(() => {
    if (!value) return 'dd-mm-yyyy --:--';
    const d = new Date(value);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${mins}`;
  }, [value]);

  const handleApply = () => {
    if (!tempDate) {
      onChange('');
      setOpen(false);
      return;
    }
    const [h, m] = (tempTime || '00:00').split(':');
    const result = new Date(tempDate);
    result.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
    const yyyy = result.getFullYear();
    const mm = String(result.getMonth() + 1).padStart(2, '0');
    const dd = String(result.getDate()).padStart(2, '0');
    const hh = String(result.getHours()).padStart(2, '0');
    const mins = String(result.getMinutes()).padStart(2, '0');
    // datetime-local format so the consumer sees the same string shape it
    // got back from the previous native input.
    onChange(`${yyyy}-${mm}-${dd}T${hh}:${mins}`);
    setOpen(false);
  };

  const monthOptions = MONTHS.map((m, i) => ({ value: i, label: m }));
  const yearOptions = YEARS.map((y) => ({ value: y, label: y.toString() }));

  const [hh, mm] = (tempTime || '00:00').split(':');
  const tempHour = Number(hh) || 0;
  const tempMinute = Number(mm) || 0;
  const setHour = (h) =>
    setTempTime(`${String(h).padStart(2, '0')}:${String(tempMinute).padStart(2, '0')}`);
  const setMinute = (m) =>
    setTempTime(`${String(tempHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between rounded-full border border-white/5 bg-[#909294]/15 px-4 py-2.5 text-[13px] transition-colors hover:border-white/15 focus:border-white/20 focus:outline-none 2xl:py-3 2xl:text-base ${
          disabled ? 'cursor-not-allowed opacity-40' : ''
        }`}
      >
        <span className={value ? 'text-white' : 'text-[#AFAFAF]'}>{display}</span>
        <CalendarDays className="h-4 w-4 text-white/55" />
      </button>
      {open && (
        <div className="wiz-dt-pop absolute top-[10%] -right-[10%] 2xl:top-full 2xl:right-0 z-50 mt-1 scale-75 2xl:scale-100 rounded-md border border-[#3a3c44] bg-[#303030] shadow-lg">
          {/* Scoped overrides — only apply inside .wiz-dt-pop, so global
              react-date-range styles (used elsewhere in the app) are
              untouched. font-size shrinks the whole calendar uniformly
              since rdr's layout is em-based. */}
          <style>{`
            .wiz-dt-pop .rdrCalendarWrapper { font-size: 10px !important; }
            .wiz-dt-pop .rdrDateDisplayWrapper { display: none !important; }
            .wiz-dt-pop .rdrMonth { padding: 0 0.5em !important; }
            .wiz-dt-pop .rdrDayNumber span { font-size: 12px !important; }
            .wiz-dt-pop .rdrWeekDay { font-size: 11px !important; }
          `}</style>
          <div className="flex">
            <Calendar
              date={tempDate || new Date()}
              onChange={setTempDate}
              color="#434343"
              minDate={minDate}
              maxDate={undefined}
              navigatorRenderer={(currentFocusedDate, changeShownDate) => {
                const month = currentFocusedDate.getMonth();
                const year = currentFocusedDate.getFullYear();
                const today = new Date();
                const atOrAfterCurrentMonth =
                  year > today.getFullYear() ||
                  (year === today.getFullYear() && month >= today.getMonth());
                // Mark future months as disabled (still visible) when the
                // focused year is the current year — keeps the dropdown
                // consistent with the disabled next button while preserving
                // the full Jan–Dec list for visual context.
                const visibleMonthOptions =
                  year === today.getFullYear()
                    ? monthOptions.map((opt) => ({
                        ...opt,
                        disabled: opt.value > today.getMonth(),
                      }))
                    : monthOptions;
                return (
                  <div className="flex items-center justify-between px-2 pt-3 pb-2">
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md bg-[#464951] text-white hover:bg-[#5b5e67]"
                      onClick={() => {
                        const d = new Date(currentFocusedDate);
                        d.setMonth(d.getMonth() - 1);
                        changeShownDate(d);
                      }}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="flex items-center gap-1">
                      <InlineDropdown
                        value={month}
                        options={visibleMonthOptions}
                        onChange={(val) => {
                          const d = new Date(currentFocusedDate);
                          d.setMonth(val);
                          changeShownDate(d);
                        }}
                        renderLabel={(v) => MONTHS[v]}
                      />
                      <InlineDropdown
                        value={year}
                        options={yearOptions}
                        onChange={(val) => {
                          const d = new Date(currentFocusedDate);
                          d.setFullYear(val);
                          changeShownDate(d);
                        }}
                        renderLabel={(v) => v}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={atOrAfterCurrentMonth}
                      className="flex size-7 items-center justify-center rounded-md bg-[#464951] text-white hover:bg-[#5b5e67] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#464951]"
                      onClick={() => {
                        const d = new Date(currentFocusedDate);
                        d.setMonth(d.getMonth() + 1);
                        changeShownDate(d);
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                );
              }}
            />
            <div className="flex items-start gap-1 border-l border-[#3a3c44] px-2 pt-3 pb-2">
              <TimeColumn values={HOURS} selected={tempHour} onChange={setHour} label="Hr" />
              <TimeColumn values={MINUTES} selected={tempMinute} onChange={setMinute} label="Min" />
            </div>
          </div>
          <div className="flex items-center mt-3 justify-end gap-2 p-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm border border-[#EFEFEF]/60 bg-transparent px-6 py-1 text-sm font-semibold text-[#E3E3E3] hover:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="rounded-sm bg-white px-8 py-1 text-sm font-bold text-[#151515] shadow-sm hover:bg-white/70"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GradientCheckbox({ checked, onChange, size = 'sm' }) {
  const boxDim = size === 'md' ? 'h-4 w-4 2xl:h-5 2xl:w-5' : 'h-3.5 w-3.5 2xl:h-4.5 2xl:w-4.5';
  const iconDim = size === 'md' ? 'h-3 w-3 2xl:h-3.5 2xl:w-3.5' : 'h-2.5 w-2.5 2xl:h-3 2xl:w-3';
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded ${boxDim} ${
        checked
          ? 'bg-white'
          : 'border border-white/50 hover:border-white/70'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      {checked && <Check className={`text-black ${iconDim}`} strokeWidth={3} />}
    </span>
  );
}

function SegButton({ active, onClick, children }) {
  return (
    <div
      className={`flex-1 rounded-full p-[1px] transition-all ${
        active
          ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
          : 'bg-white/8 hover:bg-white/15'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-full bg-[#1d1d1d] px-3 py-1.5 text-xs font-medium transition-all 2xl:py-2.5 2xl:text-sm ${
          active ? 'text-white' : 'text-white/55 hover:text-white/80'
        }`}
      >
        {children}
      </button>
    </div>
  );
}

// ─── progress rail ────────────────────────────────────────────────────────────

function StepRail({ step }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center gap-1 2xl:gap-1.5">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < idx;
        const active = i === idx;
        return (
          <React.Fragment key={s.id}>
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all 2xl:px-3 2xl:py-1.5 2xl:text-sm ${
                active
                  ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                  : done
                  ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border border-white/8 bg-white/3 text-white/30'
              }`}
            >
              {done ? <Check className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" /> : <Icon className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`h-0.5 w-2 2xl:w-3 ${i < idx ? 'bg-emerald-400/30' : 'bg-white/15'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── step 1: campaign ─────────────────────────────────────────────────────────

function CampaignStep({ form, setForm, currency }) {
  const toggleCategory = (cat) => {
    setForm((f) => {
      const has = f.specialAdCategories.includes(cat);
      return {
        ...f,
        specialAdCategories: has
          ? f.specialAdCategories.filter((c) => c !== cat)
          : [...f.specialAdCategories, cat],
      };
    });
  };

  return (
    <div className="flex flex-col gap-5 lg:gap-6 2xl:gap-7">
      <div>
        <FieldLabel>Campaign name</FieldLabel>
        <TextInput
          value={form.campaignName}
          onChange={(v) => setForm((f) => ({ ...f, campaignName: v }))}
          placeholder="e.g. Spring Sale — Traffic"
          maxLength={120}
        />
      </div>

      <div>
        <FieldLabel hint="Mirrors what Meta Ads Manager calls the buying objective">Objective</FieldLabel>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:gap-3">
          {OBJECTIVES.map(({ value, label, desc, icon: Icon, beta }) => {
            const selected = form.objective === value;
            return (
              <div
                key={value}
                className={`rounded-2xl p-[1px] transition-all ${
                  selected
                    ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                    : 'bg-white/8 hover:bg-white/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, objective: value }))}
                  className="group flex h-full w-full items-start gap-3 rounded-2xl bg-[#181818] p-3 text-left transition-all hover:bg-[#1d1d1d] 2xl:p-4"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg 2xl:h-10 2xl:w-10 ${
                      selected ? 'bg-gradient-to-br from-[#02C8C4] to-[#5867EB] text-white' : 'bg-white/5 text-white/55'
                    }`}
                  >
                    <Icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold 2xl:text-base ${selected ? 'text-white' : 'text-white/85'}`}>{label}</p>
                      {beta && (
                        <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 2xl:text-[10px]">
                          Beta
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-white/60 2xl:text-sm">{desc}</p>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <FieldLabel hint="Required if your ad is in a regulated category">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> Special ad categories
          </span>
        </FieldLabel>
        <div className="flex flex-wrap gap-2">
          {SPECIAL_AD_CATEGORIES.map((c) => {
            const selected = form.specialAdCategories.includes(c.value);
            return (
              <div
                key={c.value}
                className={`rounded-full p-[1px] transition-all ${
                  selected
                    ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                    : 'bg-white/8 hover:bg-white/15'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(c.value)}
                  className={`rounded-full bg-[#1d1d1d] px-3 py-1 text-xs font-medium transition-all 2xl:px-4 2xl:py-1.5 2xl:text-sm ${
                    selected ? 'text-white' : 'text-white/55 hover:text-white/80'
                  }`}
                >
                  {c.label}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget allocation — Campaign Budget Optimization (CBO) puts the
          budget on the campaign and disables per-adset budgets. */}
      <div className="rounded-2xl border border-white/12 bg-white/4 p-4 2xl:p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-white 2xl:text-base">
              <Wallet className="h-4 w-4 2xl:h-5 2xl:w-5" /> Advantage campaign budget (CBO)
            </p>
            <p className="mt-1 text-xs text-white/60 2xl:text-sm">
              Meta distributes the budget across ad sets automatically
            </p>
          </div>
          <Toggle
            value={form.cbo}
            onChange={(v) => setForm((f) => ({ ...f, cbo: v }))}
          />
        </div>

        {form.cbo && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3 2xl:gap-6">
            <div className="md:col-span-1">
              <FieldLabel>Budget type</FieldLabel>
              <div className="flex gap-2">
                <SegButton
                  active={form.campaignBudgetType === 'daily'}
                  onClick={() => setForm((f) => ({ ...f, campaignBudgetType: 'daily' }))}
                >
                  Daily
                </SegButton>
                <SegButton
                  active={form.campaignBudgetType === 'lifetime'}
                  onClick={() => setForm((f) => ({ ...f, campaignBudgetType: 'lifetime' }))}
                >
                  Lifetime
                </SegButton>
              </div>
            </div>
            <div className="md:col-span-2">
              <FieldLabel hint={`In ${currency || 'account currency'} · per ${form.campaignBudgetType === 'lifetime' ? 'campaign' : 'day'}`}>
                {form.campaignBudgetType === 'lifetime' ? 'Lifetime budget' : 'Daily budget'}
              </FieldLabel>
              <TextInput
                type="number"
                value={form.campaignBudget}
                onChange={(v) => setForm((f) => ({ ...f, campaignBudget: v }))}
                placeholder="e.g. 1000"
                sizingClass="px-4 py-[7px] 2xl:py-2.5"
              />
            </div>
            <div className={CAPPED_BID_STRATEGIES.has(form.bidStrategy) ? 'md:col-span-2' : 'md:col-span-3'}>
              <FieldLabel>Bid strategy</FieldLabel>
              <SelectInput
                value={form.bidStrategy}
                onChange={(v) => setForm((f) => ({ ...f, bidStrategy: v }))}
                options={BID_STRATEGIES}
              />
            </div>
            {CAPPED_BID_STRATEGIES.has(form.bidStrategy) && (
              <div>
                <FieldLabel hint={`In ${currency || 'account currency'}`}>
                  {form.bidStrategy === 'COST_CAP' ? 'Cost cap' : 'Bid cap'}
                </FieldLabel>
                <TextInput
                  type="number"
                  value={form.bidAmount}
                  onChange={(v) => setForm((f) => ({ ...f, bidAmount: v }))}
                  placeholder="e.g. 50"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── step 2: ad set ───────────────────────────────────────────────────────────

function AdSetStep({ form, setForm, pages, loadingPages, savedAudiences, loadingSavedAudiences, currency }) {
  const optimizationOptions = OPTIMIZATION_GOALS_BY_OBJECTIVE[form.objective] || ['LINK_CLICKS'];
  const conversionOptions = CONVERSION_LOCATIONS_BY_OBJECTIVE[form.objective] || [{ value: '', label: 'No specific' }];

  // If the previously-picked goal/location isn't valid for the new objective,
  // fall back to the first allowed value so we never POST something Meta will
  // reject.
  useEffect(() => {
    if (!optimizationOptions.includes(form.optimizationGoal)) {
      setForm((f) => ({ ...f, optimizationGoal: optimizationOptions[0] }));
    }
    if (!conversionOptions.find((o) => o.value === form.destinationType)) {
      setForm((f) => ({ ...f, destinationType: conversionOptions[0].value }));
    }
  }, [form.objective]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPage = useMemo(() => pages.find((p) => p.id === form.pageId), [pages, form.pageId]);

  // When the page changes, default the IG identity to the page's connected
  // Instagram account if one exists. The user can clear it to fall back to
  // the page-only identity.
  useEffect(() => {
    if (selectedPage?.instagramAccount?.id && !form.instagramActorId) {
      setForm((f) => ({ ...f, instagramActorId: selectedPage.instagramAccount.id }));
    }
  }, [selectedPage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCountry = (code) => {
    setForm((f) => {
      const has = f.countries.includes(code);
      return { ...f, countries: has ? f.countries.filter((c) => c !== code) : [...f.countries, code] };
    });
  };

  const toggleGender = (g) => {
    setForm((f) => {
      const has = f.genders.includes(g);
      return { ...f, genders: has ? f.genders.filter((x) => x !== g) : [...f.genders, g] };
    });
  };

  const toggleLocale = (id) => {
    setForm((f) => {
      const has = f.locales.includes(id);
      return { ...f, locales: has ? f.locales.filter((x) => x !== id) : [...f.locales, id] };
    });
  };

  const cboBudgetUnit = form.cbo
    ? form.campaignBudgetType === 'lifetime' ? 'lifetime (campaign)' : 'daily (campaign)'
    : form.adSetBudgetType === 'lifetime' ? 'lifetime' : 'daily';

  return (
    <div className="flex flex-col gap-5 lg:gap-6 2xl:gap-7">
      <div>
        <FieldLabel>Ad set name</FieldLabel>
        <TextInput
          value={form.adSetName}
          onChange={(v) => setForm((f) => ({ ...f, adSetName: v }))}
          placeholder="e.g. India · 18-34 · Interests"
          maxLength={120}
        />
      </div>

      {/* identities ─ page + IG account */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:gap-6">
        <div>
          <FieldLabel hint="Page used as the advertiser identity">Facebook Page</FieldLabel>
          {loadingPages ? (
            <div className="flex items-center gap-2 rounded-full border border-white/5 bg-[#909294]/15 px-4 py-2.5 text-sm text-white/65 2xl:py-3 2xl:text-base">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading pages…
            </div>
          ) : pages.length === 0 ? (
            <div className="flex items-center gap-2 rounded-full border border-[#15DCFF]/25 bg-[#15DCFF]/8 px-4 py-2.5 text-sm text-[#15DCFF] 2xl:py-3 2xl:text-base">
              <AlertCircle className="h-4 w-4" />
              No Facebook Pages found for this account
            </div>
          ) : (
            <SelectInput
              value={form.pageId}
              onChange={(v) => setForm((f) => ({ ...f, pageId: v, instagramActorId: '' }))}
              options={[
                { value: '', label: 'Select a page…' },
                ...pages.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          )}
        </div>
        <div>
          <FieldLabel hint="Optional · used for IG placements">
            <span className="flex items-center gap-1.5">
              <Instagram className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> Instagram account
            </span>
          </FieldLabel>
          {selectedPage?.instagramAccount ? (
            <SelectInput
              value={form.instagramActorId}
              onChange={(v) => setForm((f) => ({ ...f, instagramActorId: v }))}
              options={[
                { value: '', label: 'Use page only' },
                {
                  value: selectedPage.instagramAccount.id,
                  label: selectedPage.instagramAccount.username
                    ? `@${selectedPage.instagramAccount.username}`
                    : selectedPage.instagramAccount.name || selectedPage.instagramAccount.id,
                },
              ]}
            />
          ) : (
            <div className="rounded-full border border-white/5 bg-[#909294]/15 px-4 py-2.5 text-sm text-white/55 2xl:py-3 2xl:text-base">
              {form.pageId ? 'No IG account linked to this page' : 'Pick a page first'}
            </div>
          )}
        </div>
      </div>

      {/* delivery ─ optimization, billing, conversion location */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 2xl:gap-6">
        <div>
          <FieldLabel>Performance goal</FieldLabel>
          <SelectInput
            value={form.optimizationGoal}
            onChange={(v) => setForm((f) => ({ ...f, optimizationGoal: v }))}
            options={optimizationOptions}
          />
        </div>
        <div>
          <FieldLabel>Billing event</FieldLabel>
          <SelectInput
            value={form.billingEvent}
            onChange={(v) => setForm((f) => ({ ...f, billingEvent: v }))}
            options={BILLING_EVENTS}
          />
        </div>
        <div>
          <FieldLabel>Conversion location</FieldLabel>
          <SelectInput
            value={form.destinationType}
            onChange={(v) => setForm((f) => ({ ...f, destinationType: v }))}
            options={conversionOptions}
          />
        </div>
      </div>

      <div className="flex flex-col gap-5 2xl:gap-6">
        {/* budget ─ adset-level, only when CBO is OFF */}
        <div className="rounded-2xl border border-white/12 bg-white/4 p-4 2xl:p-5">
          <div className="mb-4 flex items-center gap-2 text-white">
            <Wallet className="h-4 w-4 2xl:h-5 2xl:w-5" />
            <p className="text-sm font-bold text-white 2xl:text-base">Budget</p>
            <span className="ml-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/55 2xl:text-xs">
              {form.cbo ? 'Campaign-level' : 'Ad-set level'}
            </span>
          </div>
          {form.cbo ? (
            <div className="rounded-2xl border border-[#15DCFF]/20 bg-[#15DCFF]/5 px-4 py-3 text-xs leading-relaxed text-white/75 2xl:text-sm">
              Campaign Budget Optimization is on — budget is set on the campaign (
              <b className="text-white">
                {form.campaignBudget || 0} {currency} {cboBudgetUnit}
              </b>
              ). Per-adset budgets are disabled.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 2xl:gap-5">
              <div className="md:col-span-1">
                <FieldLabel>Budget type</FieldLabel>
                <div className="flex gap-2">
                  <SegButton
                    active={form.adSetBudgetType === 'daily'}
                    onClick={() => setForm((f) => ({ ...f, adSetBudgetType: 'daily' }))}
                  >
                    Daily
                  </SegButton>
                  <SegButton
                    active={form.adSetBudgetType === 'lifetime'}
                    onClick={() => setForm((f) => ({ ...f, adSetBudgetType: 'lifetime' }))}
                  >
                    Lifetime
                  </SegButton>
                </div>
              </div>
              <div className="md:col-span-2">
                <FieldLabel
                  hint={`In ${currency || 'account currency'} · per ${form.adSetBudgetType === 'lifetime' ? 'ad set' : 'day'}`}
                >
                  {form.adSetBudgetType === 'lifetime' ? 'Lifetime budget' : 'Daily budget'}
                </FieldLabel>
                <TextInput
                  type="number"
                  value={form.adSetBudget}
                  onChange={(v) => setForm((f) => ({ ...f, adSetBudget: v }))}
                  placeholder="e.g. 500"
                  sizingClass="px-4 py-[7px] 2xl:py-2.5"
                />
              </div>
              <div
                className={
                  CAPPED_BID_STRATEGIES.has(form.bidStrategy) ? 'md:col-span-2' : 'md:col-span-3'
                }
              >
                <FieldLabel>Bid strategy</FieldLabel>
                <SelectInput
                  value={form.bidStrategy}
                  onChange={(v) => setForm((f) => ({ ...f, bidStrategy: v }))}
                  options={BID_STRATEGIES}
                />
              </div>
              {CAPPED_BID_STRATEGIES.has(form.bidStrategy) && (
                <div>
                  <FieldLabel hint={`In ${currency || 'account currency'}`}>
                    {form.bidStrategy === 'COST_CAP' ? 'Cost cap' : 'Bid cap'}
                  </FieldLabel>
                  <TextInput
                    type="number"
                    value={form.bidAmount}
                    onChange={(v) => setForm((f) => ({ ...f, bidAmount: v }))}
                    placeholder="e.g. 50"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* schedule */}
        <div className="rounded-2xl border border-white/12 bg-white/4 p-4 2xl:p-5">
          <div className="mb-4 flex items-center gap-2 text-white">
            <CalendarDays className="h-4 w-4 2xl:h-5 2xl:w-5" />
            <p className="text-sm font-bold text-white 2xl:text-base">Schedule</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:gap-5">
            <div>
              <FieldLabel hint="Defaults to now if blank">Start date</FieldLabel>
              <DateTimePicker
                value={form.startTime}
                onChange={(v) => setForm((f) => ({ ...f, startTime: v }))}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-[#afafaf] 2xl:text-base">
                <span>End date</span>
                <label className="flex items-center gap-1.5 text-xs text-white/65 normal-case 2xl:text-sm">
                  Set an end date
                  <GradientCheckbox
                    checked={form.hasEndTime}
                    onChange={(v) => setForm((f) => ({ ...f, hasEndTime: v }))}
                  />
                </label>
              </div>
              <DateTimePicker
                value={form.endTime}
                onChange={(v) => setForm((f) => ({ ...f, endTime: v }))}
                disabled={!form.hasEndTime}
                minDate={form.startTime ? new Date(form.startTime) : undefined}
              />
              {form.adSetBudgetType === 'lifetime' && !form.cbo && !form.hasEndTime && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-300/80 2xl:text-sm">
                  <AlertCircle className="h-3.5 w-3.5" /> Lifetime budgets require an end date
                </p>
              )}
            </div>
          </div>
        </div>

        {/* audience ─ saved or custom */}
        <div className="rounded-2xl border border-white/12 bg-white/4 p-4 2xl:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white">
              <Sparkles className="h-4 w-4 2xl:h-5 2xl:w-5" />
              <p className="text-sm font-bold text-white 2xl:text-base">Audience</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-white/75 2xl:text-sm">
              Use a saved audience
              <Toggle
                value={form.useSavedAudience}
                onChange={(v) => setForm((f) => ({ ...f, useSavedAudience: v }))}
              />
            </label>
          </div>

          {form.useSavedAudience ? (
            loadingSavedAudiences ? (
              <div className="flex items-center gap-2 rounded-full border border-white/5 bg-[#909294]/15 px-4 py-2.5 text-sm text-white/65 2xl:py-3 2xl:text-base">
                <Loader2 className="h-4 w-4 animate-spin text-[#15DCFF]" /> Loading saved audiences…
              </div>
            ) : savedAudiences.length === 0 ? (
              <div className="flex items-center gap-2 rounded-full border border-[#15DCFF]/25 bg-[#15DCFF]/8 px-4 py-2.5 text-sm text-[#15DCFF] 2xl:py-3 2xl:text-base">
                <AlertCircle className="h-4 w-4" />
                No saved audiences in this ad account — create one in Meta Ads Manager first
              </div>
            ) : (
              <SelectInput
                value={form.savedAudienceId}
                onChange={(v) => setForm((f) => ({ ...f, savedAudienceId: v }))}
                options={[
                  { value: '', label: 'Pick a saved audience…' },
                  ...savedAudiences.map((a) => ({
                    value: a.id,
                    label: a.size ? `${a.name} (~${Number(a.size).toLocaleString()})` : a.name,
                  })),
                ]}
              />
            )
          ) : (
            <div className="flex flex-col gap-5 px-1 2xl:gap-7">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-[#afafaf] 2xl:text-base">
                  <span className="flex items-center gap-1.5">
                    <Globe2 className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> Locations
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-white/65 normal-case 2xl:text-sm">
                    Worldwide
                    <GradientCheckbox
                      checked={form.worldwide}
                      onChange={(v) => setForm((f) => ({ ...f, worldwide: v }))}
                    />
                  </label>
                </div>
                {!form.worldwide && (
                  <div className="flex flex-wrap gap-2">
                    {COMMON_COUNTRIES.map((c) => {
                      const selected = form.countries.includes(c.code);
                      return (
                        <div
                          key={c.code}
                          className={`rounded-full p-[1px] transition-all ${
                            selected
                              ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                              : 'bg-white/8 hover:bg-white/15'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCountry(c.code)}
                            className={`rounded-full bg-[#1d1d1d] px-3 py-1.5 text-xs font-medium transition-all 2xl:px-4 2xl:py-1.5 2xl:text-sm ${
                              selected ? 'text-white' : 'text-white/55 hover:text-white/80'
                            }`}
                          >
                            {c.name}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 2xl:gap-5">
                <div>
                  <FieldLabel>Min age</FieldLabel>
                  <TextInput
                    type="number"
                    value={form.ageMin}
                    onChange={(v) => setForm((f) => ({ ...f, ageMin: v }))}
                    placeholder="18"
                    sizingClass="px-4 py-[7px] 2xl:py-2.5"
                  />
                </div>
                <div>
                  <FieldLabel>Max age</FieldLabel>
                  <TextInput
                    type="number"
                    value={form.ageMax}
                    onChange={(v) => setForm((f) => ({ ...f, ageMax: v }))}
                    placeholder="65"
                    sizingClass="px-4 py-[7px] 2xl:py-2.5"
                  />
                </div>
                <div>
                  <FieldLabel hint="Empty = all genders">Gender</FieldLabel>
                  <div className="flex gap-2">
                    {[
                      { id: 1, label: 'Male' },
                      { id: 2, label: 'Female' },
                    ].map((g) => {
                      const selected = form.genders.includes(g.id);
                      return (
                        <div
                          key={g.id}
                          className={`flex-1 rounded-full p-[1px] transition-all ${
                            selected
                              ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                              : 'bg-white/8 hover:bg-white/15'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleGender(g.id)}
                            className={`w-full rounded-full bg-[#1d1d1d] px-3 py-2 text-xs font-medium transition-all 2xl:py-2.5 2xl:text-sm ${
                              selected ? 'text-white' : 'text-white/55 hover:text-white/80'
                            }`}
                          >
                            {g.label}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <FieldLabel hint="Optional · empty = all languages">
                  <span className="flex items-center gap-1.5">
                    <Languages className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> Languages
                  </span>
                </FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGE_LOCALES.map((l) => {
                    const selected = form.locales.includes(l.id);
                    return (
                      <div
                        key={l.id}
                        className={`rounded-full p-[1px] transition-all ${
                          selected
                            ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                            : 'bg-white/8 hover:bg-white/15'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleLocale(l.id)}
                          className={`rounded-full bg-[#1d1d1d] px-3 py-1.5 text-xs font-medium transition-all 2xl:px-4 2xl:py-1.5 2xl:text-sm ${
                            selected ? 'text-white' : 'text-white/55 hover:text-white/80'
                          }`}
                        >
                          {l.label}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/2 px-4 py-3.5 2xl:px-5 2xl:py-4">
                <GradientCheckbox
                  checked={form.advantageAudience}
                  onChange={(v) => setForm((f) => ({ ...f, advantageAudience: v }))}
                  size="md"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white 2xl:text-base">
                    Advantage+ Audience
                  </p>
                  <p className="mt-0.5 text-xs text-white/60 2xl:text-sm">
                    Let Meta expand reach beyond your hand-picked targeting
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── step 3: ad ───────────────────────────────────────────────────────────────

function AdStep({ form, setForm, currency }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  // Default to whichever source already has a value (so re-entering the
  // step preserves the user's last choice). Otherwise default to upload.
  const [imageSource, setImageSource] = useState(
    form.imageUrl ? 'library' : 'upload',
  );

  // Build a preview URL for whichever source is active. For uploaded files
  // we createObjectURL and revoke on change to avoid leaks. For library
  // items we just point at the saved URL.
  useEffect(() => {
    if (form.imageUrl) {
      setPreview(form.imageUrl);
      return undefined;
    }
    if (!form.imageFile) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(form.imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [form.imageFile, form.imageUrl]);

  const onPick = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      globalToast.error('Please pick an image file (JPG, PNG, etc.)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      globalToast.error('Image must be under 10MB');
      return;
    }
    // Picking a fresh file clears any library selection — only one source
    // is valid at a time.
    setForm((f) => ({ ...f, imageFile: file, imageUrl: null }));
  };

  const onPickFromLibrary = (url) => {
    if (!url) return;
    setForm((f) => ({ ...f, imageUrl: url, imageFile: null }));
  };

  const switchSource = (next) => {
    if (next === imageSource) return;
    setImageSource(next);
    // Clear the *other* source so the chosen tab's state is the source of
    // truth. Without this, switching tabs would leave a stale value behind
    // that the upload step would still consume.
    if (next === 'upload') {
      setForm((f) => ({ ...f, imageUrl: null }));
    } else {
      setForm((f) => ({ ...f, imageFile: null }));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:gap-6">
      <div className="flex flex-col gap-5 2xl:gap-7">
        <div>
          <FieldLabel>Ad name</FieldLabel>
          <TextInput
            value={form.adName}
            onChange={(v) => setForm((f) => ({ ...f, adName: v }))}
            placeholder="e.g. Spring Sale — Hero Image"
            maxLength={120}
          />
        </div>

        <div>
          <FieldLabel>Image</FieldLabel>
          {/* Source tabs — let the user pick between uploading from disk or
              re-using a previously generated image from their library. */}
          <div className="mb-3 inline-flex rounded-xl bg-white/5 p-0.5">
            {[
              { value: 'upload', label: 'Upload your image' },
              { value: 'library', label: 'Select from library' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => switchSource(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all 2xl:text-sm ${
                  imageSource === opt.value
                    ? 'bg-white text-black'
                    : 'text-white/65 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {imageSource === 'upload' ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/2 px-4 py-3.5 text-left transition-all hover:border-white/25 hover:bg-white/5 2xl:py-4"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 2xl:h-11 2xl:w-11">
                  <Upload className="h-4 w-4 text-white/55 2xl:h-5 2xl:w-5" />
                </div>
                <div className="flex-1 truncate">
                  <p className="text-sm font-semibold text-white 2xl:text-base">
                    {form.imageFile ? form.imageFile.name : 'Click to upload an image'}
                  </p>
                  <p className="mt-0.5 text-xs text-white/55 2xl:text-sm">JPG or PNG · up to 10MB · 1:1 recommended</p>
                </div>
              </button>
            </>
          ) : (
            <LibraryPicker
              type="image"
              selectedUrl={form.imageUrl}
              onPick={onPickFromLibrary}
            />
          )}
        </div>

        <div>
          <FieldLabel hint="Shown above the image">Primary text</FieldLabel>
          <TextArea
            value={form.primaryText}
            onChange={(v) => setForm((f) => ({ ...f, primaryText: v }))}
            placeholder="Tell people what makes this ad worth tapping"
            rows={3}
            maxLength={2000}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:gap-5">
          <div>
            <FieldLabel>Headline</FieldLabel>
            <TextInput
              value={form.headline}
              onChange={(v) => setForm((f) => ({ ...f, headline: v }))}
              placeholder="Bold one-liner"
              maxLength={255}
            />
          </div>
          <div>
            <FieldLabel hint="Optional">Description</FieldLabel>
            <TextInput
              value={form.description}
              onChange={(v) => setForm((f) => ({ ...f, description: v }))}
              placeholder="Sub-headline"
              maxLength={255}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:gap-5">
          <div>
            <FieldLabel>Destination URL</FieldLabel>
            <TextInput
              value={form.linkUrl}
              onChange={(v) => setForm((f) => ({ ...f, linkUrl: v }))}
              placeholder="https://example.com/landing"
            />
          </div>
          <div>
            <FieldLabel>Call to action</FieldLabel>
            <SelectInput
              value={form.callToAction}
              onChange={(v) => setForm((f) => ({ ...f, callToAction: v }))}
              options={CTA_OPTIONS}
            />
          </div>
        </div>

        <div>
          <FieldLabel hint="Optional · appended on click via Meta's url_tags">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Link2 className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> URL parameters
            </span>
          </FieldLabel>
          <TextInput
            value={form.urlTags}
            onChange={(v) => setForm((f) => ({ ...f, urlTags: v }))}
            placeholder="utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}"
          />
          <p className="mt-1.5 text-xs text-white/35 2xl:text-sm">
            Use Meta dynamic params like <code className="rounded bg-white/5 px-1 text-white/55">{'{{campaign.name}}'}</code> /
            <code className="ml-1 rounded bg-white/5 px-1 text-white/55">{'{{adset.id}}'}</code>
          </p>
        </div>
      </div>

      {/* live preview */}
      <div>
        <FieldLabel>Preview</FieldLabel>
        <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0D0D0D]">
          <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-3 2xl:px-5 2xl:py-3.5">
            <div className="h-8 w-8 rounded-full bg-white/10 2xl:h-9 2xl:w-9" />
            <div>
              <p className="text-sm font-semibold text-white 2xl:text-base">Sponsored</p>
              <p className="text-xs text-white/35 2xl:text-sm">Facebook · Feed</p>
            </div>
          </div>
          {form.primaryText && (
            <p className="px-4 pt-3 text-sm leading-relaxed text-white/85 2xl:px-5 2xl:text-base">{form.primaryText}</p>
          )}
          <div className="mt-3 aspect-square w-full overflow-hidden bg-[#111]">
            {preview ? (
              <img src={preview} alt="ad preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                <ImageIcon className="h-10 w-10 text-white/15 2xl:h-12 2xl:w-12" />
                <span className="text-sm text-white/30 2xl:text-base">No image yet</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-3 2xl:px-5 2xl:py-4">
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-wider text-white/35 2xl:text-xs">
                {form.linkUrl ? new URL(maybeUrl(form.linkUrl) || 'https://example.com').hostname : 'example.com'}
              </p>
              {form.headline && (
                <p className="mt-0.5 truncate text-sm font-bold text-white 2xl:text-base">{form.headline}</p>
              )}
              {form.description && (
                <p className="mt-0.5 truncate text-xs text-white/55 2xl:text-sm">{form.description}</p>
              )}
            </div>
            {form.callToAction !== 'NO_BUTTON' && (
              <span className="ml-3 shrink-0 rounded-full border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white 2xl:px-4 2xl:py-2 2xl:text-sm">
                {labelize(form.callToAction)}
              </span>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-white/35 2xl:text-sm">
          Daily budget: <span className="text-white/65">{form.dailyBudget || '—'}</span> {currency || ''}
        </p>
      </div>
    </div>
  );
}

function maybeUrl(s) {
  try {
    return new URL(s).href;
  } catch {
    return null;
  }
}

// ─── step 4: review ───────────────────────────────────────────────────────────

function ReviewStep({ form, currency, account, pageName, savedAudienceName, igName, launchError, onDismissError }) {
  const campaignBudgetLine = form.cbo
    ? `${form.campaignBudget} ${currency || ''} ${form.campaignBudgetType === 'lifetime' ? 'lifetime' : 'per day'} (CBO)`
    : 'Set on ad set (no CBO)';
  const adSetBudgetLine = form.cbo
    ? 'Inherits campaign budget (CBO)'
    : `${form.adSetBudget} ${currency || ''} ${form.adSetBudgetType === 'lifetime' ? 'lifetime' : 'per day'}`;
  const audienceLine = form.useSavedAudience
    ? `Saved audience: ${savedAudienceName || form.savedAudienceId}`
    : form.worldwide
    ? 'Worldwide'
    : form.countries.join(', ');

  const cappedStrategy = form.bidStrategy === 'COST_CAP' || form.bidStrategy === 'LOWEST_COST_WITH_BID_CAP';
  const bidLabel = form.bidStrategy === 'COST_CAP' ? 'Cost cap' : 'Bid cap';
  const bidLine = cappedStrategy && form.bidAmount ? `${form.bidAmount} ${currency || ''}` : null;

  const sections = [
    {
      title: 'Campaign',
      rows: [
        ['Name', form.campaignName],
        ['Objective', labelize(form.objective)],
        ['Special ad categories', form.specialAdCategories.length ? form.specialAdCategories.map(labelize).join(', ') : 'None'],
        ['Budget', campaignBudgetLine],
        ...(form.cbo
          ? [
              ['Bid strategy', labelize(form.bidStrategy)],
              ...(bidLine ? [[bidLabel, bidLine]] : []),
            ]
          : []),
      ],
    },
    {
      title: 'Ad Set',
      rows: [
        ['Name', form.adSetName],
        ['Page', pageName || form.pageId],
        ['Instagram', igName || (form.instagramActorId ? form.instagramActorId : 'Use page only')],
        ['Conversion location', form.destinationType ? labelize(form.destinationType) : 'No specific'],
        ['Performance goal', labelize(form.optimizationGoal)],
        ['Billing', labelize(form.billingEvent)],
        ...(!form.cbo
          ? [
              ['Bid strategy', labelize(form.bidStrategy)],
              ...(bidLine ? [[bidLabel, bidLine]] : []),
            ]
          : []),
        ['Budget', adSetBudgetLine],
        ['Schedule', `${form.startTime || 'Now'} → ${form.hasEndTime && form.endTime ? form.endTime : 'Open-ended'}`],
        ['Audience', audienceLine],
        ...(!form.useSavedAudience
          ? [
              ['Age', `${form.ageMin}–${form.ageMax}`],
              ['Gender', form.genders.length === 0 ? 'All' : form.genders.map((g) => (g === 1 ? 'Male' : 'Female')).join(', ')],
              ['Languages', form.locales.length ? form.locales.length + ' selected' : 'All'],
              ['Advantage+', form.advantageAudience ? 'On' : 'Off'],
            ]
          : []),
      ],
    },
    {
      title: 'Ad',
      rows: [
        ['Name', form.adName],
        ['Headline', form.headline || '—'],
        ['Primary text', form.primaryText || '—'],
        ['Link', form.linkUrl],
        ['URL parameters', form.urlTags || '—'],
        ['CTA', labelize(form.callToAction)],
        [
          'Image',
          form.imageFile?.name ||
            (form.imageUrl ? 'From library' : '—'),
        ],
      ],
    },
  ];

  // Strip the help URL from the details (we render it as its own button)
  // so the user doesn't see a raw https:// dangling at the end of the
  // message.
  const cleanedDetails = launchError?.details
    ? launchError.details.replace(/https?:\/\/\S+/g, '').replace(/\s+\.?\s*$/, '').trim()
    : '';

  return (
    <div className="flex flex-col gap-5 2xl:gap-6">
      {launchError && (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/8 p-4 2xl:p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300 2xl:h-5 2xl:w-5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-red-100 2xl:text-base">
                  {launchError.stage ? `${labelize(launchError.stage)} step failed` : 'Launch failed'}
                </p>
                <button
                  onClick={onDismissError}
                  className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-200/60 transition-colors hover:bg-red-400/10 hover:text-red-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 text-xs font-semibold text-red-100 2xl:text-sm">{launchError.title}</p>
              {cleanedDetails && cleanedDetails !== launchError.title && (
                <p className="mt-1 text-xs leading-relaxed text-red-200/85 2xl:text-sm">{cleanedDetails}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {launchError.helpUrl && (
                  <a
                    href={launchError.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-400/20 2xl:text-xs"
                  >
                    Open Meta help ↗
                  </a>
                )}
                {launchError.fbtraceId && (
                  <span className="font-mono text-[11px] text-red-200/55 2xl:text-xs">
                    fbtrace {launchError.fbtraceId}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Posting-target banner — surfaces the destination account up-front so
          users can't miss which Meta account a paused campaign just landed in. */}
      <div className="rounded-2xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-px">
        <div
          className="flex items-center gap-3 rounded-[15px] p-3.5 2xl:p-4"
          style={{
            background:
              'linear-gradient(to right, rgba(21,220,255,0.08), rgba(107,114,248,0.08)), #141414',
          }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white 2xl:h-10 2xl:w-10">
            <FaMeta className="h-4 w-4 text-[#0082FB] 2xl:h-5 2xl:w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#15DCFF] 2xl:text-xs">Posting to</p>
            <p className="truncate text-sm font-bold text-white 2xl:text-base">{account?.name || '—'}</p>
            <p className="font-mono text-xs text-white/55 2xl:text-sm">act_{account?.id || '—'} · {currency || ''}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/8 px-4 py-3 2xl:px-5 2xl:py-3.5">
        <p className="text-xs leading-relaxed text-emerald-100 2xl:text-sm">
          Will be launched <b>ACTIVE</b>. Meta starts delivering once the ad set passes review — pause anytime from the Campaigns tab.
        </p>
      </div>

      {/* 2-up grid on wider screens prevents the value column from
          stretching across the modal. Stacks on mobile. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:gap-5">
        {sections.map((s, i) => (
          <div
            key={s.title}
            className={`overflow-hidden rounded-2xl border border-white/12 bg-[#303030]/20 ${
              // The Ad section reads better full-width because its values
              // (URL, image filename) are longer than Campaign/Ad-Set rows.
              i === 2 ? 'md:col-span-2' : ''
            }`}
          >
            <div className="border-b border-white/10 bg-white/5 px-4 py-2 2xl:px-5 2xl:py-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-white/85 2xl:text-sm">{s.title}</p>
            </div>
            <dl className="divide-y divide-white/8">
              {s.rows.map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 px-4 py-2 2xl:px-5 2xl:py-2.5">
                  <dt className="w-28 shrink-0 text-xs font-semibold capitalize tracking-wider text-white/55 2xl:w-32 2xl:text-sm">{k}</dt>
                  <dd className="min-w-0 flex-1 wrap-break-word capitalize text-xs font-medium text-white 2xl:text-sm">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── root wizard ──────────────────────────────────────────────────────────────

export default function CreateCampaignWizard({ open, onClose, account, onCreated }) {
  const [step, setStep] = useState('campaign');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(null); // { stage, message }
  const [pages, setPages] = useState([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [savedAudiences, setSavedAudiences] = useState([]);
  const [loadingSavedAudiences, setLoadingSavedAudiences] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Last failed launch attempt — surfaced as a banner on the Review step so
  // multi-paragraph Meta errors aren't squished into a single toast line.
  const [launchError, setLaunchError] = useState(null);
  // Step results from a partially-successful previous attempt. If an earlier
  // launch created the campaign + adset but failed at image/ad, retrying
  // reuses these IDs instead of creating duplicates on Meta.
  const [created, setCreated] = useState({});

  const [form, setForm] = useState(buildInitialForm);

  // reset whenever the modal is reopened — including the form, so a
  // half-filled draft from a previous session doesn't surface unexpectedly.
  useEffect(() => {
    if (!open) return;
    setStep('campaign');
    setSubmitting(false);
    setProgress(null);
    setShowDiscardConfirm(false);
    setLaunchError(null);
    setCreated({});
    setForm(buildInitialForm());
  }, [open]);

  // X-button handler — always prompts (cheap insurance against accidental
  // closes; a user partway through 4 steps is the common case).
  const requestClose = () => {
    if (submitting) return;
    setShowDiscardConfirm(true);
  };

  const confirmDiscard = () => {
    setForm(buildInitialForm());
    setStep('campaign');
    setProgress(null);
    setLaunchError(null);
    setCreated({});
    setShowDiscardConfirm(false);
    onClose?.();
  };

  // load pages + saved audiences once when wizard opens
  useEffect(() => {
    if (!open || !account?.id) return;
    let cancelled = false;
    setLoadingPages(true);
    getMetaPages(account.id)
      .then((r) => { if (!cancelled) setPages(r.pages || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingPages(false); });
    return () => { cancelled = true; };
  }, [open, account?.id]);

  useEffect(() => {
    if (!open || !account?.id) return;
    let cancelled = false;
    setLoadingSavedAudiences(true);
    getMetaSavedAudiences(account.id)
      .then((r) => { if (!cancelled) setSavedAudiences(r.savedAudiences || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingSavedAudiences(false); });
    return () => { cancelled = true; };
  }, [open, account?.id]);

  const currency = account?.currency;
  const accountStatus = account ? decodeAccountStatus(account.status) : null;
  const accountBlocked = accountStatus?.tone === 'block';
  const pageName = useMemo(
    () => pages.find((p) => p.id === form.pageId)?.name,
    [pages, form.pageId],
  );

  const validators = {
    campaign: () => {
      if (!form.campaignName.trim()) return 'Campaign name is required';
      if (!form.objective) return 'Pick an objective';
      if (form.cbo) {
        const b = Number(form.campaignBudget);
        if (!b || b < 1) return 'Campaign budget must be at least 1';
        if (CAPPED_BID_STRATEGIES.has(form.bidStrategy)) {
          const cap = Number(form.bidAmount);
          if (!cap || cap < 1) return `${form.bidStrategy === 'COST_CAP' ? 'Cost cap' : 'Bid cap'} is required for the chosen bid strategy`;
        }
      }
      return null;
    },
    adset: () => {
      if (!form.adSetName.trim()) return 'Ad set name is required';
      if (!form.pageId) return 'Pick a Facebook Page';
      if (!form.cbo) {
        const b = Number(form.adSetBudget);
        if (!b || b < 1) return 'Ad set budget must be at least 1';
        if (form.adSetBudgetType === 'lifetime' && !form.hasEndTime) {
          return 'Lifetime budgets require an end date';
        }
        if (CAPPED_BID_STRATEGIES.has(form.bidStrategy)) {
          const cap = Number(form.bidAmount);
          if (!cap || cap < 1) return `${form.bidStrategy === 'COST_CAP' ? 'Cost cap' : 'Bid cap'} is required for the chosen bid strategy`;
        }
      }
      if (form.useSavedAudience) {
        if (!form.savedAudienceId) return 'Pick a saved audience or turn the toggle off';
      } else {
        if (!form.worldwide && !form.countries.length) return 'Pick at least one country or enable Worldwide';
        const aMin = Number(form.ageMin);
        const aMax = Number(form.ageMax);
        if (aMin < 13 || aMax > 65 || aMin > aMax) return 'Age range must be 13–65 with min ≤ max';
      }
      if (form.hasEndTime && !form.endTime) return 'Pick an end date or turn the toggle off';
      if (form.startTime && form.endTime && new Date(form.endTime) <= new Date(form.startTime)) {
        return 'End date must be after start date';
      }
      return null;
    },
    ad: () => {
      if (!form.adName.trim()) return 'Ad name is required';
      if (!form.imageFile && !form.imageUrl)
        return 'Upload an image or pick one from your library';
      if (!maybeUrl(form.linkUrl)) return 'Destination URL must be a valid URL';
      return null;
    },
    review: () => null,
  };

  const goNext = () => {
    const err = validators[step]?.();
    if (err) {
      globalToast.error(err);
      return;
    }
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
  };

  const goPrev = () => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  };

  const handleLaunch = async () => {
    if (!account) return;
    setSubmitting(true);
    setLaunchError(null);
    try {
      // Meta wants budgets in minor currency units (cents/paise). User input
      // is in whole units; multiply on the way out.
      const toMinor = (v) => Math.round(Number(v) * 100);

      // 1. campaign — launching ACTIVE per user preference. Each step result
      // is cached on the `created` state so a retry after a later-step failure
      // reuses the existing entities on Meta instead of creating duplicates.
      // The cache is reset only on wizard open / successful completion /
      // explicit discard — if the user edits the form between attempts, the
      // cached IDs still point at the old values on Meta (close+reopen to
      // start truly fresh).
      let campaignId = created.campaignId;
      if (!campaignId) {
        setProgress({ stage: 'campaign', message: 'Creating campaign…' });
        const campaignPayload = {
          adAccountId: account.id,
          name: form.campaignName.trim(),
          objective: form.objective,
          specialAdCategories: form.specialAdCategories,
          status: 'ACTIVE',
        };
        if (form.cbo) {
          if (form.campaignBudgetType === 'lifetime') {
            campaignPayload.lifetimeBudget = toMinor(form.campaignBudget);
          } else {
            campaignPayload.dailyBudget = toMinor(form.campaignBudget);
          }
          campaignPayload.bidStrategy = form.bidStrategy;
        }
        const campaignRes = await createMetaCampaign(campaignPayload);
        campaignId = campaignRes?.campaign?.id;
        if (!campaignId) throw new Error('Campaign creation returned no id');
        setCreated((p) => ({ ...p, campaignId }));
      }

      // 2. ad set — only attach a budget when CBO is OFF.
      let adSetId = created.adSetId;
      if (!adSetId) {
        setProgress({ stage: 'adset', message: 'Creating ad set…' });
        const adSetPayload = {
          adAccountId: account.id,
          campaignId,
          pageId: form.pageId,
          name: form.adSetName.trim(),
          billingEvent: form.billingEvent,
          optimizationGoal: form.optimizationGoal,
          bidStrategy: form.bidStrategy,
          targeting: {
            countries: form.useSavedAudience ? [] : form.worldwide ? [] : form.countries,
            worldwide: form.useSavedAudience ? false : form.worldwide,
            ageMin: Number(form.ageMin),
            ageMax: Number(form.ageMax),
            genders: form.genders,
            locales: form.locales,
            advantageAudience: form.advantageAudience,
          },
          status: 'ACTIVE',
        };
        if (form.instagramActorId) adSetPayload.instagramActorId = form.instagramActorId;
        if (form.destinationType) adSetPayload.destinationType = form.destinationType;
        if (form.useSavedAudience && form.savedAudienceId) {
          adSetPayload.savedAudienceId = form.savedAudienceId;
        }
        if (!form.cbo) {
          if (form.adSetBudgetType === 'lifetime') {
            adSetPayload.lifetimeBudget = toMinor(form.adSetBudget);
          } else {
            adSetPayload.dailyBudget = toMinor(form.adSetBudget);
          }
        }
        // Bid cap / cost cap (only valid for capped strategies). Sent in minor
        // currency units, matching how Meta expects budgets.
        if (CAPPED_BID_STRATEGIES.has(form.bidStrategy) && form.bidAmount) {
          adSetPayload.bidAmount = toMinor(form.bidAmount);
        }
        if (form.startTime) adSetPayload.startTime = new Date(form.startTime).toISOString();
        if (form.hasEndTime && form.endTime) {
          adSetPayload.endTime = new Date(form.endTime).toISOString();
        }
        const adSetRes = await createMetaAdSet(adSetPayload);
        adSetId = adSetRes?.adSet?.id;
        if (!adSetId) throw new Error('Ad set creation returned no id');
        setCreated((p) => ({ ...p, adSetId }));
      }

      // 3. image upload
      let imageHash = created.imageHash;
      if (!imageHash) {
        setProgress({
          stage: 'image',
          message: form.imageUrl
            ? 'Sending image to Meta…'
            : 'Uploading image to Meta…',
        });
        // Library pick → imageUrl path (backend fetches the URL server-side
        // and base64-uploads to Meta). Disk upload → multipart `image`.
        const uploadRes = await uploadMetaAdImage(
          form.imageUrl
            ? { adAccountId: account.id, imageUrl: form.imageUrl }
            : { adAccountId: account.id, image: form.imageFile },
        );
        imageHash = uploadRes?.imageHash;
        if (!imageHash) throw new Error('Image upload returned no hash');
        setCreated((p) => ({ ...p, imageHash }));
      }

      // 4. ad (creative + ad in one call)
      setProgress({ stage: 'ad', message: 'Creating ad…' });
      await createMetaAd({
        adAccountId: account.id,
        adSetId,
        pageId: form.pageId,
        instagramActorId: form.instagramActorId || undefined,
        name: form.adName.trim(),
        imageHash,
        headline: form.headline,
        primaryText: form.primaryText,
        description: form.description,
        linkUrl: form.linkUrl,
        urlTags: form.urlTags,
        callToAction: form.callToAction,
        status: 'ACTIVE',
      });

      setCreated({});
      globalToast.success('Campaign, ad set and ad created — live now');
      onCreated?.();
      onClose?.();
    } catch (err) {
      // Backend returns { error: <title>, details: <message>, meta: { code,
      // subcode, fbtraceId, data } }. Title is human-readable when Meta
      // provides one (`error_user_title`), details adds the actionable text.
      const body = err?.response?.data || {};
      const title = body.error || 'Failed';
      const details = body.details || '';
      const fbtraceId = body.meta?.fbtraceId;
      const stage = progress?.stage || null;
      // Pull a help URL out of the message — Meta sometimes embeds one.
      const helpUrl = (details.match(/https?:\/\/\S+/) || [])[0] || null;

      // Capture the full error for the inline banner so the user can read it
      // properly; toast only carries the short title.
      setLaunchError({ stage, title, details, fbtraceId, helpUrl });
      // Jump back to Review so the banner is the first thing the user sees.
      if (stage && stage !== 'review') setStep('review');
      globalToast.error(`${stage ? labelize(stage) + ': ' : ''}${title}`);
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  const isLast = step === 'review';

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm sm:p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 12 }}
          transition={{ duration: 0.18 }}
          className="relative flex max-h-[98vh] 2xl:max-h-[92vh] w-full max-w-3xl scale-80 min-w-[370px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#141414] shadow-2xl 2xl:max-w-5xl 2xl:scale-100"
        >
          {/* header — surfaces destination account prominently so users
              never confuse which Meta account they're publishing into. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/12 bg-white/3 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3 2xl:px-6 2xl:py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] ring-1 ring-white/10 2xl:h-12 2xl:w-12">
                <Megaphone className="h-4.5 w-4.5 text-white 2xl:h-[24px] 2xl:w-[24px]" />
              </div>
              <div>
                <p className="text-sm font-bold text-white 2xl:text-lg">New Campaign</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="text-[11px] text-white/60 2xl:text-xs">Posting to</span>
                  <span className="inline-flex rounded-[6px] bg-gradient-to-r from-[#02C8C4] to-[#5867EB] p-px transition-all">
                    <span className="rounded-[5px] bg-[#141414] px-2 py-1 text-[11px] font-bold leading-tight text-white 2xl:text-xs">
                      {account?.name || '—'}
                    </span>
                  </span>
                  {account?.currency && (
                    <span className="font-mono text-[11px] text-white/45 2xl:text-xs">
                      · {account.currency}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StepRail step={step} />
              <button
                onClick={requestClose}
                disabled={submitting}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-30 2xl:h-8 2xl:w-8"
              >
                <X className="h-4 w-4 2xl:h-5 2xl:w-5" />
              </button>
            </div>
          </div>

          {/* body */}
          <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 2xl:px-8 2xl:py-8">
            {/* Account-state pre-flight — Meta rejects every create/edit
                call against a non-active account with a generic "Invalid
                parameter". Surfacing this here saves the user from filling
                out 4 steps before learning the destination is unusable. */}
            {accountStatus && accountStatus.tone !== 'ok' && (
              <div
                className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 2xl:p-5 ${
                  accountBlocked
                    ? 'border-red-400/30 bg-red-400/8'
                    : 'border-amber-400/30 bg-amber-400/8'
                }`}
              >
                <AlertCircle
                  className={`mt-0.5 h-4 w-4 shrink-0 2xl:h-5 2xl:w-5 ${
                    accountBlocked ? 'text-red-300' : 'text-amber-300'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-bold 2xl:text-base ${
                      accountBlocked ? 'text-red-100' : 'text-amber-100'
                    }`}
                  >
                    Ad account is {accountStatus.label.toLowerCase()}
                    {accountBlocked && ' — Meta will reject this campaign'}
                  </p>
                  <p
                    className={`mt-1 text-xs leading-relaxed 2xl:text-sm ${
                      accountBlocked ? 'text-red-200/80' : 'text-amber-200/80'
                    }`}
                  >
                    {accountBlocked
                      ? `Reactivate "${account?.name || 'the account'}" in Meta Business Manager (billing, policy review, or owner action) before retrying. Only ACTIVE accounts can create or edit ads.`
                      : 'You can still build the campaign, but Meta may reject the launch until the account returns to ACTIVE.'}
                  </p>
                </div>
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
              >
                {step === 'campaign' && (
                  <CampaignStep form={form} setForm={setForm} currency={currency} />
                )}
                {step === 'adset' && (
                  <AdSetStep
                    form={form}
                    setForm={setForm}
                    pages={pages}
                    loadingPages={loadingPages}
                    savedAudiences={savedAudiences}
                    loadingSavedAudiences={loadingSavedAudiences}
                    currency={currency}
                  />
                )}
                {step === 'ad' && <AdStep form={form} setForm={setForm} currency={currency} />}
                {step === 'review' && (
                  <ReviewStep
                    form={form}
                    account={account}
                    currency={currency}
                    pageName={pageName}
                    savedAudienceName={
                      savedAudiences.find((a) => a.id === form.savedAudienceId)?.name
                    }
                    igName={(() => {
                      const ig = pages.find((p) => p.id === form.pageId)?.instagramAccount;
                      if (!ig || ig.id !== form.instagramActorId) return null;
                      return ig.username ? `@${ig.username}` : ig.name || ig.id;
                    })()}
                    launchError={launchError}
                    onDismissError={() => setLaunchError(null)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* footer */}
          <div className="flex shrink-0 items-center justify-between border-t border-white/8 px-4 py-3 sm:px-6 2xl:px-8 2xl:py-4">
            <button
              onClick={goPrev}
              disabled={step === 'campaign' || submitting}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/3 px-4 py-2 text-xs font-semibold text-white/70 transition-all hover:border-white/15 hover:text-white disabled:opacity-30 2xl:px-5 2xl:py-2.5 2xl:text-sm"
            >
              <ChevronLeft className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" /> Back
            </button>

            <div className="flex items-center gap-3">
              {progress && (
                <div className="flex items-center gap-1.5 text-xs text-white/65 2xl:text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#15DCFF] 2xl:h-4 2xl:w-4" />
                  {progress.message}
                </div>
              )}
              {!isLast ? (
                <button
                  onClick={goNext}
                  className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black transition-all hover:opacity-90 2xl:px-6 2xl:py-2.5 2xl:text-sm"
                >
                  Next <ChevronRight className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                </button>
              ) : (
                <button
                  onClick={handleLaunch}
                  disabled={submitting || accountBlocked}
                  title={
                    accountBlocked
                      ? `Account ${accountStatus.label} — reactivate in Meta first`
                      : undefined
                  }
                  className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-xs font-bold text-black transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 2xl:px-6 2xl:py-2.5 2xl:text-sm"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin 2xl:h-4 2xl:w-4" />
                  ) : (
                    <Check className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" strokeWidth={3} />
                  )}
                  {submitting
                    ? 'Launching…'
                    : accountBlocked
                      ? `Account ${accountStatus.label}`
                      : 'Create Campaign'}
                </button>
              )}
            </div>
          </div>

          {/* Discard confirmation — overlays the whole modal so the user
              can't accidentally interact with the form behind it. */}
          <AnimatePresence>
            {showDiscardConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 z-10 flex items-center justify-center bg-black/65 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  className="w-full max-w-sm rounded-2xl border border-white/12 bg-[#161616] p-5 shadow-2xl 2xl:max-w-md 2xl:p-6"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 2xl:h-11 2xl:w-11">
                    <AlertCircle className="h-5 w-5 text-red-300 2xl:h-6 2xl:w-6" />
                  </div>
                  <h3 className="text-sm font-bold text-white 2xl:text-base">
                    Discard this campaign?
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/55 2xl:text-sm">
                    Everything you've entered in the wizard will be cleared. Your existing campaigns
                    in Meta aren't affected.
                  </p>
                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                      onClick={() => setShowDiscardConfirm(false)}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-white/10 2xl:px-5 2xl:py-2.5 2xl:text-sm"
                    >
                      Keep editing
                    </button>
                    <button
                      onClick={confirmDiscard}
                      className="rounded-full bg-red-500/85 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 2xl:px-5 2xl:py-2.5 2xl:text-sm"
                    >
                      Discard
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
