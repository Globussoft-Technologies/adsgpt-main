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

const runCronJobs = () => {
    // Phase 3 — hourly Autopilot orchestrator
    registerAutopilotCron();

    // Orphan-reservation sweeper (every 10 min by default)
    registerCreditReservationSweepCron();

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
