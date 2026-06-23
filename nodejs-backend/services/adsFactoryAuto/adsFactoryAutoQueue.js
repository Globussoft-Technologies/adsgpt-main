const { Queue, Worker } = require("bullmq");
const logger = require("../../utils/logger");

function resolvePresetCron(frequency, hour = 0) {
  const h = parseInt(hour, 10) || 0;
  switch (frequency) {
    case "daily": return `0 ${h} * * *`;
    case "every_weekday": return `0 ${h} * * 1-5`;
    case "every_weekend": return `0 ${h} * * 0,6`;
    default: return null;
  }
}

// BullMQ needs its own dedicated ioredis connection — cannot share pub/sub connections
const connection = {
  host:     process.env.HOST,
  port:     Number(process.env.RD_PORT),
  username: process.env.RD_USERNAME,
  password: process.env.redisPass,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

const QUEUE_NAME = "ads-factory-autopilot";

let _queue  = null;
let _worker = null;

function getQueue() {
  if (!_queue) _queue = new Queue(QUEUE_NAME, { connection });
  return _queue;
}

// Unique BullMQ job name per AdsFactoryJob doc — this is how we find + cancel repeatables
function jobName(jobId) {
  return `ads-factory:${jobId}`;
}

// Converts a saved ScheduleSchema doc → the object buildRepeatOpts expects.
// Shared by controller and reloadActiveJobs so both resolve the same way.
function resolveScheduleForQueue(schedule) {
  const { frequency, startDate, timezone } = schedule;

  if (frequency === "does_not_repeat") {
    let runAt;
    if (startDate) {
      try {
        const cronParser = require("cron-parser");
        const hour = Number(schedule.hour) || 0;
        const tz   = timezone || "UTC";
        runAt = cronParser.parseExpression(`0 ${hour} * * *`, {
          currentDate: new Date(startDate),
          tz,
        }).next().toDate();
      } catch (e) {
        logger.warn(`[resolveScheduleForQueue] cron-parser failed (${e.message}), falling back to startDate`);
        runAt = new Date(startDate);
      }
    } else {
      runAt = new Date();
    }
    return { type: "once", runAt, timezone };
  }

  if (frequency === "custom") {
    const cf = schedule.customFrequency || {};
    return {
      type:         "custom",
      repeatEvery:  cf.repeatEvery  || 1,
      repeatUnit:   cf.repeatUnit   || "week",
      repeatOnDays: cf.repeatOnDays || [],
      timezone,
      hour:         schedule.hour || 0,
    };
  }

  // Preset (daily / every_weekday / every_weekend) → dynamic cron based on hour
  return { type: "cron", cronExpression: resolvePresetCron(frequency, schedule.hour), timezone };
}

/**
 * Convert the resolved schedule object (from controller) into BullMQ repeat options.
 *
 * schedule.type is one of: "cron" | "interval" | "once"
 *
 * For "interval" the UI only exposes days + hours (no minutes/seconds),
 * so intervalDays and intervalHours are both supported.
 * Total ms = (days * 86_400_000) + (hours * 3_600_000)
 */
function buildRepeatOpts(schedule) {
  if (schedule.type === "cron") {
    return {
      repeat: {
        pattern: schedule.cronExpression,
        tz:      schedule.timezone || "UTC",
      },
    };
  }

  if (schedule.type === "interval") {
    const days  = Number(schedule.intervalDays  || 0);
    const hours = Number(schedule.intervalHours || 0);
    const every = days * 86_400_000 + hours * 3_600_000;
    if (every <= 0) throw new Error("interval must be at least 1 hour");
    return { repeat: { every } };
  }

  // "custom" — repeatEvery + repeatUnit + optional repeatOnDays
  if (schedule.type === "custom") {
    const every  = schedule.repeatEvery || 1;
    const unit   = schedule.repeatUnit  || "week";
    const days   = schedule.repeatOnDays || [];
    const tz     = schedule.timezone || "UTC";

    const hour   = schedule.hour || 0;

    if (unit === "day") {
      // Every N days at specific hour
      return { repeat: { pattern: `0 ${hour} */${every} * *`, tz } };
    }

    // Every N weeks on selected days — build a cron day-of-week list
    // If no days selected fall back to Monday
    const DOW_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const dowNums = days.length > 0
      ? days.map((d) => DOW_MAP[d]).filter((n) => n !== undefined).join(",")
      : "1";
    // BullMQ does not natively support "every N weeks" cron, so we fire on the
    // correct days every week and let the orchestrator skip based on lastRunAt if needed.
    return { repeat: { pattern: `0 ${hour} * * ${dowNums}`, tz } };
  }

  // "once" — one-shot with delay, no repeat
  if (schedule.type === "once" && schedule.runAt) {
    const delay = Math.max(0, new Date(schedule.runAt).getTime() - Date.now());
    return { delay };
  }

  return {};
}

/**
 * Register (or re-register) a BullMQ job for an AdsFactoryJob doc.
 * Safe to call multiple times — always cancels the old entry first.
 *
 * @param {string|ObjectId} jobId  - AdsFactoryJob._id
 * @param {object}          schedule - resolved schedule from controller
 */
async function scheduleJob(jobId, schedule) {
  const queue = getQueue();
  await cancelJob(jobId);

  const opts = buildRepeatOpts(schedule);

  await queue.add(
    jobName(jobId),
    { jobId: jobId.toString() },
    {
      ...opts,
      // attempts = 1 → no automatic retries.
      // Retrying a run that already called createAd would post a duplicate ad on Meta.
      // The next scheduled tick will naturally retry on the next cycle.
      attempts:         1,
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 20 },
    }
  );
}

