# AdsGPT Sales Demo Runbook

**Audience:** every rep running an AdsGPT (or AdsGPT + PowerAdSpy) demo.
**Purpose:** convert the patterns observed across **181 sales calls** (122 original sweep + 51 May-2026 sweep + 8 priority deep-dives) into a repeatable demo flow.
**Length:** 4 pages + addendum. Read once, scan before every demo.

---

## Page 1 — Before the call (T-15 to T-0 minutes)

You will lose deals you should win if you skip this page. Across the 122-call sweep, the single most reliable close-driver was **pre-loading Brand IQ on the prospect's brand before the call starts**. Specifically: rows 77, 80, 81, 83, 89, 96. The single most preventable loss-driver was opening with screen-share / audio / credit-balance failures (rows 19, 24, 49, 50, 60, 119).

### 15 minutes before the call

1. **Pull the prospect's website / brand into Brand IQ.** Generate the brand profile. Review the output — does it look like the prospect's actual business? If not, fix manually before the call.
2. **Pre-generate one ad creative on their brand.** Use Nano Banana Pro or Imagen depending on whether they care about realism vs polish. Save it.
3. **Pre-generate one short ad video on their brand.** ~12 seconds. Save it. This is your fallback if live generation fails on the call.
4. **Pull 2–3 finished samples from their vertical** (jewelry, travel, edtech, pharma, real-estate, etc.). Don't show samples from outside their vertical — Mamaearth shown to a jewelry buyer (row 107) and parenting brand to real-estate (row 58) both killed engagement.

### 5 minutes before the call

5. **Tech check:** screen-share permissions, audio working both ways, account has ≥100 credits left, Brand IQ pages load.
6. **Read the CRM note:** prior touches? referral? returning skeptic? Already on a trial?
7. **Have your 30-second differentiation hook ready:**
   > *"ChatGPT and Gemini answer questions. AdsGPT builds the creative, generates the video, and posts the ad. We're a campaign builder, not a chatbot."*
   This kills the "how is this different from ChatGPT?" question that ate 5+ minutes on rows 23 and 32.

### Don't bother

- Don't show up cold and ask for a competitor URL on the call (rows 18, 31, 48, 70, 88, 99, 102, 119, 131). Brittle, vertical-dependent, breaks the cognitive arc. Use the pre-built demo brand library.
- Don't pre-bundle PowerAdSpy material unless the prospect explicitly asked for competitor research. Bundling early created sticker shock in row 46 (Plan My Tour) and lost the deal.

---

## Page 2 — First 10 minutes (discovery + opener)

Your job in the first 10 minutes is to figure out whether this is a deal you can close, what plan tier fits, and what version of the demo this prospect actually needs. Reps who spend the first 30 minutes on a feature tour and *then* do discovery (rows 64, 109, 117, 119) consistently lose. Reps who do discovery first (rows 89, 131) consistently close.

### Discovery checklist (by minute 5 you should know)

