// ── Captured Lead submissions ───────────────────────────────────────────
// Helpers behind the dashboard's Leads tab, which reads + exports leads
// captured by a Page's Instant Forms. Meta hard-gates the form `leads` edge
// behind the leads_retrieval OAuth scope (error #200 "Requires
// leads_retrieval permission" otherwise) — see authController's scope list.
//
// These live in utils/ rather than in metaAdLauncher.js so they stay
// testable without pulling the controller's full require chain (Redis / the
// Business SDK / DB connections at import time) — the same reason
// targetingGeo.js and detailedTargeting.js were extracted.

// Fields requested per lead — everything the `leads` edge will surface.
// `field_data` carries the answers the person submitted; the rest is full
// attribution + source context so the exported sheet is self-contained.
const LEAD_FIELDS =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name," +
  "campaign_id,campaign_name,form_id,is_organic,platform,partner_name," +
  "custom_disclaimer_responses";

// Hard ceiling on pagination requests, independent of `maxLeads` — stops a
// pathological form (or a cursor that never advances) from looping forever.
const MAX_LEAD_PAGES = 100;

// Default cap on how many leads a single read will return.
const DEFAULT_MAX_LEADS = 5000;

// "full_name" → "Full name", "phone_number" → "Phone number" — used for
// the CSV header so the exported sheet reads cleanly in Excel.
function prettifyLeadField(name) {
  return String(name || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pull every lead for a form, following Meta's cursor pagination. Capped
// at `maxLeads` (and a hard page-count ceiling) so a runaway form can't
// exhaust memory or hang the request.
//
// Returns `{ leads, truncated }`. `truncated` is the important half: an
// advertiser with 12k leads used to silently receive 5k with nothing —
// not the count, not the CSV — indicating the rest existed. Callers surface
// it so the number on screen is either complete or visibly labelled as not.
async function fetchAllLeadsForForm(
  pageApi,
  formId,
  maxLeads = DEFAULT_MAX_LEADS,
) {
  const out = [];
  let after = null;
  let truncated = false;
  for (let page = 0; page < MAX_LEAD_PAGES; page++) {
    const params = { fields: LEAD_FIELDS, limit: 200 };
    if (after) params.after = after;
    const result = await pageApi.call("GET", [formId, "leads"], params);
    const data = result?._data || result || {};
    const batch = data.data || [];
    out.push(...batch);
    const nextCursor = data?.paging?.cursors?.after || null;
    if (out.length >= maxLeads) {
      // Landing exactly on the cap with no further page is a clean finish,
      // not a truncation — only claim truncation when leads really remain.
      return {
        leads: out.slice(0, maxLeads),
        truncated: out.length > maxLeads || !!(nextCursor && data?.paging?.next),
      };
    }
    after = nextCursor;
    if (!after || !data?.paging?.next || batch.length === 0) break;
    // Exiting on the page ceiling with a live cursor still in hand means
    // Meta had more to give us — that's truncation too.
    if (page === MAX_LEAD_PAGES - 1) truncated = true;
  }
  return { leads: out, truncated };
}

// Flatten a raw Meta lead into a self-contained record.
// `field_data` is an array of { name, values:[…] }; each is collapsed to a
// single string (multi-value answers joined with "; "). Custom disclaimer
// / consent checkboxes are flattened to "key: Yes/No" pairs.
function normalizeLead(raw) {
  const fields = {};
  for (const fd of raw?.field_data || []) {
    if (!fd || !fd.name) continue;
    fields[fd.name] = Array.isArray(fd.values) ? fd.values.join("; ") : "";
  }
  const disclaimers = (raw?.custom_disclaimer_responses || [])
    .map((d) => {
      const key = d?.checkbox_key || d?.key || "";
      return key ? `${key}: ${d?.is_checked ? "Yes" : "No"}` : "";
    })
    .filter(Boolean)
    .join("; ");
  return {
    id: raw?.id || "",
    createdTime: raw?.created_time || null,
    campaignId: raw?.campaign_id || null,
    campaignName: raw?.campaign_name || null,
    adsetId: raw?.adset_id || null,
    adsetName: raw?.adset_name || null,
    adId: raw?.ad_id || null,
    adName: raw?.ad_name || null,
    formId: raw?.form_id || null,
    platform: raw?.platform || null,
    isOrganic: !!raw?.is_organic,
    source: raw?.is_organic ? "Organic" : "Paid ad",
    partnerName: raw?.partner_name || null,
    disclaimerResponses: disclaimers || null,
    fields,
  };
}

// Union of all question field names across the leads, in first-seen order
// — drives the table columns / CSV header. A form can be edited over time,
// so different leads may carry different field sets.
function leadFieldNames(leads) {
  const seen = [];
  for (const l of leads) {
    for (const name of Object.keys(l.fields || {})) {
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

// Cells whose first character is one of these are parsed as a formula by
// Excel / Sheets / LibreOffice once the CSV quoting is stripped — quoting
// alone is NOT protection (CWE-1236).
const CSV_FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

// Escape one CSV cell — neutralise formula triggers, wrap in quotes, double
// any embedded quote.
//
// The formula guard matters here specifically because lead-form answers are
// submitted by anyone on the public internet: a spammer can put
// `=cmd|'/c calc'!A1` (or a HYPERLINK that exfiltrates adjacent cells) into a
// target's public Instant Form, and the ADVERTISER is the one who gets hit
// when they open their own export. Attribution columns (campaign / ad set /
// ad / form names) are user-authored too, so this is applied to every cell
// rather than just the answer columns.
//
// A leading apostrophe is the standard neutraliser — spreadsheet apps treat
// the rest of the cell as literal text and don't render the apostrophe.
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (s && CSV_FORMULA_TRIGGERS.includes(s[0])) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Serialise normalized leads to CSV text — the answer columns plus full
// attribution + source context so the sheet is self-contained for the
// advertiser's follow-up. Prefixed with a UTF-8 BOM so Excel reads
// non-ASCII names / addresses correctly on double-click.
function leadsToCsv(leads) {
  const fieldNames = leadFieldNames(leads);
  const header = [
    "Lead ID",
    "Captured",
    ...fieldNames.map(prettifyLeadField),
    "Campaign",
    "Ad set",
    "Ad",
    "Platform",
    "Source",
    "Partner",
    "Consent responses",
    "Form ID",
  ];
  const rows = leads.map((l) => [
    l.id || "",
    l.createdTime || "",
    ...fieldNames.map((f) => l.fields?.[f] || ""),
    l.campaignName || "",
    l.adsetName || "",
    l.adName || "",
    l.platform || "",
    l.source || "",
    l.partnerName || "",
    l.disclaimerResponses || "",
    l.formId || "",
  ]);
  return (
    "﻿" +
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")
  );
}

module.exports = {
  LEAD_FIELDS,
  MAX_LEAD_PAGES,
  DEFAULT_MAX_LEADS,
  CSV_FORMULA_TRIGGERS,
  prettifyLeadField,
  fetchAllLeadsForForm,
  normalizeLead,
  leadFieldNames,
  csvCell,
  leadsToCsv,
};
