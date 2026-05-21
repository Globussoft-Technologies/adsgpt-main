# Product issues — 2026-04-27 demo-call review

> Sourced from a 42-min demo call with **Raja P** (solo digital marketer, Tamil Nadu, 2–3 clients) on 2026-04-27. Each issue cites the timestamp from the call transcript and proposes a concrete fix with acceptance criteria.
>
> **All 10 issues filed on GitHub on 2026-04-27 evening.** Live tracking moved to GitHub Issues (links below). This file remains as the canonical source / context dump.
>
> | # | Issue | Status |
> |---|---|---|
> | 1 | Differentiate AdsGPT generations from raw Gemini in the UI | [#103](https://github.com/Globussoft-Technologies/adsgpt/issues/103) |
> | 2 | Lead with Autopilot in the Ads Manager experience | [#104](https://github.com/Globussoft-Technologies/adsgpt/issues/104) |
> | 3 | Self-serve trial that includes video generation | [#105](https://github.com/Globussoft-Technologies/adsgpt/issues/105) |
> | 4 | BrandIQ should ask for primary audience region | [#106](https://github.com/Globussoft-Technologies/adsgpt/issues/106) |
> | 5 | In-product credit estimator on every generation form | [#107](https://github.com/Globussoft-Technologies/adsgpt/issues/107) |
> | 6 | Replace AI-model brand names with outcome labels | [#108](https://github.com/Globussoft-Technologies/adsgpt/issues/108) |
> | 7 | "Improve with Gemini" prompt-improver loses user intent | [#109](https://github.com/Globussoft-Technologies/adsgpt/issues/109) |
> | 8 | Plan for the Sora deprecation / API access change | [#110](https://github.com/Globussoft-Technologies/adsgpt/issues/110) |
> | 9 | Reconsider top-level naming: BrandIQ / AdStudio / AdFactory | [#111](https://github.com/Globussoft-Technologies/adsgpt/issues/111) |
> | 10 | Multi-client agency view: fast brand switcher | [#112](https://github.com/Globussoft-Technologies/adsgpt/issues/112) |
>
> Labels created and applied (15 total): `area:autopilot`, `area:ad-studio`, `area:brand-iq`, `area:onboarding`, `area:pricing`, `priority:p0`, `priority:p1`, `priority:p2`, `effort:S`, `effort:M`, `effort:L`, `type:bug`, `type:ux`, `type:positioning`, `type:risk`.

---

## Issue 1 — Differentiate AdsGPT generations from raw Gemini in the UI

**Labels:** `area:ad-studio`, `type:positioning`, `priority:p0`, `effort:M`

**Quote (transcript 19:11):** _"What's the difference between Gemini? There I can also get the same model. If I give the prompt to Gemini, they will also give. So what is the difference between your AI and Gemini?"_

**Problem.** Prospects looking at a single generated image have no way to see why AdsGPT is worth a paid subscription versus prompting raw Gemini for free. The output looks like an ordinary AI image. The orchestration we apply (brand kit injection, audience region, brand-voice constraints, CTA, platform-specific aspect, model auto-selection) is invisible at the moment of viewing the result.

**Proposed fix.**
1. Add a **"Brand-aware applied"** chip on every generated creative listing the constraints actually injected into the prompt: brand kit, voice, region, palette, CTA, platform.
2. Add a **"Compare to vanilla Gemini"** toggle on the result page that re-runs the user's raw prompt through Gemini with no brand context and shows the two side by side. Cache the comparison so it runs once per generation.
3. Update the empty-state of Ad Studio to a 3-bullet differentiator (orchestration / brand consistency / multi-platform fit), not a generic "Generate ads" CTA.

**Acceptance criteria.**
- Every generation in Ad Studio shows a "Brand-aware applied" chip listing ≥3 constraints injected.
- Compare toggle renders a side-by-side within 6s of clicking, served from cache on re-toggle.
- Conversion-funnel event (e.g. `ad_studio.compare_clicked`) tracked.

---

## Issue 2 — Lead with Autopilot in the Ads Manager experience

**Labels:** `area:autopilot`, `area:onboarding`, `type:positioning`, `priority:p0`, `effort:M`

**Quote (transcript 28:54).** Tanmay's mention of Ads Manager / audit was a 38-second aside in a 42-minute demo. He described the Audit feature in one sentence ("if it's critical, it's warning, opportunity") and moved on. The strongest differentiator vs every other AI creative tool — **continuous audit + auto-pause/resume/scale** — was effectively buried. A solo agency owner managing 2–3 clients is precisely the Autopilot ICP.

**Proposed fix.**
1. After a user connects Meta in Ads Manager, default the active tab to **Autopilot Overview**, not Analytics.
2. The Connect Meta success state should say something like: *"Autopilot is auditing your account. We'll show you what's underperforming in 30 seconds."* Auto-fire `POST /autopilot/audit/run` for the just-connected account so the user sees real findings on first arrival.
3. Add a "What is Autopilot?" 3-card explainer above the empty Action Log: hourly audit + dry-run-by-default + per-account safety gate.
4. Sales-script update (out of repo): Tanmay's deck needs an Autopilot demo card. Flag to revops.

**Acceptance criteria.**
- New Meta connections land on Autopilot Overview with at least one audit row visible (or a clear "no findings — your account looks healthy" empty state).
- The first audit completes <30s after Meta connection on a typical account.
- Time-to-first-Autopilot-row event tracked.

---

## Issue 3 — Self-serve trial that includes video generation

**Labels:** `area:onboarding`, `area:pricing`, `type:ux`, `priority:p0`, `effort:M`

**Quotes (transcript 33:24, 39:00–39:46).** _"In a trial, there is no video, no?"_ — Raja explicitly wanted to evaluate video output and couldn't. _"Free trial is for one day only."_ — even Tanmay was confused mid-call about trial length. He had to **manually** grant Raja a 24h, 35-credit, image-only trial.

**Problems.**
1. Trial is sales-gated, not self-serve.
2. No video generation in trial — but video is the headline differentiator of the tool. Image-only trial fails to sell the product.
3. 1 day, 35 credits is too restrictive for a real evaluation.

**Proposed fix.**
1. `/signup` self-serve flow with email confirm. No sales-call gate.
2. Trial: **7 days, 60 credits, includes 1 video generation** (limit Sora 4K to a single 5–10s render to cap cost).
3. Trial users see a "Trial: X credits left, Y days remaining" banner site-wide.
4. End-of-trial CTA into the cheapest paid tier with one-click upgrade.

**Acceptance criteria.**
- A new email can sign up, confirm, log in, and generate one image + one video without any human approval.
- Trial expiry behaviour tested: post-expiry users hit a paywall instead of a hard 500.
- Conversion funnel measured: signup → first generation → video generation → paid.

---

## Issue 4 — BrandIQ should ask for primary audience region and inject it into all prompts

**Labels:** `area:brand-iq`, `area:ad-studio`, `type:ux`, `priority:p1`, `effort:S`

**Quote (transcript 19:11):** _"In South Indian we need the images. It's not much impressive images. It's like local face or something like that."_

**Problem.** AI image generation defaults to generic/Western-looking faces unless explicitly prompted otherwise. Raja had to manually add "South Indian face" in his prompt. For the Indian SMB market this will be the #1 creative-quality complaint we hear repeatedly.

**Proposed fix.**
1. Add a **"Primary audience region"** field to the BrandIQ brand-setup form (alongside palette / voice / don'ts). Free-text + suggested chips ("South India", "North India", "SE Asia", "MENA", "LATAM", etc.).
2. Inject the region into every downstream prompt for that brand — Ad Studio, Ad Factory, AI Avatars (default avatar selection should match).
3. Backfill: BrandIQ row migration sets `region: null`, prompt should noop when null (no behaviour change for existing brands).

**Acceptance criteria.**
- New brands collect region during setup; existing brands prompt the user to fill it on next BrandIQ visit.
- Region appears in the saved prompt's debug view.
- Avatar picker default matches region when populated.

---

## Issue 5 — In-product credit estimator on every generation form

**Labels:** `area:pricing`, `area:ad-studio`, `type:ux`, `priority:p1`, `effort:S`

**Quote (transcript 37:35–38:30).** Raja: _"For one creative, how much you will spend a month for ad credits?"_ Tanmay had to look it up live, then quote a per-second formula (4–10 credits/sec depending on model). Raja did the math in his head: 21s × 10 = 210 credits → most of a 300-credit month plan on one video.

**Problem.** Credit cost is opaque at decision time. Users discover the cost only after the fact when their balance drops. For SMB users on tight budgets this is a hard-stop friction.

**Proposed fix.**
1. Add a live **"Will use ~X credits"** chip next to every "Generate" button in Ad Studio / Ad Factory / AI Avatars / Video.
2. The chip updates as the user changes ratio / duration / variation count / model.
3. A second chip shows **"You have N left after this"** so users can decide whether to proceed.
4. The credits page gets a **"What can I do with X credits?"** panel: e.g. "300 credits = 300 images OR 30s of 4K video OR 100 ad copies OR a mix."

**Acceptance criteria.**
- Estimator is accurate to ±10% of actual debit (edge cases: improver token reroll, model fallback).
- Generate button is disabled with a "not enough credits" tooltip when estimator > balance.
- Credits page panel updates live as the user drags a "what if" credit slider.

---

## Issue 6 — Replace AI-model brand names with outcome-named labels

**Labels:** `area:ad-studio`, `type:ux`, `priority:p2`, `effort:S`

**Quote (transcript 12:30–13:00).** Tanmay had to verbally explain to Raja: _"I'm selecting nano banana because nano banana is good at image generation."_ A non-technical SMB user has no way to choose between "Nano Banana Pro", "OpenAI", "Imagen", "Sora 4K", "Veo", "Vivo Fast".

**Problem.** The model picker exposes implementation. Users want benefit ("best for product shots", "fastest"), not vendor brand names.

**Proposed fix.**
1. Replace every model dropdown label with the outcome:
   - Image: **Photorealistic (slowest, best quality)** / **Stylised (fastest)** / **Best for product shots** / **Best for lifestyle**
   - Video: **Cinematic 4K (highest cost)** / **Fast 1080p** / **Animated explainer**
2. Show the underlying model brand in a small caption beneath the label so curious users can tell.
3. Auto-select the recommended model based on the chosen platform + ratio + content type. Power users can override.

**Acceptance criteria.**
- No model brand name (`Nano Banana`, `Sora 4K`, `Imagen`, `Veo`) appears as the primary label in any picker.
- Default selection on a fresh form matches the platform/ratio/content combo.
- Picker is keyboard-navigable and accessible.

---

## Issue 7 — "Improve with Gemini" prompt-improver loses user intent

**Labels:** `area:ad-studio`, `type:bug`, `priority:p1`, `effort:S`

**Quote (transcript 9:25).** Tanmay told Raja _"if you are not good at prompting, you can use 'improve with Gemini'… but sometimes the AI gives different from what exactly you're looking for."_ A salesperson telling a prospect not to trust a feature is a clear bug signal.

**Problem.** The improver appears to drop or mutate user intent. Without a diff view the user has no idea what changed and the result frustrates more often than it helps.

**Proposed fix.**
1. Audit the improver's system prompt — it should preserve the user's intent verbatim and only enrich (constraints, style, brand-aware additions).
2. Add a **"Show what changed"** diff view between original and improved prompt so the user can see the additions and revert specific phrases.
3. Track: ratio of "improve clicked" → "improve accepted" → "generation completed". If the accept-rate is <50%, the improver is hurting more than helping.

**Acceptance criteria.**
- New unit/integration tests verify the improver's output contains a superset of the user's tokens (no silent drops).
- Diff view shipped, default-collapsed.
- Telemetry events landed.

---

## Issue 8 — Plan for the Sora deprecation / API access change

**Labels:** `area:ad-studio`, `type:risk`, `priority:p1`, `effort:M`

**Quote (transcript 14:34).** _"Sora is going to be disconnected."_ Raja flagged that OpenAI is restructuring Sora API access. Our video pitch leans on **Sora 4K**.

**Problem.** A core paid feature depends on a third-party API whose availability is changing. Veo 4K is in our picker — but is it at feature parity? What breaks if Sora goes away tomorrow?

**Proposed fix.**
1. Audit feature parity between Sora 4K and Veo 4K: max duration, ratios, quality bench on standard ad prompts, latency, cost-per-second.
2. Document a **fallback policy**: if Sora errors with quota / 4xx, transparently retry on Veo with the same prompt. Surface the swap to the user post-generation ("rendered with Veo").
3. Decide whether to default-promote Veo in the picker now, with Sora as a "premium / experimental" tag.

**Acceptance criteria.**
- A parity matrix written into `nodejs-backend/docs/` or wherever the team prefers.
- Fallback chain implemented and tested with a forced-error harness.
- Error budget for Sora monitored — alert if >5% of Sora requests fail in a rolling hour.

---

## Issue 9 — Reconsider top-level naming: BrandIQ / AdStudio / AdFactory

**Labels:** `area:onboarding`, `type:ux`, `priority:p2`, `effort:S`

**Observation (transcript 1:36, 5:15, 25:00).** Tanmay had to verbally explain the distinction between BrandIQ ("set up your brand"), AdStudio ("generate ad copy + creatives"), and AdFactory ("agentic full campaign") two separate times. The names overlap conceptually for a new user.

**Problem.** Three names that all sound like "the place where ads are made" → cognitive load and tab-hopping confusion.

**Proposed fix.** Rename to outcome-based labels. Working draft:
- BrandIQ → **Brand kit** (or "Brands")
- AdStudio → **Quick generate** (or "One-off ads")
- AdFactory → **Full campaign** (or "Agentic campaigns")

Sidebar order should match the user's natural flow: Brand kit → Quick generate → Full campaign → Ads Manager (Autopilot).

**Acceptance criteria.**
- Three product labels finalised (after a 1-day customer-research sanity check on 3–5 SMB users).
- Sidebar + page titles + tooltips updated atomically.
- Old URLs redirect to new ones.

---

## Issue 10 — Multi-client agency view: fast brand switcher

**Labels:** `area:brand-iq`, `area:onboarding`, `type:ux`, `priority:p2`, `effort:S`

**Quote (transcript 3:38, 35:48).** Raja: _"Monthly I go for three clients. Right now I'm having two clients only… solo only."_ He's the textbook ICP: solo agency, 2–5 clients, switching context constantly.

**Problem.** AdsGPT supports multiple brands but the demo never showed (and we should verify) a fast brand-switcher in the top bar. For a solo agency this is the single biggest day-to-day workflow concern.

**Proposed fix.**
1. Top-bar brand switcher (logo + name dropdown) visible on every page once >1 brand exists.
2. ⌘K / Ctrl-K command palette with "Switch to brand X" entries.
3. The currently active brand should be reflected in the URL (`/autopilot?brand=acme` etc.) so a copied link opens the same brand context.
4. "Recent brands" section sorted by last interaction.

**Acceptance criteria.**
- Switching brands updates every tab's data within 1s without a full page reload.
- The Autopilot ad-account picker, BrandIQ context, AdStudio defaults, and Ads Manager auth all respect the active brand.
- Keyboard switcher discoverable from the sidebar (icon + tooltip).

---

## Bonus / out-of-scope notes captured for posterity

- **Voice-input prompts in regional languages.** Raja's accent + audio quality made his prompt entry slow and error-prone. SMB users in tier-2 cities often type English with friction; voice-to-prompt in Tamil/Telugu/Hindi could unlock conversion. **Not** a blocker, but worth a research spike.
- **Variation count vs platform.** Carousel = 5 variations; the picker doesn't auto-suggest based on platform. Minor friction.
- **"Improve with Gemini" link to ChatGPT** — Tanmay mentioned at one point users could copy from ChatGPT. The product should be sufficient on its own; if we're recommending external tools we've under-built ours.
- **Trial provisioning is currently a manual sales action.** Implicit in Issue 3 but worth a one-line note: this is a process gap, not just a product one.