/**
 * Remove all BullMQ entries (repeatable + delayed/waiting) for a given AdsFactoryJob id.
 * does_not_repeat jobs are stored as plain delayed jobs (no repeat key) — they must be
 * found via getDelayed()/getWaiting() and removed by job id, otherwise every restart
 * adds a new duplicate entry and all of them fire.
 */
async function cancelJob(jobId) {
  const queue = getQueue();
  const name  = jobName(jobId);

  // 1. Remove repeatable entries (daily / weekly / custom cron jobs)
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const rep of repeatableJobs) {
    if (rep.name === name) {
      await queue.removeRepeatableByKey(rep.key);
    }
  }

  // 2. Remove delayed + waiting one-shot entries (does_not_repeat jobs)
  // BullMQ stores these as regular jobs with a future timestamp, not as repeatables.
  const [delayed, waiting] = await Promise.all([
    queue.getDelayed(),
    queue.getWaiting(),
  ]);
  for (const j of [...delayed, ...waiting]) {
    if (j.name === name) {
      await j.remove().catch(() => {});
    }
  }
}

/**
 * Fetch the next scheduled run time from BullMQ for a given AdsFactoryJob id.
 */
async function getNextRunTime(jobId, schedule = null) {
  const queue = getQueue();
  const name  = jobName(jobId);
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const rep of repeatableJobs) {
    if (rep.name === name) {
      return new Date(rep.next);
    }
  }

  // Fallback for paused jobs or one-shot jobs not in BullMQ repeatables.
  if (schedule) {
    if (schedule.frequency === "does_not_repeat") {
      if (!schedule.startDate) return null;
      try {
        const parser = require("cron-parser");
        const hour   = Number(schedule.hour) || 0;
        const result = parser.parseExpression(`0 ${hour} * * *`, {
          currentDate: new Date(schedule.startDate),
          tz: schedule.timezone || "UTC",
        }).next().toDate();
        return result;
      } catch (e) {
        logger.warn(`[getNextRunTime] cron-parser failed (${e.message}), falling back to startDate`);
        return new Date(schedule.startDate);
      }
    }
    if (schedule.cronExpression) {
      try {
        const parser = require("cron-parser");
        const interval = parser.parseExpression(schedule.cronExpression, {
          tz: schedule.timezone || "UTC",
        });
        return interval.next().toDate();
      } catch (err) {}
    }
  }

  return null;
}

/**
 * Queue a single immediate (non-repeating) run — used by runNow endpoint.
 */
async function runJobNow(jobId) {
  const queue = getQueue();
  // Use a unique jobId per manual trigger so BullMQ de-dupes concurrent calls.
  // attempts = 1 → no retries on manual runs either (would duplicate the ad).
  await queue.add(
    `${jobName(jobId)}:manual:${Date.now()}`,
    { jobId: jobId.toString() },
    {
      attempts:         1,
      removeOnComplete: true,
      removeOnFail:     { count: 10 },
    }
  );
}

