# Sales Call Analyses — Index

Single source of truth for sales-call work done in this repo. Use this as the entry point when picking up across sessions or machines: every call analyzed, every playbook written, every product issue filed, and every Google Doc share link.

> Last updated: 2026-05-20 — second sweep complete. 51 additional rows processed (S.No 129, 136–184, 190–192). Total processed: 183 of 187 Fathom/Fireflies rows; 2 skipped (rows 40, 122 — Fathom `/calls/` URLs requiring auth); 2 duplicate-linked (157→154, 167→166). Runbook updated with May-sweep addendum.

---

## Calls analyzed (in chronological order)

| Date | Prospect | Product | Host | Duration | Outcome | Playbook (repo) | Playbook (Google Doc) |
|---|---|---|---|---|---|---|---|
| 2026-02-03 | **Vincent Chacko** (ad-scope.online) | Poweradspy | Shreyash | 45 min | Stalled — B2B API ask | [`sales-playbook-ad-scope.md`](../tools/gdocs-uploader/examples/sales-playbook-ad-scope.md) | [link](https://docs.google.com/document/d/1MguzIf6Gjq3edboENeVCHyH1EKaioOwhH3VSNzMtqU4/edit?usp=drivesdk) |
| 2026-04-24 | **Kavita Prashant Sharma** (ipreneur.com.in) | AdsGPT | Tanmay | 54 min | Demo crashed; reschedule pending | [`sales-playbook-kavita-hindi-smb-tech-failure.md`](../tools/gdocs-uploader/examples/sales-playbook-kavita-hindi-smb-tech-failure.md) | [link](https://docs.google.com/document/d/1jT9IvQcz8WGA5VUBhS34l902Gec3ITyUrwTz8iiA0Ic/edit?usp=drivesdk) |
| 2026-04-27 (AM) | **Dhan Netha99** | AdsGPT | Shreyash | 11 min | **Won — Startup plan tomorrow** | [`sales-playbook-dhan-win-replay.md`](../tools/gdocs-uploader/examples/sales-playbook-dhan-win-replay.md) | [link](https://docs.google.com/document/d/1COUGSqX9Bi0INwe8D38WxfDbkYiRsD3U8oZqrzYm9YM/edit?usp=drivesdk) |
| 2026-04-27 (AM, ~3h after Dhan) | **Raja P** (Raja Digital, Tamil Nadu) | AdsGPT | Tanmay | 42 min | Manual trial granted; no commit | [`sales-playbook-raja-agency-demo.md`](../tools/gdocs-uploader/examples/sales-playbook-raja-agency-demo.md) | [link](https://docs.google.com/document/d/1B4YMb7r3UBqf_DpUhfa3pXEZtHBPd5zzqHBfU0ItvsQ/edit?usp=drivesdk) |
| 2026-04-24 (sheet row 133) | **Shailesh Sharma** (360° photography, Khatu Shyam community network, MP) | AdsGPT | Tanmay | ~50 min | Soft Monday close; verbal "subscribe karenge"; surfaced new "aspiring-agency SMB" ICP | [`sales-playbook-shailesh-360-photography-aspiring-agency.md`](../tools/gdocs-uploader/examples/sales-playbook-shailesh-360-photography-aspiring-agency.md) | [link](https://docs.google.com/document/d/1r46LdIfgttoENn1bEb05Ht-1uL_Ve7SgvUceI4GZOEg/edit?usp=drivesdk) |
| 2026-04-24 (sheet row 132) | **Satyaveer Singh** (Sr Manager Digital Marketing, Educational Institute) | Poweradspy + AdsGPT | Shreyash + Tejeshwini | ~55 min | Inconclusive; rep disconnected mid-demo; no commit; surfaced new "enterprise / informed-buyer" ICP | [`sales-playbook-satyaveer-edu-informed-buyer.md`](../tools/gdocs-uploader/examples/sales-playbook-satyaveer-edu-informed-buyer.md) | [link](https://docs.google.com/document/d/1s6Hzek2oh1FrtvnGqL-2d68jV3IlvbIQ4dQazi_nxi8/edit?usp=drivesdk) |
| 2026-04-24 (sheet row 131) | **Hasmukh-ji** (B kart India / dropship India, Shopify dropshipping) | AdsGPT | Shreyash | ~30 min | **Closed Starter ₹2,240** — payment deferred a few hours; consolidation pitch landed cleanly; no new ICP (Raja sub-segment) | [`sales-playbook-shreyash-bkart-dropship-consolidation.md`](../tools/gdocs-uploader/examples/sales-playbook-shreyash-bkart-dropship-consolidation.md) | [link](https://docs.google.com/document/d/18nZ8jUEmvTn28mgdXxUs79n9eyXMR0iN_XqX0Ds8yIE/edit?usp=drivesdk) |

The seven priority playbooks above are the deeply-analysed reference set (cross-call patterns + ICP mapping). Each call is documented with its own focused playbook (what's unique to that call); cross-call patterns are documented in the Tanmay coaching note.

### Full sheet sweep (2026-04-27)

In addition to the seven priority playbooks, **all 122 remaining sales calls in the tracker (S.No 2-129)** were processed via a parallel agent pipeline on 2026-04-27. Each generated a focused 30-60 line playbook covering: prospect snapshot, outcome, what was unique, and routine flags.

- **Location:** [`tools/gdocs-uploader/examples/sales-playbook-row-NNN-*.md`](../tools/gdocs-uploader/examples/) (one file per row)
- **Google Doc URLs:** column G of the [Demo update sheet](https://docs.google.com/spreadsheets/d/1tPuTeFB71HuGPSSXBVAWbe05x2-o4A6RSntGI8BLop0)
- **Skipped:** rows 40 and 122 (Fathom `/calls/` URLs that require authentication; marked `skip` in column F with a note in column G)
- **Total successfully processed:** 122 of 124 sales calls

### Second sweep (2026-05-20) — +51 rows

Continuation of the parallel-agent pipeline against the 51 rows added to the sheet since the April sweep (S.No 129, 136-184, 190-192). Run in 6 waves of 6–10 agents each, plus a new **Fireflies extractor** ([`tools/fathom-extractor/fetch_fireflies.py`](../tools/fathom-extractor/fetch_fireflies.py)) for the 2 Fireflies.ai recordings (S.No 142, 168).

- **Total newly processed:** 49 unique URLs → 51 sheet rows (including 2 duplicate-linked: S.No 157 → S.No 154 doc, S.No 167 → S.No 166 doc).
- **No additional skips** — every URL extracted successfully. The 2 prior skips (rows 40, 122) remain.
- **Process learnings:** the +3 S.No → sheet-row offset breaks at S.No 190 (the sheet is missing rows for S.No 185-189 entirely). Future sweep automation should resolve sheet-row via API lookup, not arithmetic.
- **Runbook addendum:** [`SALES_DEMO_RUNBOOK.md`](./SALES_DEMO_RUNBOOK.md) extended with a "May-2026 sweep" section covering 10 new findings and 4 new ICP variants.

**Headline findings from the May sweep:**

| Finding | Source row(s) | Severity / type |
|---|---|---|
| **Tenant sample-state bleed** — different customer's UGC content surfaced inside another prospect's session | 164 | HIGH — privacy / tenancy boundary; file immediately |
| Lead-capture CSV export ask | 167, 180 | Recurring feature gap |
| WhatsApp click-to-chat as first-class CTA destination | 156, 167, 180 | Recurring feature gap |
| Newspaper / print poster template | 171, 191 | Recurring feature gap |
| Brand IQ no-website / greenfield fallback | 159, 166, 169, 173, 184 | Feature gap — recurring across 5 rows |
| Sub-Starter pricing tier (sub-Rs.1,500) | 140, 146, 155, 160, 170, 173, 184 | Pricing gap — 7 rows lost or stalled on this |
| B2B / institutional targeting | 158 | New feature ask (school targeting via Meta interest fails) |
| Reseller / channel-partner program | 138, 159, 163, 179 | Recurring ask, no offering |
| "Clone Yourself / 30s video launches next week" rep promise without ship date | 141, 145, 156, 160, 162, 163, 170, 173, 179 | Sales-credibility risk; 9+ calls reference unshipped feature as imminent |
| Sora deprecation comms inconsistent (UI still shows it, reps explain verbally) | 148, 149, 150, 174, 178, 184 | Sales-process gap |

See the runbook addendum for the full per-ICP demo angle updates.

Highlights from the bulk sweep that warrant follow-up:

| Theme | Rows where it surfaced |
|---|---|
| **Verbal close** (closed/committing in-call) | 16 (Dog Home Foundation $1 Basic), 47 (Hasan Imam Starter Tue pay), 56 (Shipping Co Basic), 81 (A to Z Agri Basic), 83 (Apiqo Jewels Basic), 89 (ELICash 3-mo managed pilot), 108 (Harneet Madaan luxury skincare Starter), 131 (Hasmukh/B kart India Starter ₹2,240) |
| **Auto-targeting expectation gap** | 131 (filed as [#128](https://github.com/Globussoft-Technologies/adsgpt/issues/128)) — surfaced in many earlier calls too |
| **Demo-mode brand for prospects without website** | 18, 31, 48, 70, 88, 99, 102, 119, 131 (filed as [#127](https://github.com/Globussoft-Technologies/adsgpt/issues/127)) |
| **Hindi/regional-language UX gaps** | reinforced repeatedly (already filed as [#117](https://github.com/Globussoft-Technologies/adsgpt/issues/117)) |
| **App-only sellers blocked by auto-publish flow** | 30 — filed as [#133](https://github.com/Globussoft-Technologies/adsgpt/issues/133) |
| **Brand IQ silently fails on some prod URLs** | 59 — filed as [#131](https://github.com/Globussoft-Technologies/adsgpt/issues/131) |
| **Pricing-page misrepresents shared 500-credit pool as additive** | 59 — filed as [#132](https://github.com/Globussoft-Technologies/adsgpt/issues/132) |
| **Brand isolation bug — competitor logos bleeding into prospect creatives** | 100, 53/79 — filed as [#134](https://github.com/Globussoft-Technologies/adsgpt/issues/134) |
| **Edit-credit handling — re-edits burn full credits** | 25, 58 — filed as [#135](https://github.com/Globussoft-Technologies/adsgpt/issues/135) |
| **PowerAdSpy multi-platform Project view (LinkedIn+Google+IG)** | 18 (Kazim) — filed as [poweradspy#76](https://github.com/Globussoft-Technologies/poweradspy/issues/76) |
| **Same keyword search returning different results across logins** | 21 (Oneroof Solar) — filed as [poweradspy#77](https://github.com/Globussoft-Technologies/poweradspy/issues/77) |
| **VO3 lip-sync glitches** | 5, 19 — recurring video-quality issue (open: needs investigation) |
| **AdClarity-style bulk competitive lists** | 15 (American Express UK) — open: needs scoping |

Cross-call insights are summarised below; per-row details live in each playbook file.

---

## Cross-call insights (key learnings)

1. **The "marketer assigned" / consulting service is the highest-leverage SMB sales move.** Shreyash uses it (Dhan won in 11 min); Tanmay doesn't (Raja and Kavita stalled). It's currently tribal knowledge held by one rep. Productizing it (issues #113–#115) and training every rep on the talk-track (Dhan win-replay playbook) closes the execution gap.
2. **Four distinct SMB-and-up ICPs now:** *time-poor* (Raja: agency, knows what to do, wants speed), *expertise-poor* (Dhan/Kavita: needs guidance, not just tools), ***aspiring-agency*** (Shailesh: solo with a community/referral network, mid-call surfaces "I could resell this as an agency"), and ***enterprise / informed-buyer*** (Satyaveer: corporate marketing manager at a regulated-vertical employer, evaluates features against a checklist, won't tolerate vague answers). They respond to different demos. Signal: complaining about *time* vs *not knowing* vs unprompted *agency talk* vs *technical feature drilling*.
3. **A fifth ICP — API/platform integrator** — is different again (ad-scope.online). They need API access, async/webhook, bulk endpoints, etc. Not the SMB motion. Open question for leadership: do we pursue this ICP?
4. **Demo discipline matters.** Tanmay averages 40+ minute demos with multi-minute monologue stretches; Shreyash's win was 11 minutes with constant prospect engagement. Both rep-skill and process gaps.
5. **Tech-failure recovery is missing as both a sales process and a product capability.** The Kavita demo crash created a stalled deal we now have to recover from cold.
6. **Hindi/regional-language SMB is a real cohort** with real product gaps (English-only UI, no voice-input, default creatives are wrong region). Currently underserved.

---

## Coaching notes

Per-rep performance synthesis based on multiple calls. Located in [`coaching-notes/`](../coaching-notes/) (separate folder due to confidentiality).

| Rep | Note | Source calls |
|---|---|---|
| Tanmay Gurav | [`tanmay-coaching-note-2026-04-27.md`](../coaching-notes/tanmay-coaching-note-2026-04-27.md) · [Google Doc](https://docs.google.com/document/d/1ocuMIYFeboVlzN4lWDzDWBjkZ9armlb1KXE0smeN3TA/edit?usp=drivesdk) | Kavita 2026-04-24 + Raja 2026-04-27 vs Shreyash's Dhan 2026-04-27 |

---

## Product issues filed from these calls

### From Vincent Chacko (ad-scope.online, Feb 3) — `Globussoft-Technologies/poweradspy`

8 issues covering the B2B API gap:

| # | Title | Priority |
|---|---|---|
| [#66](https://github.com/Globussoft-Technologies/poweradspy/issues/66) | API-key authentication for B2B/OEM integrators | p0 |
| [#67](https://github.com/Globussoft-Technologies/poweradspy/issues/67) | Async pre-crawl + webhook for batch ad-data fetch | p1 |
| [#68](https://github.com/Globussoft-Technologies/poweradspy/issues/68) | Bulk multi-entity search endpoint | p1 |
| [#69](https://github.com/Globussoft-Technologies/poweradspy/issues/69) | Active/inactive ad status + retention docs | p1 |
| [#70](https://github.com/Globussoft-Technologies/poweradspy/issues/70) | Composite-entity search across URL + IG + TikTok + X + LinkedIn | p1 |
| [#71](https://github.com/Globussoft-Technologies/poweradspy/issues/71) | City-level geographic filtering | p2 |
| [#72](https://github.com/Globussoft-Technologies/poweradspy/issues/72) | Re-enable rate limiting + per-API-key quotas | p0 |
| [#73](https://github.com/Globussoft-Technologies/poweradspy/issues/73) | B2B partner accounts with metered API quotas | p1 |

Filed against poweradspy because Vincent specifically asked for Poweradspy data via API.

### From Raja P (Apr 27) — `Globussoft-Technologies/adsgpt`

10 issues #103–#112 (filed earlier; documented in [`PRODUCT_ISSUES_2026-04-27.md`](./PRODUCT_ISSUES_2026-04-27.md)).

### From Dhan Netha99 (Apr 27) — `Globussoft-Technologies/adsgpt`

3 issues productizing the consulting service:

| # | Title | Priority |
|---|---|---|
| [#113](https://github.com/Globussoft-Technologies/adsgpt/issues/113) | Surface the strategist consulting service inside AdsGPT for SMB users | p0 |
| [#114](https://github.com/Globussoft-Technologies/adsgpt/issues/114) | Productize the strategist consulting service as paid tier or add-on | p1 |
| [#115](https://github.com/Globussoft-Technologies/adsgpt/issues/115) | "Your strategist" workspace widget + persisted recommendations | p2 |

### From Kavita Sharma (Apr 24) — `Globussoft-Technologies/adsgpt`

1 issue covering tech-failure recovery:

| # | Title | Priority |
|---|---|---|
| [#116](https://github.com/Globussoft-Technologies/adsgpt/issues/116) | Sales-rescue self-serve walkthrough for prospects whose demo crashed or was rescheduled | p1 |

### From Shailesh Sharma (Apr 24, sheet row 133) — `Globussoft-Technologies/adsgpt`

6 issues from the Hindi 360°-photography demo + new aspiring-agency ICP signal:

| # | Title | Priority |
|---|---|---|
| [#117](https://github.com/Globussoft-Technologies/adsgpt/issues/117) | Hindi/regional-language prompting as a first-class UX signal | p0 |
| [#118](https://github.com/Globussoft-Technologies/adsgpt/issues/118) | Live SLOs + alerts on AdFactory site-analysis success rate + generation latency | p0 |
| [#119](https://github.com/Globussoft-Technologies/adsgpt/issues/119) | "Agency mode" framing on Individual plan + multi-client walkthrough | p1 |
| [#120](https://github.com/Globussoft-Technologies/adsgpt/issues/120) | Pricing page typography + "Share plan summary" link | p1 |
| [#121](https://github.com/Globussoft-Technologies/adsgpt/issues/121) | Replace "Generative AI / Agentic AI" jargon with outcome labels | p2 |
| [#122](https://github.com/Globussoft-Technologies/adsgpt/issues/122) | Lock "clone yourself" launch date + canonical sales messaging | p2 |

### From Satyaveer Singh (Apr 24, sheet row 132) — both repos

5 issues from the educational-institute / informed-buyer demo + the new enterprise ICP. Two products were discussed (Poweradspy + AdsGPT); issues split accordingly:

| # | Title | Priority | Repo |
|---|---|---|---|
| [poweradspy#74](https://github.com/Globussoft-Technologies/poweradspy/issues/74) | Surface paid vs organic ad classification (or document the limitation cleanly) | p1 | poweradspy |
| [adsgpt#123](https://github.com/Globussoft-Technologies/adsgpt/issues/123) | Video-from-reference-video — let users upload a sample and replicate it | p2 | adsgpt |
| [adsgpt#124](https://github.com/Globussoft-Technologies/adsgpt/issues/124) | Clarify multi-platform posting capability — UI copy + sales messaging | p1 | adsgpt |
| [adsgpt#125](https://github.com/Globussoft-Technologies/adsgpt/issues/125) | Sales process: rep-disconnection handoff checklist (live-demo continuity) | p2 | adsgpt |
| [adsgpt#126](https://github.com/Globussoft-Technologies/adsgpt/issues/126) | Re-frame "removed prompting" as Simple / Advanced modes | p2 | adsgpt |

### From Hasmukh-ji / B kart India (Apr 24, sheet row 131) — `Globussoft-Technologies/adsgpt`

2 issues from the dropshipping-consolidation close:

| # | Title | Priority |
|---|---|---|
| [#127](https://github.com/Globussoft-Technologies/adsgpt/issues/127) | Sales demo-mode: walk Brand IQ end-to-end without a prospect website | p1 |
| [#128](https://github.com/Globussoft-Technologies/adsgpt/issues/128) | Audience-targeting recommender inside Brand IQ / Ad Studio (read-only) | p0 |

### From the full-sheet bulk sweep (Apr 27, rows 2-129)

7 issues filed covering the highest-impact patterns surfaced across the 122-row sweep:

| # | Title | Severity | Source rows |
|---|---|---|---|
| [adsgpt#131](https://github.com/Globussoft-Technologies/adsgpt/issues/131) | Brand IQ silently fails on some prod URLs (works on staging) — needs reliability instrumentation | High | 59 |
| [adsgpt#132](https://github.com/Globussoft-Technologies/adsgpt/issues/132) | Pricing page misrepresents 500-credit shared pool as additive (creates trust gap at close) | High | 59 (recurring theme) |
| [adsgpt#133](https://github.com/Globussoft-Technologies/adsgpt/issues/133) | App-only sellers blocked by auto-publish flow that assumes website URL | Medium-high | 30, 33, 71, 85 |
| [adsgpt#134](https://github.com/Globussoft-Technologies/adsgpt/issues/134) | Brand isolation bug: foreign brand logos / elements bleeding into prospect creatives | High | 100, 53/79, 115 |
| [adsgpt#135](https://github.com/Globussoft-Technologies/adsgpt/issues/135) | Edit-credit handling: re-edits burn full credits, cuts effective video count from 9 to 4-5 | Medium-high | 25, 58 |
| [poweradspy#76](https://github.com/Globussoft-Technologies/poweradspy/issues/76) | Multi-platform Project view: stack LinkedIn + Google + Instagram side-by-side, not just Meta | High (agency ICP) | 18 |
| [poweradspy#77](https://github.com/Globussoft-Technologies/poweradspy/issues/77) | Keyword-search login determinism bug: same query returns different results across user accounts | High (credibility-killing) | 21 |

---

## Open follow-ups (across all calls)

1. **Vincent Chacko (ad-scope.online)** — owe a yes/no email on API access + 1k/day pricing + inactive-ad retention. Blocked on leadership ICP decision (pursue API/platform ICP, or focus on humans). Until decided, the deal is parked.
2. **Kavita Sharma** — Tanmay still owes the rescheduled Meet link. The next demo cannot fail — read the Kavita playbook for the pre-flight checklist + Hindi consulting talk-track.
3. **Raja P** — manual trial granted, decision in 24–48h. Follow-up email scaffold in his playbook.
4. **Dhan Netha99** — committed to buy Startup plan + needs consultant intro within 24h of payment confirmation. Critical retention moment.
5. **Sales-team-wide** — bake the consulting talk-track into onboarding (action item from the Dhan win-replay playbook).
6. **Sales lead + product** — lock down whether the consulting service is included in standard plans or a paid add-on. Tanmay was confused on the Kavita follow-up; this needs settling before the next call.

---

## Tooling

The `tools/gdocs-uploader/` directory contains the markdown → Google Docs publisher we use for sharing playbooks. To publish a new playbook from any machine (home, office), see [`tools/gdocs-uploader/SETUP.md`](../tools/gdocs-uploader/SETUP.md).

To clone fresh and pick up where we left off:

```bash
gh repo clone Globussoft-Technologies/adsgpt
cd adsgpt
# Read this index first:
cat docs/SALES_CALL_ANALYSES.md
# All playbooks are under tools/gdocs-uploader/examples/
ls tools/gdocs-uploader/examples/
# Coaching notes (confidential):
ls coaching-notes/
```

---

## Adding a new call analysis

When a new sales call needs to be analyzed:

1. Use the gdocs-uploader's Playwright extraction script to pull the Fathom transcript:
   ```bash
   node /path/to/fetch.mjs "https://fathom.video/share/<id>" "/tmp/extracted/"
   ```
2. Write a focused playbook under `tools/gdocs-uploader/examples/sales-playbook-<prospect-tag>.md`. Each playbook should focus on what's *unique* to that call — don't duplicate cross-cutting patterns.
3. File product issues against the relevant repo (adsgpt for AdsGPT, poweradspy for Poweradspy data API).
4. Update **this file** (`docs/SALES_CALL_ANALYSES.md`) with a new row in the "Calls analyzed" table.
5. If the call belongs to a rep with multiple recent calls, consider updating or creating a coaching note in `coaching-notes/`.
6. Commit + push to `main`. Upload to Google Docs via the gdocs-uploader for shareable access.
