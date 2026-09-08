/**
 * retireShadowedModelRows.js — stop dead catalog rows shadowing live models.
 *
 * Run with:
 *   node scripts/retireShadowedModelRows.js            # dry run (default)
 *   node scripts/retireShadowedModelRows.js --apply    # write
 *
 * ─── The problem ─────────────────────────────────────────────────────────────
 * When the Gemini image models went GA they dropped their `-preview` suffix.
 * The old rows were disabled but left in place, and duplicates ("… 1") were
 * created alongside. The result is that several strings resolve to a DEAD row
 * rather than the live model:
 *
 *   gemini-3.1-flash-image-preview  → exact canonicalKey hit on a DISABLED row
 *   gemini-3-pro-image-preview      → exact canonicalKey hit on a DISABLED row
 *
 * resolveModelByAlias() tries the exact canonicalKey first, so the dead row
 * wins over the live GA row that carries the same string as an alias. And
 * getCachedModel() scans ALL rows — archived ones included — so archiving is
 * not enough to break the collision. The row has to stop claiming the name.
 *
 * Between 2026-08-24 and 2026-09-02 that mispricing charged 0 credits for 45
 * image generations across 19 users, because a model that cannot be priced
 * resolves to 0 and freezeCredits treats 0 as a free no-op.
 *
 * Current frontends send GA ids, so this is dormant — but nothing prevents a
 * cached bundle or an un-updated mobile build from sending the old strings
 * again, and the collision is still live in the catalog today.
 *
 * ─── What it does ────────────────────────────────────────────────────────────
 * For each retired row it:
 *   · renames  canonicalKey → "retired:<original>"
 *   · clears   aliases      → []
 *
 * so the name is freed and resolution falls through to the live GA row, which
 * already carries the `-preview` string as an alias. Old clients then get the
 * CORRECT price instead of 0.
 *
 * Renaming rather than deleting keeps the row (and its history) recoverable:
 * reversing this is a rename back and restoring the alias list, which the
 * dry-run output records for you.
 *
 * ─── Safety ──────────────────────────────────────────────────────────────────
 *   · Dry run by default; --apply is required to write.
 *   · Only ever touches rows that are BOTH disabled and shadowing a live row.
 *     An enabled row is never modified, whatever its name.
 *   · Refuses to act if retiring a row would leave a name with no live owner.
 *   · Idempotent: an already-retired row is skipped.
 *
 * ─── Not handled here ────────────────────────────────────────────────────────
 * Three enabled image models have no `ultra_high` tier and no flat-credit
 * fallback (gpt-image-2, seedream-5.0-lite, gemini-3-pro-image). This script
 * REPORTS them but will not invent prices — that is a business decision and
 * belongs in Admin.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const AIModelConfiguration = require("../Module/aiModel/aiModelConfiguration");

const APPLY = process.argv.includes("--apply");
const RETIRED_PREFIX = "retired:";
const QUALITIES = ["low", "medium", "high", "ultra_high"];

function isLive(row) {
  return row.enabled !== false && row.archived !== true;
}

/**
 * Every string a row answers to, deduped — rows commonly repeat their own
 * canonicalKey inside `aliases`, which would otherwise make a single row look
 * like two competing owners of the same name.
 */
function namesOf(row) {
  return [...new Set([row.canonicalKey, ...(row.aliases || [])])];
}