/**
 * Start the BullMQ worker. Called once from index.js after MongoDB connects.
 * Lazy-imports the orchestrator to avoid circular deps at module load.
 */
function startWorker() {
  if (_worker) return _worker;

  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { adsFactoryOrchestrator } = require("./adsFactoryAutoOrchestrator");
      await adsFactoryOrchestrator.run(job.data.jobId);
    },
    {
      connection,
      // concurrency: 1 — process one tick at a time so the same AdsFactoryJob
      // can never run in parallel with itself and post two ads simultaneously.
      concurrency: 1,
    }
  );

  _worker.on("failed", (job, err) => {
    logger.error(`[adsFactoryAuto:worker] job ${job?.data?.jobId} failed: ${err.message}`);
  });

  _worker.on("completed", (job) => {
    logger.info(`[adsFactoryAuto:worker] job ${job?.data?.jobId} completed`);
  });

  return _worker;
}

/**
 * On server boot, re-register all active AdsFactoryJob docs into BullMQ
 * so schedules survive restarts.
 */
async function reloadActiveJobs() {
  const AdsFactoryJob = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
  const Campaign      = require("../../Module/adFactory/adFactory");
  const activeJobs = await AdsFactoryJob.find({ status: "active" }).lean();

  // On restart, any campaign still marked in-progress was interrupted mid-run.
  // Reset them to "error" so the next tick can re-run instead of skipping forever.
  const mongoose = require("mongoose");
  const campaignObjectIds = [...new Set(activeJobs.map((j) => j.campaignId).filter(Boolean))]
    .map((id) => { try { return new mongoose.Types.ObjectId(id); } catch { return null; } })
    .filter(Boolean);
  if (campaignObjectIds.length) {
    const result = await Campaign.updateMany(
      { _id: { $in: campaignObjectIds }, $or: [{ status: "in-progress" }, { "results.status": "in-progress" }] },
      { $set: { status: "error", "results.status": "error" } }
    );
    if (result.modifiedCount > 0) {
      logger.warn(`[adsFactoryAuto] reset ${result.modifiedCount} stuck in-progress campaign(s) to error on startup`);
    }
  }

  // Find which campaignIds actually exist in DB
  const existingCampaigns = await Campaign.find({ _id: { $in: campaignObjectIds } }, { _id: 1 }).lean();
  const existingCampaignIds = new Set(existingCampaigns.map((c) => c._id.toString()));

  // Auto-pause jobs whose campaign no longer exists AND remove them from BullMQ queue
  const orphanJobs = activeJobs.filter((j) => j.campaignId && !existingCampaignIds.has(j.campaignId.toString()));
  if (orphanJobs.length) {
    const orphanIds = orphanJobs.map((j) => j._id);
    await AdsFactoryJob.updateMany({ _id: { $in: orphanIds } }, { $set: { status: "paused" } });
    // Also cancel from BullMQ so they don't fire on this boot
    for (const job of orphanJobs) {
      await cancelJob(job._id.toString()).catch(() => {});
    }
    logger.warn(`[adsFactoryAuto] auto-paused + removed from queue ${orphanJobs.length} job(s) with deleted campaigns: ${orphanIds.join(", ")}`);
  }

  // Auto-complete does_not_repeat jobs that already have a successful/partial run.
  // These were left "active" before the completed-marking fix was deployed.
  const staleOneShots = activeJobs.filter(
    (j) =>
      j.schedule?.frequency === "does_not_repeat" &&
      (j.runHistory || []).some((r) => r.status === "success" || r.status === "partial")
  );
  if (staleOneShots.length) {
    const staleIds = staleOneShots.map((j) => j._id);
    await AdsFactoryJob.updateMany(
      { _id: { $in: staleIds } },
      { $set: { status: "completed", "schedule.nextRunAt": null } }
    );
    for (const job of staleOneShots) {
      await cancelJob(job._id.toString()).catch(() => {});
    }
    logger.warn(`[adsFactoryAuto] auto-completed ${staleOneShots.length} stale does_not_repeat job(s) on startup: ${staleIds.join(", ")}`);
  }
  const staleOneShotIds = new Set(staleOneShots.map((j) => j._id.toString()));

  // For does_not_repeat jobs that already ran (lastRunAt set) but still show a stale nextRunAt,
  // clear it so the UI doesn't display a phantom next run time.
  const staleNextRunAt = activeJobs.filter(
    (j) =>
      j.schedule?.frequency === "does_not_repeat" &&
      j.schedule?.lastRunAt &&
      j.schedule?.nextRunAt &&
      !staleOneShotIds.has(j._id.toString())
  );
  if (staleNextRunAt.length) {
    await AdsFactoryJob.updateMany(
      { _id: { $in: staleNextRunAt.map((j) => j._id) } },
      { $set: { "schedule.nextRunAt": null } }
    );
    logger.warn(`[adsFactoryAuto] cleared stale nextRunAt for ${staleNextRunAt.length} does_not_repeat job(s) that already ran`);
  }

  const validJobs = activeJobs.filter(
    (j) =>
      (!j.campaignId || existingCampaignIds.has(j.campaignId.toString())) &&
      !staleOneShotIds.has(j._id.toString())
  );

  let count = 0;
  let skippedPast = 0;
  for (const job of validJobs) {
    try {
      const resolved = resolveScheduleForQueue(job.schedule);

      // For one-shot (does_not_repeat) jobs — strict rules on restart:
      //   1. Already ran (lastRunAt set) → skip entirely, never auto-fire again.
      //      (success/partial already marked completed above; failed stays active for manual retry)
      //   2. Scheduled time is in the past and job never ran → mark as failed (missed), cancel from queue.
      //      The user chose a specific time — firing late silently is worse than failing visibly.
      //   3. Scheduled time is still in the future → re-enqueue with correct delay (normal case).
      if (resolved.type === "once") {
        if (job.schedule?.lastRunAt) {
          logger.warn(`[adsFactoryAuto] skipping does_not_repeat job ${job._id} on reload — already ran (lastRunAt=${job.schedule.lastRunAt}); user must trigger manually`);
          await cancelJob(job._id.toString()).catch(() => {});
          skippedPast++;
          continue;
        }

        // Check if the scheduled time has already passed
        const scheduledAt = resolved.runAt ? new Date(resolved.runAt) : null;
        if (scheduledAt && scheduledAt < new Date()) {
          // Grace window: if the job was scheduled within the last 10 minutes,
          // run it immediately instead of marking it missed. This handles the case
          // where nodemon/deployment restarts the server seconds before/after the
          // scheduled time and the job never got a chance to fire.
          const GRACE_MS = 10 * 60 * 1000; // 10 minutes
          const overdueMs = Date.now() - scheduledAt.getTime();
          if (overdueMs <= GRACE_MS) {
            logger.info(`[adsFactoryAuto] does_not_repeat job ${job._id} missed by ${Math.round(overdueMs / 1000)}s — within grace window, running immediately`);
            // Enqueue with delay=0 so it fires right away
            await scheduleJob(job._id, { ...resolved, runAt: new Date() });
            count++;
            continue;
          }

          // Beyond grace window — truly missed, mark failed
          logger.warn(`[adsFactoryAuto] does_not_repeat job ${job._id} missed its scheduled time (${scheduledAt.toISOString()}) — marking failed`);
          await AdsFactoryJob.updateOne(
            { _id: job._id },
            {
              $set:  { "schedule.nextRunAt": null },
              $push: {
                runHistory: {
                  runId:       `missed-${Date.now()}`,
                  startedAt:   scheduledAt,
                  completedAt: new Date(),
                  status:      "failed",
                  error:       `Scheduled run was missed — server was not running at ${scheduledAt.toISOString()}`,
                },
              },
            }
          );
          await cancelJob(job._id.toString()).catch(() => {});
          skippedPast++;
          continue;
        }
      }

      await scheduleJob(job._id, resolved);
      count++;
    } catch (err) {
      logger.error(`[adsFactoryAuto] failed to reload job ${job._id}: ${err.message}`);
    }
  }
  logger.info(`[adsFactoryAuto] reloaded ${count} active autopilot jobs into BullMQ  (skipped ${orphanJobs.length} orphan + ${skippedPast} already-ran does_not_repeat)`);
}

module.exports = { scheduleJob, cancelJob, runJobNow, startWorker, reloadActiveJobs, resolveScheduleForQueue, resolvePresetCron, getNextRunTime };
