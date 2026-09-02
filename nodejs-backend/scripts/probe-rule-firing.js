#!/usr/bin/env node
/**
 * probe-rule-firing — show exactly which entities each enabled rule WOULD act
 * on, using the real audit pipeline and the real evaluator, without acting.
 *
 * WHY NOT `runUserRuleCycle({ dryRun: true })`. A dry-run cycle still writes
 * action-log rows, still consumes the per-account action budget, still takes
 * the Redis lock the production cron needs, and can still dispatch alerts.
 * That is the right tool for rehearsing a run; it is the wrong one for
 * answering "if I deploy this normaliser change, what gets paused?" — which
 * needs to be answerable with zero side effects on shared state.
 *
 * So this calls `runAuditForAccount` (a read) and `evaluateRule` (a pure
 * function) directly. It writes nothing but the Meta usage telemetry that any
 * API call records, and it never touches Meta's write endpoints.
 *
 * It also prints each campaign's OBJECTIVE, because the dangerous case for a
 * `purchases == 0` rule is an App Install campaign, where zero purchases is
 * normal and pausing on it would be catastrophic.
 *
 * Usage:
 *   node scripts/probe-rule-firing.js GPT-435
 *   node scripts/probe-rule-firing.js GPT-435 --rule <ruleId>
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bizSdk = require("facebook-nodejs-business-sdk");

const AutopilotUserRule = require("../Module/autopilot/autopilotUserRule");
const { runAuditForAccount } = require("../services/metaAuditService");
const { evaluateRule } = require("../services/autopilot/userRuleEvaluator");
// `collectTargetsForRule` is exported under `_internals` — using the real one
// (rather than reimplementing the scoping) is the point: ad-set-scoped
// attachments and campaign-level guards must behave exactly as the cron does.
const {
  _internals: { collectTargetsForRule },
} = require("../services/autopilot/userRuleOrchestrator");
const { resolveFacebookConnection } = require("../utils/metaConnection");

const userId = process.argv[2];
const ruleFilterIdx = process.argv.indexOf("--rule");
const ruleFilter = ruleFilterIdx > -1 ? process.argv[ruleFilterIdx + 1] : null;

const acct = (id) => (String(id).startsWith("act_") ? String(id) : `act_${id}`);
const num = (v) =>
  Number.isFinite(Number(v))
    ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "—";

async function main() {
  if (!userId) {
    console.error("usage: node scripts/probe-rule-firing.js <userId> [--rule <id>]");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_CONNECTION_STRING);
  console.log(`db: ${mongoose.connection.name}  user: ${userId}\n`);

  const rules = await AutopilotUserRule.find({ userId, enabled: true }).lean();
  const scoped = ruleFilter
    ? rules.filter((r) => String(r._id) === ruleFilter)
    : rules;
  console.log(`${scoped.length} enabled rule(s)\n`);

  const resolved = await resolveFacebookConnection({
    userId,
    allowSingleFallback: true,
  });
  const accessToken = resolved.accessToken;

  // One audit per (account, lookback) — exactly how the orchestrator batches,
  // so the probe costs what a real cycle costs and no more.
  const auditCache = new Map();
  const objectiveCache = new Map();

  const getAudit = async (adAccountId, lookbackDays, campaignIds) => {
    const key = `${adAccountId}|${lookbackDays}|${[...campaignIds].sort().join(",")}`;
    if (auditCache.has(key)) return auditCache.get(key);
    const audit = await runAuditForAccount({
      userId,
      adAccountId: acct(adAccountId),
      accessToken,
      options: {
        lookbackDays,
        campaignIds: [...campaignIds],
        slimInsights: true,
        needsPrevious: false,
      },
    });
    auditCache.set(key, audit);
    return audit;
  };

  const getObjective = async (campaignId) => {
    if (objectiveCache.has(campaignId)) return objectiveCache.get(campaignId);
    let obj = "?";
    try {
      const c = await new bizSdk.Campaign(campaignId).get(["objective", "name"]);
      obj = c._data?.objective || c.objective || "?";
    } catch {
      obj = "unreadable";
    }
    objectiveCache.set(campaignId, obj);
    return obj;
  };

  let grandTotal = 0;
  const perAction = {};

  for (const rule of scoped) {
    const conds = (rule.conditions?.rules || [])
      .map((c) => `${c.field} ${c.op} ${c.value}`)
      .join(" AND ");
    console.log("─".repeat(78));
    console.log(`${rule.name}`);
    console.log(
      `  level=${rule.evaluateOn}  lookback=${rule.lookbackDays ?? rule.lookbackPreset}  action=${rule.action?.type}`,
    );
    console.log(`  IF ${conds}`);

    const lookback = Number(rule.lookbackDays) || 14;
    let hits = 0;

    // Group this rule's attachments by account so one audit serves them all.
    const byAccount = new Map();
    for (const a of rule.attachments || []) {
      if (!a?.adAccountId || !a?.campaignId) continue;
      if (!byAccount.has(a.adAccountId)) byAccount.set(a.adAccountId, []);
      byAccount.get(a.adAccountId).push(a);
    }

    for (const [adAccountId, atts] of byAccount) {
      const campaignIds = new Set(atts.map((a) => String(a.campaignId)));
      let audit;
      try {
        audit = await getAudit(adAccountId, lookback, campaignIds);
      } catch (err) {
        console.log(`  ⚠ ${acct(adAccountId)}: audit failed — ${err.message}`);
        continue;
      }

      for (const a of atts) {
        const objective = await getObjective(a.campaignId);
        const targets = collectTargetsForRule(
          rule,
          audit.entities,
          a.campaignId,
          a.adsetId || null,
        );
        const matched = targets.filter((t) => evaluateRule(rule, t));
        hits += matched.length;

        // The combination worth shouting about.
        const risky =
          /purchases/.test(conds) && /APP_INSTALLS|APP/i.test(objective);

        console.log(
          `  ${acct(adAccountId)} camp ${a.campaignId} [${objective}]` +
            `${risky ? "  ⚠ APP CAMPAIGN + purchases RULE" : ""}` +
            ` — ${targets.length} scored, ${matched.length} MATCH`,
        );

        for (const m of matched.slice(0, 6)) {
          const name = m.ad_name || m.adset_name || m.campaign_name || "(unnamed)";
          console.log(
            `      • ${String(name).slice(0, 42).padEnd(44)}` +
              ` spend=${num(m.spend)} purch=${num(m.purchases)} cpa=${num(m.cpa)}` +
              ` inst=${num(m.installs)} cpi=${num(m.cpi)} roas=${num(m.roas)}`,
          );
        }
        if (matched.length > 6) {
          console.log(`      … and ${matched.length - 6} more`);
        }
      }
    }

    const act = rule.action?.type || "?";
    perAction[act] = (perAction[act] || 0) + hits;
    grandTotal += hits;
    console.log(`  → ${hits} entit${hits === 1 ? "y" : "ies"} would be ${act}d`);
  }

  console.log("\n" + "═".repeat(78));
  console.log(`TOTAL matches: ${grandTotal}`);
  for (const [a, n] of Object.entries(perAction)) {
    console.log(`   ${a}: ${n}`);
  }
  console.log(`(${auditCache.size} account-audits made; nothing was written or changed)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("ERR:", err.message);
  process.exit(1);
});