async function main() {
  if (!process.env.MONGO_CONNECTION_STRING) {
    throw new Error("MONGO_CONNECTION_STRING is not set");
  }
  await mongoose.connect(process.env.MONGO_CONNECTION_STRING);
  console.log(
    `\n[retire-shadowed] ${APPLY ? "APPLY" : "DRY RUN"} against ${mongoose.connection.name}\n`,
  );

  const rows = await AIModelConfiguration.find({}).lean();
  const live = rows.filter(isLive);

  // name -> the live rows that answer to it
  const liveOwners = new Map();
  for (const row of live) {
    for (const name of namesOf(row)) {
      if (!liveOwners.has(name)) liveOwners.set(name, []);
      liveOwners.get(name).push(row);
    }
  }

  const plan = [];
  for (const row of rows) {
    if (isLive(row)) continue;
    if (row.canonicalKey.startsWith(RETIRED_PREFIX)) continue;

    // Does this dead row claim any name a live model also answers to?
    const shadowed = namesOf(row).filter((n) => liveOwners.has(n));
    if (!shadowed.length) continue;

    plan.push({
      _id: row._id,
      canonicalKey: row.canonicalKey,
      aliases: row.aliases || [],
      shadowed,
      liveTargets: shadowed.map(
        (n) => `${n} → ${liveOwners.get(n).map((r) => r.canonicalKey).join("/")}`,
      ),
    });
  }

  if (!plan.length) {
    console.log("  Nothing to retire — no disabled row is shadowing a live model.");
  }

  for (const p of plan) {
    console.log(`  ${p.canonicalKey}`);
    console.log(`     aliases: ${JSON.stringify(p.aliases)}`);
    console.log(`     shadows: ${p.liveTargets.join(", ")}`);
    console.log(
      `     → rename to "${RETIRED_PREFIX}${p.canonicalKey}", clear aliases`,
    );

    // Safety: never free a name that no live row can serve.
    const orphaned = p.shadowed.filter((n) => !liveOwners.get(n)?.length);
    if (orphaned.length) {
      console.log(`     !! SKIPPED — no live owner for ${orphaned.join(", ")}`);
      p.skip = true;
    }
  }

  if (APPLY) {
    let done = 0;
    for (const p of plan) {
      if (p.skip) continue;
      await AIModelConfiguration.updateOne(
        { _id: p._id, canonicalKey: p.canonicalKey },
        { $set: { canonicalKey: `${RETIRED_PREFIX}${p.canonicalKey}`, aliases: [] } },
      );
      done++;
    }
    console.log(`\n  retired ${done} row(s)`);
    console.log(
      "  NOTE: every API process must refresh its model cache (restart, or any " +
        "Admin model save) before this takes effect there.",
    );
  } else if (plan.length) {
    console.log(
      `\n  DRY RUN — ${plan.filter((p) => !p.skip).length} row(s) would be retired. ` +
        "Re-run with --apply to write.",
    );
    console.log(
      "  To reverse: rename back and restore the alias list printed above.",
    );
  }

  // ── Report-only: names claimed by MORE THAN ONE live row ─────────────────
  //
  // Retiring the dead rows does not fix this. When two live models answer to
  // the same string, which one wins depends on the cache's sort order
  // (sortOrder, then canonicalKey) — so the price for that string is decided
  // by an incidental ordering rather than a deliberate choice. Someone has to
  // pick the intended owner and drop the alias from the other row.
  const ambiguous = [];
  for (const [name, allOwners] of liveOwners) {
    // Distinct ROWS, not distinct claims — a row is not ambiguous with itself.
    const seen = new Set();
    const owners = allOwners.filter((r) => {
      const id = String(r._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (owners.length < 2) continue;
    ambiguous.push(
      `"${name}" → ${owners
        .map((r) => {
          const tiers = (r.qualityTiers || [])
            .map((t) => `${t.quality}:${t.credits}`)
            .join(",");
          return `${r.canonicalKey} (credits=${r.credits ?? "—"}${tiers ? `, tiers=[${tiers}]` : ""})`;
        })
        .join("  VS  ")}`,
    );
  }

  if (ambiguous.length) {
    console.log("\n  ⚠ AMBIGUOUS — one name, several live models, different prices:");
    ambiguous.forEach((a) => console.log(`    · ${a}`));
    console.log(
      "    This script does NOT resolve these — the winner is decided by cache\n" +
        "    sort order today. Decide the intended owner and remove the alias\n" +
        "    from the other row in Admin.",
    );
  }

  // ── Report-only: enabled models that cannot price every quality ───────────
  const unpriceable = [];
  for (const row of live) {
    const tiers = row.qualityTiers || [];
    if (row.credits == null && tiers.length === 0) {
      unpriceable.push(`${row.canonicalKey}: no price at all`);
      continue;
    }
    if (row.credits == null && tiers.length) {
      const missing = QUALITIES.filter(
        (q) => !tiers.some((t) => String(t.quality).toLowerCase() === q),
      );
      if (missing.length) {
        unpriceable.push(
          `${row.canonicalKey}: no flat fallback, missing tier(s) [${missing.join(", ")}]`,
        );
      }
    }
  }

  if (unpriceable.length) {
    console.log("\n  REPORT — enabled models that cannot price every quality:");
    unpriceable.forEach((u) => console.log(`    · ${u}`));
    console.log(
      "    Set these in Admin. This script will not invent prices.",
    );
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[retire-shadowed] failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
