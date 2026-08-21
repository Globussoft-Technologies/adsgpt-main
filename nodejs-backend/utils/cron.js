const { default: axios } = require('axios');
const { deleteOldChatSessionsFromPlans } = require('../controllers/Chats');
const { dispatchDripEmails } = require('../controllers/newsletter.controller');
const { features } = require('./features');
const cron = require('node-cron');
const IMAGE = require("../Module/adCreative/adCreativeImages");
const { s3Client } = require('../storage/s3');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { runUserRuleCycle } = require('../services/autopilot/userRuleOrchestrator');
const UnifiedCreditController = require('../controllers/UnifiedCreditController');
const oauthSigningKeyService = require('../services/oauth/signingKeyService');
const { reconcileBillingCycles } = require('../services/billingReconciliation');
require('dotenv').config();

// -----------------------------------------------------------------------------
// Autopilot scheduler — Phase 3
// Opt-in via env: AUTOPILOT_ENABLED=true. Off by default to prevent surprise
// activation on any environment that hasn't consciously enabled it.
// -----------------------------------------------------------------------------
const registerAutopilotCron = () => {
  const enabled = String(process.env.AUTOPILOT_ENABLED || 'false').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[autopilot] scheduler disabled (AUTOPILOT_ENABLED != true)');
    return;
  }
  const schedule = process.env.AUTOPILOT_CRON || '0 * * * *'; // hourly by default
  const dryRun = String(process.env.AUTOPILOT_DRY_RUN || 'true').toLowerCase() !== 'false';

  if (!cron.validate(schedule)) {
    console.error(`[autopilot] invalid AUTOPILOT_CRON: ${schedule}. Scheduler not registered.`);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      // v4 — user-defined rules drive the cycle. Discovery comes from
      // AutopilotUserRule.find({ enabled: true }), grouped by user+account
      // off rule.attachments. The 37 backend rules are no longer evaluated
      // by autopilot (they remain in use by Ads Manager's audit endpoint).
      await runUserRuleCycle({ dryRun });
    } catch (err) {
      console.error('[autopilot] cron tick failed:', err.message);
    }
  });
  console.log(`[autopilot] scheduler registered: cron="${schedule}" dryRun=${dryRun}`);
};

// -----------------------------------------------------------------------------
// Credit reservation sweeper
// Refunds CreditReservation receipts older than CREDIT_RESERVATION_MAX_AGE_MIN
// (default 60 min). Closes the orphan-hold gap when Python silently drops a
// generation — without this, those credits stay locked in `used_*` forever
// because the 24h TTL only deletes the receipt, it does not refund.
// -----------------------------------------------------------------------------
const registerCreditReservationSweepCron = () => {
    const enabled =
        String(process.env.CREDIT_RESERVATION_SWEEP_ENABLED || 'true').toLowerCase() === 'true';
    if (!enabled) {
        console.log('[credit-sweep] disabled (CREDIT_RESERVATION_SWEEP_ENABLED=false)');
        return;
    }
    const schedule = process.env.CREDIT_RESERVATION_SWEEP_CRON || '*/10 * * * *';
    const maxAgeMin = Math.max(
        5,
        parseInt(process.env.CREDIT_RESERVATION_MAX_AGE_MIN || '60', 10),
    );
    if (!cron.validate(schedule)) {
        console.error(
            `[credit-sweep] invalid CREDIT_RESERVATION_SWEEP_CRON: ${schedule}. Cron not registered.`,
        );
        return;
    }
    cron.schedule(schedule, async () => {
        try {
            const { swept, refunded } = await UnifiedCreditController.sweepStaleReservations({
                maxAgeMs: maxAgeMin * 60 * 1000,
            });
            if (swept > 0) {
                console.log(
                    `[credit-sweep] swept=${swept} refunded=${refunded} (age>${maxAgeMin}min)`,
                );
            }
        } catch (err) {
            console.error('[credit-sweep] cron tick failed:', err.message);
        }
    });
    console.log(
        `[credit-sweep] scheduler registered: cron="${schedule}" maxAge=${maxAgeMin}min`,
    );
};

// -----------------------------------------------------------------------------
// OAuth signing key rotation
// Once a day the cron checks whether the newest active signing key is older
// than OAUTH_SIGNING_KEY_ROTATION_DAYS (default 90). If so, it mints a new
// active key and retires the old one — the retired key stays in JWKS until
// its published_until so already-issued tokens keep verifying.
//
// Boot-time bootstrap: the first call to getActiveSigningKey() during a real
// /oauth/token request will create the initial key if none exist. We ALSO
// warm it up here on cron registration so the JWKS endpoint returns keys
// immediately after boot, not only after the first token request.
// -----------------------------------------------------------------------------
const registerOAuthSigningKeyRotationCron = () => {
    const enabled = String(process.env.OAUTH_ENABLED || 'true').toLowerCase() === 'true';
    if (!enabled) {
        console.log('[oauth-keyrot] disabled (OAUTH_ENABLED=false)');
        return;
    }
    const schedule = process.env.OAUTH_SIGNING_KEY_ROTATION_CRON || '0 3 * * *';
    const rotationDays = Math.max(
        1,
        parseInt(process.env.OAUTH_SIGNING_KEY_ROTATION_DAYS || '90', 10),
    );
    if (!cron.validate(schedule)) {
        console.error(
            '[oauth-keyrot] invalid key rotation schedule. Cron not registered.',
        );
        return;
    }

    // Warm-up: ensure a key exists so JWKS is populated at boot.
    oauthSigningKeyService.getActiveSigningKey().catch((err) =>
        console.error('[oauth-keyrot] boot warm-up failed:', err.message),
    );

    cron.schedule(schedule, async () => {
        try {
            const active = await oauthSigningKeyService.getActiveSigningKey();
            const ageMs = Date.now() - new Date(active.activated_at).getTime();
            const rotateAfterMs = rotationDays * 24 * 60 * 60 * 1000;
            if (ageMs >= rotateAfterMs) {
                console.log(
                    `[oauth-keyrot] rotating (age=${Math.round(ageMs / 86400000)}d, threshold=${rotationDays}d)`,
                );
                await oauthSigningKeyService.rotateSigningKey();
                console.log('[oauth-keyrot] signing key rotated successfully');
            }
        } catch (err) {
            console.error('[oauth-keyrot] cron tick failed:', err.message);
        }
    });
    console.log('[oauth-keyrot] scheduler registered');
};