| What | Why |
|---|---|
| **Vertical / business model** | Determines which sample library to pull from |
| **Current ad stack** (which tools, which platforms) | Names ≥2 tools → use the consolidation pitch |
| **Monthly volume** (images, videos, ad spend) | Determines plan tier — don't pitch Starter to a high-volume buyer (row 107) |
| **Main pain** (time? expertise? cost? quality?) | Tailors the demo emphasis |
| **Decision-maker** | Are they it, or is "let me check with my partner/husband/manager" coming? |
| **Has a website / app / neither?** | App-only buyers blocked by current publish flow ([#133](https://github.com/Globussoft-Technologies/adsgpt/issues/133)) — qualify it now, not at minute 25 |

### Opener script (60 seconds)

> "Before I jump into the tool — tell me about your business, what you're running for ads today, and the single thing that's eating most of your time."

Then **listen**. Don't pitch yet. Let them name the pain.

### ICP-signal listening

| If they say... | Pitch this |
|---|---|
| "I'm using Copy.ai + Canva + ChatGPT + ad library" | **Consolidation** — fewer tabs, one tool replaces three (row 131 closed in 30 min on this) |
| "I just want speed, I know what to do" | **Time-poor / agency** — lead with Ad Factory bulk + 30-second generation |
| "I don't really know what to post" | **Strategist consulting service** — see Dhan win replay; this is the highest-leverage SMB move |
| "I'm thinking of running ads for friends / clients" | **Aspiring-agency** — "Agency mode" framing on Individual plan |
| "We're an enterprise / large team" | **Enterprise / informed-buyer** — slow down, expect feature-checklist questions |
| "I tried the trial, it's not working" | **Diagnose first.** Ask: what didn't work? what got generated? what was missing? Don't re-demo until you know (rows 106, 111 lost on this) |
| "I declined this 1.5 years ago" | **Returning skeptic** — lead with what's changed since their last evaluation (row 6 Canam, row 17 NeoFinity churn win-back) |

### Before you start the demo

8. **Drop the 30-second hook** ("ChatGPT answers; AdsGPT builds + posts").
9. **Confirm time:** *"We have 30 min — what's the most important thing for you to see?"* Lets them prioritize, lets you cut features that don't matter to them.
10. **Banner the free-trial video gating** if relevant: *"Heads up — the free trial generates images, not videos. Videos are on the paid tiers. Want me to walk through both?"* Disclosing this at minute 25 (rows 70, 72, 75, 78) is a deal-killer.

---

## Page 3 — Demo body (the close-driver moves)

Demo length matters. Shreyash's 11-minute Dhan win is the benchmark; Tanmay's 40+ minute averages consistently lose. **Target: 12–15 minutes of demo proper, then pricing.**

### The opening 60 seconds of demo

11. **Open with the pre-loaded brand.** *"I went ahead and pulled your brand into our system before this call so we can move fast — here's what it found."* This is the moment they realize you did your homework. Don't skip it.
12. **Show the pre-generated creative.** *"And I had it generate a sample ad for you — here's the result."* This puts a finished artifact on screen in the first 90 seconds, way before any prospect would expect to see one.

### The brand-on-brand live demo (5–7 minutes)

13. **Generate ONE ad creative live, using their actual brand.** Their SKU. Their logo. Their phone number. Their tagline. The closer the artifact is to "this is mine," the more engaged they are (rows 12, 50, 51, 99, 117).
14. **Generate ONE short ad video live** on their brand. Talk through the loading time — fill it with the credit-math explanation (page 4) or with a sample-video walkthrough. Don't watch the spinner in silence.
15. **Run the competitor-recreate hook** — pull a known competitor's ad → recreate it in the prospect's brand. Rows 28 (Apollo→Preeti), 52, 71, 76, 78, 102 all closed (or moved warm) on this moment.

### The 30 seconds that prevent objections

16. **Translate credits into outcomes.** Never say "500 credits" without immediately following with "which is roughly 8 videos per month or 70 high-quality images." Customers don't think in credits; they think in deliverables (rows 51, 56, 83, 96).
17. **State the targeting boundary clearly.** *"AdsGPT builds the creative and posts the ad. Audience targeting is set in Meta Ads Manager — we don't override your targeting choices, we recommend audiences alongside (issue [#128](https://github.com/Globussoft-Technologies/adsgpt/issues/128))."* This pre-empts the recurring "does AI also pick the audience?" objection (row 131 verbatim).

### Off-script asks — the deflection

When the prospect asks about a feature you don't have or aren't sure about (rows 44 AI calling agent, 49 Hindi voice), use this template:

> *"Great ask. Roadmap shows [feature] in [specific date if you know it; "the next few weeks" only if you genuinely know that]. Want me to flag your account so we can ping you when it ships?"*

Then **actually flag it.** Promise discipline matters — row 49 had the same rep quote two different ETAs in the same call. Write down what you said.

### Things that kill the demo (avoid)

- **Don't generate output in vertical that's not theirs** — pulling Mamaearth ads for a jewelry buyer wastes credits and breaks engagement
- **Don't bundle PowerAdSpy** unless they asked for competitor research — row 46 lost the deal on this
- **Don't run multiple AI models back-to-back** to "show options" — pick one, run it, move on. Three-model showcase is for technical buyers (rows 38, 102), not SMBs
- **Don't talk past 15 minutes of demo without checking in** — *"Anything specific you want to dig into?"* every 5 minutes keeps it engagement-first

---

## Page 4 — Pricing, close, and follow-up

### Anchoring

18. **Anchor on Starter (₹2,000 / 500 credits).** Show it first. Use the agency-cost frame: *"Most agencies charge ₹15–20K per video and ₹1,400–1,500/month for done-for-you. Starter is ₹2,000 for ~10 videos plus 500 credits worth of images — and you keep control."* This frame closed rows 9, 47, 57, 58, 81.
19. **Drop to Basic (₹1,200) only if they hesitate.** Two-rep tag-team (one rep does the Starter pitch, second rep handles the Basic downsell) closed row 16 (Dog Home Foundation $1 trial close) cleanly. Don't lead with the cheap tier — lets them self-select up.
20. **For high-volume prospects, skip Starter entirely.** Quote Individual (₹4,000–5,000) or custom. Row 107 (Rare Luxury, multi-store franchisee, ₹70k+ AOV) was underpriced when offered Starter.

### What not to do

- **Don't drop pricing 3 times in 60 seconds.** Row 46 (Plan My Tour) went 5K → 3.5K → 2.5K and looked elastic. Anchor, hold, **trade discount for commitment** (extra trial credits for credit card on file, free month with annual pre-pay, etc.)
- **Don't share the base-model cost.** Internal rule from row 66 training: pitch is "we're 1 cent above OpenAI/Gemini enterprise rate." If sophisticated prospects benchmark, the gap better be real — flag if you're being pushed for line-item disclosure.
- **Don't over-promise on roadmap.** Hindi voice, Indian-face avatars, longer videos — all real customer asks (rows 49, 102, 70, 85). Quote dates only if you know them. Better to say *"I'll confirm by EOD on WhatsApp"* than guess.

### Close attempts

In order — try each before falling back to the next:

21. **Close attempt 1 — sign up now:** *"Want me to set up the trial right now while we're on the call? I can send the credentials in the next 60 seconds."*
22. **Close attempt 2 — pin trial + concrete next step:** *"Let me start the trial today, I'll send credentials and a sample creative on WhatsApp by [time]. Can we lock in 15 min on [day, time] to walk through your trial results?"*
23. **Close attempt 3 — concrete next step only:** *"Let me send you a sample creative + the demo recording today. Talk on [day, time]?"* Always a date AND time. *"I'll WhatsApp you sometime"* is a dead deal (rows 76, 77, 80, 99).

### Handoff (within 30 minutes of the call)

Send via WhatsApp:

1. **Trial credentials** (if active)
2. **Pre-generated creative + video** for their brand (the ones from page 1)
3. **Demo recording** if they missed something
4. **Calendar link** with the locked follow-up slot

For paid customers from this call: also send invoice link, payment confirmation, and the customer-success / training-call calendar invite.

### Promise tracker

Open a note. Write down every commitment you made on the call:

- Feature ETAs you quoted ("Avatar in 2 weeks")
- Pricing you offered ("I'll send the ₹1,500 custom plan")
- Materials promised ("3-4 sample videos in their vertical")
- Next-call agenda items

If you said it on the call, the prospect remembers it. Match the next conversation to the last one.

---

## Sidebar — Kill-switch checklist (read before every demo)

- [ ] Brand IQ pre-loaded on prospect's actual brand
- [ ] One ad creative + one short video pre-generated as fallback
- [ ] Vertical-tagged samples (2-3) ready
- [ ] Audio + screen-share + account credits checked
- [ ] 30-second differentiation hook scripted
- [ ] CRM note read (prior touches? returning? trial state?)
- [ ] If prospect has no website: use prebuilt demo brand, **not** competitor URL
- [ ] Free-trial video gating disclosed in first 60 seconds
- [ ] Discovery done before demo, not after
- [ ] Pricing anchored once, not dropped 3× in 60 seconds
- [ ] Close attempted explicitly (not "let me know")
- [ ] Follow-up has date AND time, not "sometime"
- [ ] Promise tracker updated within 30 minutes of call

---

## Sidebar — ICP one-liners

| ICP | One-line pitch |
|---|---|
| **Time-poor SMB / Raja** | *"One tool replaces your three. Faster generation, posts to Meta directly."* |
| **Expertise-poor / Dhan-Kavita** | *"You don't write the ad. We do. You approve it and we post it."* |
| **Aspiring-agency / Shailesh** | *"Run multiple client brands from one Individual plan."* |
| **Enterprise / Satyaveer** | *"Bulk creative across 50+ creators, custom plan, dedicated CSM."* |
| **API/platform / Vincent** | *"B2B API access, async pre-crawl + webhook, bulk endpoints"* — refer up; this isn't the SMB motion |
| **Consolidation buyer / Hasmukh** | *"Fewer tabs. Same ad workflow. ₹2,240/mo replaces what you're doing across 3 tools."* |
| **Single-location low-volume / Bose** | *"Honestly, Starter is more than you need — we should look at a smaller pack"* (today: refer up; future: needs a "lite" SKU) |
| **Multi-business / Deepak** | *"Brand IQ saves all five of your brands. Switch between them in two clicks."* |
| **Returning skeptic / Canam-NeoFinity** | *"Last time you said [X] was missing. Here's what's changed since."* |
| **Self-sufficient DIY / Aditya-Sandeep** | Skip basics. *"Reels and one-tool campaign launch — that's the new piece you don't have today."* |
| **App-only edtech** | Today: blocked by publish flow. Position trial creatives for use *outside* AdsGPT until [#133](https://github.com/Globussoft-Technologies/adsgpt/issues/133) ships. |
| **Quality-only pharma / regulated** | Skip image gen, skip auto-publish, skip targeting. *"Show me your AI video."* That's the only feature they care about. |
| **Reseller / freelancer agency-of-one** (rows 140, 146, 155, 160, 170) | *"One Individual plan, your branding, runs creative for all your clients."* — needs a sub-Starter tier; today there's no answer between trial and ₹2,300. |
| **Greenfield / pre-launch SMB** (rows 159, 166, 169, 173, 184) | *"You don't need a website to start. We set up Brand IQ manually with your product photos and brand brief."* — confirm Brand IQ manual fallback exists before pitching. |
| **Buyer-with-model-list** (rows 169, 183) | Show you know the model stack: name Nano Banana Pro / OpenAI / Imagen / Seedance / Veo / Sora with per-use-case strengths and credit costs. Don't bluff. |
| **Mobile-in-transit demo** (row 172) | Decline if you can. If you can't: phone audio + screen-share separately, defer screen-heavy features to post-call WhatsApp samples. |
| **Post-sale training / CSM cohort** (rows 137, 192) | Different motion: refuse "watch-only" demo, force hands-on, switch models for regional-language text (OpenAI > Imagen for Telugu). |

---

## Addendum — May-2026 sweep update (+51 rows, S.No 129, 136-184, 190-192)

> **What changed since the runbook v1:** 51 additional calls processed end-to-end (rows 129-192, minus skips and duplicates). Three reps in heavy rotation (Tanmay, Shreyash, Tejeshwini); one Aarya call. Four new ICPs surfaced; two new product gaps worth filing immediately; existing recurring patterns reinforced 5–10× over.

### Patterns reinforced (existing learnings, more evidence)

| Pattern | Original rows | May rows that confirm |
|---|---|---|
| 35-credit / 7-day trial too small | 088, 105, 110 | 146, 160, 170, 174, 178, 184, 191 (≈10× confirmation) |
| USD default for INR buyers | 103, 108 | 150, 156, 160, 163, 165, 166, 170, 172, 174, 181 |
| Sora deprecation comms inconsistent | 088 | 148, 149, 150, 174, 178, 184 (UI still shows Sora; reps explain verbally) |
| "Clone Yourself / 30s video next week" ship-date promise | 088 | 141, 145, 156, 160, 162, 163, 170, 173, 179 — every Tanmay call mentions it. **Stop promising before product confirms.** |
| Multi-brand isolation worry | 053, 100 | 167, 191 ("if I have 10 projects will AI confuse them?") |
| Audio dropouts / Tanmay AV issues | 067, 097, 101 | 145, 161, 172, 175 — **AV pre-flight is still missing** |
| In-call trial provisioning gap | many | 146, 170, 172, 174, 184 — buyers want self-serve, reps still WhatsApp creds |

### **New** findings (file as issues — none yet filed)

1. **Tenant sample-state bleed** (row 164, Mathel) — a cached Colors Digital Hub UGC voiceover played inside a different prospect's session view. **Privacy/security HIGH-severity** — different customer's content surfaced in another customer's demo. Needs immediate investigation.
2. **Lead-capture / Excel-CSV export** (rows 167, 180) — Indian SMBs explicitly ask to download Meta lead-form submissions as CSV. Currently routed to Meta's UI; rep can't show in-product surface.
3. **WhatsApp click-to-chat as first-class CTA destination** (rows 156, 167, 180) — buyers default to wanting WhatsApp leads; product only supports website-link CTAs.
4. **Newspaper / print poster template** (rows 171, 191) — recurring ask, no current template in Ad Factory.
5. **Brand IQ no-website / greenfield fallback** (rows 159, 166, 169, 173, 184) — manual Brand IQ setup workflow exists in reps' heads but not in product UX. Needs a first-class "I don't have a website yet" path.
6. **Sub-Starter pricing tier** (rows 140, 146, 155, 160, 170, 173, 184) — solo freelancers and Rs. 200/day Meta spenders need something between trial (1 day, 35 credits) and Starter (Rs. 2,300/mo, 300 credits). Reps lose these to "let me think about it" because the price feels disproportionate to their cadence.
7. **B2B / institutional targeting** (row 158) — *"target 14 lakh UP schools, not parents"*. Meta interest-targeting can't deliver. Needs LinkedIn integration or CSV-based audience upload.
8. **Reseller / channel-partner program** (rows 138, 159, 163, 179) — recurring ask, no documented offering. Either commit to one or update macros to say no clearly.
9. **Fireflies-source playbook tag** (rows 142, 168) — Fireflies AI-summary recordings produce less rich playbooks than Fathom transcripts (no turn-by-turn). New `fetch_fireflies.py` ships in this sweep. Future: capture buyer-side names and outcomes at sheet-entry time so reviewers know fidelity loss isn't due to playbook quality.
10. **Sheet-row offset is non-uniform** (process-learning) — sheet row ≠ S.No + 3 reliably. Future automation must look up actual row via API, not arithmetic. (Cost us 6 misaligned writes in the wave 6 dispatch.)

### New ICP variants discovered

| ICP | Source rows | Demo angle |
|---|---|---|
| **Sub-Starter solo / agency-of-one** | 140, 146, 155, 160, 170, 184 | Manual quote; flag for product as Lite-tier evidence |
| **Greenfield / pre-launch SMB** | 159, 166, 169, 173, 184 | Manual Brand IQ; defer website-bundle pitch to close |
| **Buyer-with-model-list** | 169, 183 | Open with model-stack credibility; have credit-per-model math memorised |
| **Mobile-in-transit demo** | 172 | Phone audio + screen-share, defer screen-heavy to WhatsApp |
| **Post-sale training cohort** | 137, 192 | Force hands-on; different motion from pre-sale; tag CRM accordingly |
| **Tax / professional-services solo** | 182 | Personal-name invoice ask = sole-proprietor; price-anchor at Starter |
| **Financial-services / DSA broker** | 179 | Post-layoff buyer = freed budget = annual close possible from jump |
| **Faith-based commerce** | 145, 156, 178 | Faith-specific avatar pack missing — add to demo deck once available |

### Rep-specific observations (May sweep)

- **Tanmay** — 21 calls in the May sweep. Strongest pattern: **repeated "next week" ship-date promises** (Clone Yourself, 30s video, 1-min UGC). At minimum 5 calls reference an unshipped feature as imminent. **Action:** publish a ship-date register; Tanmay should reference it before promising.
- **Shreyash** — 18 calls. Strongest closer of the May sweep. Patterns to copy: real-time data over demo data, configures-live to buyer's stated threshold, honest model deprecation disclosures, sample-runner pattern (rotating through 3-5 vertical samples).
- **Tejeshwini** — 7 calls. Vertical-specialist (healthcare, real-estate, mattress-services). Cleanest "video-only buyer" handling (row 180 — pivoted from full-platform to Rs. 2,400 custom video when buyer de-scoped Ads Manager).
- **Aarya** — 1 call in May sweep (row 12 was pre-May). Compounding her ICP-D expertise.

### Top 3 things to do this week (May sweep action items)

1. **Investigate tenant sample-state bleed (row 164).** Highest-severity finding. Different customer's UGC content surfaced in another prospect's session. Could be a session-storage or cache key bug, but worst-case is a tenancy boundary issue.
2. **Decide on Lite tier.** 7+ rows this sweep would have closed with a Rs. 800–1,200/mo SKU. Cumulative across both sweeps: 15+ rows. The opportunity cost of *not* shipping Lite is now compounded.
3. **Stop verbal "Clone Yourself launches next weekend / next Monday" claims** until product publishes a ship date. Sales credibility is taking hits the rep doesn't see (calls drop off after the promise window expires).

### Updated pre-demo checklist additions

- [ ] If prospect named a competitor model stack in pre-call email → memorise our model lineup + credit cost per model
- [ ] If prospect's website is not live → use pre-built demo brand, NOT a similar competitor URL (privacy concern — see row 164 tenant bleed)
- [ ] If buyer-side recording is Fireflies (not Fathom) → flag in CRM; expect lossy summary
- [ ] If prospect is greenfield/pre-launch → confirm manual Brand IQ flow works on your tenant before sharing screen
