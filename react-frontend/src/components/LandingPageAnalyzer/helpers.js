// Pure helpers for the Landing Page Analyzer result view.
// No React here — just data shaping + theme-aware class/colour maps.

// Score → band. Drives the gauge colour, dimension badges, and grade pill.
// stroke is a raw hex (for SVG / inline styles); the class strings are
// theme-aware (work in both light + dark via the project tokens).
export function scoreBand(score) {
  const s = Number(score) || 0;
  if (s >= 90)
    return {
      key: 'excellent',
      label: 'Excellent',
      stroke: '#10b981',
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
      ring: 'border-emerald-500/30',
    };
  if (s >= 70)
    return {
      key: 'good',
      label: 'Good',
      stroke: '#84cc16',
      text: 'text-lime-600 dark:text-lime-400',
      bg: 'bg-lime-500/10',
      ring: 'border-lime-500/30',
    };
  if (s >= 40)
    return {
      key: 'needs-work',
      label: 'Needs Work',
      stroke: '#f59e0b',
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
      ring: 'border-amber-500/30',
    };
  return {
    key: 'critical',
    label: 'Critical',
    stroke: '#ef4444',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
    ring: 'border-red-500/30',
  };
}

// Split a dimension point like `H1 is missing (-30)` into the readable text and
// its trailing score delta. The delta is rendered as a small coloured chip.
// Unsigned numbers like `(58)` and non-numeric tails like `(low score)` stay
// neutral / inline — only explicit +/- deltas read as good/bad.
export function parsePoint(raw) {
  const str = String(raw ?? '').trim();
  const m = str.match(/\s*\(([+-]?\d+|\+|-)\)\s*$/);
  if (!m) return { text: str, delta: null, sign: 'neutral', value: null };
  const token = m[1];
  const text = str.slice(0, m.index).trim();
  let sign = 'neutral';
  if (token === '+') sign = 'pos';
  else if (token === '-') sign = 'neg';
  else {
    const n = parseInt(token, 10);
    if (n > 0 && token.startsWith('+')) sign = 'pos';
    else if (n < 0) sign = 'neg';
  }
  // Numeric delta for the +N / -N / ±0 chip. Only explicit signed numbers (or 0)
  // count; bare measures like "(58)" are not deltas.
  let value = null;
  if (/^[+-]\d+$/.test(token)) value = parseInt(token, 10);
  else if (token === '0') value = 0;
  return { text, delta: token, sign, value };
}

// Strengths aren't in the payload, so we derive them: every positive (+) point
// across all dimensions, deduped and capped. The summary's "To Improve" column
// uses the payload's `top_fixes` directly.
export function deriveStrengths(dimensions, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const d of dimensions || []) {
    for (const p of d.points || []) {
      const { text, sign } = parsePoint(p);
      if (sign === 'pos' && text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
  }
  return out.slice(0, limit);
}

// screenshot_url can be absolute (https://contents.adsgpt.io/…) or relative
// (/creatives/…). Prefix relative paths with the contents CDN host.
const SCREENSHOT_HOST = 'https://contents.adsgpt.io';
export function resolveScreenshotUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SCREENSHOT_HOST}${url.startsWith('/') ? '' : '/'}${url}`;
}

// Pretty hostname for the header (falls back to the raw string).
export function prettyHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
}

// Plain-text export of the whole report for "Copy recommendations".
export function buildRecommendationsText(report) {
  if (!report) return '';
  const L = [];
  L.push(`Landing Page Analysis — ${report.url || ''}`);
  if (report.overall)
    L.push(`Score: ${report.overall.score}/100 (${report.overall.grade})`);
  if (report.overall?.summary) L.push('', report.overall.summary);
  if (report.top_fixes?.length) {
    L.push('', 'TOP FIXES');
    report.top_fixes.forEach((f, i) => L.push(`${i + 1}. ${f}`));
  }
  if (report.sections?.length) {
    L.push('', 'IMPROVEMENT IDEAS');
    report.sections.forEach((s) =>
      L.push(`• [${s.priority}] ${s.title} — ${s.detail}`),
    );
  }
  if (report.technical_seo?.length) {
    L.push('', 'TECHNICAL SEO');
    report.technical_seo.forEach((t) => L.push(`• [${t.priority}] ${t.issue}: ${t.fix}`));
  }
  return L.join('\n');
}

// Priority → theme-aware class band (Pill / PriorityBadge).
export function prioBand(priority) {
  const p = String(priority || '').toLowerCase();
  if (p === 'high')
    return {
      label: priority,
      text: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-500/10',
      ring: 'border-red-500/30',
    };
  if (p === 'medium')
    return {
      label: priority,
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
      ring: 'border-amber-500/30',
    };
  return {
    label: priority,
    text: 'text-sky-600 dark:text-sky-400',
    bg: 'bg-sky-500/10',
    ring: 'border-sky-500/30',
  };
}

// Severity hex for inline accents on the Key Signals tiles.
export const SEV_HEX = { crit: '#ef4444', warn: '#f59e0b', good: '#10b981' };

// Key Signals — 4 headline metrics derived from the report (the payload has no
// dedicated block, so we synthesise from performance + issue counts).
export function deriveKeySignals(report) {
  const perf = report?.performance || {};
  const ms = perf.load_time_ms;
  const mobile = perf.mobile_score;
  const https = perf.https;

  const highCount =
    (report?.sections || []).filter((s) => String(s.priority).toLowerCase() === 'high')
      .length +
    (report?.technical_seo || []).filter((t) => String(t.priority).toLowerCase() === 'high')
      .length;

  return [
    {
      label: 'Load Time',
      icon: 'zap',
      value: ms != null ? `${(ms / 1000).toFixed(1)}s` : '—',
      sub: 'target < 3s',
      sev: ms == null ? 'warn' : ms < 3000 ? 'good' : ms < 6000 ? 'warn' : 'crit',
    },
    {
      label: 'Mobile',
      icon: 'smartphone',
      value: mobile != null ? `${mobile}/100` : '—',
      sub: 'performance',
      sev: mobile == null ? 'warn' : mobile >= 80 ? 'good' : mobile >= 50 ? 'warn' : 'crit',
    },
    {
      label: 'HTTPS',
      icon: 'lock',
      value: https ? 'Secure' : 'None',
      sub: 'encryption',
      sev: https ? 'good' : 'crit',
    },
    {
      label: 'High Issues',
      icon: 'alert',
      value: String(highCount),
      sub: 'priority fixes',
      sev: highCount === 0 ? 'good' : highCount <= 2 ? 'warn' : 'crit',
    },
  ];
}

// "analyzed Jun 11, 2026" style date for the header.
export function prettyDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// Raw hex for a priority — used for the small dots on Page Overview chips.
export function priorityHex(priority) {
  const p = String(priority || '').toLowerCase();
  if (p === 'high') return '#ef4444';
  if (p === 'medium') return '#f59e0b';
  return '#0ea5e9';
}

// Priority sort rank (High → Medium → Low) for the Improvement Ideas list.
export function priorityRank(priority) {
  const p = String(priority || '').toLowerCase();
  return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
}

// The sticky-nav sections, in scroll order. Shared by the nav + the page.
export const RESULT_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'section-scores', label: 'Section Scores' },
  { id: 'on-page-audit', label: 'On-Page Audit' },
  { id: 'improvement-ideas', label: 'Improvement Ideas' },
  { id: 'technical-seo', label: 'Technical SEO' },
];