// -----------------------------------------------------------------------------
// Billing cycle reconciliation
// Credit refill is otherwise triggered ONLY by login, so a user whose
// subscription rebills in aMember gets nothing until they next sign in — and
// anything they generate meanwhile is charged to the previous cycle's
// remainder. This reconciles local billing cycles against aMember on a
// schedule, closing that gap.
//
// Ships in dry-run so the first runs can be read in the logs before it is
// allowed to move credits. Set BILLING_RECONCILE_DRY_RUN=false to apply.
// -----------------------------------------------------------------------------
const registerBillingReconciliationCron = () => {
    const enabled =
        String(process.env.BILLING_RECONCILE_ENABLED || 'true').toLowerCase() === 'true';
    if (!enabled) {
        console.log('[billing-reconcile] disabled (BILLING_RECONCILE_ENABLED=false)');
        return;
    }

    const schedule = process.env.BILLING_RECONCILE_CRON || '0 2 * * *'; // 02:00 UTC daily
    const dryRun =
        String(process.env.BILLING_RECONCILE_DRY_RUN || 'true').toLowerCase() !== 'false';

    if (!cron.validate(schedule)) {
        console.error(
            `[billing-reconcile] invalid BILLING_RECONCILE_CRON: ${schedule}. Cron not registered.`,
        );
        return;
    }

    cron.schedule(schedule, async () => {
        try {
            await reconcileBillingCycles({ dryRun });
        } catch (err) {
            console.error('[billing-reconcile] run failed:', err.message);
        }
    });
    console.log(
        `[billing-reconcile] scheduler registered: cron="${schedule}" dryRun=${dryRun}`,
    );
};

const runCronJobs = () => {
    // Phase 3 — hourly Autopilot orchestrator
    registerAutopilotCron();

    // Grant renewed credits without waiting for a login (daily at 02:00 UTC)
    registerBillingReconciliationCron();

    // Orphan-reservation sweeper (every 10 min by default)
    registerCreditReservationSweepCron();

    // OAuth signing key rotation (daily at 03:00 by default)
    registerOAuthSigningKeyRotationCron();

    // Daily newsletter drip — runs at 09:00 UTC every day
    cron.schedule('0 9 * * *', async () => {
        try {
            await dispatchDripEmails();
        } catch (error) {
            console.error('[newsletter] cron error:', error);
        }
    });

    cron.schedule('0 0 * * *', async () => {
        //console.log('Running cron job to delete old chat sessions...');
        try {
            const chatHistoryFeature = "Chat history";
            const plans = features[chatHistoryFeature].plans;

            for (const [planNum, duration] of Object.entries(plans)) {
                let monthsToDelete;
                switch (duration) {
                    case "30 days":
                        monthsToDelete = 1;
                        break;
                    case "6 months":
                        monthsToDelete = 6;
                        break;
                    case "3 months":
                        monthsToDelete = 3;
                        break;
                    case "All":
                        monthsToDelete = 0; // No deletion for all
                        break;
                    default:
                        console.warn(`Unknown duration "${duration}" for plan ${planNum}`);
                        continue; // Skip to the next plan
                }
                if(monthsToDelete){
                    await deleteOldChatSessionsFromPlans(planNum, monthsToDelete);
                }
            }
        } catch (error) {
            console.error('Error running cron job:', error);
        }
    });
    // cron.schedule('0 0 * * *', deleteOldImages); // runs every midnight
};

const deleteOldImages = async () => {
    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
      // Find images of type: 1 that are 3+ days old
      const oldImages = await IMAGE.find({
        type: 1,
        createdAt: { $lte: threeDaysAgo },
      });
      
      for (const image of oldImages) {
        try {
          let parts = image.image_url.split("/");
          parts.shift();
          let newImageUrl = parts.join("/");
          
          // Delete image from storage
          await deleteImageFromS3(newImageUrl);
        } catch (error) {
          console.error(`Failed to delete image from storage: ${image.image_url}`, error);
        }
  
        // Remove image record from the database
        await IMAGE.findByIdAndDelete(image._id);
      }
    } catch (error) {
      console.error('Error during old image deletion:', error);
    }
  };

  const deleteImageFromS3 = async (key) => {
    try {
      const params = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
      };
  
      await s3Client.send(new DeleteObjectCommand(params));
    } catch (error) {
      console.error("Error deleting S3 image:", error);
    }
  };
  

module.exports = { runCronJobs, deleteImageFromS3 };
